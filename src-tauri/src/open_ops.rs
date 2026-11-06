use serde_json::Value;
use std::{path::Path, time::Duration};
#[tauri::command]
pub async fn open_repo() -> Result<Option<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(folder) = rfd::FileDialog::new().pick_folder() else {
            return Ok(None);
        };
        crate::repo::load_inner(&folder, true, None).map(Some)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn open_folder(dir: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = crate::history::git(
            Path::new(&dir),
            &["rev-parse", "--show-toplevel"],
            Duration::from_secs(15),
            16 * 1024 * 1024,
        )?;
        open::that(root.trim()).map_err(|e| format!("No se pudo abrir la carpeta: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn open_issue(url: String) -> Result<(), String> {
    if !url.starts_with("https://") || url.contains(['\r', '\n', '\0']) {
        return Err("Enlace no válido".into());
    }
    tauri::async_runtime::spawn_blocking(move || open::that(url).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}
fn target_path(root: &Path, file: &str) -> Result<std::path::PathBuf, String> {
    use std::path::Component;
    if file.is_empty() || file.contains('\0') {
        return Err("Ruta no válida".into());
    }
    let path = Path::new(file);
    if path.is_absolute()
        || path.components().any(|c| {
            matches!(
                c,
                Component::ParentDir | Component::Prefix(_) | Component::RootDir
            )
        })
    {
        return Err("Ruta fuera del repositorio".into());
    }
    if !path.components().any(|c| matches!(c, Component::Normal(_))) {
        return Err("Ruta no válida".into());
    }
    Ok(root.join(path))
}
fn ignore_file(root: &Path, file: &str) -> Result<(), String> {
    use std::io::Write;
    let path = root.join(".gitignore");
    let content = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(e.to_string()),
    };
    let mut pattern = String::from("/");
    for c in file.chars() {
        if "\\*?[] !#".contains(c) {
            pattern.push('\\');
        }
        pattern.push(c);
    }
    if !content.lines().any(|l| l.trim_end_matches('\r') == pattern) {
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .map_err(|e| e.to_string())?;
        if !content.is_empty() && !content.ends_with('\n') {
            f.write_all(b"\n").map_err(|e| e.to_string())?;
        }
        writeln!(f, "{pattern}").map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn file_action_inner(dir: &Path, file: &str, action: &str) -> Result<(), String> {
    let root = crate::history::git(
        dir,
        &["rev-parse", "--show-toplevel"],
        Duration::from_secs(15),
        16 * 1024 * 1024,
    )?;
    let root = Path::new(root.trim());
    let target = target_path(root, file)?;
    match action {
        "open" => open::that(&target).map_err(|e| e.to_string())?,
        "reveal" => {
            if !target.exists() {
                return Err("El archivo no existe".into());
            }
            #[cfg(windows)]
            {
                std::process::Command::new("explorer.exe")
                    .arg("/select,")
                    .arg(&target)
                    .spawn()
                    .map_err(|e| e.to_string())?;
            }
            #[cfg(not(windows))]
            {
                open::that(target.parent().ok_or("Ruta no válida")?).map_err(|e| e.to_string())?;
            }
        }
        "head" => {
            let bytes = crate::history::git_bytes_with_exit(
                root,
                &["show", &format!("HEAD:{file}")],
                Duration::from_secs(15),
                32 * 1024 * 1024,
                false,
            )?;
            let temp = tempfile::Builder::new()
                .prefix("git-glam-head-")
                .tempdir()
                .map_err(|e| e.to_string())?
                .keep();
            let snapshot = temp.join(Path::new(file).file_name().ok_or("Archivo no válido")?);
            std::fs::write(&snapshot, bytes).map_err(|e| e.to_string())?;
            open::that(snapshot).map_err(|e| e.to_string())?;
        }
        "ignore" => ignore_file(root, file)?,
        _ => return Err("Acción no válida".into()),
    };
    Ok(())
}
#[tauri::command]
pub async fn file_action(dir: String, file: String, action: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || file_action_inner(Path::new(&dir), &file, &action))
        .await
        .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_parent_paths_and_escapes_ignore_patterns() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path();
        assert!(target_path(root, "../outside").is_err());
        assert!(target_path(root, "a/../../outside").is_err());
        assert!(target_path(root, "folder/file").is_ok());
        ignore_file(root, "a [test]# file").unwrap();
        ignore_file(root, "a [test]# file").unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join(".gitignore")).unwrap(),
            "/a\\ \\[test\\]\\#\\ file\n"
        );
    }
}
