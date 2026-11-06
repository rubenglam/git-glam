use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};
#[derive(Default)]
pub struct DataLock(Mutex<()>);
fn file(app: &AppHandle, kind: &str) -> Result<PathBuf, String> {
    let name = match kind {
        "agent" => "agent-chats.json",
        "improvements" => "improvements.json",
        _ => return Err("Tipo no válido".into()),
    };
    app.path()
        .app_data_dir()
        .map(|p| p.join(name))
        .map_err(|e| e.to_string())
}
fn field(kind: &str) -> &str {
    if kind == "agent" { "chats" } else { "items" }
}
fn read(file: &Path, kind: &str) -> Value {
    let saved = fs::read(file)
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok());
    saved
        .filter(|v| v[field(kind)].is_object())
        .unwrap_or_else(|| json!({field(kind):{}}))
}
fn text(value: &Value, max: usize) -> String {
    value.as_str().unwrap_or("").chars().take(max).collect()
}
fn clean(kind: &str, data: Value) -> Value {
    if kind == "agent" {
        let tabs = data["tabs"]
            .as_array()
            .map(|tabs| {
                tabs.iter()
                    .filter(|t| t["id"].is_string() && t["messages"].is_array())
                    .take(8)
                    .cloned()
                    .map(|mut t| {
                        let messages = t["messages"].as_array().unwrap();
                        t["messages"] = json!(&messages[messages.len().saturating_sub(100)..]);
                        t
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let active = data["activeId"].as_str();
        json!({"tabs":tabs,"activeId":active})
    } else {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        let items = data.as_array().cloned().unwrap_or_default();
        let filtered: Vec<_> = items
            .into_iter()
            .filter(|i| i["id"].is_string() && i["title"].is_string())
            .collect();
        json!(filtered.iter().skip(filtered.len().saturating_sub(200)).map(|item|json!({"id":text(&item["id"],64),"title":text(&item["title"],200),"description":text(&item["description"],2000),"effort":text(&item["effort"],30),"files":item["files"].as_array().map(|a|a.iter().take(20).map(|f|text(f,300)).collect::<Vec<_>>()).unwrap_or_default(),"createdAt":item["createdAt"].as_f64().filter(|n|n.is_finite()).unwrap_or(now as f64)})).collect::<Vec<_>>())
    }
}
#[tauri::command]
pub fn data_load(
    app: AppHandle,
    lock: State<'_, DataLock>,
    kind: String,
    root: String,
) -> Result<Value, String> {
    let _g = lock.0.lock().map_err(|e| e.to_string())?;
    let file = file(&app, &kind)?;
    let state = read(&file, &kind);
    Ok(state[field(&kind)].get(&root).cloned().unwrap_or_else(|| {
        if kind == "agent" {
            json!({"tabs":[],"activeId":null})
        } else {
            json!([])
        }
    }))
}
#[tauri::command]
pub fn data_save(
    app: AppHandle,
    lock: State<'_, DataLock>,
    kind: String,
    root: String,
    data: Value,
) -> Result<(), String> {
    if root.is_empty() {
        return Err("Repositorio no válido".into());
    }
    let _g = lock.0.lock().map_err(|e| e.to_string())?;
    let file = file(&app, &kind)?;
    let mut state = read(&file, &kind);
    let value = clean(&kind, data);
    let empty = if kind == "agent" {
        value["tabs"].as_array().unwrap().is_empty()
    } else {
        value.as_array().unwrap().is_empty()
    };
    let map = state[field(&kind)]
        .as_object_mut()
        .ok_or("Datos no válidos")?;
    if empty {
        map.remove(&root);
    } else {
        map.insert(root, value);
    }
    crate::settings::write(&file, &state)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cleans_and_bounds_agent_and_improvements() {
        let data = json!({"tabs":[{"id":"a","messages":vec![1;110]},{"id":1,"messages":[]}],"activeId":"a"});
        let cleaned = clean("agent", data);
        assert_eq!(cleaned["tabs"].as_array().unwrap().len(), 1);
        assert_eq!(
            cleaned["tabs"][0]["messages"].as_array().unwrap().len(),
            100
        );
        let items = clean(
            "improvements",
            json!([{"id":"a","title":"hello","files":["x"]},{}]),
        );
        assert_eq!(items.as_array().unwrap().len(), 1);
    }
}
