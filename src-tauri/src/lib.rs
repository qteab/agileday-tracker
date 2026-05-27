use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{
    image::Image,
    menu::{ContextMenu, Menu, MenuBuilder, MenuItem, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, Wry,
};

// On macOS, Control+click is the system convention for "secondary click" but
// NSStatusItem only reports it as a plain left-click — we have to query
// NSEvent ourselves to recover the modifier state.
#[cfg(target_os = "macos")]
fn control_key_held() -> bool {
    use objc2::msg_send;
    use objc2::runtime::AnyClass;
    const NS_EVENT_MODIFIER_FLAG_CONTROL: usize = 1 << 18;
    let Some(class) = AnyClass::get(c"NSEvent") else {
        return false;
    };
    let flags: usize = unsafe { msg_send![class, modifierFlags] };
    flags & NS_EVENT_MODIFIER_FLAG_CONTROL != 0
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum MenuBarMode {
    Off,
    Compact,
    Full,
}

impl MenuBarMode {
    fn parse(s: &str) -> Self {
        match s {
            "compact" => MenuBarMode::Compact,
            "full" => MenuBarMode::Full,
            _ => MenuBarMode::Off,
        }
    }
}

#[derive(Clone)]
struct DisplaySnapshot {
    running: bool,
    start_time_ms: Option<i64>,
    project_name: Option<String>,
    task_name: Option<String>,
    description: Option<String>,
    day_base_seconds: u64,
}

struct TrayState {
    tray: TrayIcon<Wry>,
    menu: Menu<Wry>,
    icon_idle: Image<'static>,
    icon_active: Image<'static>,
    timer_status: MenuItem<Wry>,
    project_item: MenuItem<Wry>,
    task_item: MenuItem<Wry>,
    description_item: MenuItem<Wry>,
    sep_after_status: PredefinedMenuItem<Wry>,
    continue_item: MenuItem<Wry>,
    stop_item: MenuItem<Wry>,
    detail_rows_visible: Mutex<bool>,
    snapshot: Mutex<Option<DisplaySnapshot>>,
    last_title: Mutex<Option<String>>,
    last_headline: Mutex<String>,
    menu_bar_mode: Mutex<MenuBarMode>,
    window_layout: Mutex<WindowLayout>,
}

#[derive(Default, Clone)]
struct WindowLayout {
    docked: bool,
    free_x: Option<f64>,
    free_y: Option<f64>,
}

fn truncate(s: &str, max: usize) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() <= max {
        return s.to_string();
    }
    let mut out: String = chars[..max.saturating_sub(1)].iter().collect();
    out.push('…');
    out
}

fn format_hours_minutes_seconds(total_seconds: u64) -> String {
    let hours = total_seconds / 3600;
    let minutes = (total_seconds % 3600) / 60;
    let seconds = total_seconds % 60;
    format!("{}:{:02}:{:02}", hours, minutes, seconds)
}

fn format_hours_minutes(total_seconds: u64) -> String {
    let hours = total_seconds / 3600;
    let minutes = (total_seconds % 3600) / 60;
    format!("{}:{:02}", hours, minutes)
}

// Drives every visible part of the tray (icon, title next to the icon, the
// disabled headline row, the project/task/description detail rows). Called on
// every state change pushed by the React side and once per second by the
// background tick task so the menu bar keeps advancing even when the WebView
// is hidden and JavaScript timers get throttled.
fn apply_tray_state(state: &TrayState, snapshot: Option<&DisplaySnapshot>) -> Result<(), String> {
    let running = snapshot.is_some_and(|s| s.running);

    let headline = match snapshot {
        Some(s) if s.running => {
            let session = s.start_time_ms.map(elapsed_seconds_now).unwrap_or(0);
            let total = s.day_base_seconds.saturating_add(session);
            format!("Today on task: {}", format_hours_minutes_seconds(total))
        }
        _ => "Timer is not running".to_string(),
    };
    {
        let mut last = state.last_headline.lock().unwrap();
        if *last != headline {
            state
                .timer_status
                .set_text(&headline)
                .map_err(|e| e.to_string())?;
            *last = headline;
        }
    }

    state
        .continue_item
        .set_enabled(!running)
        .map_err(|e| e.to_string())?;
    state
        .stop_item
        .set_enabled(running)
        .map_err(|e| e.to_string())?;

    let icon = if running {
        &state.icon_active
    } else {
        &state.icon_idle
    };
    state
        .tray
        .set_icon(Some(icon.clone()))
        .map_err(|e| e.to_string())?;

    // Minutes only so the title width changes once per minute rather than once
    // per second; the dropdown headline above carries the live H:MM:SS view.
    // macOS NSStatusItem doesn't reliably clear when given nil, so the Off
    // case uses an empty string instead.
    let mode = *state.menu_bar_mode.lock().unwrap();
    let title: Option<String> = match mode {
        MenuBarMode::Off => Some(String::new()),
        _ => match snapshot {
            Some(s) => {
                let extra = if s.running {
                    s.start_time_ms.map(elapsed_seconds_now).unwrap_or(0)
                } else {
                    0
                };
                let total = s.day_base_seconds.saturating_add(extra);
                let time = format_hours_minutes(total);
                let padding = "\u{2002}";
                let glyph = if s.running { "⏸" } else { "▶" };
                let task = s
                    .task_name
                    .as_deref()
                    .map(str::trim)
                    .filter(|p| !p.is_empty());
                Some(match (mode, task) {
                    (MenuBarMode::Full, Some(name)) => {
                        format!("{padding}{glyph}  {time}  {}", truncate(name, 25))
                    }
                    _ => format!("{padding}{glyph}  {time}"),
                })
            }
            None => Some("\u{2002}▶\u{2002}".to_string()),
        },
    };
    {
        let mut last = state.last_title.lock().unwrap();
        if *last != title {
            state
                .tray
                .set_title(title.as_deref())
                .map_err(|e| e.to_string())?;
            *last = title;
        }
    }

    let mut visible = state.detail_rows_visible.lock().unwrap();
    if let Some(s) = snapshot.filter(|s| s.running) {
        state
            .project_item
            .set_text(format!(
                "Project: {}",
                truncate(s.project_name.as_deref().unwrap_or("—"), 40)
            ))
            .map_err(|e| e.to_string())?;
        state
            .task_item
            .set_text(format!(
                "Task: {}",
                truncate(s.task_name.as_deref().unwrap_or("—"), 40)
            ))
            .map_err(|e| e.to_string())?;
        let description = s.description.as_deref().unwrap_or("").trim();
        state
            .description_item
            .set_text(if description.is_empty() {
                "No description".to_string()
            } else {
                format!("“{}”", truncate(description, 40))
            })
            .map_err(|e| e.to_string())?;

        if !*visible {
            state
                .menu
                .insert(&state.sep_after_status, 2)
                .map_err(|e| e.to_string())?;
            state
                .menu
                .insert(&state.project_item, 3)
                .map_err(|e| e.to_string())?;
            state
                .menu
                .insert(&state.task_item, 4)
                .map_err(|e| e.to_string())?;
            state
                .menu
                .insert(&state.description_item, 5)
                .map_err(|e| e.to_string())?;
            *visible = true;
        }
    } else if *visible {
        state
            .menu
            .remove(&state.description_item)
            .map_err(|e| e.to_string())?;
        state
            .menu
            .remove(&state.task_item)
            .map_err(|e| e.to_string())?;
        state
            .menu
            .remove(&state.project_item)
            .map_err(|e| e.to_string())?;
        state
            .menu
            .remove(&state.sep_after_status)
            .map_err(|e| e.to_string())?;
        *visible = false;
    }

    Ok(())
}

fn elapsed_seconds_now(start_time_ms: i64) -> u64 {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let diff = (now_ms - start_time_ms).max(0);
    (diff / 1000) as u64
}

#[tauri::command]
fn set_timer_status(
    app: tauri::AppHandle,
    running: bool,
    start_time_ms: Option<i64>,
    project_name: Option<String>,
    task_name: Option<String>,
    description: Option<String>,
    day_base_seconds: Option<u64>,
    menu_bar_mode: String,
) -> Result<(), String> {
    let state = app.state::<TrayState>();
    let new_snapshot = if running {
        start_time_ms.map(|millis| DisplaySnapshot {
            running: true,
            start_time_ms: Some(millis),
            project_name,
            task_name,
            description,
            day_base_seconds: day_base_seconds.unwrap_or(0),
        })
    } else if task_name.is_some() {
        Some(DisplaySnapshot {
            running: false,
            start_time_ms: None,
            project_name,
            task_name,
            description,
            day_base_seconds: day_base_seconds.unwrap_or(0),
        })
    } else {
        None
    };
    {
        let mut snap = state.snapshot.lock().unwrap();
        *snap = new_snapshot;
        *state.menu_bar_mode.lock().unwrap() = MenuBarMode::parse(&menu_bar_mode);
    }
    let snap = state.snapshot.lock().unwrap();
    apply_tray_state(&state, snap.as_ref())
}

#[tauri::command]
fn set_window_layout(
    app: tauri::AppHandle,
    docked: bool,
    free_x: Option<f64>,
    free_y: Option<f64>,
) -> Result<(), String> {
    let state = app.state::<TrayState>();
    let mut layout = state.window_layout.lock().unwrap();
    layout.docked = docked;
    // The snap path sends None coordinates because we want to keep the last
    // free position around for when the user un-docks again.
    if free_x.is_some() && free_y.is_some() {
        layout.free_x = free_x;
        layout.free_y = free_y;
    }
    Ok(())
}

#[tauri::command]
fn snap_window_to_tray(app: tauri::AppHandle) -> Result<(), String> {
    position_window_under_tray(&app)
}

fn position_window_under_tray(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<TrayState>();
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let tray_rect = state
        .tray
        .rect()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "tray rect unavailable".to_string())?;
    let (tray_x, tray_y) = match tray_rect.position {
        tauri::Position::Physical(p) => (p.x as f64, p.y as f64),
        tauri::Position::Logical(p) => (p.x, p.y),
    };
    let (tray_width, tray_height) = match tray_rect.size {
        tauri::Size::Physical(s) => (s.width as f64, s.height as f64),
        tauri::Size::Logical(s) => (s.width, s.height),
    };
    let window_size = window.outer_size().map_err(|e| e.to_string())?;
    let x = tray_x + tray_width / 2.0 - (window_size.width as f64) / 2.0;
    let y = tray_y + tray_height;
    window
        .set_position(tauri::PhysicalPosition::new(
            x.round() as i32,
            y.round() as i32,
        ))
        .map_err(|e| e.to_string())
}

fn show_main_window(app: &tauri::AppHandle) {
    if app.get_webview_window("main").is_none() {
        return;
    }
    let state = app.state::<TrayState>();
    let layout = state.window_layout.lock().unwrap().clone();
    if layout.docked {
        let _ = position_window_under_tray(app);
    } else if let (Some(x), Some(y)) = (layout.free_x, layout.free_y) {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_position(tauri::PhysicalPosition::new(
                x.round() as i32,
                y.round() as i32,
            ));
        }
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        #[cfg(target_os = "macos")]
        set_dock_visible(app, true);
    }
}

#[cfg(target_os = "macos")]
fn set_dock_visible(app: &tauri::AppHandle, visible: bool) {
    let _ = if visible {
        app.set_activation_policy(tauri::ActivationPolicy::Regular)
    } else {
        app.set_activation_policy(tauri::ActivationPolicy::Accessory)
    };
}

/// Start a one-shot HTTP server on localhost:19847 to capture the OAuth callback.
/// Returns the code and state from the redirect URL.
#[tauri::command]
async fn wait_for_oauth_callback() -> Result<(String, String), String> {
    let result = tokio::task::spawn_blocking(|| {
        let listener = TcpListener::bind("127.0.0.1:19847").map_err(|e| {
            if e.kind() == std::io::ErrorKind::AddrInUse {
                "Port 19847 is already in use. Please close any other application using this port and try again.".to_string()
            } else {
                format!("Failed to start login server: {}", e)
            }
        })?;

        // Set a timeout so we don't block forever if the user abandons login
        listener
            .set_nonblocking(false)
            .map_err(|e| format!("Failed to configure server: {}", e))?;

        let (mut stream, _) = listener
            .accept()
            .map_err(|e| format!("Failed to receive login callback: {}", e))?;

        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut request_line = String::new();
        reader
            .read_line(&mut request_line)
            .map_err(|e| format!("Failed to read request: {}", e))?;

        // Parse query params from: GET /auth/callback?code=X&state=Y HTTP/1.1
        let path = request_line
            .split_whitespace()
            .nth(1)
            .unwrap_or("")
            .to_string();

        let query = path.split('?').nth(1).unwrap_or("");
        let params: std::collections::HashMap<&str, &str> = query
            .split('&')
            .filter_map(|p| {
                let mut kv = p.splitn(2, '=');
                Some((kv.next()?, kv.next()?))
            })
            .collect();

        let code = params
            .get("code")
            .ok_or("Missing 'code' parameter")?
            .to_string();
        let state = params
            .get("state")
            .ok_or("Missing 'state' parameter")?
            .to_string();

        // Respond with a success page that auto-closes
        let html = r#"<!DOCTYPE html>
<html><head><title>QTE Time Tracker</title></head>
<body style="font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#F0EDEB;color:#241143;">
<div style="text-align:center">
<h2 style="color:#7A59FC">Signed in!</h2>
<p>You can close this tab and return to the app.</p>
</div>
</body></html>"#;

        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            html.len(),
            html
        );
        let _ = stream.write_all(response.as_bytes());
        let _ = stream.flush();

        Ok((code, state))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?;

    result
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            wait_for_oauth_callback,
            set_timer_status,
            set_window_layout,
            snap_window_to_tray
        ])
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }

            let app_handle = app.handle().clone();

            let app_name = MenuItemBuilder::with_id("app_name", "QTE Time Tracker")
                .enabled(false)
                .build(app)?;
            let timer_status = MenuItemBuilder::with_id("timer_status", "Timer is not running")
                .enabled(false)
                .build(app)?;
            let project_item = MenuItemBuilder::with_id("tray_project", "Project: —")
                .enabled(false)
                .build(app)?;
            let task_item = MenuItemBuilder::with_id("tray_task", "Task: —")
                .enabled(false)
                .build(app)?;
            let description_item = MenuItemBuilder::with_id("tray_description", "No description")
                .enabled(false)
                .build(app)?;

            let new_item = MenuItemBuilder::with_id("new", "New")
                .accelerator("CmdOrCtrl+N")
                .build(app)?;
            let continue_item = MenuItemBuilder::with_id("continue", "Continue")
                .accelerator("CmdOrCtrl+P")
                .build(app)?;
            let stop_item = MenuItemBuilder::with_id("stop", "Stop")
                .accelerator("CmdOrCtrl+S")
                .enabled(false)
                .build(app)?;

            let show_item = MenuItemBuilder::with_id("show", "Show")
                .accelerator("CmdOrCtrl+T")
                .build(app)?;

            let sync_item = MenuItemBuilder::with_id("sync", "Sync")
                .accelerator("CmdOrCtrl+R")
                .build(app)?;

            let finalize_item = MenuItemBuilder::with_id("finalize", "Finalize Timesheet")
                .accelerator("CmdOrCtrl+F")
                .build(app)?;

            let settings_item = MenuItemBuilder::with_id("settings", "Settings")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;

            let quit_item = MenuItemBuilder::with_id("quit", "Quit")
                .accelerator("CmdOrCtrl+Q")
                .build(app)?;

            let sep = PredefinedMenuItem::separator(app)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let sep3 = PredefinedMenuItem::separator(app)?;
            // Separator inserted between timer_status and detail rows when running.
            let sep_after_status = PredefinedMenuItem::separator(app)?;

            // Base menu (timer idle) — detail rows are inserted dynamically.
            let menu = MenuBuilder::new(app)
                .item(&app_name)
                .item(&timer_status)
                .item(&sep)
                .item(&new_item)
                .item(&continue_item)
                .item(&stop_item)
                .item(&sep2)
                .item(&show_item)
                .item(&sync_item)
                .item(&finalize_item)
                .item(&settings_item)
                .item(&sep3)
                .item(&quit_item)
                .build()?;

            // Load QTE branded tray icons (embedded at compile time).
            let icon_idle = tauri::include_image!("icons/tray-idle.png");
            let icon_active = tauri::include_image!("icons/tray-active.png");

            let tray = TrayIconBuilder::new()
                .tooltip("QTE Time Tracker")
                .icon_as_template(false)
                .icon(icon_idle.clone())
                .menu(&menu)
                // We split the left-click target into two zones below, so we
                // can't let the OS open the menu on every left click.
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| match event {
                    // The status item is logically two buttons side by side:
                    // the leftmost icon-sized square plus the glyph slot next
                    // to it act as the pause/resume control, the rest of the
                    // title acts as a window show/hide toggle.
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        position,
                        rect,
                        ..
                    } => {
                        // Treat Control+click as a right-click so trackpad
                        // users get the context menu without two fingers.
                        #[cfg(target_os = "macos")]
                        if control_key_held() {
                            let app = tray.app_handle();
                            let state = app.state::<TrayState>();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = state.menu.popup(window.as_ref().window().clone());
                            }
                            return;
                        }
                        let rect_x = match rect.position {
                            tauri::Position::Physical(p) => p.x as f64,
                            tauri::Position::Logical(p) => p.x,
                        };
                        let rect_height = match rect.size {
                            tauri::Size::Physical(s) => s.height as f64,
                            tauri::Size::Logical(s) => s.height,
                        };
                        let click_offset = position.x - rect_x;
                        let icon_width = rect_height;
                        let glyph_width = rect_height;
                        let in_glyph_zone =
                            click_offset >= icon_width && click_offset < icon_width + glyph_width;
                        let app = tray.app_handle();
                        if in_glyph_zone {
                            let state = app.state::<TrayState>();
                            let is_running = state
                                .snapshot
                                .lock()
                                .unwrap()
                                .as_ref()
                                .is_some_and(|s| s.running);
                            if is_running {
                                let _ = app.emit("tray-stop-timer", ());
                            } else {
                                let _ = app.emit("tray-continue-last", ());
                            }
                        } else if let Some(window) = app.get_webview_window("main") {
                            // Leaving the dock activation policy alone — toggling
                            // it on every hide caused the Dock icon to blink.
                            // Three states: hidden → show; visible-but-behind →
                            // raise + focus (don't hide); visible + focused → hide.
                            let visible = window.is_visible().unwrap_or(false);
                            let focused = window.is_focused().unwrap_or(false);
                            if !visible {
                                show_main_window(app);
                            } else if !focused {
                                let _ = window.set_focus();
                                #[cfg(target_os = "macos")]
                                set_dock_visible(app, true);
                            } else {
                                let _ = window.hide();
                            }
                        }
                    }
                    TrayIconEvent::Click {
                        button: MouseButton::Right,
                        button_state: MouseButtonState::Up,
                        ..
                    } => {
                        let app = tray.app_handle();
                        let state = app.state::<TrayState>();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = state.menu.popup(window.as_ref().window().clone());
                        }
                    }
                    _ => {}
                })
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "new" | "show" => {
                            show_main_window(app);
                        }
                        "continue" => {
                            let _ = app.emit("tray-continue-last", ());
                        }
                        "stop" => {
                            let _ = app.emit("tray-stop-timer", ());
                        }
                        "sync" => {
                            let _ = app.emit("sync-data", ());
                            show_main_window(app);
                        }
                        "finalize" => {
                            let _ = app.emit("tray-open-finalize", ());
                            show_main_window(app);
                        }
                        "settings" => {
                            let _ = app.emit("tray-open-settings", ());
                            show_main_window(app);
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .build(&app_handle)?;

            app.manage(TrayState {
                tray,
                menu,
                icon_idle,
                icon_active,
                timer_status,
                project_item,
                task_item,
                description_item,
                sep_after_status,
                continue_item,
                stop_item,
                detail_rows_visible: Mutex::new(false),
                snapshot: Mutex::new(None),
                last_title: Mutex::new(None),
                last_headline: Mutex::new("Timer is not running".to_string()),
                menu_bar_mode: Mutex::new(MenuBarMode::Off),
                window_layout: Mutex::new(WindowLayout::default()),
            });

            // WebKit throttles JavaScript timers heavily while the window is
            // hidden (which is the normal state for a menu bar app), so the
            // tray's elapsed counter has to be driven from Rust.
            let tick_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_secs(1));
                interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
                loop {
                    interval.tick().await;
                    let state = tick_handle.state::<TrayState>();
                    let snapshot = state.snapshot.lock().unwrap().clone();
                    if let Err(err) = apply_tray_state(&state, snapshot.as_ref()) {
                        eprintln!("tray tick error: {}", err);
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
                #[cfg(target_os = "macos")]
                set_dock_visible(window.app_handle(), false);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
