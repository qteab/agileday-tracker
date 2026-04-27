use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Manager,
};

#[cfg(target_os = "macos")]
fn set_dock_visible(app: &tauri::AppHandle, visible: bool) {
    if visible {
        app.set_activation_policy(tauri::ActivationPolicy::Regular);
    } else {
        app.set_activation_policy(tauri::ActivationPolicy::Accessory);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Start hidden from Dock and Cmd+Tab
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
