<div align="center">

<img src="src-tauri/icons/128x128@2x.png" width="96" height="96" alt="">

# GladosXshell

**面向 Windows 的 SSH 客户端：终端、文件、服务器状态和端口转发集中在同一个窗口里。**

![Version](https://img.shields.io/badge/version-0.1.1--beta-3b82f6)
![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078d4)
![Languages](https://img.shields.io/badge/languages-English%20%7C%20%E4%B8%AD%E6%96%87%20%7C%20%D8%A6%DB%87%D9%8A%D8%BA%DB%87%D8%B1%DA%86%DB%95-64748b)
![Built with](https://img.shields.io/badge/built%20with-Rust%20%2B%20Tauri%202-b7410e)

[English](README.md) · 简体中文 · [ئۇيغۇرچە](README.ug.md)

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/main-light.png">
  <img src="docs/screenshots/main.png" alt="GladosXshell 主窗口">
</picture>

</div>

## 亮点

- **一个窗口看全服务器**：终端、SFTP 文件、实时状态和端口转发并排显示。默认布局接近 FinalShell，面板可以拖到不同区域。
- **懂常用工具的指令栏**：在终端下方输入，常用命令的子命令、参数和远程路径都能补全。还能把同一条输入同时发送到多个终端。
- **直接编辑远程文件**：内置编辑器带语法着色和搜索替换。文件面板会跟随终端的当前目录。
- **实时监控**：CPU、内存、磁盘、网络、延迟和进程一目了然，另有带图表和进程管理的独立窗口。
- **机密留在本机**：连接、密钥和密码都由 Rust 核心处理。保存的密码默认用 Windows DPAPI 加密；设了主密码后，改用主密码加密。
- **可扩展**：内置功能本身就是插件，都可以单独停用。第三方插件在沙箱中运行，只能使用你授权的权限。
- **三种语言**：英文、中文和维吾尔文，维吾尔文下整个界面从右到左排列。

## 快速开始

1. 从 [Releases](../../releases) 下载 `GladosXshell-Setup-<版本>.exe`。
2. 运行安装程序，选择安装给当前用户还是所有用户。
3. 按 `Ctrl+Shift+N` 打开连接管理器，添加服务器，或者从 `~/.ssh/config`、Xshell、PuTTY、FinalShell 导入连接。

系统要求：64 位 Windows 10 / 11，需要 WebView2 运行时（Windows 11 和较新的 Windows 10 已自带）。

| 操作 | 快捷键 |
|---|---|
| 命令面板 | `Ctrl+Shift+P` |
| 连接管理器 | `Ctrl+Shift+N` |
| 设置 | `Ctrl+,` |

## 截图

| 文件管理 | 服务器状态 |
|---|---|
| ![文件管理](docs/screenshots/files.png) | ![高级状态窗口](docs/screenshots/status.png) |

## 功能

**连接**
- SSH：支持密码、私钥、键盘交互和 ssh-agent / Pageant 登录。
- Telnet 和串口。
- 跳板机、SOCKS5 代理和 HTTP 代理。
- 首次连接时核对主机指纹，核对后记住。
- 可以从 `~/.ssh/config`、Xshell、PuTTY、FinalShell 导入连接。
- 本地终端：自动找到 cmd、PowerShell、Git Bash 和 WSL 发行版，支持分屏。

**文件**
- SFTP 浏览、上传和下载，带传输队列。
- ZMODEM（`rz` / `sz`）。
- 内置编辑器，可以直接编辑远程文件。

**服务器工具**
- 状态面板，以及带进程管理的高级状态窗口。
- 端口转发：查看每个会话的转发和流量，可以临时添加 `-L`、`-R`、`-D` 转发。
- 当前服务器上的 Docker 容器和 Kubernetes Pod。

**终端辅助**
- 指令台：收藏常用指令，可以分文件夹整理。
- 宏：回放一串输入，中途可以等待指定输出。
- 触发器：输出匹配时高亮、提醒或自动回复。
- 会话录制与回放，录成 asciicast 格式。
- 日志着色。

**密钥与数据**
- 密钥库：生成和导入 SSH 密钥，一键把公钥装到服务器上。
- 可选的主密码。
- 设置和连接可以导出为带密码的备份。
- 便携模式：在 `gladosxshell.exe` 旁边建一个 `data` 文件夹即可。不用便携模式时，数据存放在 `%USERPROFILE%\.gladosxshell`。

**外观**
- 三种布局预设。
- 深色和浅色主题。
- 可设置终端字体、背景图片和自定义 CSS。
- 界面语言在"设置 → 外观"里选择，重启后生效。

## 插件

插件用 JavaScript 编写，运行在沙箱 iframe 中。它们只能通过 `gx` API 访问应用，而且只能使用用户授权的权限。插件可以添加：
- 命令、菜单项和快捷键
- 面板和状态栏项
- 设置项、主题和补全数据

| 资料 | 位置 |
|---|---|
| 开发指南 | 应用内：命令面板 →"插件开发指南" |
| 类型声明 | [`sdk/gx.d.ts`](sdk/gx.d.ts) |
| 示例 | [`examples/plugins`](examples/plugins)：`hello`（命令、菜单、面板），`disk-alert`（运行 `df`，在状态栏告警） |
| 翻译 | 在 `plugin.json` 的 `locales` 里翻译；运行时从 `gx.lang` 读取界面语言 |

## 从源码构建

需要 Node.js 和 Rust 稳定版（edition 2024）。

```sh
npm install
npm run tauri dev        # 开发运行
npm run check            # Biome、TypeScript、Vitest 和未翻译文字检查
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm run build:release    # 正式版安装程序
npm run build:debug      # 调试版安装程序：带开发者工具，数据单独存放
```

安装程序会生成在 `target/release/setup/`。

| 目录 | 内容 |
|---|---|
| `src/` | 前端（TypeScript、Vite、xterm.js、CodeMirror） |
| `crates/gxs-core/` | 连接、认证、数据和密钥（Rust） |
| `src-tauri/` | 应用外壳（Tauri 2） |
| `installer/` | 安装程序 |

新增的界面文字都要同时提供 `zh`、`en`、`ug` 三种语言，漏翻时 `npm run check` 会报错。

## 平台支持

| 平台 | 状态 |
|---|---|
| Windows 10 / 11，x64 | 已支持 |
| Linux | 暂不支持。代码里留有 Linux 分支，但还没有构建和测试过 |
| macOS | 暂不支持 |

在 Linux 和 macOS 上，不设主密码时保存密码还需要接入系统钥匙串。

## 反馈

遇到问题时，在"设置 → 测试"里导出诊断包，连同问题描述一起发到 malik6@qq.com。
