//! Language packs: list, import and remove. Packs are JSON files under `<data>/Language`, one per
//! language, keyed by English text (Cheat Engine .lng style). Built-in packs ship in the binary;
//! imported packs override or extend them. English text is always the fallback for missing keys.

use std::path::PathBuf;

use gxs_core::i18n::{self, LanguageInfo};
use gxs_core::{Error, Result, tr};
use tauri::State;

use crate::AppState;

const MAX_PACK_BYTES: u64 = 4 * 1024 * 1024;
const MAX_PACK_CODE: usize = 32;

/// A BCP 47-ish pack code: lowercase letters, digits and hyphens, with at least one letter.
fn valid_pack_code(code: &str) -> bool {
    code.len() <= MAX_PACK_CODE
        && code != crate::settings::Language::AUTO
        && code.chars().any(|c| c.is_ascii_alphabetic())
        && code.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Every language the user can pick: the built-in three plus imported packs.
#[tauri::command]
pub fn languages_list(state: State<'_, AppState>) -> Vec<LanguageInfo> {
    i18n::languages(Some(&state.config_dir))
}

/// Import a language pack from a file the user picked. Validates it, copies it into
/// `<data>/Language/<code>.json` and returns the language it adds or overrides.
#[tauri::command]
pub async fn language_pack_import(state: State<'_, AppState>, path: String) -> Result<LanguageInfo> {
    let src = PathBuf::from(&path);
    let bytes = std::fs::read(&src).map_err(Error::Io)?;
    if bytes.len() as u64 > MAX_PACK_BYTES {
        return Err(Error::Invalid(tr!(
            "语言包不能超过 4 MB",
            "A language pack can't be larger than 4 MB",
            "تىل بوغچىسىنىڭ چوڭلۇقى 4 MB دىن ئېشىپ كەتمەسلىكى كېرەك"
        )));
    }
    let pack: i18n::Pack = serde_json::from_slice(&bytes).map_err(|error| {
        Error::Invalid(tr!(
            "语言包格式无效：{error}",
            "The language pack is not valid JSON: {error}",
            "تىل بوغچىسىنىڭ فورماتى ئىناۋەتسىز: {error}"
        ))
    })?;
    let code = i18n::normalize_code(&pack.meta.code);
    if !valid_pack_code(&code) {
        return Err(Error::Invalid(tr!(
            "语言包代码无效：{code}",
            "The language pack code is not valid: {code}",
            "تىل بوغچىسىنىڭ كودى ئىناۋەتسىز: {code}"
        )));
    }
    if pack.translations.is_empty() {
        return Err(Error::Invalid(tr!(
            "语言包里没有翻译条目",
            "The language pack has no translations",
            "تىل بوغچىسىدا تەرجىمە تۈرلىرى يوق"
        )));
    }
    if pack.meta.native_name.is_empty() || pack.meta.name.is_empty() {
        return Err(Error::Invalid(tr!(
            "语言包缺少名称",
            "The language pack is missing its name",
            "تىل بوغچىسىدا ئىسىم كەم"
        )));
    }
    let dir = state.config_dir.join("Language");
    std::fs::create_dir_all(&dir).map_err(Error::Io)?;
    let target = dir.join(format!("{code}.json"));
    std::fs::copy(&src, &target).map_err(Error::Io)?;
    Ok(LanguageInfo {
        code,
        name: pack.meta.name,
        native_name: pack.meta.native_name,
        rtl: pack.meta.rtl,
        builtin: false,
        version: pack.meta.version,
    })
}

/// Remove an imported language pack. Built-in languages cannot be removed.
#[tauri::command]
pub async fn language_pack_remove(state: State<'_, AppState>, code: String) -> Result<()> {
    let code = i18n::normalize_code(&code);
    if i18n::Lang::from_code(&code).is_some() {
        return Err(Error::Unsupported(tr!(
            "内置语言不能删除",
            "Built-in languages cannot be removed",
            "ئۆزىگە مەنسۇپ تىللارنى ئۆچۈرگىلى بولمايدۇ"
        )));
    }
    // The language on screen cannot be removed under itself: the interface would be
    // stranded mid-session. Switch first, then remove.
    let active = state.settings.get().await.ui.language.resolve_code();
    if active == code {
        return Err(Error::Invalid(tr!(
            "「{name}」正在使用中，请先切换到其他语言再删除",
            "“{name}” is in use; switch to another language first",
            "«{name}» ئىشلىتىلىۋاتىدۇ، ئالدى بىلەن باشقا تىلغا ئالماشتۇرۇڭ",
            name = code
        )));
    }
    let path = state.config_dir.join("Language").join(format!("{code}.json"));
    if path.exists() {
        std::fs::remove_file(&path).map_err(Error::Io)?;
    }
    Ok(())
}

