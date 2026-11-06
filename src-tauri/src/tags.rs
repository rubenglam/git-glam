use crate::history::git;
use serde::Deserialize;
use serde_json::{Value, json};
use std::{path::Path, time::Duration};
fn run(dir: &Path, args: &[&str]) -> Result<String, String> {
    git(dir, args, Duration::from_secs(120), 16 * 1024 * 1024)
}
fn exists(dir: &Path, name: &str) -> bool {
    run(
        dir,
        &[
            "show-ref",
            "--verify",
            "--quiet",
            &format!("refs/tags/{name}"),
        ],
    )
    .is_ok()
}
fn valid_existing(dir: &Path, name: &str) -> Result<(), String> {
    if name.is_empty() || name.starts_with('-') || !exists(dir, name) {
        Err("Etiqueta no válida".into())
    } else {
        Ok(())
    }
}
fn remote_for(dir: &Path, remote: Option<&str>) -> Result<String, String> {
    let all = run(dir, &["remote"])?;
    let remotes: Vec<_> = all.lines().filter(|s| !s.is_empty()).collect();
    if remotes.is_empty() {
        return Err("El repositorio no tiene remotos configurados".into());
    }
    match remote.filter(|s| !s.is_empty()) {
        Some(r) if remotes.contains(&r) => Ok(r.into()),
        Some(_) => Err("Remoto no válido".into()),
        None => Ok(if remotes.contains(&"origin") {
            "origin"
        } else {
            remotes[0]
        }
        .into()),
    }
}
fn list_inner(dir: &Path) -> Result<Vec<Value>, String> {
    let text = run(
        dir,
        &[
            "for-each-ref",
            "--sort=-creatordate",
            "--format=%(refname:short)%1f%(objecttype)%1f%(*objectname)%1f%(objectname)%1f%(creatordate:short)%1f%(contents:subject)",
            "refs/tags",
        ],
    )?;
    Ok(text.lines().filter(|s| !s.is_empty()).map(|line| { let mut f = line.split('\x1f'); let name=f.next().unwrap_or_default(); let annotated=f.next()==Some("tag"); let target=f.next().unwrap_or_default();let object=f.next().unwrap_or_default();let date=f.next().unwrap_or_default();let subject=f.next().unwrap_or_default(); json!({"name":name,"annotated":annotated,"commit":if annotated {target} else {object},"date":date,"message":if annotated {subject} else {""}}) }).collect())
}
#[derive(Deserialize)]
pub struct TagRequest {
    name: String,
    hash: Option<String>,
    message: Option<String>,
}
fn create_inner(dir: &Path, request: TagRequest) -> Result<(), String> {
    let name = request.name.as_str();
    if name.is_empty() || name.starts_with('-') || name.trim() != name {
        return Err("Introduce un nombre de etiqueta válido".into());
    }
    run(dir, &["check-ref-format", &format!("refs/tags/{name}")])
        .map_err(|_| "Nombre de etiqueta no válido".to_string())?;
    let hash = request.hash.as_deref().unwrap_or("HEAD");
    if hash != "HEAD"
        && (!(40..=64).contains(&hash.len()) || !hash.bytes().all(|b| b.is_ascii_hexdigit()))
    {
        return Err("Commit no válido".into());
    }
    if exists(dir, name) {
        return Err(format!("La etiqueta «{name}» ya existe"));
    }
    let message = request.message.as_deref().unwrap_or("").trim();
    if message.is_empty() {
        run(dir, &["tag", "--", name, hash])?;
    } else {
        run(dir, &["tag", "-a", "-m", message, "--", name, hash])?;
    }
    Ok(())
}
fn delete_inner(
    dir: &Path,
    name: &str,
    remote: bool,
    remote_name: Option<&str>,
) -> Result<(), String> {
    if remote {
        let target = remote_for(dir, remote_name)?;
        if name.is_empty() || name.starts_with('-') {
            return Err("Etiqueta no válida".into());
        }
        run(
            dir,
            &["push", &target, "--delete", &format!("refs/tags/{name}")],
        )?;
    } else {
        valid_existing(dir, name)?;
        run(dir, &["tag", "-d", "--", name])?;
    }
    Ok(())
}
fn push_inner(dir: &Path, name: &str, remote_name: Option<&str>) -> Result<(), String> {
    valid_existing(dir, name)?;
    let target = remote_for(dir, remote_name)?;
    run(
        dir,
        &[
            "push",
            &target,
            &format!("refs/tags/{name}:refs/tags/{name}"),
        ],
    )?;
    Ok(())
}
#[tauri::command]
pub async fn list_tags(dir: String) -> Result<Vec<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || list_inner(Path::new(&dir)))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn create_tag(dir: String, request: TagRequest) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || create_inner(Path::new(&dir), request))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn delete_tag(
    dir: String,
    name: String,
    remote: Option<bool>,
    remote_name: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        delete_inner(
            Path::new(&dir),
            &name,
            remote.unwrap_or(false),
            remote_name.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn push_tag(
    dir: String,
    name: String,
    remote_name: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        push_inner(Path::new(&dir), &name, remote_name.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, process::Command};
    fn g(dir: &Path, args: &[&str]) {
        assert!(
            Command::new("git")
                .args(args)
                .current_dir(dir)
                .output()
                .unwrap()
                .status
                .success()
        );
    }
    #[test]
    fn creates_lists_and_deletes_tags() {
        let t = tempfile::tempdir().unwrap();
        let d = t.path();
        g(d, &["init", "-q"]);
        g(d, &["config", "user.name", "Test"]);
        g(d, &["config", "user.email", "test@example.com"]);
        fs::write(d.join("a"), "x").unwrap();
        g(d, &["add", "a"]);
        g(d, &["commit", "-qm", "initial"]);
        create_inner(
            d,
            TagRequest {
                name: "v1".into(),
                hash: None,
                message: Some("release".into()),
            },
        )
        .unwrap();
        let list = list_inner(d).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0]["annotated"], true);
        assert_eq!(list[0]["message"], "release");
        delete_inner(d, "v1", false, None).unwrap();
        assert!(list_inner(d).unwrap().is_empty());
    }
}
