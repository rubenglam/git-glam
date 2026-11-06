use crate::history::git;
use serde::Deserialize;
use std::{path::Path, time::Duration};
fn run(dir: &Path, args: &[&str]) -> Result<String, String> {
    git(dir, args, Duration::from_secs(60), 32 * 1024 * 1024)
}
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StashOptions {
    message: Option<String>,
    include_untracked: Option<bool>,
    keep_index: Option<bool>,
}
fn push_inner(dir: &Path, options: StashOptions) -> Result<(), String> {
    let before = run(dir, &["rev-parse", "-q", "--verify", "refs/stash"]).unwrap_or_default();
    let mut args = vec!["stash", "push"];
    if options.include_untracked.unwrap_or(false) {
        args.push("--include-untracked");
    }
    if options.keep_index.unwrap_or(false) {
        args.push("--keep-index");
    }
    let message = options.message.unwrap_or_default();
    if !message.trim().is_empty() {
        args.extend(["-m", message.trim()]);
    }
    run(dir, &args)?;
    let after = run(dir, &["rev-parse", "-q", "--verify", "refs/stash"]).unwrap_or_default();
    if before.trim() == after.trim() {
        return Err("No hay cambios locales que guardar".into());
    }
    Ok(())
}
fn action_inner(dir: &Path, action: &str, hash: &str) -> Result<(), String> {
    if !(40..=64).contains(&hash.len()) || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Stash no válido".into());
    }
    if !["apply", "pop", "drop"].contains(&action) {
        return Err("Acción no válida".into());
    }
    let list = run(dir, &["stash", "list", "--format=%H"])?;
    let index = list
        .lines()
        .position(|item| item.eq_ignore_ascii_case(hash))
        .ok_or("El stash ya no existe. Actualiza la lista.")?;
    let reference = format!("stash@{{{index}}}");
    let args = if action == "drop" {
        vec!["stash", action, reference.as_str()]
    } else {
        vec!["stash", action, "--index", reference.as_str()]
    };
    run(dir, &args)?;
    Ok(())
}
#[tauri::command]
pub async fn stash_push(dir: String, options: Option<StashOptions>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        push_inner(Path::new(&dir), options.unwrap_or_default())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn stash_action(dir: String, action: String, hash: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || action_inner(Path::new(&dir), &action, &hash))
        .await
        .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, process::Command};
    fn git_test(dir: &Path, args: &[&str]) -> String {
        let out = Command::new("git")
            .args(args)
            .current_dir(dir)
            .output()
            .unwrap();
        assert!(out.status.success());
        String::from_utf8_lossy(&out.stdout).into_owned()
    }
    #[test]
    fn push_apply_and_drop_by_hash() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path();
        git_test(dir, &["init", "-q"]);
        git_test(dir, &["config", "user.name", "Test"]);
        git_test(dir, &["config", "user.email", "test@example.com"]);
        fs::write(dir.join("a"), "one").unwrap();
        git_test(dir, &["add", "a"]);
        git_test(dir, &["commit", "-qm", "initial"]);
        fs::write(dir.join("a"), "two").unwrap();
        push_inner(dir, StashOptions::default()).unwrap();
        let hash = git_test(dir, &["rev-parse", "refs/stash"]);
        let hash = hash.trim();
        action_inner(dir, "apply", hash).unwrap();
        assert_eq!(fs::read_to_string(dir.join("a")).unwrap(), "two");
        action_inner(dir, "drop", hash).unwrap();
        assert!(action_inner(dir, "drop", hash).is_err());
    }
}
