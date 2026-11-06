use regex::Regex;
use serde_json::{Value, json};
use std::{path::Path, sync::OnceLock, time::Duration};
#[derive(Debug, PartialEq)]
pub(crate) struct Remote {
    pub provider: &'static str,
    pub host: String,
    pub path: String,
}
fn parse_remote(url: &str) -> Option<Remote> {
    static REMOTE: OnceLock<Regex> = OnceLock::new();
    let re=REMOTE.get_or_init(||Regex::new(r"^(?:(?:https?|ssh|git)://(?:[^@/]+@)?|(?:[^@/\s]+@)?)([^:/\s]+)(?::\d+)?[:/]+(.+?)(?:\.git)?/?$").unwrap());
    let cap = re.captures(url.trim())?;
    let host = cap[1].to_lowercase();
    let path = cap[2]
        .trim_start_matches('/')
        .trim_end_matches('/')
        .to_owned();
    let github = host
        .strip_prefix("www.")
        .or_else(|| host.strip_prefix("ssh."))
        .unwrap_or(&host);
    if github == "github.com" || github.starts_with("github.com-") {
        let parts: Vec<_> = path.split('/').collect();
        return if parts.len() == 2 && !parts[0].is_empty() && !parts[1].is_empty() {
            Some(Remote {
                provider: "github",
                host: "github.com".into(),
                path,
            })
        } else {
            None
        };
    }
    let gitlab = host.strip_prefix("www.").unwrap_or(&host);
    if gitlab == "gitlab.com" || gitlab.starts_with("gitlab.com-") {
        return if path.contains('/') {
            Some(Remote {
                provider: "gitlab",
                host: "gitlab.com".into(),
                path,
            })
        } else {
            None
        };
    }
    if host.starts_with("gitlab.") || host.contains(".gitlab.") {
        return if path.contains('/') {
            Some(Remote {
                provider: "gitlab",
                host,
                path,
            })
        } else {
            None
        };
    }
    None
}
pub(crate) fn remote_info(dir: &Path) -> Result<Remote, String> {
    let run =
        |args: &[&str]| crate::history::git(dir, args, Duration::from_secs(30), 16 * 1024 * 1024);
    let names = run(&["remote"])?;
    let mut names: Vec<_> = names.lines().filter(|s| !s.is_empty()).collect();
    if names.is_empty() {
        return Err("El repositorio no tiene remotos configurados".into());
    }
    names.sort_by_key(|n| if *n == "origin" { 0 } else { 1 });
    let mut seen = vec![];
    for name in names {
        let url = run(&["remote", "get-url", name])?;
        if let Some(remote) = parse_remote(&url) {
            return Ok(remote);
        }
        seen.push(format!("{name}: {}", url.trim()));
    }
    Err(format!(
        "Ningún remoto apunta a GitHub o GitLab ({})",
        seen.join(", ")
    ))
}
#[tauri::command]
pub async fn forge_info(dir: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let r = remote_info(Path::new(&dir))?;
        let (owner, repo) = r.path.rsplit_once('/').ok_or("Remoto no válido")?;
        Ok(json!({"provider":r.provider,"owner":owner,"repo":repo}))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_ssh_https_and_aliases() {
        assert_eq!(
            parse_remote("git@github.com:foo/bar.git"),
            Some(Remote {
                provider: "github",
                host: "github.com".into(),
                path: "foo/bar".into()
            })
        );
        assert_eq!(
            parse_remote("https://gitlab.com/group/sub/repo.git")
                .unwrap()
                .path,
            "group/sub/repo"
        );
        assert_eq!(
            parse_remote("git@github.com-work:foo/bar.git")
                .unwrap()
                .host,
            "github.com"
        );
        assert!(parse_remote("git@other.example:foo/bar").is_none());
    }
}
fn encode(value: &str) -> String {
    use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};
    utf8_percent_encode(value, NON_ALPHANUMERIC).to_string()
}
fn endpoint(remote: &Remote) -> String {
    if remote.provider == "github" {
        format!(
            "https://api.github.com/repos/{}",
            remote
                .path
                .split('/')
                .map(encode)
                .collect::<Vec<_>>()
                .join("/")
        )
    } else {
        format!(
            "https://{}/api/v4/projects/{}",
            remote.host,
            encode(&remote.path)
        )
    }
}
fn secret(dir: &Path, remote: &Remote) -> Result<String, String> {
    let saved = crate::tokens::get(dir)?;
    if !saved.is_empty() {
        return Ok(saved);
    }
    if remote.provider == "github" {
        if let Ok(token) = std::env::var("GITHUB_TOKEN").or_else(|_| std::env::var("GH_TOKEN")) {
            if !token.is_empty() {
                return Ok(token);
            }
        }
        use wait_timeout::ChildExt;
        let mut cmd = std::process::Command::new("gh");
        cmd.args(["auth", "token"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        if let Ok(mut child) = cmd.spawn() {
            match child.wait_timeout(Duration::from_secs(5)) {
                Ok(Some(status)) if status.success() => {
                    use std::io::Read;
                    let mut token = String::new();
                    if let Some(mut out) = child.stdout.take() {
                        let _ = out.read_to_string(&mut token);
                    }
                    return Ok(token.trim().to_owned());
                }
                Ok(None) | Err(_) => {
                    let _ = child.kill();
                    let _ = child.wait();
                }
                _ => (),
            }
        }
        Ok(String::new())
    } else {
        Ok(std::env::var("GITLAB_TOKEN")
            .or_else(|_| std::env::var("GITLAB_PRIVATE_TOKEN"))
            .unwrap_or_default())
    }
}

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent("git-graph-desktop")
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())
}
fn request(
    remote: &Remote,
    secret: &str,
    method: reqwest::Method,
    url: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let client = client()?;
    let mut req = client.request(method, url);
    if remote.provider == "github" {
        req = req.header("Accept", "application/vnd.github+json");
        if !secret.is_empty() {
            req = req.bearer_auth(secret);
        }
    } else if !secret.is_empty() {
        req = req.header("PRIVATE-TOKEN", secret);
    }
    if let Some(body) = body {
        req = req.json(&body);
    }
    let response = req
        .send()
        .map_err(|e| format!("No se pudo conectar con el servidor: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(match status.as_u16() {
            401 | 404 => {
                "No se pudo acceder al repositorio; comprueba el token y sus permisos".into()
            }
            403 | 429 => "Acceso denegado o límite de la API alcanzado".into(),
            422 => "El servidor no pudo procesar la consulta".into(),
            _ => format!("El servidor respondió {status}"),
        });
    }
    response
        .json()
        .map_err(|e| format!("Respuesta no válida: {e}"))
}
fn labels(item: &Value) -> Vec<Value> {
    item.as_array()
        .map(|a| {
            a.iter()
                .map(|l| {
                    if let Some(name) = l.as_str() {
                        json!({"name":name,"color":""})
                    } else {
                        json!({"name":l["name"],"color":l["color"].as_str().unwrap_or("").trim_start_matches('#')})
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}
fn str_at<'a>(v: &'a Value, path: &[&str]) -> &'a str {
    let mut v = v;
    for key in path {
        v = &v[*key];
    }
    v.as_str().unwrap_or("")
}
fn first<'a>(v: &'a Value, paths: &[&[&str]]) -> &'a str {
    paths
        .iter()
        .map(|p| str_at(v, p))
        .find(|s| !s.is_empty())
        .unwrap_or("")
}
fn detail_inner(dir: &Path, kind: &str, id: u64) -> Result<Value, String> {
    if !["issues", "pulls", "milestones", "runs"].contains(&kind) {
        return Err("Sección no válida".into());
    }
    if id == 0 {
        return Err("Identificador no válido".into());
    }
    let remote = remote_info(dir)?;
    let token = secret(dir, &remote)?;
    let base = endpoint(&remote);
    let sub = if remote.provider == "gitlab" {
        match kind {
            "issues" => "issues",
            "pulls" => "merge_requests",
            "milestones" => "milestones",
            _ => "pipelines",
        }
    } else {
        match kind {
            "runs" => "actions/runs",
            _ => kind,
        }
    };
    let item = request(
        &remote,
        &token,
        reqwest::Method::GET,
        &format!("{base}/{sub}/{id}"),
        None,
    )?;
    let mut comments = Vec::new();
    let mut comments_error = String::new();
    if kind == "issues" || kind == "pulls" {
        let sub = if remote.provider == "gitlab" {
            if kind == "pulls" {
                "merge_requests"
            } else {
                "issues"
            }
        } else {
            "issues"
        };
        let suffix = if remote.provider == "gitlab" {
            "notes?per_page=100&sort=asc"
        } else {
            "comments?per_page=100"
        };
        match request(&remote,&token,reqwest::Method::GET,&format!("{base}/{sub}/{id}/{suffix}"),None){Ok(data)=>{comments=data.as_array().map(|a|a.iter().filter(|v|v["system"]!=true).map(|v|json!({"author":first(v,&[&["user","login"],&["author","username"]]),"body":str_at(v,&["body"]),"createdAt":str_at(v,&["created_at"])})).collect()).unwrap_or_default()},Err(e)=>comments_error=e}
    }
    let title = first(&item, &[&["title"], &["display_title"], &["name"]]);
    let fallback = format!(
        "Pipeline #{}",
        item["iid"]
            .as_u64()
            .or_else(|| item["id"].as_u64())
            .unwrap_or(id)
    );
    let assignees = item["assignees"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|v| first(v, &[&["login"], &["username"]]))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(
        json!({"title":if title.is_empty()&&kind=="runs"{&fallback}else{title},"body":first(&item,&[&["body"],&["description"]]),"url":first(&item,&[&["html_url"],&["web_url"]]),"state":if !item["merged_at"].is_null(){"merged"}else{first(&item,&[&["state"],&["conclusion"],&["status"]])},"author":first(&item,&[&["user","login"],&["author","username"],&["actor","login"]]),"createdAt":str_at(&item,&["created_at"]),"updatedAt":str_at(&item,&["updated_at"]),"labels":labels(&item["labels"]),"assignees":assignees,"milestone":str_at(&item,&["milestone","title"]),"head":first(&item,&[&["head","ref"],&["head_branch"],&["source_branch"],&["ref"]]),"base":first(&item,&[&["base","ref"],&["target_branch"]]),"draft":item["draft"]==true||item["work_in_progress"]==true,"additions":item["additions"],"deletions":item["deletions"],"changedFiles":item["changed_files"],"dueOn":first(&item,&[&["due_on"],&["due_date"]]),"open":item["open_issues"],"closed":item["closed_issues"],"event":first(&item,&[&["event"],&["source"]]),"status":str_at(&item,&["status"]),"conclusion":str_at(&item,&["conclusion"]),"comments":comments,"commentsError":comments_error}),
    )
}
fn comment_inner(dir: &Path, kind: &str, id: u64, body: &str) -> Result<Value, String> {
    if kind != "issues" && kind != "pulls" {
        return Err("Sección no válida".into());
    }
    if id == 0 {
        return Err("Identificador no válido".into());
    }
    if body.trim().is_empty() || body.len() > 65536 {
        return Err("Escribe un comentario de hasta 65536 caracteres".into());
    }
    let remote = remote_info(dir)?;
    let token = secret(dir, &remote)?;
    if token.is_empty() {
        return Err(
            "Configura un token con permisos de escritura para publicar comentarios".into(),
        );
    }
    let sub = if remote.provider == "gitlab" && kind == "pulls" {
        "merge_requests"
    } else {
        "issues"
    };
    let suffix = if remote.provider == "github" {
        "comments"
    } else {
        "notes"
    };
    let data = request(
        &remote,
        &token,
        reqwest::Method::POST,
        &format!("{}/{sub}/{id}/{suffix}", endpoint(&remote)),
        Some(json!({"body":body})),
    )?;
    Ok(
        json!({"author":first(&data,&[&["user","login"],&["author","username"]]),"body":data["body"].as_str().unwrap_or(body),"createdAt":str_at(&data,&["created_at"])}),
    )
}
#[tauri::command]
pub async fn forge_detail(dir: String, kind: String, id: u64) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || detail_inner(Path::new(&dir), &kind, id))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn forge_comment(
    dir: String,
    kind: String,
    id: u64,
    body: String,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || comment_inner(Path::new(&dir), &kind, id, &body))
        .await
        .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod http_tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };
    #[test]
    fn sends_authenticated_post_without_exposing_token_in_url() {
        let server = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = server.local_addr().unwrap();
        let worker = thread::spawn(move || {
            let (mut stream, _) = server.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut data = vec![0; 8192];
            let n = stream.read(&mut data).unwrap();
            let req = String::from_utf8_lossy(&data[..n]).to_lowercase();
            assert!(req.starts_with("post /comments "));
            assert!(req.contains("authorization: bearer test-secret"));
            assert!(!req.lines().next().unwrap().contains("test-secret"));
            stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{\"ok\":true}").unwrap();
        });
        let remote = Remote {
            provider: "github",
            host: "github.com".into(),
            path: "a/b".into(),
        };
        let result = request(
            &remote,
            "test-secret",
            reqwest::Method::POST,
            &format!("http://{addr}/comments"),
            Some(json!({"body":"hello"})),
        )
        .unwrap();
        assert_eq!(result["ok"], true);
        worker.join().unwrap();
    }
}
#[derive(Default, serde::Deserialize)]
pub struct ListOptions {
    state: Option<String>,
    filters: Option<Value>,
}
fn normalized(kind: &str, provider: &str, data: &Value) -> Vec<Value> {
    let array = if provider == "github" && kind == "runs" {
        data["workflow_runs"].as_array()
    } else {
        data.as_array()
    };
    array.into_iter().flatten().filter(|x|!(provider=="github"&&kind=="issues"&&!x["pull_request"].is_null())).map(|x|{
 let gh=provider=="github";let author=if gh{first(x,&[&["user","login"],&["actor","login"]])}else{str_at(x,&["author","username"])};let url=if gh{str_at(x,&["html_url"])}else{str_at(x,&["web_url"])};let number=if gh{x["number"].clone()}else{x["iid"].clone()};let title=str_at(x,&["title"]);let state=str_at(x,&["state"]);let created=str_at(x,&["created_at"]);
 match kind{
 "issues"=>json!({"number":number,"title":title,"state":if !gh{if state=="opened"{"open"}else{"closed"}}else{state},"url":url,"author":author,"comments":if gh{x["comments"].as_u64().unwrap_or(0)}else{x["user_notes_count"].as_u64().unwrap_or(0)},"createdAt":created,"labels":labels(&x["labels"])}),
 "pulls"=>json!({"number":number,"title":title,"state":if gh&&(!x["merged_at"].is_null()||!x["pull_request"]["merged_at"].is_null()){ "merged" }else{state},"draft":x["draft"]==true||x["work_in_progress"]==true,"url":url,"author":author,"createdAt":created,"head":if gh{str_at(x,&["head","ref"])}else{str_at(x,&["source_branch"])},"base":if gh{str_at(x,&["base","ref"])}else{str_at(x,&["target_branch"])},"labels":labels(&x["labels"])}),
 "milestones"=>json!({"number":if gh{x["number"].clone()}else{x["id"].clone()},"title":title,"state":if !gh{if state=="active"{"open"}else{"closed"}}else{state},"url":url,"description":str_at(x,&["description"]),"dueOn":first(x,&[&["due_on"],&["due_date"]]),"updatedAt":str_at(x,&["updated_at"]),"open":if gh{json!(x["open_issues"].as_u64().unwrap_or(0))}else{Value::Null},"closed":if gh{json!(x["closed_issues"].as_u64().unwrap_or(0))}else{Value::Null}}),
 _=>{let status=str_at(x,&["status"]);let completed=["success","failed","canceled","skipped","manual"].contains(&status);let id=x["id"].clone();let number=if gh{x["run_number"].clone()}else{if x["iid"].is_null(){id.clone()}else{x["iid"].clone()}};let fallback=format!("Pipeline #{}",number);let name=if gh{str_at(x,&["name"])}else{"Pipeline"};let title=if gh{first(x,&[&["display_title"],&["name"]])}else{let s=str_at(x,&["name"]);if s.is_empty(){&fallback}else{s}};json!({"id":id,"number":number,"name":name,"title":title,"status":if gh{status}else if completed{"completed"}else{"in_progress"},"conclusion":if gh{str_at(x,&["conclusion"])}else{match status{"failed"=>"failure","canceled"=>"cancelled",s if completed=>s,_=>""}},"branch":if gh{str_at(x,&["head_branch"])}else{str_at(x,&["ref"])},"event":if gh{str_at(x,&["event"])}else{str_at(x,&["source"])},"url":url,"author":author,"createdAt":created})}
 }
 }).collect()
}
fn filters(
    kind: &str,
    value: Option<Value>,
) -> Result<std::collections::BTreeMap<String, String>, String> {
    let mut out = std::collections::BTreeMap::new();
    let Some(Value::Object(filters)) = value else {
        return Ok(out);
    };
    for (key, value) in filters {
        if value.is_null() || value == "" {
            continue;
        }
        let allowed = match kind {
            "issues" => {
                ["author", "assignee", "label", "milestone", "sort"].contains(&key.as_str())
            }
            "pulls" => [
                "author",
                "assignee",
                "label",
                "milestone",
                "sort",
                "status",
                "review",
            ]
            .contains(&key.as_str()),
            "runs" => ["workflow", "event", "status", "branch", "actor"].contains(&key.as_str()),
            _ => false,
        };
        if !allowed {
            continue;
        }
        let s = value.as_str().ok_or("Filtro no válido")?;
        let ok = match key.as_str() {
            "author" | "assignee" | "actor" => {
                !s.is_empty()
                    && s.len() <= 100
                    && s.bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"_.[]-".contains(&b))
            }
            "label" | "milestone" | "branch" => s.len() <= 100 && !s.chars().any(|c| c <= '\u{1f}'),
            "sort" => [
                "created-desc",
                "created-asc",
                "updated-desc",
                "updated-asc",
                "comments-desc",
                "comments-asc",
            ]
            .contains(&s),
            "workflow" => !s.is_empty() && s.len() <= 15 && s.bytes().all(|b| b.is_ascii_digit()),
            "event" => {
                !s.is_empty()
                    && s.len() <= 40
                    && s.bytes().all(|b| b.is_ascii_lowercase() || b == b'_')
            }
            "review" => ["none", "required", "approved", "changes_requested"].contains(&s),
            "status" if kind == "pulls" => ["draft", "ready", "merged"].contains(&s),
            "status" => [
                "queued",
                "in_progress",
                "completed",
                "waiting",
                "success",
                "failure",
                "cancelled",
                "skipped",
                "timed_out",
                "neutral",
                "action_required",
            ]
            .contains(&s),
            _ => false,
        };
        if !ok {
            return Err("Filtro no válido".into());
        }
        out.insert(key, s.into());
    }
    Ok(out)
}
fn list_inner(dir: &Path, kind: &str, options: ListOptions) -> Result<Value, String> {
    if !["issues", "pulls", "milestones", "runs"].contains(&kind) {
        return Err("Sección no válida".into());
    }
    let state = options.state.as_deref().unwrap_or("open");
    if !["open", "closed", "all"].contains(&state) {
        return Err("Estado no válido".into());
    }
    let f = filters(kind, options.filters)?;
    let remote = remote_info(dir)?;
    let token = secret(dir, &remote)?;
    let base = endpoint(&remote);
    let mut data;
    if remote.provider == "gitlab" {
        let sub = match kind {
            "issues" => "issues",
            "pulls" => "merge_requests",
            "milestones" => "milestones",
            _ => "pipelines",
        };
        let state_value = if state == "open" {
            if kind == "milestones" {
                "active"
            } else {
                "opened"
            }
        } else {
            state
        };
        let query = if kind == "runs" {
            "per_page=100".to_string()
        } else {
            format!(
                "state={state_value}&per_page=100{}",
                if kind == "issues" {
                    "&order_by=updated_at&with_labels_details=true"
                } else {
                    ""
                }
            )
        };
        data = request(
            &remote,
            &token,
            reqwest::Method::GET,
            &format!("{base}/{sub}?{query}"),
            None,
        )?;
        if kind == "pulls" && state == "closed" {
            let merged = request(
                &remote,
                &token,
                reqwest::Method::GET,
                &format!("{base}/{sub}?state=merged&per_page=100"),
                None,
            )?;
            if let (Some(a), Some(b)) = (data.as_array_mut(), merged.as_array()) {
                a.extend(b.iter().cloned());
                a.sort_by(|x, y| str_at(y, &["created_at"]).cmp(str_at(x, &["created_at"])));
                a.truncate(100);
            }
        }
    } else {
        let search = (kind == "issues" || kind == "pulls")
            && f.iter().any(|(k, v)| !(k == "sort" && v == "created-desc"));
        let url = if search {
            let mut parts = vec![
                format!("repo:{}", remote.path),
                format!("is:{}", if kind == "pulls" { "pr" } else { "issue" }),
            ];
            if state != "all" {
                parts.push(format!("is:{state}"));
            }
            for key in ["author", "assignee", "label", "milestone"] {
                if let Some(v) = f.get(key) {
                    parts.push(format!(
                        "{key}:{}",
                        if key == "label" || key == "milestone" {
                            format!("\"{}\"", v.replace('"', ""))
                        } else {
                            v.clone()
                        }
                    ));
                }
            }
            if let Some(status) = f.get("status") {
                parts.push(
                    match status.as_str() {
                        "draft" => "draft:true",
                        "ready" => "draft:false",
                        _ => "is:merged",
                    }
                    .into(),
                );
            }
            if let Some(review) = f.get("review") {
                parts.push(format!("review:{review}"));
            }
            let sort = f.get("sort").map(String::as_str).unwrap_or("created-desc");
            let (sort, order) = sort.split_once('-').unwrap();
            format!(
                "https://api.github.com/search/issues?q={}&per_page=100&sort={sort}&order={order}",
                encode(&parts.join(" "))
            )
        } else if kind == "runs" {
            let route = f
                .get("workflow")
                .map(|v| format!("workflows/{v}/runs"))
                .unwrap_or("runs".into());
            let mut q = "per_page=50".to_string();
            for key in ["event", "status", "branch", "actor"] {
                if let Some(v) = f.get(key) {
                    q.push_str(&format!("&{key}={}", encode(v)));
                }
            }
            format!("{base}/actions/{route}?{q}")
        } else if kind == "milestones" {
            format!("{base}/milestones?state={state}&per_page=100&sort=due_on")
        } else {
            format!(
                "{base}/{}?state={state}&per_page=100&sort=created&direction=desc",
                if kind == "pulls" { "pulls" } else { "issues" }
            )
        };
        data = request(&remote, &token, reqwest::Method::GET, &url, None)?;
        if search {
            data = data["items"].clone();
        }
    }
    let (owner, repo) = remote.path.rsplit_once('/').ok_or("Remoto no válido")?;
    Ok(
        json!({"provider":remote.provider,"owner":owner,"repo":repo,"items":normalized(kind,remote.provider,&data)}),
    )
}
#[tauri::command]
pub async fn forge_list(
    dir: String,
    kind: String,
    options: Option<ListOptions>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        list_inner(Path::new(&dir), &kind, options.unwrap_or_default())
    })
    .await
    .map_err(|e| e.to_string())?
}
fn facets_inner(dir: &Path, kind: &str) -> Result<Value, String> {
    if !["issues", "pulls", "milestones", "runs"].contains(&kind) {
        return Err("Sección no válida".into());
    }
    let remote = remote_info(dir)?;
    let mut result = json!({"labels":[],"milestones":[],"people":[],"workflows":[],"branches":[]});
    if remote.provider != "github" || kind == "milestones" {
        return Ok(result);
    }
    let token = secret(dir, &remote)?;
    let base = endpoint(&remote);
    let get = |sub: &str| {
        request(
            &remote,
            &token,
            reqwest::Method::GET,
            &format!("{base}/{sub}"),
            None,
        )
        .unwrap_or(json!([]))
    };
    let people = get("assignees?per_page=100");
    result["people"] = json!(
        people
            .as_array()
            .map(|a| a
                .iter()
                .map(|v| json!({"value":v["login"],"label":v["login"]}))
                .collect::<Vec<_>>())
            .unwrap_or_default()
    );
    if kind == "runs" {
        let workflows = get("actions/workflows?per_page=100");
        result["workflows"] = json!(
            workflows["workflows"]
                .as_array()
                .map(|a| a
                    .iter()
                    .map(|v| json!({"value":v["id"].to_string(),"label":v["name"]}))
                    .collect::<Vec<_>>())
                .unwrap_or_default()
        );
        let branches = get("branches?per_page=100");
        result["branches"]=json!(branches.as_array().map(|a|a.iter().map(|v|json!({"value":v["name"],"label":v["name"],"color":str_at(v,&["color"])})).collect::<Vec<_>>()).unwrap_or_default());
    } else {
        let ls = get("labels?per_page=100");
        result["labels"]=json!(ls.as_array().map(|a|a.iter().map(|v|json!({"value":v["name"],"label":v["name"],"color":str_at(v,&["color"])})).collect::<Vec<_>>()).unwrap_or_default());
        let milestones = get("milestones?state=all&per_page=100");
        result["milestones"] = json!(
            milestones
                .as_array()
                .map(|a| a
                    .iter()
                    .map(|v| json!({"value":v["title"],"label":v["title"]}))
                    .collect::<Vec<_>>())
                .unwrap_or_default()
        );
    }
    Ok(result)
}
#[tauri::command]
pub async fn forge_facets(dir: String, kind: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || facets_inner(Path::new(&dir), &kind))
        .await
        .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod normalize_tests {
    use super::*;
    #[test]
    fn normalizes_github_and_gitlab_items_and_validates_filters() {
        let gh = json!([{"number":1,"title":"Issue","state":"open","html_url":"https://example.com","user":{"login":"ana"},"labels":[{"name":"bug","color":"ff0000"}]},{"number":2,"pull_request":{}}]);
        let items = normalized("issues", "github", &gh);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["author"], "ana");
        assert_eq!(items[0]["labels"][0]["name"], "bug");
        let gl = json!([{"iid":42,"title":"Issue","state":"opened","author":{"username":"bob"},"labels":["bug"]}]);
        let items = normalized("issues", "gitlab", &gl);
        assert_eq!(items[0]["state"], "open");
        assert_eq!(items[0]["number"], 42);
        assert_eq!(
            labels(&json!([{"name":"bug","color":"#ff0000"}]))[0]["color"],
            "ff0000"
        );
        assert!(filters("runs", Some(json!({"workflow":"oops"}))).is_err());
        assert!(
            filters(
                "pulls",
                Some(json!({"review":"approved","author":"user-1"}))
            )
            .is_ok()
        );
    }
}
#[cfg(test)]
mod live_tests {
    use super::*;
    #[test]
    #[ignore = "requires public GitHub network access"]
    fn public_github_list_smoke() {
        let remote = Remote {
            provider: "github",
            host: "github.com".into(),
            path: "tauri-apps/tauri".into(),
        };
        let url = format!("{}/issues?state=open&per_page=5", endpoint(&remote));
        let data = request(&remote, "", reqwest::Method::GET, &url, None).unwrap();
        assert!(data.is_array());
        let items = normalized("issues", "github", &data);
        for item in items {
            assert!(item["number"].as_u64().is_some());
            assert!(
                item["url"]
                    .as_str()
                    .unwrap_or("")
                    .starts_with("https://github.com/")
            );
        }
    }
}
#[cfg(test)]
mod live_gitlab_tests {
    use super::*;
    #[test]
    #[ignore = "requires public GitLab network access"]
    fn public_gitlab_list_smoke() {
        let remote = Remote {
            provider: "gitlab",
            host: "gitlab.com".into(),
            path: "gitlab-org/gitlab".into(),
        };
        let url = format!(
            "{}/issues?state=opened&per_page=5&with_labels_details=true",
            endpoint(&remote)
        );
        let data = request(&remote, "", reqwest::Method::GET, &url, None).unwrap();
        assert!(data.is_array());
        for item in normalized("issues", "gitlab", &data) {
            assert!(item["number"].as_u64().is_some());
            assert!(
                item["url"]
                    .as_str()
                    .unwrap_or("")
                    .starts_with("https://gitlab.com/")
            );
        }
    }
}
#[cfg(test)]
mod live_details_tests {
    use super::*;
    #[test]
    #[ignore = "requires public GitHub network access"]
    fn github_issue_detail_and_comments() {
        let remote = Remote {
            provider: "github",
            host: "github.com".into(),
            path: "tauri-apps/tauri".into(),
        };
        let base = endpoint(&remote);
        let list = request(
            &remote,
            "",
            reqwest::Method::GET,
            &format!("{base}/issues?state=open&per_page=30"),
            None,
        )
        .unwrap();
        let id = list
            .as_array()
            .unwrap()
            .iter()
            .find(|i| i["pull_request"].is_null())
            .and_then(|i| i["number"].as_u64())
            .expect("public issue");
        let detail = request(
            &remote,
            "",
            reqwest::Method::GET,
            &format!("{base}/issues/{id}"),
            None,
        )
        .unwrap();
        assert!(detail["title"].is_string());
        let comments = request(
            &remote,
            "",
            reqwest::Method::GET,
            &format!("{base}/issues/{id}/comments?per_page=10"),
            None,
        )
        .unwrap();
        assert!(comments.is_array());
    }
    #[test]
    #[ignore = "requires public GitLab network access"]
    fn gitlab_issue_detail_and_comments() {
        let remote = Remote {
            provider: "gitlab",
            host: "gitlab.com".into(),
            path: "gitlab-org/gitlab".into(),
        };
        let base = endpoint(&remote);
        let list = request(
            &remote,
            "",
            reqwest::Method::GET,
            &format!("{base}/issues?state=opened&per_page=5"),
            None,
        )
        .unwrap();
        let id = list[0]["iid"].as_u64().expect("public issue");
        let detail = request(
            &remote,
            "",
            reqwest::Method::GET,
            &format!("{base}/issues/{id}"),
            None,
        )
        .unwrap();
        assert!(detail["title"].is_string());
        match request(
            &remote,
            "",
            reqwest::Method::GET,
            &format!("{base}/issues/{id}/notes?per_page=10"),
            None,
        ) {
            Ok(comments) => assert!(comments.is_array()),
            Err(error) => assert!(error.contains("token") || error.contains("denegado")),
        }
    }
}
