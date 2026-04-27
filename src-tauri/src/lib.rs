use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Manager,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
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

            // Start with window hidden
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }

            let app_handle = app.handle().clone();

            // Status items (disabled, just for display)
            let app_name = MenuItemBuilder::with_id("app_name", "QTE Time Tracker")
                .enabled(false)
                .build(app)?;
            let timer_status = MenuItemBuilder::with_id("timer_status", "Timer is not running")
                .enabled(false)
                .build(app)?;

            // Action items
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
            // Close button hides the window instead of quitting (menu bar app)
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
