// 待办便签 - 设置窗口逻辑
const { invoke } = window.__TAURI__.core;

let settings = null;
let saveTimer = null;

const $shortcut = document.getElementById("shortcut-input");
const $autostart = document.getElementById("autostart");
const $saveStatus = document.getElementById("save-status");
const $exportResult = document.getElementById("export-result");

// ---------------- 保存 ----------------

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await invoke("save_settings", { settings });
      flashStatus("已自动保存");
    } catch (e) {
      flashStatus("保存失败：" + e, true);
    }
  }, 250);
}

function flashStatus(msg, isErr = false) {
  $saveStatus.textContent = msg;
  $saveStatus.style.color = isErr ? "#d33" : "#2a7d2a";
  setTimeout(() => { $saveStatus.textContent = ""; }, 2000);
}

// ---------------- 界面绑定 ----------------

function renderSettings() {
  document.querySelectorAll(".swatch").forEach((el) => {
    el.classList.toggle("active", el.dataset.color === settings.color);
  });
  const radio = document.querySelector(`input[name="font"][value="${settings.fontSize}"]`);
  if (radio) radio.checked = true;
  $shortcut.value = shortcutLabel(settings.shortcut);
  $autostart.checked = !!settings.autostart;
}

function shortcutLabel(sc) {
  const parts = [];
  if (sc.ctrl) parts.push("Ctrl");
  if (sc.alt) parts.push("Alt");
  if (sc.shift) parts.push("Shift");
  if (sc.meta) parts.push("Win");
  parts.push(sc.key.length === 1 ? sc.key.toUpperCase() : sc.key);
  return parts.join("+");
}

// 配色
document.getElementById("color-row").addEventListener("click", (e) => {
  const btn = e.target.closest(".swatch");
  if (!btn) return;
  settings.color = btn.dataset.color;
  renderSettings();
  scheduleSave();
});

// 字体档位
document.getElementById("font-row").addEventListener("change", (e) => {
  settings.fontSize = e.target.value;
  scheduleSave();
});

// 开机自启
$autostart.addEventListener("change", () => {
  settings.autostart = $autostart.checked;
  scheduleSave();
});

// ---------------- 快捷键录制 ----------------

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta"]);

$shortcut.addEventListener("keydown", (e) => {
  e.preventDefault();
  if (MODIFIER_KEYS.has(e.key)) {
    $shortcut.value = "按下按键…";
    return;
  }
  const sc = {
    ctrl: e.ctrlKey,
    alt: e.altKey,
    shift: e.shiftKey,
    meta: e.metaKey,
    key: normalizeKey(e.key),
  };
  if (!sc.ctrl && !sc.alt && !sc.shift && !sc.meta) {
    $shortcut.value = "需包含修饰键（Ctrl/Alt/Shift/Win）";
    return;
  }
  if (!sc.key) {
    $shortcut.value = "不支持的按键";
    return;
  }
  settings.shortcut = sc;
  renderSettings();
  scheduleSave();
  $shortcut.blur();
});

$shortcut.addEventListener("focus", () => $shortcut.classList.add("recording"));
$shortcut.addEventListener("blur", () => {
  $shortcut.classList.remove("recording");
  if (settings) renderSettings();
});

function normalizeKey(key) {
  if (!key) return null;
  if (key === " ") return "Space";
  if (key.length === 1) return key.toUpperCase();
  const map = {
    Escape: "Escape", Enter: "Enter", Tab: "Tab", Backspace: "Backspace",
    Delete: "Delete", Insert: "Insert", Home: "Home", End: "End",
    PageUp: "PageUp", PageDown: "PageDown",
    ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight",
    Minus: "Minus", Equal: "Equal", Comma: "Comma", Period: "Period", Slash: "Slash",
    Semicolon: "Semicolon", Quote: "Quote", Backquote: "Backquote",
    BracketLeft: "BracketLeft", BracketRight: "BracketRight", Backslash: "Backslash",
  };
  if (/^F([1-9]|1[0-2])$/.test(key)) return key;
  return map[key] || null;
}

// ---------------- 导出 ----------------

async function doExport(format) {
  try {
    const result = await invoke("export_data", { format });
    $exportResult.textContent =
      result === "cancelled" ? "已取消导出" : `已导出：${result}`;
  } catch (e) {
    $exportResult.textContent = "导出失败：" + e;
  }
}
document.getElementById("export-json").addEventListener("click", () => doExport("json"));
document.getElementById("export-md").addEventListener("click", () => doExport("md"));
document.getElementById("open-dir").addEventListener("click", () => {
  invoke("open_data_dir").catch((e) => {
    $exportResult.textContent = "打开目录失败：" + e;
  });
});

// 关闭按钮：隐藏设置窗口
document.getElementById("close").addEventListener("click", () => {
  invoke("close_settings").catch(console.error);
});

// ---------------- 初始化 ----------------

async function init() {
  const state = await invoke("load_state");
  settings = state.settings;
  renderSettings();
  try {
    document.getElementById("data-dir").textContent = await invoke("data_dir");
  } catch (_) { /* 忽略 */ }
}

init().catch((e) => console.error("初始化失败", e));
