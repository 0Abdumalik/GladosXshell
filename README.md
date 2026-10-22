<div align="center">

<img src="src-tauri/icons/128x128@2x.png" width="96" height="96" alt="">

# GladosXshell

**An SSH client for Windows. Terminal, files, server status and port forwarding share one window.**

![Version](https://img.shields.io/badge/version-0.1.1--beta-3b82f6)
![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078d4)
![Languages](https://img.shields.io/badge/languages-English%20%7C%20%E4%B8%AD%E6%96%87%20%7C%20%D8%A6%DB%87%D9%8A%D8%BA%DB%87%D8%B1%DA%86%DB%95-64748b)
![Built with](https://img.shields.io/badge/built%20with-Rust%20%2B%20Tauri%202-b7410e)

English · [简体中文](README.zh-CN.md) · [ئۇيغۇرچە](README.ug.md)

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/main-light.png">
  <img src="docs/screenshots/main.png" alt="GladosXshell main window">
</picture>

</div>

## Highlights

- **The whole server in one place.** The terminal, SFTP file browser, live server status and port forwards sit side by side. The default layout is close to FinalShell, and panels can be moved between areas.
- **A command bar that knows your tools.** Type below the terminal with completion for common commands, their flags and remote paths. You can also send one input to several terminals at once.
- **Edit remote files in place.** The built-in editor has syntax colors and search and replace. The file browser follows the terminal's working directory.
- **Live monitoring.** CPU, memory, disks, network, latency and processes, plus a separate window with charts and a process manager.
- **Secrets stay on your machine.** Connections, keys and passwords are handled in the Rust core. Saved passwords are encrypted with Windows DPAPI, or with a master password if you set one.
- **Extensible.** Every built-in feature is a plugin and can be turned off. Third-party plugins run sandboxed and use only the permissions you grant.
- **Three languages.** English, Chinese and Uyghur. Uyghur gets a full right-to-left layout.

## Quick start

1. Download `GladosXshell-Setup-<version>.exe` from [Releases](../../releases).
2. Run it and choose whether to install for the current user or for all users.
3. Open the connection manager with `Ctrl+Shift+N`. Add a server, or import your connections from `~/.ssh/config`, Xshell, PuTTY or FinalShell.

You need 64-bit Windows 10 or 11 with the WebView2 runtime, which Windows 11 and recent Windows 10 builds already have.

| Action | Keys |
|---|---|
| Command palette | `Ctrl+Shift+P` |
| Connection manager | `Ctrl+Shift+N` |
| Settings | `Ctrl+,` |

## Screenshots

| File manager | Server status |
|---|---|
| ![File manager](docs/screenshots/files.png) | ![Advanced status window](docs/screenshots/status.png) |

## Features

**Connections**
- SSH with password, private key, keyboard-interactive, or ssh-agent / Pageant login.
- Telnet and serial ports.
- Jump hosts, plus SOCKS5 and HTTP proxies.
- The host fingerprint is checked on the first connection and remembered after that.
- Connections can be imported from `~/.ssh/config`, Xshell, PuTTY and FinalShell.
- Local terminals: cmd, PowerShell, Git Bash and WSL distributions are found automatically. Terminals can be split.

**Files**
- SFTP browsing, uploads and downloads, with a transfer queue.
- ZMODEM (`rz` / `sz`).
- A built-in editor for remote files.

**Server tools**
- A status panel and an advanced status window with a process manager.
- Port forwarding: shows each session's forwards and their traffic, and adds `-L`, `-R` or `-D` forwards on the fly.
- Docker containers and Kubernetes pods on the current server.

**Terminal helpers**
- Favorite commands, grouped into folders in the Commands panel.
- Macros that can wait for given output before going on.
- Triggers that highlight, alert or reply when output matches.
- Session recording and playback in asciicast format.
- Log highlighting.

**Keys and data**
- A key library that generates and imports SSH keys and installs a public key on a server in one step.
- An optional master password.
- Settings and connections can be exported as a password-protected backup.
- Portable mode: create a `data` folder next to `gladosxshell.exe`. Otherwise data is kept in `%USERPROFILE%\.gladosxshell`.

**Look**
- Three layout presets.
- Dark and light themes.
- Terminal fonts, a background image and custom CSS.
- The interface language is set in Settings → Appearance and applies after a restart.

## Plugins

Plugins are written in JavaScript and run in a sandboxed frame. They reach the app only through the `gx` API, and only with the permissions the user grants. They can add:
- commands, menu items and keyboard shortcuts
- panels and status bar items
- settings, themes and completions

| Resource | Where |
|---|---|
| Guide | In the app: command palette → "Plugin developer guide" |
| Type declarations | [`sdk/gx.d.ts`](sdk/gx.d.ts) |
| Examples | [`examples/plugins`](examples/plugins): `hello` (commands, menus, a panel) and `disk-alert` (runs `df` and warns in the status bar) |
| Translation | `locales` in `plugin.json`; read the interface language from `gx.lang` |

## Build from source

You need Node.js and stable Rust (edition 2024).

```sh
npm install
npm run tauri dev        # run in development
npm run check            # Biome, TypeScript, Vitest and the untranslated-text check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm run build:release    # release installer
npm run build:debug      # debug installer: developer tools, separate data folder
```

The installers are written to `target/release/setup/`.

| Folder | Contents |
|---|---|
| `src/` | Frontend (TypeScript, Vite, xterm.js, CodeMirror) |
| `crates/gxs-core/` | Connections, authentication, data and keys (Rust) |
| `src-tauri/` | App shell (Tauri 2) |
| `installer/` | Setup program |

Every new piece of interface text needs `zh`, `en` and `ug` versions, and `npm run check` fails on text that is left untranslated.

## Platform support

| Platform | Status |
|---|---|
| Windows 10 / 11, x64 | Supported |
| Linux | Not yet. The code has Linux paths, but it has not been built or tested there. |
| macOS | Not yet |

On Linux and macOS, saving passwords without a master password would also need a system keychain backend.

## Feedback

If something goes wrong, export a diagnostics package from Settings → Testing. Send it to malik6@qq.com with a short description of what happened.
