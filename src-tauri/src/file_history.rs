use crate::history::git;
use serde_json::{Value, json};
use std::{collections::HashMap, path::Path, time::Duration};
fn validate(file: &str, rev: Option<&str>) -> Result<(), String> {
    if file.is_empty() || file.starts_with('-') || file.contains('\0') {
        return Err("Archivo no válido".into());
    }
    if let Some(r) = rev {
        if !(40..=64).contains(&r.len()) || !r.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("Commit no válido".into());
        }
    }
    Ok(())
}
fn run(dir: &Path, args: &[&str]) -> Result<String, String> {
    let mut base = vec!["--literal-pathspecs", "-c", "core.quotepath=false"];
    base.extend_from_slice(args);
    git(dir, &base, Duration::from_secs(60), 64 * 1024 * 1024)
}
fn history(dir: &Path, file: &str, rev: Option<&str>) -> Result<Vec<Value>, String> {
    validate(file, rev)?;
    let log = run(
        dir,
        &[
            "log",
            "--follow",
            "--no-color",
            "--no-ext-diff",
            "--name-only",
            "-n",
            "2000",
            "--format=%x1e%H%x1f%an%x1f%aI%x1f%s%x1f",
            rev.unwrap_or("HEAD"),
            "--",
            file,
        ],
    )?;
    let mut current = file.to_owned();
    Ok(log
        .split('\x1e')
        .filter(|r| !r.trim().is_empty())
        .map(|r| {
            let mut f = r.split('\x1f');
            let hash = f.next().unwrap_or_default().trim();
            let author = f.next().unwrap_or_default();
            let date = f.next().unwrap_or_default();
            let subject = f.next().unwrap_or_default();
            if let Some(path) = f
                .next()
                .unwrap_or_default()
                .lines()
                .map(|v| v.trim_end_matches('\r'))
                .find(|v| !v.is_empty())
            {
                current = path.to_owned();
            }
            json!({"hash":hash,"author":author,"date":date,"subject":subject,"path":current})
        })
        .collect())
}
fn blame(dir: &Path, file: &str, rev: &str) -> Result<Vec<Value>, String> {
    validate(file, Some(rev))?;
    let output = run(dir, &["blame", "--porcelain", "-M", rev, "--", file])?;
    let mut commits: HashMap<String, (String, i64, String)> = HashMap::new();
    let mut header: Option<(String, usize)> = None;
    let mut lines = vec![];
    for raw in output.split('\n') {
        if let Some(text) = raw.strip_prefix('\t') {
            if let Some((hash, line)) = header.take() {
                let (author, time, summary) = commits.get(&hash).cloned().unwrap_or_default();
                lines.push(json!({"line":line,"hash":hash,"author":author,"time":time,"summary":summary,"text":text.trim_end_matches('\r')}));
            }
            continue;
        }
        let parts: Vec<_> = raw.split_whitespace().collect();
        if parts.len() >= 3
            && (40..=64).contains(&parts[0].len())
            && parts[0].bytes().all(|b| b.is_ascii_hexdigit())
            && parts[1].parse::<usize>().is_ok()
        {
            if let Ok(line) = parts[2].parse::<usize>() {
                header = Some((parts[0].to_owned(), line));
                commits.entry(parts[0].to_owned()).or_default();
                continue;
            }
        }
        if let Some((ref hash, _)) = header {
            let Some((key, value)) = raw.split_once(' ') else {
                continue;
            };
            let entry = commits.entry(hash.clone()).or_default();
            match key {
                "author" => entry.0 = value.into(),
                "author-time" => entry.1 = value.parse::<i64>().unwrap_or(0) * 1000,
                "summary" => entry.2 = value.into(),
                _ => (),
            }
        }
    }
    Ok(lines)
}
#[tauri::command]
pub async fn file_history(
    dir: String,
    file: String,
    rev: Option<String>,
) -> Result<Vec<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || history(Path::new(&dir), &file, rev.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn file_blame(
    dir: String,
    file: String,
    rev: Option<String>,
) -> Result<Vec<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        blame(
            Path::new(&dir),
            &file,
            rev.as_deref().ok_or("Commit no válido")?,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, process::Command};
    fn g(d: &Path, a: &[&str]) -> String {
        let o = Command::new("git").args(a).current_dir(d).output().unwrap();
        assert!(o.status.success());
        String::from_utf8_lossy(&o.stdout).trim().to_owned()
    }
    #[test]
    fn follows_renames_and_blames() {
        let t = tempfile::tempdir().unwrap();
        let d = t.path();
        g(d, &["init", "-q"]);
        g(d, &["config", "user.name", "Test"]);
        g(d, &["config", "user.email", "test@example.com"]);
        fs::write(d.join("old.txt"), "first\n").unwrap();
        g(d, &["add", "old.txt"]);
        g(d, &["commit", "-qm", "first"]);
        g(d, &["mv", "old.txt", "new.txt"]);
        g(d, &["commit", "-qm", "rename"]);
        let h = g(d, &["rev-parse", "HEAD"]);
        let entries = history(d, "new.txt", Some(&h)).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[1]["path"], "old.txt");
        let lines = blame(d, "new.txt", &h).unwrap();
        assert_eq!(lines[0]["text"], "first");
        assert_eq!(lines[0]["author"], "Test");
    }
}
