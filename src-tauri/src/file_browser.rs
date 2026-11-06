use serde::Serialize;
use std::{fs, io::Read, path::{Component, Path, PathBuf}};

#[derive(Serialize)]
pub struct Entry { name: String, path: String, directory: bool }

fn resolve(dir: &str, relative: &str) -> Result<PathBuf, String> {
    let root = fs::canonicalize(dir).map_err(|e| e.to_string())?;
    let path = Path::new(relative);
    if path.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err("Ruta no válida".into());
    }
    let target = fs::canonicalize(root.join(path)).map_err(|e| e.to_string())?;
    if !target.starts_with(&root) { return Err("Ruta fuera del repositorio".into()); }
    Ok(target)
}

#[tauri::command]
pub async fn browse_files(dir: String, path: String) -> Result<Vec<Entry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let target = resolve(&dir, &path)?;
        let mut entries = Vec::new();
        for item in fs::read_dir(target).map_err(|e| e.to_string())? {
            let item = item.map_err(|e| e.to_string())?;
            let kind = item.file_type().map_err(|e| e.to_string())?;
            let name = item.file_name().to_string_lossy().into_owned();
            if name == ".git" || kind.is_symlink() || (!kind.is_dir() && !kind.is_file()) { continue; }
            let child = if path.is_empty() { name.clone() } else { format!("{path}/{name}") };
            entries.push(Entry { name, path: child, directory: kind.is_dir() });
        }
        entries.sort_by(|a, b| b.directory.cmp(&a.directory).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
        Ok(entries)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn preview_file(dir: String, path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let target = resolve(&dir, &path)?;
        let file = fs::File::open(target).map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        file.take(1_048_577).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        if bytes.len() > 1_048_576 { return Err("El archivo supera el límite de 1 MB para la vista previa.".into()); }
        if bytes.contains(&0) { return Err("No se puede mostrar un archivo binario.".into()); }
        String::from_utf8(bytes).map_err(|_| "No se puede mostrar este archivo como texto UTF-8.".into())
    }).await.map_err(|e| e.to_string())?
}

#[derive(Serialize)]
pub struct SearchResults { files: Vec<Entry>, truncated: bool }

#[tauri::command]
pub async fn search_files(dir: String, query: String) -> Result<SearchResults, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = resolve(&dir, "")?;
        let needle = query.to_lowercase();
        let mut pending = vec![(root, String::new())];
        let mut files = Vec::new();
        let mut scanned = 0usize;
        let mut truncated = false;
        while let Some((folder, relative)) = pending.pop() {
            let entries = match fs::read_dir(folder) { Ok(entries) => entries, Err(_) => continue };
            for item in entries.flatten() {
                scanned += 1;
                if scanned > 100_000 || files.len() >= 200 { truncated = true; break; }
                let kind = match item.file_type() { Ok(kind) => kind, Err(_) => continue };
                let name = item.file_name().to_string_lossy().into_owned();
                if name == ".git" || kind.is_symlink() { continue; }
                let path = if relative.is_empty() { name.clone() } else { format!("{relative}/{name}") };
                if kind.is_dir() { pending.push((item.path(), path)); }
                else if kind.is_file() && path.to_lowercase().contains(&needle) {
                    files.push(Entry { name, path, directory: false });
                }
            }
            if truncated { break; }
        }
        files.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
        Ok(SearchResults { files, truncated })
    }).await.map_err(|e| e.to_string())?
}
