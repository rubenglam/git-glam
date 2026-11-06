use crate::history::git;
use std::{path::Path, time::Duration};

fn run(dir: &Path, args: &[&str]) -> Result<String, String> {
    git(dir, args, Duration::from_secs(120), 16 * 1024 * 1024)
}
fn current_branch(dir: &Path) -> Result<String, String> {
    let branch = run(dir, &["branch", "--show-current"])?.trim().to_owned();
    if branch.is_empty() {
        Err("No hay ninguna rama activa (HEAD separado)".into())
    } else {
        Ok(branch)
    }
}
pub(crate) fn sync_inner(dir: &Path, action: &str) -> Result<(), String> {
    match action {
        "fetch" => {
            run(dir, &["fetch", "--all", "--tags", "--prune", "--quiet"])?;
        }
        "pull" => {
            current_branch(dir)?;
            run(dir, &["pull", "--ff-only"])?;
        }
        "push" => {
            let branch = current_branch(dir)?;
            let upstream = run(
                dir,
                &[
                    "rev-parse",
                    "--abbrev-ref",
                    &format!("{branch}@{{upstream}}"),
                ],
            )
            .unwrap_or_default();
            if !upstream.trim().is_empty() {
                run(dir, &["push"])?;
            } else {
                let remotes = run(dir, &["remote"])?;
                let remotes: Vec<_> = remotes.lines().filter(|s| !s.is_empty()).collect();
                if remotes.is_empty() {
                    return Err("El repositorio no tiene remotos configurados".into());
                }
                let remote = if remotes.contains(&"origin") {
                    "origin"
                } else {
                    remotes[0]
                };
                run(dir, &["push", "--set-upstream", remote, &branch])?;
            }
        }
        _ => return Err("Acción no válida".into()),
    }
    Ok(())
}
#[tauri::command]
pub async fn sync_repo(dir: String, action: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || sync_inner(Path::new(&dir), &action))
        .await
        .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    #[test]
    fn refuses_push_without_remote_and_unknown_action() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path();
        assert!(
            Command::new("git")
                .args(["init", "-q"])
                .current_dir(dir)
                .status()
                .unwrap()
                .success()
        );
        assert!(sync_inner(dir, "push").unwrap_err().contains("remotos"));
        assert!(sync_inner(dir, "anything").is_err());
    }
}
