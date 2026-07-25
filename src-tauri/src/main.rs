// 待办便签 - Tauri 后端
// 职责：数据持久化（JSON 文件）、系统托盘、全局快捷键、开机自启、导出、窗口行为
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewWindow,
};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{
    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
};

// ----------------------------- 数据模型 -----------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Todo {
    pub id: String,
    pub text: String,
    pub completed: bool,
    pub priority: String, // "high" | "medium" | "low"
    pub created_at: i64,  // 毫秒时间戳，仅用于排序
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutConfig {
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub meta: bool,
    pub key: String, // 如 "T"、"F9"、"Space"
}

impl Default for ShortcutConfig {
    fn default() -> Self {
        Self {
            ctrl: true,
            alt: true,
            shift: false,
            meta: false,
            key: "T".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub color: String,     // yellow | pink | green | blue | white
    pub font_size: String, // small | medium | large | xlarge
    pub always_on_top: bool,
    pub shortcut: ShortcutConfig,
    pub autostart: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            color: "yellow".into(),
            font_size: "small".into(),
            always_on_top: true,
            shortcut: ShortcutConfig::default(),
            autostart: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FullState {
    pub todos: Vec<Todo>,
    pub settings: Settings,
}

// ----------------------------- 全局状态 -----------------------------

static QUITTING: AtomicBool = AtomicBool::new(false);

struct Store {
    dir: PathBuf,
    settings: Mutex<Settings>,
}

impl Store {
    fn todos_path(&self) -> PathBuf {
        self.dir.join("todos.json")
    }
    fn settings_path(&self) -> PathBuf {
        self.dir.join("settings.json")
    }
    fn load_todos(&self) -> Vec<Todo> {
        fs::read_to_string(self.todos_path())
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }
    fn save_todos(&self, todos: &[Todo]) -> Result<(), String> {
        write_json(&self.todos_path(), todos)
    }
    fn save_settings(&self, settings: &Settings) -> Result<(), String> {
        write_json(&self.settings_path(), settings)?;
        *self.settings.lock().map_err(|e| e.to_string())? = settings.clone();
        Ok(())
    }
}

fn write_json<T: Serialize + ?Sized>(path: &PathBuf, value: &T) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    let data = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(&tmp, data).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    Ok(())
}

// ----------------------------- 窗口控制 -----------------------------

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

fn toggle_main_window(app: &AppHandle) {
    if let Some(win) = main_window(app) {
        match win.is_visible() {
            Ok(true) => {
                let _ = win.hide();
            }
            _ => {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }
    }
}

// ----------------------------- 快捷键 -----------------------------

fn key_code(key: &str) -> Option<Code> {
    let k = key.to_uppercase();
    Some(match k.as_str() {
        "A" => Code::KeyA, "B" => Code::KeyB, "C" => Code::KeyC, "D" => Code::KeyD,
        "E" => Code::KeyE, "F" => Code::KeyF, "G" => Code::KeyG, "H" => Code::KeyH,
        "I" => Code::KeyI, "J" => Code::KeyJ, "K" => Code::KeyK, "L" => Code::KeyL,
        "M" => Code::KeyM, "N" => Code::KeyN, "O" => Code::KeyO, "P" => Code::KeyP,
        "Q" => Code::KeyQ, "R" => Code::KeyR, "S" => Code::KeyS, "T" => Code::KeyT,
        "U" => Code::KeyU, "V" => Code::KeyV, "W" => Code::KeyW, "X" => Code::KeyX,
        "Y" => Code::KeyY, "Z" => Code::KeyZ,
        "0" => Code::Digit0, "1" => Code::Digit1, "2" => Code::Digit2, "3" => Code::Digit3,
        "4" => Code::Digit4, "5" => Code::Digit5, "6" => Code::Digit6, "7" => Code::Digit7,
        "8" => Code::Digit8, "9" => Code::Digit9,
        "F1" => Code::F1, "F2" => Code::F2, "F3" => Code::F3, "F4" => Code::F4,
        "F5" => Code::F5, "F6" => Code::F6, "F7" => Code::F7, "F8" => Code::F8,
        "F9" => Code::F9, "F10" => Code::F10, "F11" => Code::F11, "F12" => Code::F12,
        "SPACE" => Code::Space,
        "ENTER" => Code::Enter,
        "TAB" => Code::Tab,
        "ESCAPE" => Code::Escape,
        "ARROWUP" => Code::ArrowUp,
        "ARROWDOWN" => Code::ArrowDown,
        "ARROWLEFT" => Code::ArrowLeft,
        "ARROWRIGHT" => Code::ArrowRight,
        "HOME" => Code::Home,
        "END" => Code::End,
        "PAGEUP" => Code::PageUp,
        "PAGEDOWN" => Code::PageDown,
        "INSERT" => Code::Insert,
        "DELETE" => Code::Delete,
        "BACKSPACE" => Code::Backspace,
        "MINUS" => Code::Minus,
        "EQUAL" => Code::Equal,
        "COMMA" => Code::Comma,
        "PERIOD" => Code::Period,
        "SLASH" => Code::Slash,
        "SEMICOLON" => Code::Semicolon,
        "QUOTE" => Code::Quote,
        "BACKQUOTE" => Code::Backquote,
        "BRACKETLEFT" => Code::BracketLeft,
        "BRACKETRIGHT" => Code::BracketRight,
        "BACKSLASH" => Code::Backslash,
        _ => return None,
    })
}

fn build_shortcut(cfg: &ShortcutConfig) -> Option<Shortcut> {
    let mut mods = Modifiers::empty();
    if cfg.ctrl {
        mods |= Modifiers::CONTROL;
    }
    if cfg.alt {
        mods |= Modifiers::ALT;
    }
    if cfg.shift {
        mods |= Modifiers::SHIFT;
    }
    if cfg.meta {
        mods |= Modifiers::SUPER;
    }
    if mods.is_empty() {
        return None; // 全局快捷键必须包含修饰键，避免与普通输入冲突
    }
    let code = key_code(&cfg.key)?;
    Some(Shortcut::new(Some(mods), code))
}

fn apply_shortcut(app: &AppHandle, cfg: &ShortcutConfig) -> Result<(), String> {
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| e.to_string())?;
    if let Some(sc) = build_shortcut(cfg) {
        gs.register(sc).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[allow(dead_code)]
fn shortcut_label(cfg: &ShortcutConfig) -> String {
    let mut parts: Vec<String> = Vec::new();
    if cfg.ctrl {
        parts.push("Ctrl".into());
    }
    if cfg.alt {
        parts.push("Alt".into());
    }
    if cfg.shift {
        parts.push("Shift".into());
    }
    if cfg.meta {
        parts.push("Win".into());
    }
    parts.push(if cfg.key.len() == 1 {
        cfg.key.to_uppercase()
    } else {
        let lower = cfg.key.to_lowercase();
        let mut c = lower.chars();
        match c.next() {
            Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
            None => String::new(),
        }
    });
    parts.join("+")
}

// ----------------------------- Tauri 命令 -----------------------------

#[tauri::command]
fn load_state(app: AppHandle) -> FullState {
    let store = app.state::<Store>();
    let settings = store.settings.lock().unwrap().clone();
    let todos = store.load_todos();
    // 将实际的自启动状态与设置同步（外部可能被改动）
    let autostart = app.autolaunch().is_enabled().unwrap_or(settings.autostart);
    FullState {
        todos,
        settings: Settings {
            autostart,
            ..settings
        },
    }
}

#[tauri::command]
fn save_todos(app: AppHandle, todos: Vec<Todo>) -> Result<(), String> {
    app.state::<Store>().save_todos(&todos)
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    // 应用置顶
    if let Some(win) = main_window(&app) {
        let _ = win.set_always_on_top(settings.always_on_top);
    }
    // 应用全局快捷键
    apply_shortcut(&app, &settings.shortcut)?;
    // 应用开机自启
    let autostart = app.autolaunch();
    let enabled = autostart.is_enabled().unwrap_or(false);
    if settings.autostart && !enabled {
        autostart.enable().map_err(|e| e.to_string())?;
    } else if !settings.autostart && enabled {
        autostart.disable().map_err(|e| e.to_string())?;
    }
    // 持久化
    app.state::<Store>().save_settings(&settings)?;
    // 通知主窗口刷新外观
    let _ = app.emit_to("main", "settings-changed", &settings);
    Ok(())
}

#[tauri::command]
fn toggle_window(app: AppHandle) {
    toggle_main_window(&app);
}

#[tauri::command]
fn hide_window(app: AppHandle) {
    if let Some(win) = main_window(&app) {
        let _ = win.hide();
    }
}

#[tauri::command]
fn open_settings(app: AppHandle) {
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

#[tauri::command]
fn close_settings(app: AppHandle) {
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.hide();
    }
}

#[tauri::command]
fn export_data(app: AppHandle, format: String) -> Result<String, String> {
    let todos = app.state::<Store>().load_todos();
    let (ext, filter_name) = match format.as_str() {
        "md" | "markdown" => ("md", "Markdown 文件"),
        _ => ("json", "JSON 文件"),
    };
    let path = app
        .dialog()
        .file()
        .set_title("导出待办数据")
        .set_directory(app.state::<Store>().dir.clone())
        .set_file_name(format!("待办便签.{}", ext))
        .add_filter(filter_name, &[ext])
        .blocking_save_file();

    let Some(path) = path else {
        return Ok("cancelled".into());
    };
    let path = path.into_path().map_err(|e| e.to_string())?;

    let content = if ext == "md" {
        let mut s = String::from("# 待办便签\n\n");
        for t in &todos {
            let check = if t.completed { "x" } else { " " };
            let prio = match t.priority.as_str() {
                "high" => "高",
                "medium" => "中",
                _ => "低",
            };
            s.push_str(&format!("- [{}] {}（优先级：{}）\n", check, t.text, prio));
        }
        s
    } else {
        serde_json::to_string_pretty(&todos).map_err(|e| e.to_string())?
    };
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn data_dir(app: AppHandle) -> String {
    app.state::<Store>()
        .dir
        .to_string_lossy()
        .to_string()
}

#[tauri::command]
fn open_data_dir(app: AppHandle) -> Result<(), String> {
    let dir = app.state::<Store>().dir.clone();
    std::process::Command::new("explorer")
        .arg(&dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ----------------------------- 应用入口 -----------------------------

fn main() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .with_denylist(&["settings"])
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_main_window(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            // 数据目录：%APPDATA%/com.todosticky.app
            let dir = app.path().app_data_dir()?;
            fs::create_dir_all(&dir)?;
            let settings: Settings = fs::read_to_string(dir.join("settings.json"))
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default();
            app.manage(Store {
                dir,
                settings: Mutex::new(settings.clone()),
            });

            // 创建窗口（配置中 create=false，必须在 manage 之后创建，
            // 否则页面 JS 会在状态就绪前调用命令）
            for label in ["main", "settings"] {
                let cfg = app
                    .config()
                    .app
                    .windows
                    .iter()
                    .find(|w| w.label == label)
                    .cloned()
                    .expect("缺少窗口配置");
                tauri::WebviewWindowBuilder::from_config(app.handle(), &cfg)?.build()?;
            }
            // 确保设置窗口初始隐藏
            if let Some(w) = app.get_webview_window("settings") {
                let _ = w.hide();
            }

            // 应用置顶设置
            if let Some(win) = main_window(app.app_handle()) {
                let _ = win.set_always_on_top(settings.always_on_top);
            }

            // 注册全局快捷键（FR-19 / FR-20）
            if let Err(e) = apply_shortcut(app.app_handle(), &settings.shortcut) {
                eprintln!("注册全局快捷键失败: {e}");
            }

            // 系统托盘（FR-16 / FR-17 / FR-18）
            let toggle_item = MenuItemBuilder::with_id("toggle", "显示/隐藏便签").build(app)?;
            let settings_item = MenuItemBuilder::with_id("settings", "设置").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "退出").build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&toggle_item)
                .item(&settings_item)
                .item(&PredefinedMenuItem::separator(app)?)
                .item(&quit_item)
                .build()?;

            let icon = app
                .default_window_icon()
                .cloned()
                .expect("缺少默认窗口图标");

            TrayIconBuilder::with_id("main-tray")
                .icon(icon)
                .tooltip("待办便签")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "toggle" => toggle_main_window(app),
                    "settings" => {
                        if let Some(win) = app.get_webview_window("settings") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "quit" => {
                        QUITTING.store(true, Ordering::SeqCst);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // FR-16：点击关闭按钮仅隐藏窗口，托盘保留；「退出」是唯一退出入口
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if !QUITTING.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_state,
            save_todos,
            save_settings,
            toggle_window,
            hide_window,
            open_settings,
            close_settings,
            export_data,
            data_dir,
            open_data_dir,
        ])
        .run(tauri::generate_context!())
        .expect("运行待办便签应用时出错");
}
