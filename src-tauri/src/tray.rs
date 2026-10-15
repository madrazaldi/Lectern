use tauri::{
    AppHandle, Manager, Wry,
    menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
};

use crate::{
    app_state::focus_main_window,
    menu::{Controls, NowPlaying, sleep_submenu},
};

const TOOLTIP: &str = "Lectern";

pub struct TrayHandles {
    icon: TrayIcon<Wry>,
    title: MenuItem<Wry>,
    subtitle: MenuItem<Wry>,
    controls: Controls,
}

impl TrayHandles {
    pub fn apply(&self, state: &NowPlaying) {
        let title = state.title.as_deref().filter(|t| !t.is_empty());
        let _ = self.title.set_text(title.unwrap_or("Nothing playing"));
        let _ = self
            .subtitle
            .set_text(state.subtitle.as_deref().unwrap_or(""));
        let _ = self.icon.set_tooltip(Some(match title {
            Some(title) => format!("{TOOLTIP} — {title}"),
            None => TOOLTIP.to_string(),
        }));
        self.controls.apply(state);
    }
}

pub fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let disabled = |id: &str, text: &str| MenuItem::with_id(app, id, text, false, None::<&str>);
    let title = disabled("tray-title", "Nothing playing")?;
    let subtitle = disabled("tray-subtitle", "")?;
    let play = disabled("play-pause", "Play")?;
    let skip_back = disabled("skip-back", "Skip Back")?;
    let skip_forward = disabled("skip-forward", "Skip Forward")?;
    let prev_chapter = disabled("prev-chapter", "Previous Chapter")?;
    let next_chapter = disabled("next-chapter", "Next Chapter")?;
    let sleep = sleep_submenu(app)?;
    let show = MenuItem::with_id(app, "show", "Show Lectern", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Lectern", true, None::<&str>)?;

    let sep = || PredefinedMenuItem::separator(app);
    let (sep1, sep2, sep3) = (sep()?, sep()?, sep()?);
    let items: [&dyn IsMenuItem<Wry>; 13] = [
        &title,
        &subtitle,
        &sep1,
        &play,
        &skip_back,
        &skip_forward,
        &prev_chapter,
        &next_chapter,
        &sep2,
        &sleep,
        &sep3,
        &show,
        &quit,
    ];
    let menu = Menu::with_items(app, &items)?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip(TOOLTIP)
        .menu(&menu)
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
                && !cfg!(target_os = "macos")
            {
                focus_main_window(tray.app_handle());
            }
        });
    // macOS menu bar icons are monochrome templates that adapt to light/dark bars; elsewhere use the app icon.
    #[cfg(target_os = "macos")]
    {
        let template = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-template.png"))?;
        builder = builder.icon(template).icon_as_template(true);
    }
    #[cfg(not(target_os = "macos"))]
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    let icon = builder.build(app)?;

    app.manage(TrayHandles {
        icon,
        title,
        subtitle,
        controls: Controls {
            play,
            transport: vec![skip_back, skip_forward, prev_chapter, next_chapter],
            sleep,
        },
    });
    Ok(())
}
