use std::{fs, io::Write, path::Path};
const FILES: &[&str] = &[
    "projects.json",
    "settings.json",
    "agent-chats.json",
    "improvements.json",
];
fn migrate(source: &Path, target: &Path) -> Result<(), String> {
    if target.join(".electron-data-migrated").exists() {
        return Ok(());
    }
    fs::create_dir_all(target).map_err(|e| format!("No se pudo preparar la migración: {e}"))?;
    for name in FILES {
        let from = source.join(name);
        let to = target.join(name);
        if to.exists() || !from.is_file() {
            continue;
        }
        let bytes = fs::read(&from).map_err(|e| format!("No se pudo importar {name}: {e}"))?;
        let mut tmp = tempfile::NamedTempFile::new_in(target).map_err(|e| e.to_string())?;
        tmp.write_all(&bytes).map_err(|e| e.to_string())?;
        tmp.flush().map_err(|e| e.to_string())?;
        match tmp.persist_noclobber(&to) {
            Ok(_) => (),
            Err(e) if e.error.kind() == std::io::ErrorKind::AlreadyExists => (),
            Err(e) => return Err(format!("No se pudo importar {name}: {}", e.error)),
        }
    }
    let mut marker = tempfile::NamedTempFile::new_in(target).map_err(|e| e.to_string())?;
    marker.write_all(b"1\n").map_err(|e| e.to_string())?;
    match marker.persist_noclobber(target.join(".electron-data-migrated")) {
        Ok(_) => Ok(()),
        Err(e) if e.error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
pub fn import_existing(target: &Path) -> Result<(), String> {
    if target.join(".electron-data-migrated").exists() {
        return Ok(());
    }
    let Some(roaming) = std::env::var_os("APPDATA") else {
        return Ok(());
    };
    let roaming = Path::new(&roaming);
    let candidates = [roaming.join("git-graph-desktop"), roaming.join("Git Glam")];
    if let Some(source) = candidates
        .iter()
        .find(|p| p.join("projects.json").is_file() || p.join("settings.json").is_file())
    {
        migrate(source, target)?;
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn imports_once_without_overwriting() {
        let t = tempfile::tempdir().unwrap();
        let src = t.path().join("old");
        let dst = t.path().join("new");
        fs::create_dir_all(&src).unwrap();
        fs::create_dir_all(&dst).unwrap();
        fs::write(src.join("projects.json"), "old").unwrap();
        fs::write(src.join("settings.json"), "old settings").unwrap();
        fs::write(dst.join("settings.json"), "new settings").unwrap();
        migrate(&src, &dst).unwrap();
        assert_eq!(
            fs::read_to_string(dst.join("projects.json")).unwrap(),
            "old"
        );
        assert_eq!(
            fs::read_to_string(dst.join("settings.json")).unwrap(),
            "new settings"
        );
        fs::remove_file(dst.join("projects.json")).unwrap();
        migrate(&src, &dst).unwrap();
        assert!(!dst.join("projects.json").exists());
        assert!(src.join("projects.json").exists());
    }
}
