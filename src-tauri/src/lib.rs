use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};

#[cfg(target_os = "macos")]
fn set_dock_visible(app: &tauri::AppHandle, visible: bool) {
    if visible {
        app.set_activation_policy(tauri::ActivationPolicy::Regular);
    } else {
        app.set_activation_policy(tauri::ActivationPolicy::Accessory);
    }
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
        .invoke_handler(tauri::generate_handler![wait_for_oauth_callback])
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

            let new_item = MenuItemBuilder::with_id("new", "New")
                .accelerator("CmdOrCtrl+N")
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

            let quit_item = MenuItemBuilder::with_id("quit", "Quit")
                .accelerator("CmdOrCtrl+Q")
                .build(app)?;

            let sep = PredefinedMenuItem::separator(app)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let sep3 = PredefinedMenuItem::separator(app)?;

            let menu = MenuBuilder::new(app)
                .item(&app_name)
                .item(&timer_status)
                .item(&sep)
                .item(&new_item)
                .item(&stop_item)
                .item(&sep2)
                .item(&show_item)
                .item(&sync_item)
                .item(&sep3)
                .item(&quit_item)
                .build()?;

            TrayIconBuilder::new()
                .tooltip("QTE Time Tracker")
                .icon_as_template(false)
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .menu_on_left_click(true)
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "new" | "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                                #[cfg(target_os = "macos")]
                                set_dock_visible(app, true);
                            }
                        }
                        "sync" => {
                            let _ = app.emit("sync-data", ());
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                                #[cfg(target_os = "macos")]
                                set_dock_visible(app, true);
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .build(&app_handle)?;

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
