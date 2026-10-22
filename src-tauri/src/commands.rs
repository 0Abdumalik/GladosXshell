//! Command favorites and the command-bar history. Both are local, app-wide data.

use std::sync::atomic::{AtomicU32, Ordering};

use gxs_core::i18n::ltr;
use gxs_core::{Error, fsutil, tr};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::applog::Level;
use crate::store::JsonStore;
use crate::{AppState, Result};

const MAX_COMMAND: usize = 64 * 1024;
const MAX_NOTE_CHARS: usize = 2000;
const MAX_FAVORITES: usize = 5000;
const MAX_FOLDERS: usize = 200;
const MAX_FOLDER_NAME_CHARS: usize = 60;
const MAX_HISTORY: usize = 500;
const MAX_HISTORY_ITEM: usize = 16 * 1024;
const MAX_PATH_HISTORY: usize = 100;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Favorite {
    pub id: String,
    pub command: String,
    pub note: String,
    /// `None` keeps the favorite at the top level.
    #[serde(default)]
    pub folder_id: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct FavoritesFile {
    pub items: Vec<Favorite>,
    pub folders: Vec<Folder>,
}

/// Oldest first.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct HistoryFile {
    pub items: Vec<String>,
}

/// Path history for cd command completion. Oldest first.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct PathHistoryFile {
    pub items: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteInput {
    pub id: Option<String>,
    pub command: String,
    pub note: String,
    /// Only read when adding; editing keeps the current folder.
    #[serde(default)]
    pub folder_id: Option<String>,
}

static ID_COUNTER: AtomicU32 = AtomicU32::new(0);

fn new_id(taken: impl Fn(&str) -> bool) -> String {
    loop {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos());
        let id = format!("{nanos:x}{:04x}", ID_COUNTER.fetch_add(1, Ordering::Relaxed) & 0xffff);
        if !taken(&id) {
            return id;
        }
    }
}

/// First line of a command, shortened, for log messages.
pub(crate) fn summary(command: &str) -> String {
    let line = command.lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim();
    let short: String = line.chars().take(40).collect();
    if short.len() < line.len() || command.trim().lines().count() > 1 {
        format!("{short}…")
    } else {
        short
    }
}

/// A whole sentence, so it goes out as `Data` rather than `NotFound` (which shows "not found: …").
fn favorite_gone() -> Error {
    Error::Data(tr!(
        "这条收藏已被删除",
        "This favorite has been deleted",
        "بۇ يىغىلغان بۇيرۇق ئۆچۈرۈلگەن"
    ))
}

fn folder_gone() -> Error {
    Error::Data(tr!(
        "这个收藏夹已被删除",
        "This folder has been deleted",
        "بۇ يىغقۇچ قىسقۇچى ئۆچۈرۈلگەن"
    ))
}

fn apply_save(file: &mut FavoritesFile, input: FavoriteInput, now: u64) -> Result<Favorite> {
    let command = input.command.trim_end().trim_start_matches(['\r', '\n']).to_owned();
    if command.trim().is_empty() {
        return Err(Error::Invalid(tr!("指令不能为空", "The command can't be empty", "بۇيرۇق بوش بولسا بولمايدۇ")));
    }
    if command.len() > MAX_COMMAND {
        return Err(Error::Invalid(tr!(
            "指令不能超过 64 KB",
            "The command can't be larger than 64 KB",
            "بۇيرۇق 64 KB دىن ئېشىپ كەتمەسلىكى كېرەك"
        )));
    }
    let note = input.note.trim().to_owned();
    if note.chars().count() > MAX_NOTE_CHARS {
        return Err(Error::Invalid(tr!(
            "备注不能超过 2000 个字",
            "The note can't be longer than 2000 characters",
            "ئىزاھات 2000 ھەرپتىن ئېشىپ كەتمەسلىكى كېرەك"
        )));
    }
    match input.id {
        Some(id) => {
            let item = file
                .items
                .iter_mut()
                .find(|f| f.id == id)
                .ok_or_else(favorite_gone)?;
            item.command = command;
            item.note = note;
            item.updated_at = now;
            Ok(item.clone())
        }
        None => {
            if file.items.len() >= MAX_FAVORITES {
                return Err(Error::Invalid(tr!(
                    "收藏已达上限 5000 条",
                    "You have reached the limit of 5000 favorites",
                    "يىغقۇچ 5000 لىك چەككە يەتتى"
                )));
            }
            check_folder(file, input.folder_id.as_deref())?;
            let id = new_id(|id| file.items.iter().any(|f| f.id == id));
            let item = Favorite {
                id,
                command,
                note,
                folder_id: input.folder_id,
                created_at: now,
                updated_at: now,
            };
            file.items.insert(0, item.clone());
            Ok(item)
        }
    }
}

fn check_folder(file: &FavoritesFile, folder_id: Option<&str>) -> Result<()> {
    match folder_id {
        Some(id) if !file.folders.iter().any(|f| f.id == id) => Err(folder_gone()),
        _ => Ok(()),
    }
}

fn apply_folder_save(file: &mut FavoritesFile, id: Option<String>, name: &str) -> Result<Folder> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > MAX_FOLDER_NAME_CHARS || name.chars().any(char::is_control) {
        return Err(Error::Invalid(tr!(
            "收藏夹名称需为 1 到 60 个字",
            "Folder names must be 1 to 60 characters",
            "يىغقۇچ قىسقۇچىنىڭ ئاتى 1 دىن 60 ھەرپكىچە بولۇشى كېرەك"
        )));
    }
    if file
        .folders
        .iter()
        .any(|f| f.name == name && Some(&f.id) != id.as_ref())
    {
        return Err(Error::Exists(tr!(
            "已有名为「{name}」的收藏夹",
            "A folder named \"{name}\" already exists",
            "«{name}» ناملىق يىغقۇچ قىسقۇچى ئاللىقاچان مەۋجۇت"
        )));
    }
    match id {
        Some(id) => {
            let folder = file
                .folders
                .iter_mut()
                .find(|f| f.id == id)
                .ok_or_else(folder_gone)?;
            folder.name = name.to_owned();
            Ok(folder.clone())
        }
        None => {
            if file.folders.len() >= MAX_FOLDERS {
                return Err(Error::Invalid(tr!(
                    "收藏夹已达上限 200 个",
                    "You have reached the limit of 200 folders",
                    "يىغقۇچ قىسقۇچى 200 لىك چەككە يەتتى"
                )));
            }
            let folder = Folder {
                id: new_id(|id| file.folders.iter().any(|f| f.id == id)),
                name: name.to_owned(),
            };
            file.folders.push(folder.clone());
            Ok(folder)
        }
    }
}

/// Removes the folder; its favorites move to the top level rather than being deleted.
fn apply_folder_delete(file: &mut FavoritesFile, id: &str) -> Option<Folder> {
    let index = file.folders.iter().position(|f| f.id == id)?;
    for item in file.items.iter_mut().filter(|f| f.folder_id.as_deref() == Some(id)) {
        item.folder_id = None;
    }
    Some(file.folders.remove(index))
}

/// Adds favorites from another file. Folders match by name; a command already saved in the same
/// folder is skipped. Returns (added, skipped).
pub(crate) fn merge_favorites(file: &mut FavoritesFile, incoming: FavoritesFile) -> (usize, usize) {
    let mut folder_ids = std::collections::HashMap::new();
    for folder in incoming.folders {
        let name = folder.name.trim();
        let valid = !name.is_empty() && name.chars().count() <= MAX_FOLDER_NAME_CHARS && !name.chars().any(char::is_control);
        if !valid {
            continue;
        }
        let id = match file.folders.iter().find(|f| f.name == name) {
            Some(same) => same.id.clone(),
            None if file.folders.len() < MAX_FOLDERS => {
                let id = new_id(|id| file.folders.iter().any(|f| f.id == id));
                file.folders.push(Folder {
                    id: id.clone(),
                    name: name.to_owned(),
                });
                id
            }
            None => continue,
        };
        folder_ids.insert(folder.id, id);
    }
    let (mut added, mut skipped) = (0, 0);
    for item in incoming.items {
        let folder_id = item.folder_id.and_then(|f| folder_ids.get(&f).cloned());
        let command = item.command.trim_end().trim_start_matches(['\r', '\n']).to_owned();
        let note = item.note.trim().to_owned();
        let valid = !command.trim().is_empty() && command.len() <= MAX_COMMAND && note.chars().count() <= MAX_NOTE_CHARS;
        if !valid || file.items.iter().any(|f| f.command == command && f.folder_id == folder_id) {
            skipped += 1;
            continue;
        }
        if file.items.len() >= MAX_FAVORITES {
            skipped += 1;
            continue;
        }
        let id = new_id(|id| file.items.iter().any(|f| f.id == id));
        file.items.push(Favorite {
            id,
            command,
            note,
            folder_id,
            created_at: item.created_at,
            updated_at: item.updated_at,
        });
        added += 1;
    }
    (added, skipped)
}

fn apply_history(file: &mut HistoryFile, command: &str) {
    let command = command.trim_end();
    if command.trim().is_empty() || command.len() > MAX_HISTORY_ITEM {
        return;
    }
    file.items.retain(|c| c != command);
    file.items.push(command.to_owned());
    let excess = file.items.len().saturating_sub(MAX_HISTORY);
    file.items.drain(..excess);
}


pub(crate) type Favorites = JsonStore<FavoritesFile>;
pub(crate) type History = JsonStore<HistoryFile>;
pub(crate) type PathHistory = JsonStore<PathHistoryFile>;

#[tauri::command]
pub async fn favorites_list(state: State<'_, AppState>) -> Result<FavoritesFile> {
    state.favorites.get().await
}

#[tauri::command]
pub async fn favorite_move(state: State<'_, AppState>, id: String, folder_id: Option<String>) -> Result<()> {
    state
        .favorites
        .update(|file| {
            check_folder(file, folder_id.as_deref())?;
            let item = file
                .items
                .iter_mut()
                .find(|f| f.id == id)
                .ok_or_else(favorite_gone)?;
            item.folder_id = folder_id;
            Ok(())
        })
        .await
}

#[tauri::command]
pub async fn folder_save(state: State<'_, AppState>, id: Option<String>, name: String) -> Result<Folder> {
    let renaming = id.is_some();
    let folder = state
        .favorites
        .update(|file| apply_folder_save(file, id, &name))
        .await?;
    let name = &folder.name;
    let line = if renaming {
        tr!(
            "已重命名收藏夹「{name}」",
            "Renamed the favorites folder \"{name}\"",
            "«{name}» يىغقۇچ قىسقۇچىنىڭ ئاتى ئۆزگەرتىلدى"
        )
    } else {
        tr!(
            "已新建收藏夹「{name}」",
            "Created the favorites folder \"{name}\"",
            "«{name}» يىغقۇچ قىسقۇچى قۇرۇلدى"
        )
    };
    state.log.add(Level::Info, line).await;
    Ok(folder)
}

#[tauri::command]
pub async fn folder_delete(state: State<'_, AppState>, id: String) -> Result<()> {
    let removed = state
        .favorites
        .update(|file| Ok(apply_folder_delete(file, &id)))
        .await?;
    if let Some(folder) = removed {
        state
            .log
            .add(
                Level::Info,
                tr!(
                    "已删除收藏夹「{name}」，其中的指令移到顶层",
                    "Deleted the favorites folder \"{name}\"; its commands moved to the top level",
                    "«{name}» يىغقۇچ قىسقۇچى ئۆچۈرۈلدى، ئىچىدىكى بۇيرۇقلار ئەڭ ئۈستۈنكى قاتلامغا يۆتكەلدى",
                    name = folder.name
                ),
            )
            .await;
    }
    Ok(())
}

#[tauri::command]
pub async fn favorite_save(state: State<'_, AppState>, input: FavoriteInput) -> Result<Favorite> {
    let editing = input.id.is_some();
    let saved = state
        .favorites
        .update(|file| apply_save(file, input, fsutil::now_secs()))
        .await?;
    let command = ltr(&summary(&saved.command));
    let line = if editing {
        tr!(
            "已修改指令收藏「{command}」",
            "Edited the favorite command \"{command}\"",
            "يىغىلغان بۇيرۇق ئۆزگەرتىلدى: «{command}»"
        )
    } else {
        tr!(
            "已添加指令收藏「{command}」",
            "Added the favorite command \"{command}\"",
            "يىغىلغان بۇيرۇق قوشۇلدى: «{command}»"
        )
    };
    state.log.add(Level::Info, line).await;
    Ok(saved)
}

#[tauri::command]
pub async fn favorite_delete(state: State<'_, AppState>, id: String) -> Result<()> {
    let removed = state
        .favorites
        .update(|file| {
            let index = file.items.iter().position(|f| f.id == id);
            Ok(index.map(|i| file.items.remove(i)))
        })
        .await?;
    if let Some(item) = removed {
        state
            .log
            .add(
                Level::Info,
                tr!(
                    "已删除指令收藏「{command}」",
                    "Deleted the favorite command \"{command}\"",
                    "يىغىلغان بۇيرۇق ئۆچۈرۈلدى: «{command}»",
                    command = ltr(&summary(&item.command))
                ),
            )
            .await;
    }
    Ok(())
}

#[tauri::command]
pub async fn history_list(state: State<'_, AppState>) -> Result<Vec<String>> {
    Ok(state.history.get().await?.items)
}

#[tauri::command]
pub async fn history_add(state: State<'_, AppState>, command: String) -> Result<()> {
    state
        .history
        .update(|file| {
            apply_history(file, &command);
            Ok(())
        })
        .await
}

#[tauri::command]
pub async fn history_remove(state: State<'_, AppState>, command: String) -> Result<()> {
    state
        .history
        .update(|file| {
            file.items.retain(|c| *c != command);
            Ok(())
        })
        .await
}

#[tauri::command]
pub async fn history_clear(state: State<'_, AppState>) -> Result<()> {
    let count = state
        .history
        .update(|file| Ok(std::mem::take(&mut file.items).len()))
        .await?;
    state
        .log
        .add(
            Level::Info,
            tr!(
                "已清除指令历史（{count} 条）",
                "Cleared the command history ({count} entries)",
                "بۇيرۇق تارىخى تازىلاندى ({count} تال)"
            ),
        )
        .await;
    Ok(())
}

#[tauri::command]
pub async fn load_path_history(state: State<'_, AppState>) -> Result<Vec<String>> {
    Ok(state.path_history.get().await?.items)
}

#[tauri::command]
pub async fn save_path_history(state: State<'_, AppState>, paths: Vec<String>) -> Result<()> {
    state
        .path_history
        .update(|file| {
            file.items = paths;
            let excess = file.items.len().saturating_sub(MAX_PATH_HISTORY);
            file.items.drain(..excess);
            Ok(())
        })
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(id: Option<&str>, command: &str, note: &str) -> FavoriteInput {
        FavoriteInput {
            id: id.map(str::to_owned),
            command: command.into(),
            note: note.into(),
            folder_id: None,
        }
    }

    #[test]
    fn favorites_are_validated_and_updated_in_place() {
        let mut file = FavoritesFile::default();
        assert!(apply_save(&mut file, input(None, "  \n ", ""), 1).is_err());
        let a = apply_save(&mut file, input(None, "\nuptime\n\n", " 负载 "), 1).unwrap();
        assert_eq!(a.command, "uptime");
        assert_eq!(a.note, "负载");
        let b = apply_save(&mut file, input(None, "df -h", ""), 2).unwrap();
        assert_eq!(file.items[0].id, b.id);
        let edited = apply_save(&mut file, input(Some(&a.id), "uptime -p", "x"), 3).unwrap();
        assert_eq!((edited.created_at, edited.updated_at), (1, 3));
        assert_eq!(file.items.len(), 2);
        assert!(apply_save(&mut file, input(Some("gone"), "ls", ""), 4).is_err());
        assert!(apply_save(&mut file, input(None, "ls", &"字".repeat(2001)), 4).is_err());
    }

    #[test]
    fn merging_favorites_matches_folders_by_name_and_skips_duplicates() {
        let mut file = FavoritesFile::default();
        let ops = apply_folder_save(&mut file, None, "运维").unwrap();
        let mut kept = input(None, "uptime", "");
        kept.folder_id = Some(ops.id.clone());
        apply_save(&mut file, kept, 1).unwrap();
        let theirs = FavoritesFile {
            folders: vec![
                Folder {
                    id: "f1".into(),
                    name: "运维".into(),
                },
                Folder {
                    id: "f2".into(),
                    name: "新的".into(),
                },
            ],
            items: ["uptime", "df -h", "uptime", " "]
                .iter()
                .zip([Some("f1"), Some("f2"), None, None])
                .map(|(command, folder)| Favorite {
                    id: "x".into(),
                    command: (*command).into(),
                    note: String::new(),
                    folder_id: folder.map(str::to_owned),
                    created_at: 5,
                    updated_at: 6,
                })
                .collect(),
        };
        assert_eq!(merge_favorites(&mut file, theirs), (2, 2));
        assert_eq!(file.folders.len(), 2);
        let fresh = file.folders.iter().find(|f| f.name == "新的").unwrap();
        let df = file.items.iter().find(|f| f.command == "df -h").unwrap();
        assert_eq!(df.folder_id.as_ref(), Some(&fresh.id));
        assert_eq!(file.items.iter().filter(|f| f.command == "uptime").count(), 2);
        assert_eq!(file.items.iter().map(|f| &f.id).collect::<std::collections::HashSet<_>>().len(), 3);
    }

    #[test]
    fn folders_are_unique_and_deleting_one_keeps_its_favorites() {
        let mut file = FavoritesFile::default();
        let ops = apply_folder_save(&mut file, None, " 运维 ").unwrap();
        assert_eq!(ops.name, "运维");
        assert!(apply_folder_save(&mut file, None, "运维").is_err());
        assert!(apply_folder_save(&mut file, None, "  ").is_err());
        let mut add = input(None, "uptime", "");
        add.folder_id = Some(ops.id.clone());
        let fav = apply_save(&mut file, add, 1).unwrap();
        assert_eq!(fav.folder_id.as_deref(), Some(ops.id.as_str()));
        let mut stray = input(None, "ls", "");
        stray.folder_id = Some("gone".into());
        assert!(apply_save(&mut file, stray, 1).is_err());
        assert_eq!(
            apply_folder_save(&mut file, Some(ops.id.clone()), "运维2")
                .unwrap()
                .name,
            "运维2"
        );
        assert!(apply_folder_delete(&mut file, &ops.id).is_some());
        assert_eq!(file.items[0].folder_id, None);
        assert!(file.folders.is_empty());
    }

    #[test]
    fn old_files_without_folders_still_load() {
        let file: FavoritesFile =
            serde_json::from_str(r#"{"items":[{"id":"a","command":"ls","note":"","createdAt":1,"updatedAt":1}]}"#)
                .unwrap();
        assert_eq!(file.items[0].folder_id, None);
        assert!(file.folders.is_empty());
    }

    #[test]
    fn history_moves_repeats_to_the_end_and_is_capped() {
        let mut file = HistoryFile::default();
        for c in ["ls", "pwd", "ls  ", "", "   "] {
            apply_history(&mut file, c);
        }
        assert_eq!(file.items, ["pwd", "ls"]);
        for i in 0..MAX_HISTORY + 5 {
            apply_history(&mut file, &format!("echo {i}"));
        }
        assert_eq!(file.items.len(), MAX_HISTORY);
        assert_eq!(file.items.last().unwrap(), &format!("echo {}", MAX_HISTORY + 4));
    }

    #[test]
    fn path_history_deduplicates_and_is_capped() {
        let mut file = PathHistoryFile::default();
        for p in ["/home/user", "/tmp", "/home/user", "~", ".", "   "] {
            file.items.retain(|item| item != p.trim());
            let path = p.trim();
            if !path.is_empty() && path != "~" && path != "." {
                file.items.push(path.to_owned());
            }
        }
        assert_eq!(file.items, ["/tmp", "/home/user"]);
        for i in 0..MAX_PATH_HISTORY + 5 {
            let path = format!("/path/{i}");
            file.items.retain(|item| item != &path);
            file.items.push(path);
            let excess = file.items.len().saturating_sub(MAX_PATH_HISTORY);
            file.items.drain(..excess);
        }
        assert_eq!(file.items.len(), MAX_PATH_HISTORY);
        assert_eq!(file.items.last().unwrap(), &format!("/path/{}", MAX_PATH_HISTORY + 4));
    }

    #[test]
    fn summaries_are_short_single_lines() {
        assert_eq!(summary("ls -la"), "ls -la");
        assert_eq!(summary("\ncd /srv\nmake"), "cd /srv…");
        assert_eq!(summary(&"a".repeat(50)).chars().count(), 41);
    }
}
