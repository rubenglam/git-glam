use serde_json::{Value, json};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager, State};
#[derive(Default)]
pub struct SettingsLock(Mutex<()>);
fn defaults() -> Value {
    json!({"showAI":true,"showAIAgent":true,"showAIReview":true,"showAICommit":true,"showAIImprovements":true,"showRemote":true,"leftOpen":true,"rightOpen":true,"explorerIconsOnly":false,"groupTabs":false,"showUngroupedLabel":false,"tabLabelWidth":220,"autoFetchMinutes":0,"layoutDensity":"comfortable","theme":"dark","branchPalette":{"preset":"classic","custom":["#009ce9","#e30094","#00d625","#e69a00","#aa00e8","#ee4c4c","#00cabc"]},"agentModel":"claude-sonnet-5-5","agentEffort":"medium","chatModel":"","summaryModel":"claude-haiku-5-5","reviewModel":"","commitModel":"claude-haiku-5-5","improvementsModel":""})
}
fn valid(key: &str, value: &Value) -> bool {
    let models = [
        "claude-fable-5-1",
        "claude-opus-5-5",
        "claude-sonnet-5-5",
        "claude-haiku-5-5",
    ];
    match key {
        "agentModel" => value.as_str().is_some_and(|v| models.contains(&v)),
        "chatModel" | "summaryModel" | "reviewModel" | "commitModel" | "improvementsModel" => value
            .as_str()
            .is_some_and(|v| v.is_empty() || models.contains(&v)),
        "agentEffort" => value
            .as_str()
            .is_some_and(|v| ["low", "medium", "high", "xhigh", "max"].contains(&v)),
        "theme" => value
            .as_str()
            .is_some_and(|v| ["light", "dark"].contains(&v)),
        "layoutDensity" => value
            .as_str()
            .is_some_and(|v| ["comfortable", "compact"].contains(&v)),
        "tabLabelWidth" => value.as_u64().is_some_and(|v| (80..=400).contains(&v)),
        "autoFetchMinutes" => value.as_u64().is_some_and(|v| v <= 120),
        "branchPalette" => value.get("preset").and_then(Value::as_str).is_some_and(|v| ["classic", "ocean", "forest", "sunset", "pastel", "custom"].contains(&v))
            && value.get("custom").and_then(Value::as_array).is_some_and(|colors| (2..=24).contains(&colors.len()) && colors.iter().all(|color| color.as_str().is_some_and(|v| v.len() == 7 && v.starts_with('#') && v[1..].bytes().all(|b| b.is_ascii_hexdigit()))))
            && value.get("name").map_or(true, |name| name.as_str().is_some_and(|v| v.chars().count() <= 32)),
        _ => defaults().get(key).is_some_and(Value::is_boolean) && value.is_boolean(),
    }
}
fn read(file: &Path) -> Result<Value, String> {
    let mut result = defaults();
    let bytes = match fs::read(file) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(result),
        Err(e) => return Err(format!("No se pudieron leer los ajustes: {e}")),
    };
    let saved: Value = serde_json::from_slice(&bytes)
        .map_err(|e| format!("No se pudieron leer los ajustes: {e}"))?;
    let saved = saved.as_object().ok_or("Formato de ajustes no válido")?;
    for (key, default) in result.as_object_mut().unwrap() {
        if let Some(value) = saved.get(key) {
            if !valid(key, value) {
                return Err("Formato de ajustes no válido".into());
            }
            *default = value.clone();
        }
    }
    Ok(result)
}
pub(crate) fn write(file: &Path, value: &Value) -> Result<(), String> {
    let parent = file.parent().ok_or("Ruta de ajustes no válida")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut tmp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    serde_json::to_writer_pretty(&mut tmp, value).map_err(|e| e.to_string())?;
    tmp.flush().map_err(|e| e.to_string())?;
    tmp.persist(file)
        .map_err(|e| format!("No se pudieron guardar los ajustes: {e}"))?;
    Ok(())
}
fn path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.join("settings.json"))
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn read_settings(app: AppHandle, lock: State<'_, SettingsLock>) -> Result<Value, String> {
    let _guard = lock.0.lock().map_err(|e| e.to_string())?;
    read(&path(&app)?)
}
#[tauri::command]
pub fn set_setting(
    app: AppHandle,
    lock: State<'_, SettingsLock>,
    key: String,
    value: Value,
) -> Result<Value, String> {
    if !valid(&key, &value) {
        return Err("Ajuste no válido".into());
    }
    let _guard = lock.0.lock().map_err(|e| e.to_string())?;
    let file = path(&app)?;
    let mut state = read(&file)?;
    state[&key] = value;
    write(&file, &state)?;
    Ok(state)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_validation_and_atomic_update() {
        let t = tempfile::tempdir().unwrap();
        let f = t.path().join("settings.json");
        let mut state = read(&f).unwrap();
        assert_eq!(state["theme"], "dark");
        assert!(!valid("theme", &json!("blue")));
        assert!(!valid("tabLabelWidth", &json!(999)));
        assert!(valid("showRemote", &json!(false)));
        state["theme"] = json!("light");
        write(&f, &state).unwrap();
        state["showRemote"] = json!(false);
        write(&f, &state).unwrap();
        assert_eq!(read(&f).unwrap(), state);
    }
}

pub(crate) fn commit_model(app: &AppHandle) -> Result<String, String> {
    let state = read(&path(app)?)?;
    Ok(state["commitModel"]
        .as_str()
        .filter(|s| !s.is_empty())
        .or_else(|| state["agentModel"].as_str())
        .unwrap_or("claude-haiku-5-5")
        .to_owned())
}
