use serde::Deserialize;
use tauri::{
    AppHandle, Emitter, Manager, Wry,
    menu::{IsMenuItem, MenuEvent, MenuItem, Submenu},
};

use crate::{
    app_state::{focus_main_window, request_quit},
    tray::TrayHandles,
};

pub const SLEEP_TITLE: &str = "Sleep Timer";

/// Items whose text/enabled state follows playback.
pub struct Controls {
    pub play: MenuItem<Wry>,
    /// Disabled while nothing is loaded (skip, chapters, speed, bookmark).
    pub transport: Vec<MenuItem<Wry>>,
    pub sleep: Submenu<Wry>,
}

impl Controls {
    pub fn apply(&self, state: &NowPlaying) {
        let _ = self
            .play
            .set_text(if state.playing { "Pause" } else { "Play" });
        let _ = self.play.set_enabled(state.can_control);
        for item in &self.transport {
            let _ = item.set_enabled(state.can_control);
        }
        let _ = self.sleep.set_enabled(state.can_control);
        let _ = self.sleep.set_text(match state.sleep_label.as_deref() {
            Some(label) if !label.is_empty() => format!("{SLEEP_TITLE} ({label})"),
            _ => SLEEP_TITLE.to_string(),
        });
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    pub title: Option<String>,
    pub subtitle: Option<String>,
    pub playing: bool,
    pub can_control: bool,
    pub sleep_label: Option<String>,
}

#[cfg(target_os = "macos")]
pub struct MacMenuHandles(pub Controls);

pub fn sleep_submenu(app: &AppHandle) -> tauri::Result<Submenu<Wry>> {
    let item = |id: &str, text: &str| MenuItem::with_id(app, id, text, true, None::<&str>);
    let off = item("sleep-off", "Off")?;
    let m15 = item("sleep-15", "15 minutes")?;
    let m30 = item("sleep-30", "30 minutes")?;
    let m45 = item("sleep-45", "45 minutes")?;
    let m60 = item("sleep-60", "1 hour")?;
    let chapter = item("sleep-chapter", "End of Chapter")?;
    let items: [&dyn IsMenuItem<Wry>; 6] = [&off, &m15, &m30, &m45, &m60, &chapter];
    Submenu::with_items(app, SLEEP_TITLE, false, &items)
}

pub fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref();
    match id {
        "quit" => request_quit(app),
        "show" => focus_main_window(app),
        _ if is_action(id) => {
            if id.starts_with("nav:") || id == "search" || id == "now-playing" {
                focus_main_window(app);
            }
            let _ = app.emit("menu-action", id.to_string());
        }
        _ => {}
    }
}

fn is_action(id: &str) -> bool {
    id.starts_with("nav:")
        || id.starts_with("sleep-")
        || matches!(
            id,
            "play-pause"
                | "skip-back"
                | "skip-forward"
                | "prev-chapter"
                | "next-chapter"
                | "speed-up"
                | "speed-down"
                | "add-bookmark"
                | "now-playing"
                | "search"
                | "back"
                | "forward"
        )
}

pub fn set_now_playing_impl(app: &AppHandle, state: &NowPlaying) {
    if let Some(tray) = app.try_state::<TrayHandles>() {
        tray.apply(state);
    }
    #[cfg(target_os = "macos")]
    if let Some(mac) = app.try_state::<MacMenuHandles>() {
        mac.0.apply(state);
    }
}

#[tauri::command]
pub fn set_now_playing(app: AppHandle, state: NowPlaying) {
    set_now_playing_impl(&app, &state);
}

#[cfg(target_os = "macos")]
pub fn build_macos_menu(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, PredefinedMenuItem};

    let item =
        |id: &str, text: &str, accel: Option<&str>| MenuItem::with_id(app, id, text, true, accel);
    // Disabled until a book is loaded; see `Controls::apply`.
    let transport_item =
        |id: &str, text: &str| MenuItem::with_id(app, id, text, false, None::<&str>);
    let sep = || PredefinedMenuItem::separator(app);

    let settings = item("nav:/settings", "Settings…", Some("CmdOrCtrl+,"))?;
    let quit = item("quit", "Quit Lectern", Some("CmdOrCtrl+Q"))?;
    let app_menu = Submenu::with_items(
        app,
        "Lectern",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &sep()?,
            &settings,
            &sep()?,
            &PredefinedMenuItem::services(app, None)?,
            &sep()?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &sep()?,
            &quit,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &sep()?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &item("now-playing", "Now Playing", Some("CmdOrCtrl+Shift+F"))?,
            &item("search", "Search", Some("CmdOrCtrl+F"))?,
            &sep()?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    let go_menu = Submenu::with_items(
        app,
        "Go",
        true,
        &[
            &item("nav:/", "Home", Some("CmdOrCtrl+1"))?,
            &item("nav:/library", "Library", Some("CmdOrCtrl+2"))?,
            &item("nav:/series", "Series", Some("CmdOrCtrl+3"))?,
            &item("nav:/authors", "Authors", Some("CmdOrCtrl+4"))?,
            &item("nav:/collections", "Collections", Some("CmdOrCtrl+5"))?,
            &item("nav:/downloads", "Downloads", Some("CmdOrCtrl+6"))?,
            &item("nav:/stats", "Listening", Some("CmdOrCtrl+7"))?,
            &sep()?,
            &item("back", "Back", Some("CmdOrCtrl+["))?,
            &item("forward", "Forward", Some("CmdOrCtrl+]"))?,
        ],
    )?;

    let play = transport_item("play-pause", "Play")?;
    let skip_back = transport_item("skip-back", "Skip Back")?;
    let skip_forward = transport_item("skip-forward", "Skip Forward")?;
    let prev_chapter = transport_item("prev-chapter", "Previous Chapter")?;
    let next_chapter = transport_item("next-chapter", "Next Chapter")?;
    let faster = transport_item("speed-up", "Faster")?;
    let slower = transport_item("speed-down", "Slower")?;
    let bookmark = transport_item("add-bookmark", "Add Bookmark")?;
    let sleep = sleep_submenu(app)?;
    let playback_menu = Submenu::with_items(
        app,
        "Playback",
        true,
        &[
            &play,
            &skip_back,
            &skip_forward,
            &sep()?,
            &prev_chapter,
            &next_chapter,
            &sep()?,
            &faster,
            &slower,
            &sep()?,
            &bookmark,
            &sep()?,
            &sleep,
        ],
    )?;

    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, Some("Zoom"))?,
            &sep()?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    let menu = Menu::with_items(
        app,
        &[
            &app_menu,
            &edit_menu,
            &view_menu,
            &go_menu,
            &playback_menu,
            &window_menu,
        ],
    )?;
    app.set_menu(menu)?;

    app.manage(MacMenuHandles(Controls {
        play,
        transport: vec![
            skip_back,
            skip_forward,
            prev_chapter,
            next_chapter,
            faster,
            slower,
            bookmark,
        ],
        sleep,
    }));
    Ok(())
}
