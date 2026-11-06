use sha2::{Digest, Sha256};
use std::{path::Path, sync::Mutex, time::Duration};
use tauri::State;
#[derive(Default)]
pub struct TokensLock(Mutex<()>);
fn repo_key(dir: &Path) -> Result<String, String> {
    let common = crate::history::git(
        dir,
        &["rev-parse", "--git-common-dir"],
        Duration::from_secs(15),
        16 * 1024 * 1024,
    )
    .map_err(|_| "No es un repositorio de Git".to_string())?;
    let path = dir.join(common.trim());
    let resolved = std::fs::canonicalize(&path).unwrap_or(path);
    Ok(key_path(&resolved))
}
pub(crate) fn key_path(resolved: &Path) -> String {
    let resolved = std::fs::canonicalize(resolved).unwrap_or_else(|_| resolved.to_path_buf());
    let text = resolved.to_string_lossy();
    let normalized = if cfg!(windows) {
        text.to_lowercase()
    } else {
        text.into_owned()
    };
    format!("{:x}", Sha256::digest(normalized.as_bytes()))
}
fn entry(dir: &Path) -> Result<keyring::Entry, String> {
    let key = repo_key(dir)?;
    keyring::Entry::new("Git Glam", &key)
        .map_err(|e| format!("No se pudo acceder al almacén de credenciales: {e}"))
}
pub(crate) fn get(dir: &Path) -> Result<String, String> {
    match entry(dir)?.get_password() {
        Ok(s) => Ok(s),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(e) => Err(format!("No se pudo leer el token: {e}")),
    }
}
fn set(dir: &Path, value: &str) -> Result<(), String> {
    if value.len() > 1000 || value.trim().chars().any(char::is_whitespace) {
        return Err("Token no válido".into());
    }
    let entry = entry(dir)?;
    if value.trim().is_empty() {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("No se pudo borrar el token: {e}")),
        }
    } else {
        entry
            .set_password(value.trim())
            .map_err(|e| format!("No se pudo guardar el token: {e}"))
    }
}
#[tauri::command]
pub async fn token_has(dir: String, lock: State<'_, TokensLock>) -> Result<bool, String> {
    let _guard = lock.0.lock().map_err(|e| e.to_string())?;
    Ok(!get(Path::new(&dir))?.is_empty())
}
#[tauri::command]
pub async fn token_set(
    dir: String,
    value: String,
    lock: State<'_, TokensLock>,
) -> Result<(), String> {
    let _guard = lock.0.lock().map_err(|e| e.to_string())?;
    set(Path::new(&dir), &value)
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, process::Command};
    fn g(d: &Path, args: &[&str]) {
        assert!(
            Command::new("git")
                .args(args)
                .current_dir(d)
                .output()
                .unwrap()
                .status
                .success()
        );
    }
    #[test]
    fn linked_worktrees_share_credential_key() {
        let t = tempfile::tempdir().unwrap();
        let d = t.path().join("repo");
        let w = t.path().join("worktree");
        fs::create_dir(&d).unwrap();
        g(&d, &["init", "-q"]);
        g(&d, &["config", "user.name", "Test"]);
        g(&d, &["config", "user.email", "test@example.com"]);
        fs::write(d.join("a"), "x").unwrap();
        g(&d, &["add", "a"]);
        g(&d, &["commit", "-qm", "first"]);
        g(&d, &["worktree", "add", "-b", "new", w.to_str().unwrap()]);
        assert_eq!(repo_key(&d).unwrap(), repo_key(&w).unwrap());
    }
}
