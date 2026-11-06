use rusty_leveldb::{DB, LdbIterator, Options};
use std::{collections::BTreeMap, fs, path::Path};
const KEYS: &[&str] = &[
    "gitgraph.hiddenTabs",
    "gitgraph.hiddenFolders",
    "gitgraph.collapsedGroups",
    "gitgraph.tabColors",
    "gitgraph.leftWidth",
    "gitgraph.rightWidth",
    "gitgraph.panelOrder",
    "gitgraph.panelsSwapped",
    "gitgraph.settingsSidebarWidth",
];
fn decode(data: &[u8]) -> Option<String> {
    let (&encoding, bytes) = data.split_first()?;
    match encoding {
        1 => Some(bytes.iter().map(|&b| char::from(b)).collect()),
        0 => {
            if bytes.len() % 2 != 0 {
                return None;
            }
            String::from_utf16(
                &bytes
                    .chunks_exact(2)
                    .map(|c| u16::from_le_bytes([c[0], c[1]]))
                    .collect::<Vec<_>>(),
            )
            .ok()
        }
        _ => None,
    }
}
fn read_db(source: &Path) -> Result<BTreeMap<String, String>, String> {
    let temp = tempfile::tempdir().map_err(|e| e.to_string())?;
    for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        if name == "LOCK" || !entry.file_type().map_err(|e| e.to_string())?.is_file() {
            continue;
        }
        fs::copy(entry.path(), temp.path().join(name)).map_err(|e| e.to_string())?;
    }
    let mut options = Options::default();
    options.create_if_missing = false;
    let mut db = DB::open(temp.path(), options)
        .map_err(|e| format!("No se pudo leer la disposición anterior: {e}"))?;
    let mut iter = db.new_iter().map_err(|e| e.to_string())?;
    let mut result = BTreeMap::new();
    let mut priority = BTreeMap::new();
    while let Some((key, value)) = iter.next() {
        if key.first() != Some(&b'_') {
            continue;
        }
        let Some(separator) = key.iter().position(|b| *b == 0) else {
            continue;
        };
        let origin = &key[1..separator];
        let rank = if origin == b"file://" {
            2
        } else if origin.starts_with(b"http://127.0.0.1:") {
            1
        } else {
            continue;
        };
        let Some(name) = decode(&key[separator + 1..]) else {
            continue;
        };
        if !KEYS.contains(&name.as_str()) || priority.get(&name).is_some_and(|&v| v >= rank) {
            continue;
        }
        let Some(data) = decode(&value) else { continue };
        if data.len() > 100_000 || serde_json::from_str::<serde_json::Value>(&data).is_err() {
            continue;
        }
        priority.insert(name.clone(), rank);
        result.insert(name, data);
    }
    Ok(result)
}
#[tauri::command]
pub async fn electron_ui_settings() -> Result<BTreeMap<String, String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(roaming) = std::env::var_os("APPDATA") else {
            return Ok(BTreeMap::new());
        };
        for name in ["git-graph-desktop", "Git Glam"] {
            let path = Path::new(&roaming)
                .join(name)
                .join("Local Storage")
                .join("leveldb");
            if path.join("CURRENT").is_file() {
                return read_db(&path);
            }
        }
        Ok(BTreeMap::new())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn decodes_chromium_strings() {
        assert_eq!(decode(b"\x01hello").as_deref(), Some("hello"));
        assert_eq!(decode(&[0, 0xf1, 0]).as_deref(), Some("ñ"));
        assert!(decode(&[0, 1]).is_none());
    }
    #[test]
    fn imports_only_known_values_and_prefers_file_origin() {
        let t = tempfile::tempdir().unwrap();
        let mut db = DB::open(t.path(), Options::default()).unwrap();
        db.put(
            b"_http://127.0.0.1:5173\0\x01gitgraph.leftWidth",
            b"\x01100",
        )
        .unwrap();
        db.put(b"_file://\0\x01gitgraph.leftWidth", b"\x01325")
            .unwrap();
        db.put(b"_file://\0\x01unrelated", b"\x011").unwrap();
        db.flush().unwrap();
        db.close().unwrap();
        drop(db);
        let state = read_db(t.path()).unwrap();
        assert_eq!(state.get("gitgraph.leftWidth").unwrap(), "325");
        assert_eq!(state.len(), 1);
    }
}
#[cfg(test)]
mod real_profile_tests {
    use super::*;
    #[test]
    #[ignore = "reads the local Electron UI layout"]
    fn reads_current_electron_layout() {
        let Some(roaming) = std::env::var_os("APPDATA") else {
            panic!("APPDATA missing")
        };
        let source = Path::new(&roaming)
            .join("git-graph-desktop")
            .join("Local Storage")
            .join("leveldb");
        let data = read_db(&source).unwrap();
        assert!(data.contains_key("gitgraph.hiddenTabs"));
        assert!(data.contains_key("gitgraph.leftWidth"));
    }
}
