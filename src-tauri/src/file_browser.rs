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

#[tauri::command]
pub async fn documentation_files(dir: String, include_folders: Vec<String>) -> Result<SearchResults, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = resolve(&dir, "")?;
        let mut pending = vec![(root, String::new())];
        let mut files = Vec::new();
        let mut scanned = 0usize;
        let mut truncated = false;
        while let Some((folder, relative)) = pending.pop() {
            let entries = match fs::read_dir(folder) { Ok(entries) => entries, Err(_) => continue };
            for item in entries.flatten() {
                scanned += 1;
                if scanned > 100_000 || files.len() >= 1000 { truncated = true; break; }
                let kind = match item.file_type() { Ok(kind) => kind, Err(_) => continue };
                let name = item.file_name().to_string_lossy().into_owned();
                let lower = name.to_lowercase();
                if kind.is_symlink() { continue; }
                let path = if relative.is_empty() { name.clone() } else { format!("{relative}/{name}") };
                if kind.is_dir() {
                    if matches!(lower.as_str(), ".git" | "node_modules" | "vendor" | "target" | "dist" | "build" | "bin" | "obj" | ".venv") { continue; }
                    if matches!(lower.as_str(), ".github" | ".agents" | ".claude" | ".skills") && !include_folders.contains(&lower) { continue; }
                    pending.push((item.path(), path));
                } else if kind.is_file() && (lower.ends_with(".md") || lower.ends_with(".mdx") || lower.ends_with(".rst") || lower.ends_with(".adoc") || matches!(lower.as_str(), "readme" | "license" | "licence" | "changelog" | "contributing")) {
                    files.push(Entry { name, path, directory: false });
                }
            }
            if truncated { break; }
        }
        files.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
        Ok(SearchResults { files, truncated })
    }).await.map_err(|e| e.to_string())?
}

// Discover project-local assistant instructions and configuration, including untracked files.
#[tauri::command]
pub async fn ai_files(dir: String) -> Result<SearchResults, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = resolve(&dir, "")?;
        let mut pending = vec![(root, String::new())];
        let mut files = Vec::new();
        let mut scanned = 0usize;
        let mut truncated = false;
        while let Some((folder, relative)) = pending.pop() {
            let entries = match fs::read_dir(folder) { Ok(entries) => entries, Err(_) => continue };
            for item in entries.flatten() {
                scanned += 1;
                if scanned > 100_000 || files.len() >= 1000 { truncated = true; break; }
                let kind = match item.file_type() { Ok(kind) => kind, Err(_) => continue };
                if kind.is_symlink() { continue; }
                let name = item.file_name().to_string_lossy().into_owned();
                let lower = name.to_lowercase();
                let path = if relative.is_empty() { name.clone() } else { format!("{relative}/{name}") };
                if kind.is_dir() {
                    if matches!(lower.as_str(), ".git" | "node_modules" | "vendor" | "target" | "dist" | "build" | "bin" | "obj" | ".venv") { continue; }
                    pending.push((item.path(), path));
                } else if kind.is_file() && is_ai_file(&path) {
                    files.push(Entry { name, path, directory: false });
                }
            }
            if truncated { break; }
        }
        files.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
        Ok(SearchResults { files, truncated })
    }).await.map_err(|e| e.to_string())?
}

fn is_ai_file(path: &str) -> bool {
    let lower = path.to_lowercase();
    let parts: Vec<&str> = lower.split('/').collect();
    let name = parts.last().copied().unwrap_or("");
    if matches!(name, "agents.md" | "agents.override.md" | "claude.md" | "gemini.md" | "copilot-instructions.md" | ".cursorrules" | ".windsurfrules" | ".aider.conf.yml" | ".aider.conf.yaml" | "skills-lock.json" | ".mcp.json" | "mcp.json" | "marketplace.json") { return true; }
    if parts.iter().any(|part| matches!(*part, ".claude" | ".codex" | ".agents" | ".cursor" | ".windsurf" | ".gemini" | ".opencode" | ".skills" | ".mcp" | ".claude-plugin")) { return true; }
    parts.windows(2).any(|p| p[0] == ".github" && matches!(p[1], "agents" | "instructions" | "prompts" | "skills"))
}

#[cfg(test)]
mod ai_file_tests {
    use super::is_ai_file;
    #[test]
    fn detects_assistant_files_without_matching_unrelated_files() {
        for path in ["AGENTS.md", "src/CLAUDE.md", ".codex/config.toml", ".claude/agents/reviewer.md", ".github/agents/test.agent.md", ".cursor/rules/test.mdc", ".mcp.json", ".claude-plugin/marketplace.json"] { assert!(is_ai_file(path), "{path}"); }
        for path in ["README.md", "src/agents.ts", ".github/workflows/ci.yml", "docs/claude-guide.md"] { assert!(!is_ai_file(path), "{path}"); }
    }
}
