use serde::Serialize;
use std::{
    io::{self, Read},
    path::Path,
    process::{Command, Stdio},
    thread,
    time::Duration,
};
use wait_timeout::ChildExt;

const PAGE_SIZE: usize = 500;
const MAX_COMMITS: usize = 200_000;
const MAX_OUTPUT: usize = 512 * 1024 * 1024;
const LOG_FORMAT: &str = "--format=%H%x1f%P%x1f%D%x1f%s%x1f%an%x1f%aI%x1f%ae%x1f%B%x1e";

#[derive(Debug, Serialize)]
pub(crate) struct Commit {
    hash: String,
    parents: Vec<String>,
    refs: Vec<String>,
    subject: String,
    author: String,
    date: String,
    email: String,
    message: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct History {
    pub(crate) head: String,
    pub(crate) commits: Vec<Commit>,
    pub(crate) limit: usize,
    pub(crate) has_more: bool,
}

// Drain both pipes concurrently so Git cannot deadlock on a full stderr buffer.
fn read_limited(mut reader: impl Read, limit: usize) -> io::Result<(Vec<u8>, bool)> {
    let mut result = Vec::new();
    let mut buffer = [0; 8192];
    let mut exceeded = false;
    loop {
        let n = reader.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        let keep = n.min(limit.saturating_sub(result.len()));
        result.extend_from_slice(&buffer[..keep]);
        exceeded |= keep < n;
    }
    Ok((result, exceeded))
}

pub(crate) fn git(
    dir: &Path,
    args: &[&str],
    timeout: Duration,
    max: usize,
) -> Result<String, String> {
    git_with_exit(dir, args, timeout, max, false)
}

pub(crate) fn git_with_exit(
    dir: &Path,
    args: &[&str],
    timeout: Duration,
    max: usize,
    allow_one: bool,
) -> Result<String, String> {
    git_bytes_with_exit(dir, args, timeout, max, allow_one)
        .map(|out| String::from_utf8_lossy(&out).into_owned())
}

pub(crate) fn git_bytes_with_exit(
    dir: &Path,
    args: &[&str],
    timeout: Duration,
    max: usize,
    allow_one: bool,
) -> Result<Vec<u8>, String> {
    let mut cmd = Command::new("git");
    cmd.args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .current_dir(dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("No se pudo iniciar Git: {e}"))?;
    let stdout = child.stdout.take().ok_or("No se pudo leer Git")?;
    let stderr = child.stderr.take().ok_or("No se pudo leer Git")?;
    let out = thread::spawn(move || read_limited(stdout, max));
    let err = thread::spawn(move || read_limited(stderr, 1024 * 1024));
    let status = match child.wait_timeout(timeout) {
        Ok(Some(status)) => Ok(status),
        Ok(None) => {
            let _ = child.kill();
            let _ = child.wait();
            Err("Git agotó el tiempo de espera".to_string())
        }
        Err(e) => {
            let _ = child.kill();
            let _ = child.wait();
            Err(format!("Error al esperar a Git: {e}"))
        }
    };
    let (out, exceeded) = out
        .join()
        .map_err(|_| "Error leyendo la salida de Git")?
        .map_err(|e| e.to_string())?;
    let (err, _) = err
        .join()
        .map_err(|_| "Error leyendo los errores de Git")?
        .map_err(|e| e.to_string())?;
    let status = status?;
    if exceeded {
        return Err("La salida de Git supera el límite permitido".into());
    }
    if !status.success() && !(allow_one && status.code() == Some(1)) {
        let message = String::from_utf8_lossy(&err).trim().to_string();
        return Err(if message.is_empty() {
            format!("Git terminó con {status}")
        } else {
            message
        });
    }
    Ok(out)
}

pub(crate) fn history_inner(
    dir: &Path,
    show_remote: bool,
    requested_limit: Option<usize>,
) -> Result<History, String> {
    let limit = requested_limit
        .filter(|&n| n > 0)
        .unwrap_or(PAGE_SIZE)
        .min(MAX_COMMITS);
    let quick = Duration::from_secs(15);
    let head = match git(
        dir,
        &["rev-parse", "--verify", "HEAD"],
        quick,
        16 * 1024 * 1024,
    ) {
        Ok(head) => head.trim().to_string(),
        Err(error) => {
            let symbolic = git(dir, &["symbolic-ref", "HEAD"], quick, 16 * 1024 * 1024)?;
            if !symbolic.trim().starts_with("refs/heads/") {
                return Err(error);
            }
            // An unborn branch has no commits; distinguish it from a damaged HEAD.
            let exists = Command::new("git")
                .args(["show-ref", "--verify", "--quiet", symbolic.trim()])
                .current_dir(dir)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map_err(|e| e.to_string())?;
            if exists.code() == Some(1) {
                return Ok(History {
                    head: String::new(),
                    commits: vec![],
                    limit,
                    has_more: false,
                });
            }
            return Err(error);
        }
    };
    let count = (limit + 1).to_string();
    let mut args = vec!["log", "--branches"];
    if show_remote {
        args.push("--remotes");
    }
    args.extend([
        "--tags",
        "HEAD",
        "--topo-order",
        "-n",
        count.as_str(),
        LOG_FORMAT,
    ]);
    let log = git(dir, &args, Duration::from_secs(120), MAX_OUTPUT)?;
    let mut commits: Vec<_> = log
        .split('\x1e')
        .map(str::trim_start)
        .filter(|s| !s.is_empty())
        .map(|record| {
            let mut fields = record.split('\x1f');
            let hash = fields.next().unwrap_or_default().to_owned();
            let parents = fields
                .next()
                .unwrap_or_default()
                .split_whitespace()
                .map(str::to_owned)
                .collect();
            let refs = fields.next().unwrap_or_default();
            let refs = if refs.is_empty() {
                vec![]
            } else {
                refs.split(", ").map(str::to_owned).collect()
            };
            let subject = fields.next().unwrap_or_default().to_owned();
            let author = fields.next().unwrap_or_default().to_owned();
            let date = fields.next().unwrap_or_default().to_owned();
            let email = fields.next().unwrap_or_default().to_owned();
            let message = fields
                .next()
                .filter(|s| !s.is_empty())
                .unwrap_or(&subject)
                .trim_end()
                .to_owned();
            Commit {
                hash,
                parents,
                refs,
                subject,
                author,
                date,
                email,
                message,
            }
        })
        .collect();
    let has_more = commits.len() > limit;
    commits.truncate(limit);
    Ok(History {
        head,
        commits,
        limit,
        has_more,
    })
}

#[tauri::command]
pub async fn history(
    dir: String,
    show_remote: Option<bool>,
    limit: Option<usize>,
) -> Result<History, String> {
    tauri::async_runtime::spawn_blocking(move || {
        history_inner(Path::new(&dir), show_remote.unwrap_or(true), limit)
    })
    .await
    .map_err(|e| format!("No se pudo leer el historial: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    fn run(dir: &Path, args: &[&str]) {
        assert!(
            Command::new("git")
                .args(args)
                .current_dir(dir)
                .output()
                .unwrap()
                .status
                .success()
        );
    }
    #[test]
    fn reads_empty_and_paginated_history() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path();
        run(dir, &["init", "-q"]);
        run(dir, &["config", "user.name", "Git Glam Test"]);
        run(dir, &["config", "user.email", "test@example.com"]);
        let empty = history_inner(dir, true, None).unwrap();
        assert!(empty.head.is_empty() && empty.commits.is_empty() && !empty.has_more);
        for n in 1..=2 {
            fs::write(dir.join("file.txt"), n.to_string()).unwrap();
            run(dir, &["add", "file.txt"]);
            run(dir, &["commit", "-q", "-m", &format!("commit {n}")]);
        }
        let page = history_inner(dir, false, Some(1)).unwrap();
        assert_eq!(page.commits.len(), 1);
        assert_eq!(page.commits[0].subject, "commit 2");
        assert_eq!(page.commits[0].hash, page.head);
        assert_eq!(page.commits[0].parents.len(), 1);
        assert!(page.has_more);
        let all = history_inner(dir, true, Some(5)).unwrap();
        assert_eq!(all.commits.len(), 2);
        assert!(!all.has_more);
    }
    #[test]
    fn rejects_non_repository() {
        let temp = tempfile::tempdir().unwrap();
        assert!(history_inner(temp.path(), true, None).is_err());
    }
}
