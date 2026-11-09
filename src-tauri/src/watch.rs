use crate::history::git;
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::json;
use std::{
    path::{Component, Path, PathBuf},
    sync::{Mutex, mpsc},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, State};

// Bursts of file events (a save, a checkout, a build) collapse into one `repo:changed`.
const DEBOUNCE: Duration = Duration::from_millis(300);
const MAX_WAIT: Duration = Duration::from_secs(2);

// Git metadata files whose changes alter `git status` or the branch list.
const META_FILES: &[&str] = &[
    "index",
    "HEAD",
    "packed-refs",
    "ORIG_HEAD",
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
];
// Directories whose churn never changes what the app shows.
const IGNORED_DIRS: &[&str] = &[".git", "node_modules", "target"];

#[derive(Default)]
pub struct RepoWatch(Mutex<Option<RepoWatcher>>);

// Dropping the watcher stops the OS subscriptions and ends the debounce thread.
pub struct RepoWatcher {
    _watchers: Vec<RecommendedWatcher>,
}

// Decides whether a file event can change git status. `git_dirs` are the canonical git directories.
fn relevant(path: &Path, root: &Path, git_dirs: &[PathBuf]) -> bool {
    if let Some(dir) = git_dirs.iter().find(|dir| path.starts_with(dir)) {
        let rel = path.strip_prefix(dir).unwrap_or(path);
        let mut parts = rel.components();
        return match parts.next() {
            Some(Component::Normal(first)) if first == "refs" => true,
            Some(Component::Normal(first)) => {
                parts.next().is_none() && META_FILES.iter().any(|name| first == *name)
            }
            _ => false,
        };
    }
    match path.strip_prefix(root) {
        Ok(rel) => !rel.components().any(|part| {
            matches!(part, Component::Normal(name) if IGNORED_DIRS.iter().any(|dir| name == *dir))
        }),
        Err(_) => false,
    }
}

// Watches the working tree and the git metadata of `dir`, emitting `repo:changed` with `dir` when status may have changed.
#[tauri::command]
pub fn watch_repo(app: AppHandle, state: State<RepoWatch>, dir: String) -> Result<(), String> {
    let root = std::fs::canonicalize(&dir).map_err(|e| e.to_string())?;
    let git_dir = git(&root, &["rev-parse", "--absolute-git-dir"], Duration::from_secs(10), 4096)?;
    let common = git(&root, &["rev-parse", "--git-common-dir"], Duration::from_secs(10), 4096)?;
    let mut git_dirs: Vec<PathBuf> = Vec::new();
    for raw in [git_dir.trim(), common.trim()] {
        let path = std::fs::canonicalize(root.join(raw)).map_err(|e| e.to_string())?;
        if !git_dirs.contains(&path) {
            git_dirs.push(path);
        }
    }

    let (tx, rx) = mpsc::channel::<()>();
    let emit_root = dir.clone();
    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            let started = Instant::now();
            while started.elapsed() < MAX_WAIT && rx.recv_timeout(DEBOUNCE).is_ok() {}
            let _ = app.emit("repo:changed", json!([emit_root]));
        }
    });

    // Every watcher shares one filter and one channel into the debounce thread.
    let make_handler = |tx: mpsc::Sender<()>, filter_root: PathBuf, filter_dirs: Vec<PathBuf>| {
        move |result: notify::Result<Event>| match result {
            Ok(event) => {
                if event.paths.iter().any(|p| relevant(p, &filter_root, &filter_dirs)) {
                    let _ = tx.send(());
                }
            }
            // Backend errors (for example a dropped-event overflow) may hide changes: refresh anyway.
            Err(_) => {
                let _ = tx.send(());
            }
        }
    };

    let mut watchers: Vec<RecommendedWatcher> = Vec::new();
    let mut main = notify::recommended_watcher(make_handler(tx.clone(), root.clone(), git_dirs.clone()))
        .map_err(|e| e.to_string())?;
    main.watch(&root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    watchers.push(main);

    // Worktrees keep HEAD and index outside the working tree, and refs in the common directory.
    // Watch those directories without recursing into objects/.
    for dir in git_dirs.iter().filter(|dir| !dir.starts_with(&root)) {
        let mut extra = notify::recommended_watcher(make_handler(tx.clone(), root.clone(), git_dirs.clone()))
            .map_err(|e| e.to_string())?;
        extra
            .watch(dir, RecursiveMode::NonRecursive)
            .map_err(|e| e.to_string())?;
        if dir.join("refs").is_dir() {
            extra
                .watch(&dir.join("refs"), RecursiveMode::Recursive)
                .map_err(|e| e.to_string())?;
        }
        watchers.push(extra);
    }
    drop(tx);

    *state.0.lock().map_err(|e| e.to_string())? = Some(RepoWatcher { _watchers: watchers });
    Ok(())
}

#[tauri::command]
pub fn unwatch_repo(state: State<RepoWatch>) -> Result<(), String> {
    *state.0.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> (PathBuf, Vec<PathBuf>) {
        (
            PathBuf::from("/repo"),
            vec![PathBuf::from("/repo/.git")],
        )
    }

    #[test]
    fn working_tree_changes_are_relevant() {
        let (root, dirs) = sample();
        assert!(relevant(Path::new("/repo/src/main.rs"), &root, &dirs));
    }

    #[test]
    fn ignored_directories_are_skipped() {
        let (root, dirs) = sample();
        assert!(!relevant(Path::new("/repo/node_modules/x/index.js"), &root, &dirs));
        assert!(!relevant(Path::new("/repo/target/debug/app"), &root, &dirs));
    }

    #[test]
    fn git_metadata_filters_noise() {
        let (root, dirs) = sample();
        assert!(relevant(Path::new("/repo/.git/index"), &root, &dirs));
        assert!(relevant(Path::new("/repo/.git/HEAD"), &root, &dirs));
        assert!(relevant(Path::new("/repo/.git/refs/heads/main"), &root, &dirs));
        assert!(!relevant(Path::new("/repo/.git/index.lock"), &root, &dirs));
        assert!(!relevant(Path::new("/repo/.git/objects/ab/cdef"), &root, &dirs));
    }

    #[test]
    fn linked_worktree_metadata_is_relevant() {
        let root = PathBuf::from("/wt");
        let dirs = vec![PathBuf::from("/common/worktrees/wt"), PathBuf::from("/common")];
        assert!(relevant(Path::new("/common/worktrees/wt/index"), &root, &dirs));
        assert!(relevant(Path::new("/common/refs/heads/dev"), &root, &dirs));
        assert!(!relevant(Path::new("/common/objects/ab/cdef"), &root, &dirs));
    }
}
