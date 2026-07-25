# 待办便签（Todo Sticky）

一款 Windows 桌面端的极简待办事项软件。主界面即一张「桌面便签贴纸」，直接在便签内管理待办事项，无需主窗口、列表页等多级界面。

技术栈：**Tauri v2（Rust + 系统 WebView2）+ 原生 HTML/CSS/JS**，数据以 JSON 文件存储在 `%APPDATA%\com.todosticky.dev`，绿色便携单文件 exe。

## 功能

- **待办管理**：回车快速连续添加、勾选完成（划线置灰、保留原位）、删除（二次确认）、双击行内编辑、拖拽手柄排序、高/中/低优先级左侧色条标记（点击切换）
- **便签窗口**：无边框贴纸外观、拖动本体移动、边缘缩放、位置尺寸记忆、默认置顶（图钉切换）、黄/粉/绿/蓝/白五色、小/中/大/特大字体档位（默认小）、标题显示未完成数量
- **系统托盘**：关闭按钮仅隐藏到托盘；左键单击托盘图标切换显隐；右键菜单：显示/隐藏便签、设置、退出（唯一退出入口）
- **全局快捷键**：默认 `Ctrl+Alt+T` 呼出/隐藏，可在设置中自定义
- **设置面板**：配色、字体、快捷键、开机自启（默认关闭）、数据导出（JSON / Markdown）、打开导出目录
- **数据**：所有变更自动保存，异常退出不丢已存数据

## 开发

前置要求：Rust（rustup）、Node.js、Visual Studio Build Tools（MSVC）、系统 WebView2。

```bash
npm install        # 安装 @tauri-apps/cli
npm run dev        # 开发模式（热重载）
npm run build      # 发布构建
npm run gen-icons  # 重新生成应用图标
```

## 构建产物

发布构建后，便携单文件 exe 位于：

```
src-tauri/target/release/todo-sticky.exe
```

复制该文件到任意位置即可运行（需系统装有 WebView2 运行时，Win10 1803+/Win11 通常已内置）。

## 目录结构

```
├── ui/                  # 前端（原生 HTML/CSS/JS）
│   ├── index.html       # 便签主窗口
│   ├── main.js
│   ├── style.css        # 五色主题 + 字体档位（CSS 变量）
│   ├── settings.html    # 设置窗口
│   ├── settings.js
│   └── settings.css
├── src-tauri/           # Rust 后端
│   ├── src/main.rs      # 托盘、全局快捷键、持久化、导出、窗口行为
│   ├── tauri.conf.json
│   └── icons/
├── scripts/gen-icons.mjs # 图标生成脚本
└── REQUIREMENTS.md      # 需求文档
```

## 数据文件

位于 `%APPDATA%\com.todosticky.dev\`：

| 文件 | 内容 |
| --- | --- |
| `todos.json` | 待办列表（标题、优先级、完成状态、创建时间） |
| `settings.json` | 配色、字体档位、置顶、快捷键、自启设置 |
| `.window-state.json` | 窗口位置与尺寸（由 window-state 插件维护） |
