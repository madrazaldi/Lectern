mod app_state;
mod downloads;
mod menu;
mod secrets;
mod tray;

use std::sync::atomic::Ordering;

use app_state::{AppState, focus_main_window, request_quit};
use tauri::{Manager, RunEvent, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_main_window(app);
        }))
        // After single-instance, which forwards deep links from second instances to it.
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .on_menu_event(menu::handle_menu_event)
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                api.prevent_close();
                if state.hide_on_close.load(Ordering::SeqCst)
                    && !state.quitting.load(Ordering::SeqCst)
                {
                    let _ = window.hide();
                } else {
                    // Let the frontend save progress; it finishes with `quit_now`.
                    request_quit(window.app_handle());
                }
            }
        })
        .setup(|app| {
            // Installers register the URL schemes; an AppImage has nobody to do it for it.
            #[cfg(target_os = "linux")]
            if app.env().appimage.is_some() {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(err) = app.deep_link().register_all() {
                    eprintln!("Could not register sign-in links: {err}");
                }
            }
            #[cfg(target_os = "macos")]
            menu::build_macos_menu(app.handle())?;
            tray::build_tray(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_state::quit_now,
            app_state::set_close_behavior,
            app_state::show_main_window,
            menu::set_now_playing,
            secrets::secret_get,
            secrets::secret_set,
            secrets::secret_delete,
            downloads::download_file,
            downloads::cancel_download,
            downloads::write_download_meta,
            downloads::list_download_meta,
            downloads::remove_download,
            downloads::downloads_usage,
            downloads::downloads_free_space,
            downloads::prune_downloads,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Lectern")
        .run(|app, event| match event {
            RunEvent::ExitRequested { api, code, .. } => {
                let quitting = app.state::<AppState>().quitting.load(Ordering::SeqCst);
                if code.is_none() && !quitting {
                    api.prevent_exit();
                    request_quit(app);
                }
            }
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => focus_main_window(app),
            _ => {}
        });
}
