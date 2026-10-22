# GladosXshell

English | [中文](README.zh.md) | [ئۇيغۇرچە](README.ug.md)

GladosXshell is an SSH client for Windows. It puts the terminal, files, server status and port forwarding in one window, with a layout close to FinalShell. The interface is available in Chinese, English and Uyghur (right to left).

The current version is 0.1.1 Beta.

## Features

- **Connections:**
  - SSH, with password, private key, keyboard-interactive and ssh-agent / Pageant login
  - Telnet and serial ports
  - Jump hosts, SOCKS5 and HTTP proxies
  - The host fingerprint is checked on the first connection
- **Import:** brings in connections from `~/.ssh/config`, Xshell, PuTTY and FinalShell.
- **Local terminal:** finds cmd, PowerShell, Git Bash and WSL distributions by itself. Terminals can be split.
- **Command bar:** sits under the terminal, with completion and history. It can send the same input to several terminals at once. Saved commands live in the Commands panel and run with one click.
- **Files:**
  - SFTP browsing, uploads and downloads with a transfer queue
  - ZMODEM (rz / sz)
  - A built-in editor for remote files, with syntax colors and search and replace
  - The files panel follows the terminal's `cd`
- **Status:**
  - CPU, memory, disks, network, latency and processes of the server
  - A separate advanced status window with a process manager
- **Port forwarding:** shows the forwards and traffic of the current session, and adds `-L` / `-R` / `-D` forwards on the fly.
- **Docker and Kubernetes:** lists the server's containers and pods and lets you act on them.
- **Terminal helpers:**
  - Macros: record a run of input and replay it, optionally waiting for given output along the way.
  - Triggers: when output matches, highlight it, alert you or send input.
  - Session recording and playback in asciicast format.
  - Log colors for ERROR, WARN, INFO and IP addresses.
- **Keys and security:**
  - A key library that generates and imports SSH keys and installs the public key on a server in one step.
  - Saved passwords are encrypted with Windows DPAPI by default, or with a master password instead if you set one.
  - Settings and connections can be exported as a password-protected backup.
- **Look:**
  - Three layout presets, with panels you can drag between areas
  - Dark and light themes
  - Terminal font, background image and custom CSS
- **Plugins:**
  - The built-in features are plugins themselves, and each one can be turned off.
  - Third-party plugins are written in JavaScript and run in a sandbox. The user grants the permissions they ask for.

## Install

Run `GladosXshell-Setup-<version>.exe`, choose whether to install for the current user or for all users, then pick a folder. The uninstaller asks whether to keep your data.

- **Requirements:** 64-bit Windows 10 or 11, with the WebView2 runtime. Windows 11 and recent Windows 10 builds already have it.
- **Data location:** `%USERPROFILE%\.gladosxshell`.
- **Portable use:** create a `data` folder next to `gladosxshell.exe`, and the data is kept there.
- **Interface language:** set it in Settings → Appearance; it applies after a restart. The default, "Same as Windows", follows the system language.

Shortcuts:

| Action | Keys |
|---|---|
| Command palette | `Ctrl+Shift+P` |
| Connection manager | `Ctrl+Shift+N` |
| Settings | `Ctrl+,` |

## Writing plugins

The in-app plugin developer guide covers the manifest, the permissions and the whole API. To open it, search for "Plugin developer guide" in the command palette.

- **Type declarations:** [sdk/gx.d.ts](sdk/gx.d.ts).
- **Examples:** [examples/plugins](examples/plugins).
  - `hello` shows commands, menus, the status bar and a panel.
  - `disk-alert` runs `df` on the server from time to time and warns when a disk is nearly full.
- **Translation:** a plugin translates its own name and titles with `locales` in `plugin.json`, and reads the interface language from `gx.lang` at run time.

## Build

You need Node.js and stable Rust (edition 2024).

```sh
npm install
npm run tauri dev        # run in development
npm run check            # Biome, TypeScript, Vitest, untranslated-text check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm run build:release    # release installer
npm run build:debug      # debug installer (developer tools, separate data folder)
```

The installers are written to `target/release/setup/`.

Where the code lives:

| Folder | Contents |
|---|---|
| `src/` | Frontend (TypeScript + Vite) |
| `crates/gxs-core/` | Connections, authentication, data and keys (Rust) |
| `src-tauri/` | App shell |
| `installer/` | Setup program |

Every new piece of interface text needs `zh`, `en` and `ug`.

## Platforms

Only Windows is supported for now. The code has branches for Linux and macOS, but it has not been built or tested on them yet, and saving passwords without a master password relies on Windows DPAPI.

## Feedback

When something goes wrong, export a diagnostics package in Settings → Testing and send it to malik6@qq.com with a description of the problem.
