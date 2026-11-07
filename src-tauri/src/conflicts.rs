use crate::history::git;
use serde::Serialize;
use std::{path::Path, time::Duration};

fn run(dir: &Path, args: &[&str]) -> Result<String, String> {
    git(dir, args, Duration::from_secs(120), 16 * 1024 * 1024)
}
#[derive(Serialize)]
pub struct ConflictState {
    operation: Option<String>,
    files: Vec<String>,
}
fn state(dir: &Path) -> Result<ConflictState, String> {
    let git_path = |name: &str| -> Result<bool, String> {
        let p = run(dir, &["rev-parse", "--git-path", name])?;
        let p = Path::new(p.trim());
        Ok(if p.is_absolute() {
            p.exists()
        } else {
            dir.join(p).exists()
        })
    };
    let operation = if git_path("rebase-merge")? || git_path("rebase-apply")? {
        Some("rebase")
    } else if git_path("MERGE_HEAD")? {
        Some("merge")
    } else if git_path("CHERRY_PICK_HEAD")? {
        Some("cherry-pick")
    } else if git_path("REVERT_HEAD")? {
        Some("revert")
    } else {
        None
    };
    let output = run(dir, &["diff", "--name-only", "--diff-filter=U", "-z"])?;
    Ok(ConflictState {
        operation: operation.map(str::to_owned),
        files: output
            .split('\0')
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .collect(),
    })
}
fn target(dir: &Path, file: &str) -> Result<std::path::PathBuf, String> {
    if !state(dir)?.files.iter().any(|p| p == file) {
        return Err("El archivo ya no tiene conflictos pendientes. Actualiza la vista.".into());
    }
    let root = std::fs::canonicalize(dir).map_err(|e| e.to_string())?;
    let path = std::fs::canonicalize(root.join(file))
        .map_err(|e| format!("No se puede abrir el archivo: {e}"))?;
    if !path.starts_with(&root) || !path.is_file() {
        return Err("No se puede editar esta ruta".into());
    }
    Ok(path)
}
#[tauri::command]
pub async fn conflict_state(dir: String) -> Result<ConflictState, String> {
    tauri::async_runtime::spawn_blocking(move || state(Path::new(&dir)))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn conflict_read(dir: String, file: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = target(Path::new(&dir), &file)?;
        if std::fs::metadata(&path).map_err(|e| e.to_string())?.len() > 2_000_000 {
            return Err("El archivo es demasiado grande para editarlo aquí".into());
        }
        let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
        if bytes.contains(&0) {
            return Err("No se pueden editar archivos binarios aquí".into());
        }
        String::from_utf8(bytes).map_err(|_| "El archivo no está codificado en UTF-8".into())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn conflict_save(
    dir: String,
    file: String,
    original: String,
    content: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = target(Path::new(&dir), &file)?;
        let current = std::fs::read(&path).map_err(|e| e.to_string())?;
        if current != original.as_bytes() {
            return Err(
                "El archivo cambió desde que se abrió. Vuelve a abrirlo antes de guardar.".into(),
            );
        }
        std::fs::write(path, content).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn conflict_action(dir: String, operation: String, action: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = Path::new(&dir);
        let current = state(dir)?;
        if current.operation.as_deref() != Some(operation.as_str()) {
            return Err("La operación ha cambiado. Actualiza la vista.".into());
        }
        if !["merge", "rebase", "cherry-pick", "revert"].contains(&operation.as_str())
            || !["continue", "abort"].contains(&action.as_str())
        {
            return Err("Acción no válida".into());
        }
        if action == "continue" && !current.files.is_empty() {
            return Err("Quedan archivos sin marcar como resueltos".into());
        }
        run(
            dir,
            &[
                "-c",
                "core.editor=true",
                "-c",
                "sequence.editor=true",
                &operation,
                &format!("--{action}"),
            ],
        )
        .map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, process::Command};
    fn g(dir: &Path, args: &[&str]) -> bool {
        Command::new("git")
            .current_dir(dir)
            .args(args)
            .output()
            .unwrap()
            .status
            .success()
    }
    #[test]
    fn detects_merge_conflict_and_resolution() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path();
        assert!(g(dir, &["init", "-q", "-b", "main"]));
        assert!(g(dir, &["config", "user.name", "Test"]));
        assert!(g(dir, &["config", "user.email", "test@example.com"]));
        fs::write(dir.join("file.txt"), "base\n").unwrap();
        assert!(g(dir, &["add", "."]));
        assert!(g(dir, &["commit", "-qm", "base"]));
        assert!(g(dir, &["checkout", "-qb", "other"]));
        fs::write(dir.join("file.txt"), "other\n").unwrap();
        assert!(g(dir, &["commit", "-qam", "other"]));
        assert!(g(dir, &["checkout", "-q", "main"]));
        fs::write(dir.join("file.txt"), "main\n").unwrap();
        assert!(g(dir, &["commit", "-qam", "main"]));
        assert!(!g(dir, &["merge", "other"]));
        let s = state(dir).unwrap();
        assert_eq!(s.operation.as_deref(), Some("merge"));
        assert_eq!(s.files, vec!["file.txt"]);
        assert!(target(dir, "file.txt").is_ok());
        assert!(target(dir, "../file.txt").is_err());
        fs::write(dir.join("file.txt"), "resolved\n").unwrap();
        assert!(g(dir, &["add", "file.txt"]));
        let s = state(dir).unwrap();
        assert!(s.files.is_empty());
        assert_eq!(s.operation.as_deref(), Some("merge"));
        assert!(g(dir, &["-c", "core.editor=true", "merge", "--continue"]));
        assert!(state(dir).unwrap().operation.is_none());
    }
}
