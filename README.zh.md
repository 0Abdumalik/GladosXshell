# GladosXshell

[English](README.md) | 中文 | [ئۇيغۇرچە](README.ug.md)

面向 Windows 的 SSH 客户端：终端、文件、服务器状态和端口转发放在同一个窗口里，布局接近 FinalShell。界面有中文、英文和维吾尔文（从右到左）三种语言。

当前版本 0.1.1 Beta。

## 功能

- **连接**：SSH（密码、私钥、键盘交互、ssh-agent / Pageant）、Telnet、串口。支持跳板机，以及 SOCKS5 / HTTP 代理。首次连接时核对主机指纹。
- **导入**：可以从 `~/.ssh/config`、Xshell、PuTTY、FinalShell 导入连接。
- **本地终端**：自动找到 cmd、PowerShell、Git Bash 和 WSL 发行版；可以分屏。
- **终端下方的指令栏**：支持命令补全和历史记录，也能把输入同时发送到多个终端。常用命令可以收进指令台，一键执行。
- **文件**：SFTP 浏览、上传、下载，带传输队列，并支持 ZMODEM（rz / sz）。远程文件可以用内置编辑器打开，带语法着色和搜索替换。终端 cd 到哪里，文件面板就跟到哪里。
- **状态**：查看服务器的 CPU、内存、磁盘、网络、延迟和进程。另有单独的高级状态窗口和进程管理。
- **端口转发**：查看当前会话的转发和流量，可以临时添加 `-L` / `-R` / `-D` 转发。
- **Docker 与 Kubernetes**：查看和操作当前服务器上的容器和 Pod。
- **终端辅助**：
  - 宏：录制一串输入后回放，可以中途等待指定输出。
  - 触发器：输出匹配时高亮、提醒，或自动发送输入。
  - 会话录制与回放，录成 asciicast 格式。
  - 日志着色：给 ERROR、WARN、INFO 和 IP 地址上色。
- **密钥与安全**：
  - 密钥库：生成和导入 SSH 密钥，一键把公钥装到服务器上。
  - 保存的密码默认用 Windows DPAPI 加密；也可以设一个主密码，改用主密码加密。
  - 设置和连接可以带密码导出备份。
- **外观**：
  - 三种布局预设，面板可以拖到不同区域。
  - 深色和浅色主题。
  - 可设置终端字体、背景图片和自定义 CSS。
- **插件**：
  - 内置功能本身就是插件，可以单独停用。
  - 第三方插件用 JavaScript 编写，运行在沙箱里，需要的权限要用户授权。

## 安装

运行 `GladosXshell-Setup-<版本>.exe`，选择安装给当前用户还是所有用户，再选安装位置。卸载时可以选择保留或删除数据。

- 系统要求：Windows 10 / 11（64 位），需要 WebView2 运行时（Windows 11 和较新的 Windows 10 已自带）。
- 数据位置：`%USERPROFILE%\.gladosxshell`。
- 便携使用：在 `gladosxshell.exe` 旁边建一个 `data` 文件夹，数据就存放在那里。
- 界面语言：在"设置 → 外观"里选择，重启后生效。默认"跟随系统"。

常用快捷键：

| 操作 | 快捷键 |
|---|---|
| 命令面板 | `Ctrl+Shift+P` |
| 连接管理器 | `Ctrl+Shift+N` |
| 设置 | `Ctrl+,` |

## 插件开发

应用内的插件指南介绍了清单、权限和全部 API。从命令面板搜索"插件开发指南"即可打开。

- 类型声明：[sdk/gx.d.ts](sdk/gx.d.ts)。
- 示例：[examples/plugins](examples/plugins)。`hello` 演示命令、菜单、状态栏和面板；`disk-alert` 在服务器上定时运行 `df`，磁盘快满时告警。
- 插件可以在 `plugin.json` 的 `locales` 里翻译自己的名称和标题，运行时用 `gx.lang` 读取界面语言。

## 构建

需要 Node.js 和 Rust 稳定版（edition 2024）。

```sh
npm install
npm run tauri dev        # 开发运行
npm run check            # Biome、TypeScript、Vitest、未翻译文字检查
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm run build:release    # 正式版安装程序
npm run build:debug      # 调试版安装程序（带开发者工具，数据单独存放）
```

安装程序生成在 `target/release/setup/` 目录下。

代码结构：

| 目录 | 内容 |
|---|---|
| `src/` | 前端（TypeScript + Vite） |
| `crates/gxs-core/` | 连接、认证、数据和密钥（Rust） |
| `src-tauri/` | 应用外壳 |
| `installer/` | 安装程序 |

新增界面文字时，需要同时写 `zh`、`en`、`ug` 三种语言。

## 平台

目前只支持 Windows。代码里留有 Linux 和 macOS 的分支，但还没有在这两个系统上构建和测试过。另外，不设主密码时，保存密码依赖 Windows DPAPI。

## 反馈

出现问题时，在"设置 → 测试"里导出诊断包，连同问题描述一起发到 malik6@qq.com。
