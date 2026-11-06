use crate::history::git;
use serde::Deserialize;
use std::{path::Path, time::Duration};
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionRequest {
    r#type: String,
    hash: String,
    expected_head: Option<String>,
    expected_branch: Option<String>,
    name: Option<String>,
    message: Option<String>,
    mainline: Option<usize>,
    mode: Option<String>,
}
fn hash_ok(s: &str) -> bool {
    (s.len() == 40 || s.len() == 64) && s.bytes().all(|b| b.is_ascii_hexdigit())
}
fn run(dir: &Path, args: &[&str]) -> Result<String, String> {
    let mut base = vec!["-c", "core.editor=true", "-c", "sequence.editor=true"];
    base.extend_from_slice(args);
    git(dir, &base, Duration::from_secs(120), 16 * 1024 * 1024)
}
fn action_inner(dir: &Path, r: ActionRequest) -> Result<String, String> {
    if !hash_ok(&r.hash) {
        return Err("Repositorio o commit no válido".into());
    }
    if ![
        "tag",
        "branch",
        "checkout",
        "cherry-pick",
        "revert",
        "merge",
        "rebase",
        "reset",
    ]
    .contains(&r.r#type.as_str())
    {
        return Err("Acción no válida".into());
    }
    run(dir, &["cat-file", "-e", &format!("{}^{{commit}}", r.hash)])?;
    if !["tag", "branch"].contains(&r.r#type.as_str()) {
        let expected = r
            .expected_head
            .as_deref()
            .filter(|v| hash_ok(v))
            .ok_or("Falta el estado esperado de HEAD")?;
        let branch_expected = r
            .expected_branch
            .as_deref()
            .ok_or("Falta el estado esperado de HEAD")?;
        let head = run(dir, &["rev-parse", "--verify", "HEAD"])?;
        let branch = run(dir, &["branch", "--show-current"])?;
        let branch = if branch.trim().is_empty() {
            "HEAD separado"
        } else {
            branch.trim()
        };
        if !head.trim().eq_ignore_ascii_case(expected) || branch != branch_expected {
            return Err(
                "HEAD o la rama actual han cambiado. Actualiza el grafo y vuelve a intentarlo."
                    .into(),
            );
        }
        if ["merge", "rebase", "reset"].contains(&r.r#type.as_str()) && branch == "HEAD separado" {
            return Err("Esta acción requiere una rama activa; HEAD está separado.".into());
        }
    }
    let mut args: Vec<String> = vec![];
    match r.r#type.as_str() {
        "tag" | "branch" => {
            let name = r
                .name
                .as_deref()
                .filter(|s| !s.is_empty() && !s.starts_with('-') && s.trim() == *s)
                .ok_or("Introduce un nombre válido")?;
            let prefix = if r.r#type == "tag" { "tags" } else { "heads" };
            run(dir, &["check-ref-format", &format!("refs/{prefix}/{name}")])?;
            args.push(r.r#type.clone());
            let msg = r.message.as_deref().unwrap_or("").trim();
            if r.r#type == "tag" && !msg.is_empty() {
                args.extend(["-a".into(), "-m".into(), msg.into()]);
            }
            args.extend(["--".into(), name.into(), r.hash.clone()]);
        }
        "checkout" => args.extend(["checkout".into(), "--detach".into(), r.hash.clone()]),
        "cherry-pick" | "revert" => {
            let parents = run(dir, &["rev-list", "--parents", "-n", "1", &r.hash])?;
            let count = parents.split_whitespace().count().saturating_sub(1);
            args.extend([r.r#type.clone(), "--no-edit".into()]);
            if count > 1 {
                let mainline = r
                    .mainline
                    .filter(|v| *v >= 1 && *v <= count)
                    .ok_or("Selecciona el padre principal del merge")?;
                args.extend(["-m".into(), mainline.to_string()]);
            }
            args.push(r.hash.clone());
        }
        "merge" => args.extend(["merge".into(), "--no-edit".into(), r.hash.clone()]),
        "rebase" => args.extend(["rebase".into(), "--no-autostash".into(), r.hash.clone()]),
        "reset" => {
            let mode = r
                .mode
                .as_deref()
                .filter(|m| ["soft", "mixed", "hard"].contains(m))
                .ok_or("Modo de reset no válido")?;
            args.extend(["reset".into(), format!("--{mode}"), r.hash.clone()]);
        }
        _ => unreachable!(),
    }
    let refs: Vec<_> = args.iter().map(String::as_str).collect();
    Ok(run(dir, &refs)?.trim().to_owned())
}
#[tauri::command]
pub async fn commit_action(dir: String, request: ActionRequest) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || action_inner(Path::new(&dir), request))
        .await
        .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, process::Command};
    fn g(d: &Path, a: &[&str]) -> String {
        let o = Command::new("git").args(a).current_dir(d).output().unwrap();
        assert!(o.status.success());
        String::from_utf8_lossy(&o.stdout).trim().into()
    }
    #[test]
    fn protects_stale_head() {
        let t = tempfile::tempdir().unwrap();
        let d = t.path();
        g(d, &["init", "-q", "-b", "main"]);
        g(d, &["config", "user.name", "Test"]);
        g(d, &["config", "user.email", "test@example.com"]);
        fs::write(d.join("a"), "x").unwrap();
        g(d, &["add", "a"]);
        g(d, &["commit", "-qm", "first"]);
        let h = g(d, &["rev-parse", "HEAD"]);
        let r = ActionRequest {
            r#type: "reset".into(),
            hash: h,
            expected_head: Some("0".repeat(40)),
            expected_branch: Some("main".into()),
            name: None,
            message: None,
            mainline: None,
            mode: Some("hard".into()),
        };
        assert!(action_inner(d, r).unwrap_err().contains("han cambiado"));
    }
}
