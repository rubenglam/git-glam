mod actions;
mod agent;
mod branches;
mod commit;
mod commit_message;
mod conflicts;
mod data_store;
mod diff;
mod file_browser;
mod file_history;
mod forge;
mod history;
mod migration;
mod open_ops;
mod projects;
mod release;
mod repo;
mod settings;
mod staging;
mod stash;
mod sync;
mod tags;
mod token_migration;
mod tokens;
mod ui_migration;
mod watch;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(settings::SettingsLock::default())
        .manage(agent::AgentRuns::default())
        .manage(tokens::TokensLock::default())
        .manage(commit_message::MessageRuns::default())
        .manage(data_store::DataLock::default())
        .manage(projects::ProjectsLock::default())
        .manage(WindowState::default())
        .manage(watch::RepoWatch::default())
        .invoke_handler(tauri::generate_handler![
            history::history,
            repo::load_repo,
            watch::watch_repo,
            watch::unwatch_repo,
            staging::stage_paths,
            staging::unstage_paths,
            staging::staged_diff,
            staging::last_message,
            staging::working_diff,
            staging::discard_paths,
            sync::sync_repo,
            stash::stash_push,
            stash::stash_action,
            branches::list_branches,
            branches::create_branch,
            branches::switch_branch,
            branches::rename_branch,
            branches::delete_branch,
            tags::list_tags,
            tags::create_tag,
            tags::delete_tag,
            tags::push_tag,
            commit::commit,
            actions::commit_action,
            conflicts::conflict_state,
            conflicts::conflict_read,
            conflicts::conflict_save,
            conflicts::conflict_action,
            settings::read_settings,
            settings::reveal_settings_file,
            settings::read_settings_file,
            settings::export_settings,
            settings::import_settings,
            settings::set_setting,
            projects::projects_list,
            projects::projects_update,
            projects::project_add,
            projects::project_open,
            projects::project_worktree,
            data_store::data_load,
            data_store::data_save,
            projects::project_status,
            is_packaged,
            release::release_info,
            release::release_run,
            diff::commit_diff,
            diff::commit_files,
            file_browser::browse_files,
            file_browser::preview_file,
            file_browser::search_files,
            file_browser::documentation_files,
            file_browser::ai_files,
            file_history::file_history,
            file_history::file_blame,
            branches::delete_remote_branch,
            branches::set_upstream,
            branches::checkout_remote,
            branches::branch_operation,
            commit::commit_push,
            staging::apply_hunk,
            staging::discard_hunk,
            agent::agent_send,
            agent::agent_cancel,
            commit_message::generate_message,
            commit_message::cancel_message,
            open_ops::open_repo,
            open_ops::open_folder,
            open_ops::open_issue,
            open_ops::file_action,
            forge::forge_info,
            forge::forge_list,
            forge::forge_facets,
            forge::forge_detail,
            forge::forge_comment,
            ui_migration::electron_ui_settings,
            tokens::token_has,
            tokens::token_set,
            projects::run_project_command
        ])
        .on_window_event(|window, event| {
            // Minimized windows are not reliably reported as 0x0 (Windows), so ask the window itself.
            if matches!(event, tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Focused(_)) {
                use tauri::{Emitter, Manager};
                let minimized = window.is_minimized().unwrap_or(false);
                let state = window.state::<WindowState>();
                let was = state.0.swap(minimized, std::sync::atomic::Ordering::SeqCst);
                if was && !minimized {
                    let _ = window.emit("app:restored", ());
                }
            }
        })
        .setup(|app| {
            use tauri::Manager;
            let target = app.path().app_data_dir()?;
            migration::import_existing(&target).map_err(std::io::Error::other)?;
            token_migration::import_existing(&target).map_err(std::io::Error::other)?;
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}

#[tauri::command]
fn is_packaged() -> bool {
    !cfg!(debug_assertions)
}

#[derive(Default)]
struct WindowState(std::sync::atomic::AtomicBool);
