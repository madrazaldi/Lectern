use std::{
    collections::HashSet,
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use tauri::{AppHandle, Emitter, Manager, State};

pub struct AppState {
    pub hide_on_close: AtomicBool,
    pub quitting: AtomicBool,
    pub cancels: Mutex<HashSet<String>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            hide_on_close: AtomicBool::new(true),
            quitting: AtomicBool::new(false),
            cancels: Mutex::new(HashSet::new()),
        }
    }
}

pub fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Asks the frontend to save progress and call `quit_now`; exits on its own if it never does.
pub fn request_quit(app: &AppHandle) {
    let state = app.state::<AppState>();
    if state.quitting.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = app.emit("app-quit-requested", ());
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(4));
        app.exit(0);
    });
}

#[tauri::command]
pub fn quit_now(app: AppHandle, state: State<'_, AppState>) {
    state.quitting.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[tauri::command]
pub fn set_close_behavior(state: State<'_, AppState>, hide: bool) {
    state.hide_on_close.store(hide, Ordering::SeqCst);
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) {
    focus_main_window(&app);
}
