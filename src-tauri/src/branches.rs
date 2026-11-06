use crate::history::git;
use serde_json::{Value, json};
use std::{path::Path, time::Duration};
fn run(dir: &Path, args: &[&str]) -> Result<String, String> {
    git(dir, args, Duration::from_secs(60), 16 * 1024 * 1024)
}
fn exists(dir: &Path, reference: &str) -> bool {
    run(dir, &["show-ref", "--verify", "--quiet", reference]).is_ok()
}
fn validate_name(dir: &Path, name: &str) -> Result<(), String> {
    if name.is_empty() || name.starts_with('-') || name.trim() != name {
        return Err("Introduce un nombre de rama válido".into());
    }
    run(dir, &["check-ref-format", "--branch", name])
        .map_err(|_| "Nombre de rama no válido".to_string())?;
    Ok(())
}
fn list_inner(dir: &Path) -> Result<Value, String> {
    let current = run(dir, &["branch", "--show-current"])?;
    let text = run(
        dir,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(refname)%1f%(refname:short)%1f%(committerdate:relative)%1f%(authorname)%1f%(objectname:short)%1f%(subject)",
            "refs/heads",
            "refs/remotes",
        ],
    )?;
    let rows: Vec<_> = text.lines().filter(|l| !l.is_empty()).map(|line| {
        let mut f = line.split('\x1f'); let reference = f.next().unwrap_or_default(); let name = f.next().unwrap_or_default();
        json!({"ref":reference,"name":name,"remote":reference.starts_with("refs/remotes/"),"date":f.next().unwrap_or_default(),"author":f.next().unwrap_or_default(),"hash":f.next().unwrap_or_default(),"subject":f.next().unwrap_or_default()})
    }).filter(|v| !v["ref"].as_str().unwrap_or_default().ends_with("/HEAD")).collect();
    let local: Vec<_> = rows
        .iter()
        .filter(|v| v["remote"] == false)
        .filter_map(|v| v["name"].as_str())
        .collect();
    let branches: Vec<_> = rows
        .iter()
        .filter(|v| {
            !v["remote"].as_bool().unwrap_or(false)
                || !local.contains(
                    &v["name"]
                        .as_str()
                        .unwrap_or_default()
                        .split_once('/')
                        .map(|(_, n)| n)
                        .unwrap_or(""),
                )
        })
        .collect();
    Ok(json!({"current":current.trim(),"branches":branches}))
}
fn create_inner(dir: &Path, name: &str) -> Result<(), String> {
    validate_name(dir, name)?;
    if exists(dir, &format!("refs/heads/{name}")) {
        return Err(format!("La rama «{name}» ya existe"));
    }
    run(dir, &["switch", "-c", name])?;
    Ok(())
}
fn switch_inner(dir: &Path, reference: &str) -> Result<(), String> {
    let (remote, short) = if let Some(short) = reference.strip_prefix("refs/heads/") {
        (false, short)
    } else if let Some(short) = reference.strip_prefix("refs/remotes/") {
        (true, short)
    } else {
        return Err("Rama no válida".into());
    };
    if short.is_empty() || short.starts_with('-') || !exists(dir, reference) {
        return Err("Rama no válida".into());
    }
    if !remote {
        run(dir, &["switch", short])?;
    } else {
        let local = short.split_once('/').map(|(_, v)| v).unwrap_or(short);
        if exists(dir, &format!("refs/heads/{local}")) {
            run(dir, &["switch", local])?;
        } else {
            run(dir, &["switch", "--track", short])?;
        }
    }
    Ok(())
}
fn rename_inner(dir: &Path, name: &str, new_name: &str) -> Result<(), String> {
    if name.is_empty() || name.starts_with('-') || !exists(dir, &format!("refs/heads/{name}")) {
        return Err("Rama no válida".into());
    }
    validate_name(dir, new_name)?;
    if name == new_name {
        return Ok(());
    }
    if exists(dir, &format!("refs/heads/{new_name}")) {
        return Err(format!("La rama «{new_name}» ya existe"));
    }
    run(dir, &["branch", "-m", name, new_name])?;
    Ok(())
}
fn delete_inner(dir: &Path, name: &str, force: bool) -> Result<(), String> {
    if name.is_empty() || name.starts_with('-') || !exists(dir, &format!("refs/heads/{name}")) {
        return Err("Rama no válida".into());
    }
    if run(dir, &["branch", "--show-current"])?.trim() == name {
        return Err("No se puede borrar la rama actual. Cambia a otra rama primero.".into());
    }
    run(
        dir,
        &["branch", if force { "-D" } else { "-d" }, "--", name],
    )?;
    Ok(())
}
#[tauri::command]
pub async fn list_branches(dir: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || list_inner(Path::new(&dir)))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn create_branch(dir: String, name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || create_inner(Path::new(&dir), &name))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn switch_branch(dir: String, reference: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || switch_inner(Path::new(&dir), &reference))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn rename_branch(dir: String, name: String, new_name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || rename_inner(Path::new(&dir), &name, &new_name))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn delete_branch(dir: String, name: String, force: Option<bool>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        delete_inner(Path::new(&dir), &name, force.unwrap_or(false))
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
    fn creates_switches_renames_and_deletes_branches() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path();
        g(dir, &["init", "-q", "-b", "main"]);
        g(dir, &["config", "user.name", "Test"]);
        g(dir, &["config", "user.email", "test@example.com"]);
        fs::write(dir.join("a"), "x").unwrap();
        g(dir, &["add", "a"]);
        g(dir, &["commit", "-qm", "initial"]);
        create_inner(dir, "feature").unwrap();
        assert_eq!(list_inner(dir).unwrap()["current"], "feature");
        assert!(delete_inner(dir, "feature", false).is_err());
        switch_inner(dir, "refs/heads/main").unwrap();
        rename_inner(dir, "feature", "renamed").unwrap();
        delete_inner(dir, "renamed", false).unwrap();
        assert!(switch_inner(dir, "refs/heads/renamed").is_err());
        assert!(create_inner(dir, "-bad").is_err());
    }
}
fn remote_parts(dir: &Path, reference: &str) -> Result<(String, String), String> {
    let short = reference
        .strip_prefix("refs/remotes/")
        .filter(|s| !s.starts_with('-'))
        .ok_or("Rama remota no válida")?;
    if !exists(dir, reference) {
        return Err("Rama remota no válida".into());
    }
    let remotes = run(dir, &["remote"])?;
    let mut names: Vec<_> = remotes.lines().filter(|s| !s.is_empty()).collect();
    names.sort_by_key(|s| std::cmp::Reverse(s.len()));
    let remote = names
        .into_iter()
        .find(|r| short.strip_prefix(*r).is_some_and(|v| v.starts_with('/')))
        .ok_or("Rama remota no válida")?;
    let branch = &short[remote.len() + 1..];
    if branch.is_empty() || branch == "HEAD" {
        return Err("Rama remota no válida".into());
    }
    Ok((remote.into(), branch.into()))
}
fn local_exists(dir: &Path, name: &str) -> Result<(), String> {
    if name.is_empty() || name.starts_with('-') || !exists(dir, &format!("refs/heads/{name}")) {
        Err("Rama no válida".into())
    } else {
        Ok(())
    }
}
#[tauri::command]
pub async fn delete_remote_branch(dir: String, reference: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = Path::new(&dir);
        let (remote, branch) = remote_parts(dir, &reference)?;
        run(dir, &["push", &remote, "--delete", "--", &branch])?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn set_upstream(
    dir: String,
    name: String,
    reference: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = Path::new(&dir);
        local_exists(dir, &name)?;
        if let Some(reference) = reference.filter(|s| !s.is_empty()) {
            let (remote, branch) = remote_parts(dir, &reference)?;
            run(
                dir,
                &[
                    "branch",
                    &format!("--set-upstream-to={remote}/{branch}"),
                    &name,
                ],
            )?;
        } else {
            run(dir, &["branch", "--unset-upstream", &name])?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn checkout_remote(
    dir: String,
    reference: String,
    name: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = Path::new(&dir);
        let (remote, branch) = remote_parts(dir, &reference)?;
        let name = name
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| branch.clone());
        validate_name(dir, &name)?;
        if exists(dir, &format!("refs/heads/{name}")) {
            return Err(format!("La rama «{name}» ya existe"));
        }
        run(
            dir,
            &[
                "switch",
                "-c",
                &name,
                "--track",
                &format!("{remote}/{branch}"),
            ],
        )?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn branch_operation(
    dir: String,
    action: String,
    reference: String,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = Path::new(&dir);
        if !(reference.starts_with("refs/heads/") || reference.starts_with("refs/remotes/"))
            || !exists(dir, &reference)
        {
            return Err("Rama no válida".into());
        }
        let short = reference
            .strip_prefix("refs/heads/")
            .or_else(|| reference.strip_prefix("refs/remotes/"))
            .unwrap();
        match action.as_str() {
            "merge" => {
                run(dir, &["merge", "--no-edit", &reference])?;
            }
            "fetch" => {
                let (remote, branch) = remote_parts(dir, &reference)?;
                validate_name(dir, &branch)?;
                run(
                    dir,
                    &["fetch", &remote, "--", &format!("{branch}:{branch}")],
                )?;
            }
            "pull" => {
                let (remote, branch) = if reference.starts_with("refs/remotes/") {
                    remote_parts(dir, &reference)?
                } else {
                    let remote = run(dir, &["config", &format!("branch.{short}.remote")])?
                        .trim()
                        .to_owned();
                    let merge = run(dir, &["config", &format!("branch.{short}.merge")])?
                        .trim()
                        .trim_start_matches("refs/heads/")
                        .to_owned();
                    (remote, merge)
                };
                if remote.is_empty() || branch.is_empty() {
                    return Err(format!("«{short}» no tiene upstream"));
                }
                run(dir, &["pull", "--no-edit", &remote, "--", &branch])?;
            }
            "archive" => {
                let suggested = format!(
                    "{}.zip",
                    short.replace(['/', ':', '*', '?', '\"', '<', '>', '|'], "-")
                );
                let Some(file) = rfd::FileDialog::new()
                    .set_file_name(suggested)
                    .add_filter("ZIP", &["zip"])
                    .save_file()
                else {
                    return Ok(false);
                };
                let file = file.to_str().ok_or("Archivo no válido")?;
                run(dir, &["archive", "--format=zip", "-o", file, &reference])?;
            }
            _ => return Err("Acción no válida".into()),
        }
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}
