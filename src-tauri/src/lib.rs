use tauri::{
    tray::{TrayIconBuilder, TrayIconEvent},
    Manager,
    WebviewUrl,
    WebviewWindowBuilder,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Hide from dock on macOS — menu bar only
            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }

            let app_handle = app.handle().clone();

            // Build system tray icon
            TrayIconBuilder::new()
                .tooltip("QTE Time Tracker")
                .icon_as_template(true)
                .icon(app.default_window_icon().unwrap().clone())
                .on_tray_icon_event(move |tray, event| {
                    match event {
                        TrayIconEvent::Click { .. } => {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                if window.is_visible().unwrap_or(false) {
                                    let _ = window.hide();
                                } else {
                                    // Position window near tray icon
                                    if let Some(rect) = tray.rect().ok().flatten() {
                                        let (px, py) = match rect.position {
                                            tauri::Position::Physical(p) => (p.x as f64, p.y as f64),
                                            tauri::Position::Logical(p) => (p.x, p.y),
                                        };
                                        let sh = match rect.size {
                                            tauri::Size::Physical(s) => s.height as f64,
                                            tauri::Size::Logical(s) => s.height,
                                        };
                                        let _ = window.set_position(tauri::Position::Logical(
                                            tauri::LogicalPosition::new(px - 200.0, py + sh),
                                        ));
                                    }
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            } else {
                                let _ = WebviewWindowBuilder::new(
                                    app,
                                    "main",
                                    WebviewUrl::default(),
                                )
                                .title("QTE Time Tracker")
                                .inner_size(400.0, 600.0)
                                .decorations(false)
                                .resizable(false)
                                .always_on_top(true)
                                .skip_taskbar(true)
                                .build();
                            }
                        }
                        _ => {}
                    }
                })
                .build(&app_handle)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Hide window when it loses focus (like Toggl)
            if let tauri::WindowEvent::Focused(false) = event {
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
