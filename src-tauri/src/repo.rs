use crate::history::{git, history_inner};
use serde_json::{Value, json};
use std::{collections::BTreeMap, path::Path, time::Duration};

fn quick(dir: &Path, args: &[&str]) -> Result<String, String> {
    git(dir, args, Duration::from_secs(15), 16 * 1024 * 1024)
}

fn tracking(text: &str) -> (Vec<String>, BTreeMap<String, Value>) {
    let mut names = Vec::new();
    let mut sync = BTreeMap::new();
    for line in text.lines().filter(|l| !l.is_empty()) {
        let mut parts = line.split('\x1f');
        let name = parts.next().unwrap_or_default();
        let upstream = parts.next().unwrap_or_default();
        let track = parts.next().unwrap_or_default();
        names.push(name.to_owned());
        if !upstream.is_empty() {
            let count = |key: &str| {
                track
                    .split_once(key)
                    .and_then(|(_, rest)| rest.split(|c: char| !c.is_ascii_digit()).next())
                    .and_then(|v| v.parse::<u64>().ok())
                    .unwrap_or(0)
            };
            sync.insert(name.to_owned(), json!({"upstream": upstream, "ahead": count("ahead "), "behind": count("behind "), "gone": track == "gone"}));
        }
    }
    (names, sync)
}

pub(crate) fn load_inner(
    dir: &Path,
    show_remote: bool,
    limit: Option<usize>,
) -> Result<Value, String> {
    let root = quick(dir, &["rev-parse", "--show-toplevel"])?
        .trim()
        .to_owned();
    let root_path = Path::new(&root);
    let branch = quick(root_path, &["branch", "--show-current"])?;
    // --no-optional-locks: status must not rewrite .git/index, or the file watcher would reload forever.
    let status = quick(
        root_path,
        &[
            "--no-optional-locks",
            "status",
            "--porcelain=v1",
            "--no-renames",
            "--untracked-files=all",
            "-z",
        ],
    )?;
    let remote = quick(root_path, &["remote"])?;
    let refs = quick(
        root_path,
        &[
            "for-each-ref",
            "--format=%(refname:short)%1f%(upstream:short)%1f%(upstream:track,nobracket)",
            "refs/heads",
        ],
    )?;
    let worktrees = quick(root_path, &["worktree", "list", "--porcelain", "-z"])?;
    let stashes = quick(
        root_path,
        &[
            "stash",
            "list",
            "--format=%H%x1f%P%x1f%gd%x1f%gs%x1f%an%x1f%aI%x1f%ae%x1f%B%x1e",
        ],
    )?;
    let history = history_inner(root_path, show_remote, limit)?;
    let changes: Vec<Value> = status
        .split('\0')
        .filter(|s| s.len() >= 3)
        .map(|entry| json!({"status": &entry[..2], "path": &entry[3..]}))
        .collect();
    let (branches, sync) = tracking(&refs);
    let worktrees: Vec<Value> = worktrees
        .split("\0\0")
        .filter_map(|record| {
            let fields: Vec<_> = record.split('\0').collect();
            if fields.contains(&"bare") {
                return None;
            }
            let path = fields.iter().find_map(|f| f.strip_prefix("worktree "))?;
            let branch = fields
                .iter()
                .find_map(|f| f.strip_prefix("branch refs/heads/"))
                .unwrap_or(if fields.contains(&"detached") {
                    "HEAD separado"
                } else {
                    "Sin rama"
                });
            Some(json!({"path": path, "branch": branch, "bare": false}))
        })
        .collect();
    let stashes: Vec<Value> = stashes.split('\x1e').map(str::trim_start).filter(|s| !s.is_empty()).map(|record| {
        let mut f = record.split('\x1f');
        let hash = f.next().unwrap_or_default(); let parents = f.next().unwrap_or_default();
        let stash = f.next().unwrap_or_default(); let subject = f.next().unwrap_or_default();
        let author = f.next().unwrap_or_default(); let date = f.next().unwrap_or_default();
        let email = f.next().unwrap_or_default(); let message = f.next().filter(|s| !s.is_empty()).unwrap_or(subject).trim_end();
        json!({"hash": hash, "parents": parents.split_whitespace().collect::<Vec<_>>(), "stash": stash, "refs": [], "subject": subject, "author": author, "date": date, "email": email, "message": message})
    }).collect();
    Ok(
        json!({"root": root, "branch": if branch.trim().is_empty() {"HEAD separado"} else {branch.trim()}, "head": history.head,
        "changes": changes, "commits": history.commits, "limit": history.limit, "hasMore": history.has_more, "fingerprint": history.fingerprint,
        "stashes": stashes, "remotes": remote.lines().filter(|s| !s.is_empty()).collect::<Vec<_>>(), "branches": branches, "sync": sync, "worktrees": worktrees}),
    )
}

#[tauri::command]
pub async fn load_repo(
    dir: String,
    show_remote: Option<bool>,
    limit: Option<usize>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        load_inner(Path::new(&dir), show_remote.unwrap_or(true), limit)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, process::Command};
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
    fn loads_status_history_and_worktree() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path();
        run(dir, &["init", "-q"]);
        run(dir, &["config", "user.name", "Test"]);
        run(dir, &["config", "user.email", "test@example.com"]);
        fs::write(dir.join("file.txt"), "first").unwrap();
        run(dir, &["add", "file.txt"]);
        run(dir, &["commit", "-qm", "first"]);
        fs::write(dir.join("file.txt"), "changed").unwrap();
        fs::write(dir.join("new file.txt"), "new").unwrap();
        let repo = load_inner(dir, true, None).unwrap();
        assert_eq!(repo["commits"].as_array().unwrap().len(), 1);
        assert_eq!(repo["worktrees"].as_array().unwrap().len(), 1);
        assert!(
            repo["changes"]
                .as_array()
                .unwrap()
                .iter()
                .any(|c| c["path"] == "new file.txt" && c["status"] == "??")
        );
        assert!(
            repo["changes"]
                .as_array()
                .unwrap()
                .iter()
                .any(|c| c["path"] == "file.txt" && c["status"] == " M")
        );
    }
    #[test]
    fn parses_tracking_counts() {
        let (names, sync) = tracking("main\x1forigin/main\x1fahead 2, behind 3\nother\x1f\x1f\n");
        assert_eq!(names, vec!["main", "other"]);
        assert_eq!(sync["main"]["ahead"], 2);
        assert_eq!(sync["main"]["behind"], 3);
        assert!(!sync.contains_key("other"));
    }
}
