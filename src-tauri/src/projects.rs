use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager, State};
#[derive(Default)]
pub struct ProjectsLock(Mutex<()>);
fn path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.join("projects.json"))
        .map_err(|e| e.to_string())
}
fn read(file: &Path) -> Result<Value, String> {
    let bytes = match fs::read(file) {
        Ok(v) => v,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(
                json!({"projects":[],"folders":[],"activeProject":null,"defaultProject":null}),
            );
        }
        Err(e) => return Err(e.to_string()),
    };
    let mut state: Value = serde_json::from_slice(&bytes)
        .map_err(|e| format!("No se pudo leer la lista de proyectos: {e}"))?;
    if !state["projects"].as_array().is_some_and(|p| {
        p.iter()
            .all(|x| x["path"].is_string() && x["lastWorktree"].is_string())
    }) || !(state["activeProject"].is_string() || state["activeProject"].is_null())
    {
        return Err("Formato de proyectos no válido".into());
    }
    if state.get("folders").is_none() {
        state["folders"] = json!([]);
    }
    if state.get("defaultProject").is_none() {
        state["defaultProject"] = Value::Null;
    }
    if !state["folders"].as_array().is_some_and(|v| {
        v.iter()
            .all(|f| f["id"].is_string() && f["name"].is_string())
    }) {
        return Err("Formato de carpetas no válido".into());
    }
    Ok(state)
}
fn key(p: &str) -> String {
    p.trim_end_matches(['\\', '/'])
        .replace('/', "\\")
        .to_lowercase()
}
fn update(
    state: &mut Value,
    action: &str,
    project: Option<&str>,
    value: Option<Value>,
) -> Result<(), String> {
    let project = project.unwrap_or("");
    let value = value.unwrap_or(Value::Null);
    match action {
        "select" | "default" => {
            if action == "default" && project.is_empty() {
                state["defaultProject"] = Value::Null;
                return Ok(());
            }
            let p = state["projects"]
                .as_array()
                .unwrap()
                .iter()
                .find(|p| key(p["path"].as_str().unwrap_or("")) == key(project))
                .ok_or("El proyecto ya no está en la lista")?["path"]
                .clone();
            state[if action == "select" {
                "activeProject"
            } else {
                "defaultProject"
            }] = p;
        }
        "remove" => {
            state["projects"]
                .as_array_mut()
                .unwrap()
                .retain(|p| key(p["path"].as_str().unwrap_or("")) != key(project));
            for field in ["activeProject", "defaultProject"] {
                if state[field]
                    .as_str()
                    .is_some_and(|p| key(p) == key(project))
                {
                    state[field] = Value::Null;
                }
            }
        }
        "command" | "move" => {
            if action == "move"
                && !value.is_null()
                && !state["folders"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|f| f["id"] == value)
            {
                return Err("La carpeta ya no existe".into());
            }
            if action == "command"
                && !value
                    .as_str()
                    .is_some_and(|v| v.len() <= 4000 && !v.contains('\0'))
            {
                return Err("El comando no es válido o supera los 4000 caracteres".into());
            }
            let p = state["projects"]
                .as_array_mut()
                .unwrap()
                .iter_mut()
                .find(|p| key(p["path"].as_str().unwrap_or("")) == key(project))
                .ok_or("El proyecto ya no está en la lista")?;
            p[if action == "move" {
                "folderId"
            } else {
                "command"
            }] = value;
        }
        "appearance" => {
            let appearance = value.as_object().ok_or("Apariencia no válida")?;
            let name = appearance.get("name").filter(|v| !v.is_null());
            let icon = appearance.get("icon").filter(|v| !v.is_null());
            let color = appearance.get("color").filter(|v| !v.is_null());
            let targets = appearance.get("colorTargets").filter(|v| !v.is_null());
            if name.is_some_and(|v| !v.as_str().is_some_and(|s| s.trim().chars().count() <= 80)) {
                return Err("El nombre debe tener como máximo 80 caracteres".into());
            }
            if icon.is_some_and(|v| {
                !v.as_str().is_some_and(|s| {
                    !s.is_empty()
                        && s.len() <= 40
                        && s.bytes()
                            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
                })
            }) {
                return Err("El icono no es válido".into());
            }
            if color.is_some_and(|v| {
                !v.as_str().is_some_and(|s| {
                    s.len() == 7
                        && s.starts_with('#')
                        && s[1..].bytes().all(|c| c.is_ascii_hexdigit())
                })
            }) {
                return Err("El color no es válido".into());
            }
            if targets.is_some_and(|v| {
                !["border", "text", "icon"]
                    .iter()
                    .all(|k| v[*k].is_boolean())
            }) {
                return Err("Los destinos del color no son válidos".into());
            }
            let entry = state["projects"]
                .as_array_mut()
                .unwrap()
                .iter_mut()
                .find(|p| key(p["path"].as_str().unwrap_or("")) == key(project))
                .ok_or("El proyecto ya no está en la lista")?;
            let object = entry.as_object_mut().ok_or("Proyecto no válido")?;
            for k in ["name", "icon", "color", "colorTargets"] {
                object.remove(k);
            }
            if let Some(n) = name
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                object.insert("name".into(), json!(n));
            }
            if let Some(v) = icon {
                object.insert("icon".into(), v.clone());
            }
            if let Some(v) = color {
                object.insert("color".into(), v.clone());
            }
            if let Some(v) = targets {
                object.insert(
                    "colorTargets".into(),
                    json!({"border":v["border"],"text":v["text"],"icon":v["icon"]}),
                );
            }
        }
        "reorder" => {
            let list = value
                .as_array()
                .ok_or("El orden de proyectos no es válido")?;
            let existing = state["projects"].as_array().unwrap();
            if list.len() != existing.len() {
                return Err("El orden de proyectos no es válido".into());
            }
            let mut used = std::collections::HashSet::new();
            let mut ordered = vec![];
            for v in list {
                let k = key(v.as_str().ok_or("El orden de proyectos no es válido")?);
                if !used.insert(k.clone()) {
                    return Err("La lista de proyectos ha cambiado; vuelve a intentarlo".into());
                }
                ordered.push(
                    existing
                        .iter()
                        .find(|p| key(p["path"].as_str().unwrap_or("")) == k)
                        .ok_or("La lista de proyectos ha cambiado; vuelve a intentarlo")?
                        .clone(),
                );
            }
            state["projects"] = json!(ordered);
        }
        "folder_create" | "folder_rename" => {
            let name = value.as_str().unwrap_or("").trim();
            if name.is_empty() || name.chars().count() > 80 {
                return Err("El nombre debe tener entre 1 y 80 caracteres".into());
            }
            let folders = state["folders"].as_array_mut().unwrap();
            if folders.iter().any(|f| {
                f["id"] != project
                    && f["name"].as_str().unwrap_or("").to_lowercase() == name.to_lowercase()
            }) {
                return Err("Ya existe una carpeta con ese nombre".into());
            }
            if action == "folder_create" {
                let id = tempfile::Builder::new()
                    .prefix("folder-")
                    .tempfile()
                    .map_err(|e| e.to_string())?
                    .path()
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .to_string();
                folders.push(json!({"id":id,"name":name}));
            } else {
                let folder = folders
                    .iter_mut()
                    .find(|f| f["id"] == project)
                    .ok_or("La carpeta ya no existe")?;
                folder["name"] = json!(name);
            }
        }
        "folder_delete" => {
            let folders = state["folders"].as_array_mut().unwrap();
            if !folders.iter().any(|f| f["id"] == project) {
                return Err("La carpeta ya no existe".into());
            }
            folders.retain(|f| f["id"] != project);
            for p in state["projects"].as_array_mut().unwrap() {
                if p["folderId"] == project {
                    p["folderId"] = Value::Null;
                }
            }
        }
        "folder_reorder" => {
            let ids = value
                .as_array()
                .ok_or("El orden de carpetas no es válido")?;
            let folders = state["folders"].as_array().unwrap();
            if ids.len() != folders.len() {
                return Err("El orden de carpetas no es válido".into());
            }
            let mut used = std::collections::HashSet::new();
            let mut next = vec![];
            for id in ids {
                let id = id.as_str().ok_or("El orden de carpetas no es válido")?;
                if !used.insert(id) {
                    return Err("El orden de carpetas no es válido".into());
                }
                next.push(
                    folders
                        .iter()
                        .find(|f| f["id"] == id)
                        .ok_or("La lista de carpetas ha cambiado; vuelve a intentarlo")?
                        .clone(),
                );
            }
            state["folders"] = json!(next);
        }
        _ => return Err("Acción no válida".into()),
    };
    Ok(())
}
#[tauri::command]
pub fn projects_list(app: AppHandle, lock: State<'_, ProjectsLock>) -> Result<Value, String> {
    let _g = lock.0.lock().map_err(|e| e.to_string())?;
    read(&path(&app)?)
}
#[tauri::command]
pub fn projects_update(
    app: AppHandle,
    lock: State<'_, ProjectsLock>,
    action: String,
    project: Option<String>,
    value: Option<Value>,
) -> Result<Value, String> {
    let _g = lock.0.lock().map_err(|e| e.to_string())?;
    let file = path(&app)?;
    let mut state = read(&file)?;
    update(&mut state, &action, project.as_deref(), value)?;
    crate::settings::write(&file, &state)?;
    Ok(state)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn moves_projects_and_deletes_folders() {
        let mut s = json!({"projects":[{"path":"C:\\repo","lastWorktree":"C:\\repo"}],"folders":[],"activeProject":null,"defaultProject":null});
        update(&mut s, "folder_create", None, Some(json!("Work"))).unwrap();
        let id = s["folders"][0]["id"].as_str().unwrap().to_owned();
        update(&mut s, "move", Some("c:/repo"), Some(json!(id))).unwrap();
        assert_eq!(s["projects"][0]["folderId"], id);
        update(&mut s, "folder_delete", Some(&id), None).unwrap();
        assert!(s["projects"][0]["folderId"].is_null());
        update(&mut s, "default", Some("c:/repo"), None).unwrap();
        assert_eq!(s["defaultProject"], "C:\\repo");
    }
}

fn activate(state: &mut Value, project: &str, worktree: &str) -> Result<(), String> {
    let entry = state["projects"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|p| key(p["path"].as_str().unwrap_or("")) == key(project))
        .ok_or("El proyecto ya no está en la lista")?;
    let actual = entry["path"].clone();
    entry["lastWorktree"] = json!(worktree);
    state["activeProject"] = actual;
    Ok(())
}
#[tauri::command]
pub async fn project_add(app: AppHandle) -> Result<Option<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(folder) = rfd::FileDialog::new().pick_folder() else {
            return Ok(None);
        };
        let repo = crate::repo::load_inner(&folder, true, None)?;
        let root = repo["root"]
            .as_str()
            .ok_or("Repositorio no válido")?
            .to_owned();
        let lock = app.state::<ProjectsLock>();
        let _g = lock.0.lock().map_err(|e| e.to_string())?;
        let file = path(&app)?;
        let mut state = read(&file)?;
        if let Some(entry) = state["projects"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|p| key(p["path"].as_str().unwrap_or("")) == key(&root))
        {
            entry["path"] = json!(root);
            entry["lastWorktree"] = json!(root);
        } else {
            state["projects"]
                .as_array_mut()
                .unwrap()
                .insert(0, json!({"path":root,"lastWorktree":root}));
        }
        state["activeProject"] = json!(root);
        crate::settings::write(&file, &state)?;
        Ok(Some(json!({"repo":repo,"state":state})))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn project_open(
    app: AppHandle,
    project: String,
    show_remote: Option<bool>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let lock = app.state::<ProjectsLock>();
        let _g = lock.0.lock().map_err(|e| e.to_string())?;
        let file = path(&app)?;
        let mut state = read(&file)?;
        let entry = state["projects"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["path"] == project)
            .ok_or("El proyecto ya no está en la lista")?;
        let last = entry["lastWorktree"].as_str().ok_or("Proyecto no válido")?;
        let remote = show_remote.unwrap_or(true);
        let repo = crate::repo::load_inner(Path::new(last), remote, None).or_else(|e| {
            if last != project {
                crate::repo::load_inner(Path::new(&project), remote, None)
            } else {
                Err(e)
            }
        })?;
        activate(
            &mut state,
            &project,
            repo["root"].as_str().ok_or("Repositorio no válido")?,
        )?;
        crate::settings::write(&file, &state)?;
        Ok(json!({"repo":repo,"state":state}))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn project_worktree(
    app: AppHandle,
    project: String,
    dir: String,
    show_remote: Option<bool>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let lock = app.state::<ProjectsLock>();
        let _g = lock.0.lock().map_err(|e| e.to_string())?;
        let file = path(&app)?;
        let mut state = read(&file)?;
        if !state["projects"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["path"] == project)
        {
            return Err("El proyecto ya no está en la lista".into());
        }
        let remote = show_remote.unwrap_or(true);
        let project_repo = crate::repo::load_inner(Path::new(&project), remote, None)?;
        if !project_repo["worktrees"]
            .as_array()
            .unwrap()
            .iter()
            .any(|w| key(w["path"].as_str().unwrap_or("")) == key(&dir))
        {
            return Err("El worktree no pertenece al proyecto".into());
        }
        let repo = crate::repo::load_inner(Path::new(&dir), remote, None)?;
        activate(
            &mut state,
            &project,
            repo["root"].as_str().ok_or("Repositorio no válido")?,
        )?;
        crate::settings::write(&file, &state)?;
        Ok(json!({"repo":repo,"state":state}))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn project_status(app: AppHandle, paths: Vec<String>) -> Result<Value, String> {
    if paths.len() > 200 {
        return Err("Proyectos no válidos".into());
    }
    tauri::async_runtime::spawn_blocking(move||{
        let lock=app.state::<ProjectsLock>();let known={let _g=lock.0.lock().map_err(|e|e.to_string())?;read(&path(&app)?)?["projects"].as_array().unwrap().iter().filter_map(|p|p["path"].as_str().map(str::to_owned)).collect::<std::collections::HashSet<_>>()};
        let mut result=serde_json::Map::new();
        for dir in paths.into_iter().filter(|d|known.contains(d)){
            let run=|args:&[&str]|crate::history::git(Path::new(&dir),args,std::time::Duration::from_secs(15),16*1024*1024);
            if let Ok(status)=run(&["status","--porcelain=v1","--untracked-files=normal","-z"]){let counts=run(&["rev-list","--left-right","--count","@{upstream}...HEAD"]).unwrap_or_default();let mut counts=counts.split_whitespace().map(|v|v.parse::<usize>().unwrap_or(0));let behind=counts.next().unwrap_or(0);let ahead=counts.next().unwrap_or(0);let branch=run(&["branch","--show-current"]).map(|b|b.trim().to_string()).unwrap_or_default();let branch=if branch.is_empty(){run(&["rev-parse","--short","HEAD"]).map(|h|h.trim().to_string()).unwrap_or_default()}else{branch};result.insert(dir,json!({"branch":branch,"dirty":status.split('\0').filter(|s|!s.is_empty()).count(),"ahead":ahead,"behind":behind}));}
        }Ok(Value::Object(result))
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn run_project_command(
    app: AppHandle,
    project: String,
    worktree: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let lock = app.state::<ProjectsLock>();
        let entry = {
            let _g = lock.0.lock().map_err(|e| e.to_string())?;
            read(&path(&app)?)?["projects"]
                .as_array()
                .unwrap()
                .iter()
                .find(|p| key(p["path"].as_str().unwrap_or("")) == key(&project))
                .cloned()
                .ok_or("El proyecto ya no está en la lista")?
        };
        let command = entry["command"]
            .as_str()
            .filter(|s| !s.trim().is_empty() && s.len() <= 4000 && !s.contains('\0'))
            .ok_or("Configura un comando para este proyecto en Ajustes")?;
        let run = |args: &[&str]| {
            crate::history::git(
                Path::new(&worktree),
                args,
                std::time::Duration::from_secs(15),
                16 * 1024 * 1024,
            )
        };
        let root = run(&["rev-parse", "--show-toplevel"])?;
        let root = root.trim();
        if key(root) != key(&worktree) {
            return Err("El worktree seleccionado ya no está disponible".into());
        }
        let worktrees = run(&["worktree", "list", "--porcelain", "-z"])?;
        let project = entry["path"].as_str().ok_or("Proyecto no válido")?;
        if !worktrees
            .split('\0')
            .filter_map(|s| s.strip_prefix("worktree "))
            .any(|p| key(p) == key(project))
        {
            return Err("El worktree seleccionado ya no pertenece al proyecto".into());
        }
        use base64::Engine;
        let bytes: Vec<u8> = command.encode_utf16().flat_map(u16::to_le_bytes).collect();
        let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
        let system = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
        let shell = PathBuf::from(system)
            .join("System32")
            .join("WindowsPowerShell")
            .join("v1.0")
            .join("powershell.exe");
        std::process::Command::new(shell)
            .args(["-NoLogo", "-NoExit", "-EncodedCommand", &encoded])
            .current_dir(root)
            .env("GITGRAPH_PROJECT", project)
            .env("GITGRAPH_WORKTREE", root)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| format!("No se pudo abrir PowerShell: {e}"))?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod appearance_tests {
    use super::*;
    #[test]
    fn validates_and_saves_project_appearance() {
        let mut state = json!({"projects":[{"path":"C:\\repo","lastWorktree":"C:\\repo"}],"folders":[],"activeProject":null,"defaultProject":null});
        update(&mut state,"appearance",Some("C:\\repo"),Some(json!({"name":" Repo ","icon":"star","color":"#aabbcc","colorTargets":{"border":true,"text":false,"icon":true}}))).unwrap();
        assert_eq!(state["projects"][0]["name"], "Repo");
        assert_eq!(state["projects"][0]["color"], "#aabbcc");
        assert!(
            update(
                &mut state,
                "appearance",
                Some("C:\\repo"),
                Some(json!({"color":"red"}))
            )
            .is_err()
        );
    }
}
