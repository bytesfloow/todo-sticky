// 待办便签 - 主窗口逻辑
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const PRIORITIES = ["high", "medium", "low"];

let todos = [];
let settings = null;
let saveTimer = null;
let dragState = null; // { id, li } 拖拽排序状态

const $list = document.getElementById("list");
const $empty = document.getElementById("empty");
const $title = document.getElementById("title");
const $input = document.getElementById("new-input");
const $btnPin = document.getElementById("btn-pin");
const $btnHide = document.getElementById("btn-hide");
const $prioBtn = document.getElementById("prio-btn");

// 新增待办时使用的优先级（默认中级，点击按钮按 中→低→高 循环切换）
let newPriority = "medium";
$prioBtn.addEventListener("click", () => {
  const next = { medium: "low", low: "high", high: "medium" };
  newPriority = next[newPriority];
  $prioBtn.dataset.prio = newPriority;
  $prioBtn.textContent = prioLabel(newPriority);
  $prioBtn.title = `优先级：${prioLabel(newPriority)}（点击切换）`;
  $input.focus();
});

// ---------------- 持久化 ----------------

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    invoke("save_todos", { todos }).catch((e) => console.error("保存失败", e));
  }, 300);
}

async function persistSettings() {
  try {
    await invoke("save_settings", { settings });
  } catch (e) {
    console.error("保存设置失败", e);
  }
}

// ---------------- 外观 ----------------

function applySettings(s) {
  settings = { ...settings, ...s };
  document.body.dataset.color = settings.color;
  document.body.dataset.font = settings.fontSize;
  $btnPin.classList.toggle("pinned", !!settings.alwaysOnTop);
}

function updateTitle() {
  const n = todos.filter((t) => !t.completed).length;
  $title.textContent = n > 0 ? `待办便签 (${n})` : "待办便签";
  document.title = $title.textContent;
}

// ---------------- 渲染 ----------------

function prioLabel(p) {
  return p === "high" ? "高" : p === "medium" ? "中" : "低";
}

function render() {
  $list.innerHTML = "";
  todos.forEach((todo, index) => {
    const li = document.createElement("li");
    li.className = "todo-item" + (todo.completed ? " done" : "");
    li.dataset.index = index;
    li.dataset.id = todo.id;
    li.dataset.prio = todo.priority;

    // 拖拽手柄（按住拖动排序，Pointer 事件实现）
    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.textContent = "⠿";
    handle.title = "按住拖动排序";
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      dragState = { id: todo.id, li };
      li.classList.add("dragging");
    });

    // 完成勾选
    const check = document.createElement("button");
    check.className = "check-btn";
    check.title = todo.completed ? "取消完成" : "标记完成";
    check.textContent = todo.completed ? "✓" : "";
    check.addEventListener("click", () => {
      todo.completed = !todo.completed;
      render();
      scheduleSave();
    });

    // 文本（双击打开编辑对话框）
    const text = document.createElement("span");
    text.className = "todo-text";
    text.textContent = todo.text;
    text.title = "双击编辑";
    text.addEventListener("dblclick", () => openEditDialog(todo));

    // 删除（二次确认：第一次点击进入确认态，再次点击执行删除）
    const del = document.createElement("button");
    del.className = "del-btn";
    del.title = "删除";
    del.textContent = "✕";
    let disarmTimer = null;
    del.addEventListener("click", () => {
      if (del.dataset.armed === "1") {
        clearTimeout(disarmTimer);
        todos.splice(index, 1);
        render();
        scheduleSave();
        return;
      }
      del.dataset.armed = "1";
      del.textContent = "删除?";
      del.classList.add("armed");
      disarmTimer = setTimeout(() => {
        if (!del.isConnected) return;
        delete del.dataset.armed;
        del.textContent = "✕";
        del.classList.remove("armed");
      }, 2500);
    });

    li.append(handle, check, text, del);
    $list.appendChild(li);
  });

  $empty.classList.toggle("show", todos.length === 0);
  updateTitle();
}

// ---------------- 拖拽排序（Pointer 事件实现） ----------------

document.addEventListener("pointermove", (e) => {
  if (!dragState) return;
  const items = [...$list.querySelectorAll(".todo-item")];
  for (const el of items) {
    if (el === dragState.li) continue;
    const r = el.getBoundingClientRect();
    if (e.clientY >= r.top && e.clientY <= r.bottom) {
      const before = e.clientY < r.top + r.height / 2;
      $list.insertBefore(dragState.li, before ? el : el.nextSibling);
      break;
    }
  }
});

document.addEventListener("pointerup", () => {
  if (!dragState) return;
  // 按 DOM 顺序提交新排序
  const ids = [...$list.querySelectorAll(".todo-item")].map((el) => el.dataset.id);
  todos.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  dragState.li.classList.remove("dragging");
  dragState = null;
  render();
  scheduleSave();
});

// ---------------- 编辑对话框（双击事项弹出） ----------------

function openEditDialog(todo) {
  let selected = todo.priority;

  const mask = document.createElement("div");
  mask.className = "modal-mask";

  const card = document.createElement("div");
  card.className = "modal-card";

  const title = document.createElement("div");
  title.className = "modal-title";
  title.textContent = "编辑待办";

  // 内容编辑：文本域（Enter 保存，Shift+Enter 换行，Esc 取消）
  const input = document.createElement("textarea");
  input.className = "modal-input";
  input.value = todo.text;
  input.maxLength = 200;
  input.rows = 3;

  // 优先级选择（高/中/低 pill）
  const prioRow = document.createElement("div");
  prioRow.className = "modal-prio-row";
  const prioLabelEl = document.createElement("span");
  prioLabelEl.className = "modal-prio-label";
  prioLabelEl.textContent = "优先级";
  prioRow.appendChild(prioLabelEl);
  const pills = [];
  for (const p of PRIORITIES) {
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "prio-pill";
    pill.dataset.prio = p;
    pill.textContent = prioLabel(p);
    pill.addEventListener("click", () => {
      selected = p;
      pills.forEach((el) => el.classList.toggle("active", el.dataset.prio === selected));
    });
    pills.push(pill);
    prioRow.appendChild(pill);
  }
  pills.forEach((el) => el.classList.toggle("active", el.dataset.prio === selected));

  // 底部按钮
  const btnRow = document.createElement("div");
  btnRow.className = "modal-btn-row";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "modal-btn";
  cancelBtn.textContent = "取消";
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "modal-btn primary";
  saveBtn.textContent = "保存";
  btnRow.append(cancelBtn, saveBtn);

  card.append(title, input, prioRow, btnRow);
  mask.appendChild(card);
  document.getElementById("app").appendChild(mask);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    mask.remove();
  };
  const save = () => {
    if (closed) return;
    const v = input.value.trim();
    if (v) {
      todo.text = v;
      todo.priority = selected;
    } else {
      // 内容为空 → 删除该条
      todos = todos.filter((t) => t.id !== todo.id);
    }
    close();
    render();
    scheduleSave();
  };

  saveBtn.addEventListener("click", save);
  cancelBtn.addEventListener("click", close);
  mask.addEventListener("mousedown", (e) => {
    if (e.target === mask) close();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") close();
  });
}

// ---------------- 新增 ----------------

$input.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const text = $input.value.trim();
  if (!text) return;
  todos.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text,
    completed: false,
    priority: newPriority,
    createdAt: Date.now(),
  });
  $input.value = "";
  render();
  scheduleSave();
  $input.focus(); // 保持焦点，可连续添加
  // 滚动到底部
  const wrap = document.getElementById("list-wrap");
  wrap.scrollTop = wrap.scrollHeight;
});

// ---------------- 标题栏按钮 ----------------

$btnPin.addEventListener("click", async () => {
  settings.alwaysOnTop = !settings.alwaysOnTop;
  applySettings(settings);
  await persistSettings();
});

$btnHide.addEventListener("click", () => {
  invoke("hide_window").catch(console.error);
});

// ---------------- 初始化 ----------------

async function init() {
  const state = await invoke("load_state");
  todos = state.todos || [];
  applySettings(state.settings);
  render();
  $input.focus();

  // 设置窗口修改后同步外观
  await listen("settings-changed", (e) => applySettings(e.payload));
}

init().catch((e) => console.error("初始化失败", e));
