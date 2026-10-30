use crate::{AppExt, Locale, Runtime, State};
use tauri::Emitter;

#[allow(dead_code)]
pub struct Tray(pub tauri::tray::TrayIcon<Runtime>);

impl Tray {
    pub fn new(app: &tauri::AppHandle<Runtime>) -> anyhow::Result<Self> {
        app.with_app_state::<Locale, _>(|locale| {
            let build_item = |id: &str, text: &str| -> anyhow::Result<tauri::menu::MenuItem<Runtime>> {
                tauri::menu::MenuItemBuilder::with_id(id, text)
                    .build(app)
                    .map_err(|e| anyhow::anyhow!("Failed to build menu item: {}", e))
            };
            let menu = tauri::menu::MenuBuilder::new(app)
                .items(&[
                    &build_item("show", locale.get("tray_show"))?,
                    &build_item("storage", locale.get("storage"))?,
                    &build_item("add_storage", &format!("{} {}", locale.get("add"), locale.get("storage")))?,
                    &build_item("mount", locale.get("mount"))?,
                    &build_item("transmit", locale.get("transmit"))?,
                    &build_item("task", locale.get("task"))?,
                    &build_item("setting", locale.get("setting"))?,
                    &build_item("restart", locale.get("tray_restart"))?,
                    &build_item("quit", locale.get("quit"))?,
                ])
                .build()
                .map_err(|e| anyhow::anyhow!("Failed to build menu: {}", e))?;
            let tray = app.tray_by_id("main")
                .ok_or_else(|| anyhow::anyhow!("Tray icon 'main' not found"))?;
            tray.set_menu(Some(menu))?;
            tray.on_tray_icon_event(|icon, event| match event {
                tauri::tray::TrayIconEvent::Click {
                    id: _,
                    position: _,
                    rect: _,
                    button,
                    button_state,
                } => {
                    if button == tauri::tray::MouseButton::Left
                        && button_state == tauri::tray::MouseButtonState::Up
                    {
                        if !show_main_window(icon.app_handle()) {
                            show_webview_error_dialog();
                        }
                    }
                }
                _ => {}
            });
            tray.on_menu_event(|app, event| match event.id.as_ref() {
                "show" => {
                    if !show_main_window(app) {
                        show_webview_error_dialog();
                    }
                }
                "storage" => {
                    if show_main_window(app) {
                        if let Err(error) = app.emit("netmount://navigate", "/storage/manage") {
                            eprintln!("[tray] failed to navigate to storage: {error}");
                        }
                    } else {
                        show_webview_error_dialog();
                    }
                }
                "mount" | "transmit" | "task" | "setting" => {
                    if show_main_window(app) {
                        let path = match event.id.as_ref() {
                            "mount" => "/mount",
                            "transmit" => "/transmit",
                            "task" => "/task",
                            _ => "/setting",
                        };
                        if let Err(error) = app.emit("netmount://navigate", path) {
                            eprintln!("[tray] failed to navigate to {path}: {error}");
                        }
                    } else {
                        show_webview_error_dialog();
                    }
                }
                "add_storage" => {
                    if show_main_window(app) {
                        if let Err(error) = app.emit("netmount://add-storage", ()) {
                            eprintln!("[tray] failed to open add-storage page: {error}");
                        }
                    } else {
                        show_webview_error_dialog();
                    }
                }
                "restart" => {
                    app.restart();
                }
                "quit" => {
                    app.app_quit();
                }
                _ => {}
            });
            Ok(Self(tray))
        })
    }
}


/// Bring the configured main webview to the foreground from a tray action.
/// Keep every native-window error visible in the log; silently ignoring these
/// errors made the Catalina regression impossible to diagnose.
fn show_main_window(app: &tauri::AppHandle<Runtime>) -> bool {
    let window = match app.app_main_window() {
        Some(window) => window,
        None => {
            eprintln!("[tray] main webview window is missing; attempting to recreate it");
            match tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("NetMount")
            .inner_size(850.0, 600.0)
            .min_inner_size(700.0, 450.0)
            .resizable(true)
            .decorations(false)
            .transparent(false)
            .visible(false)
            .build()
            {
                Ok(window) => {
                    eprintln!("[tray] recreated main webview window");
                    window
                }
                Err(error) => {
                    eprintln!("[tray] failed to recreate main webview window: {error}");
                    return false;
                }
            }
        }
    };

    for (operation, result) in [
        ("unminimize", window.unminimize()),
        ("show", window.show()),
        ("focus", window.set_focus()),
    ] {
        if let Err(error) = result {
            eprintln!("[tray] main window {operation} failed: {error}");
            return false;
        }
    }

    match window.is_visible() {
        Ok(true) => {
            eprintln!("[tray] main window shown and focused");
            true
        }
        Ok(false) => {
            eprintln!("[tray] show() returned success but main window is still hidden");
            false
        }
        Err(error) => {
            eprintln!("[tray] failed to query main window visibility: {error}");
            false
        }
    }
}

/// 显示 WebView2 缺失的原生错误对话框（不依赖 WebView2）
fn show_webview_error_dialog() {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let _ = Command::new("powershell")
            .args(&[
                "-Command",
                "Add-Type -AssemblyName System.Windows.Forms; \
                 [System.Windows.Forms.MessageBox]::Show( \
                   '无法显示主窗口。这可能是因为 Microsoft Edge WebView2 运行时未安装或被删除。\n\n\
                   请按以下步骤修复：\n\
                   1. 重新安装 Microsoft Edge 浏览器，或\n\
                   2. 从 https://developer.microsoft.com/en-us/microsoft-edge/webview2/ 下载并安装 WebView2 运行时\n\n\
                   安装后请重启 NetMount。', \
                   'NetMount - 显示主窗口失败', \
                   'OK', \
                   'Error' \
                 )"
            ])
            .spawn();
    }

    #[cfg(not(target_os = "windows"))]
    {
        eprintln!("无法显示主窗口。请检查系统是否安装了必要的 WebView 运行时。");
    }
}

impl State for Tray {}
