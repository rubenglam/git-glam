use crate::history::git;
use serde::Deserialize;
use serde_json::{Value, json};
use std::{path::Path, time::Duration};
fn run(dir: &Path, args: &[&str]) -> Result<String, String> {
    git(dir, args, Duration::from_secs(60), 16 * 1024 * 1024)
}
#[derive(Default, Deserialize)]
pub struct CommitOptions {
    amend: Option<bool>,
}
fn commit_inner(dir: &Path, message: &str, options: CommitOptions) -> Result<Value, String> {
    let text = message.trim();
    if options.amend.unwrap_or(false) {
        run(dir, &["rev-parse", "--verify", "HEAD"])
            .map_err(|_| "No hay ningún commit que enmendar".to_string())?;
        if text.is_empty() {
            run(dir, &["commit", "--amend", "--no-edit"])?;
        } else {
            run(dir, &["commit", "--amend", "-m", text])?;
        }
        return Ok(json!({"stagedOnly":true,"amended":true}));
    }
    if text.is_empty() {
        return Err("Escribe un mensaje de commit".into());
    }
    let staged = !run(dir, &["diff", "--cached", "--name-only", "-z"])?.is_empty();
    if !staged {
        run(dir, &["add", "-A"])?;
    }
    if run(dir, &["diff", "--cached", "--name-only", "-z"])?.is_empty() {
        return Err("No hay cambios que confirmar".into());
    }
    run(dir, &["commit", "-m", text])?;
    Ok(json!({"stagedOnly":staged}))
}
#[tauri::command]
pub async fn commit(
    dir: String,
    message: String,
    options: Option<CommitOptions>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        commit_inner(Path::new(&dir), &message, options.unwrap_or_default())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, process::Command};
    fn g(dir: &Path, args: &[&str]) {
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
    fn commits_staged_changes_only_and_amends() {
        let t = tempfile::tempdir().unwrap();
        let d = t.path();
        g(d, &["init", "-q"]);
        g(d, &["config", "user.name", "Test"]);
        g(d, &["config", "user.email", "test@example.com"]);
        fs::write(d.join("a"), "x").unwrap();
        fs::write(d.join("b"), "x").unwrap();
        g(d, &["add", "a"]);
        let r = commit_inner(d, "first", CommitOptions::default()).unwrap();
        assert_eq!(r["stagedOnly"], true);
        assert!(d.join("b").exists());
        assert!(run(d, &["ls-files", "--", "b"]).unwrap().is_empty());
        commit_inner(d, "changed", CommitOptions { amend: Some(true) }).unwrap();
        assert_eq!(
            run(d, &["log", "-1", "--format=%s"]).unwrap().trim(),
            "changed"
        );
    }
}

#[tauri::command]
pub async fn commit_push(
    dir: String,
    message: String,
    options: Option<CommitOptions>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = Path::new(&dir);
        let result = commit_inner(path, &message, options.unwrap_or_default())?;
        crate::sync::sync_inner(path, "push")
            .map_err(|e| format!("El commit se creó, pero el push falló: {e}"))?;
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}
