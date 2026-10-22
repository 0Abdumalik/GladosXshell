//! Small JSON documents in the config directory: command favorites, command history, app log.

use std::path::PathBuf;

use gxs_core::i18n::ltr;
use gxs_core::{Error, fsutil, tr};
use serde::Serialize;
use serde::de::DeserializeOwned;
use tokio::sync::Mutex;

use crate::Result;

pub(crate) struct JsonStore<T> {
    path: PathBuf,
    data: Mutex<T>,
    /// A precious file that could not be parsed: refuse reads and writes so it is never overwritten.
    broken: Option<String>,
}

impl<T: Serialize + DeserializeOwned + Default + Clone> JsonStore<T> {
    /// Returns the store and, if the file was unusable, why. Disposable stores start over empty.
    pub async fn open(path: PathBuf, precious: bool) -> (Self, Option<String>) {
        let name = ltr(&path.file_name().unwrap_or_default().to_string_lossy());
        let (data, problem) = match fsutil::read_optional(&path).await {
            Ok(None) => (T::default(), None),
            Ok(Some(bytes)) => match serde_json::from_slice(&bytes) {
                Ok(data) => (data, None),
                Err(e) => {
                    let e = ltr(&e.to_string());
                    let text = tr!(
                        "{name} 无法解析：{e}",
                        "{name} could not be parsed: {e}",
                        "{name} نى تەھلىل قىلغىلى بولمىدى: {e}"
                    );
                    (T::default(), Some(text))
                }
            },
            Err(e) => {
                let e = ltr(&e.to_string());
                let text = tr!(
                    "{name} 无法读取：{e}",
                    "{name} could not be read: {e}",
                    "{name} نى ئوقۇغىلى بولمىدى: {e}"
                );
                (T::default(), Some(text))
            }
        };
        let broken = if precious {
            problem.as_ref().map(|p| {
                tr!(
                    "{p}。文件已保留，修复或移走后重启软件。",
                    "{p}. The file was kept; fix or move it, then restart the app.",
                    "{p}. ھۆججەت ساقلاپ قېلىندى، ئۇنى ئوڭشاپ ياكى يۆتكىۋېتىپ ئاندىن يۇمشاق دېتالنى قايتا قوزغىتىڭ."
                )
            })
        } else {
            None
        };
        (
            Self {
                path,
                data: Mutex::new(data),
                broken,
            },
            problem,
        )
    }

    fn check(&self) -> Result<()> {
        match &self.broken {
            Some(message) => Err(Error::Data(message.clone())),
            None => Ok(()),
        }
    }

    pub async fn get(&self) -> Result<T> {
        self.check()?;
        Ok(self.data.lock().await.clone())
    }

    /// Applies `change` to a copy, writes it, and only then makes it current.
    pub async fn update<R>(&self, change: impl FnOnce(&mut T) -> Result<R>) -> Result<R> {
        self.check()?;
        let mut data = self.data.lock().await;
        let mut next = data.clone();
        let out = change(&mut next)?;
        let body = serde_json::to_vec_pretty(&next).map_err(|e| Error::Data(e.to_string()))?;
        fsutil::write_atomic(&self.path, body).await?;
        *data = next;
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn broken_precious_file_is_left_alone() {
        let dir = tempfile_dir();
        let path = dir.join("favorites.json");
        std::fs::write(&path, b"{not json").unwrap();
        let (store, problem) = JsonStore::<Vec<String>>::open(path.clone(), true).await;
        assert!(problem.is_some());
        assert!(store.get().await.is_err());
        let push = |v: &mut Vec<String>| {
            v.push("x".into());
            Ok(())
        };
        assert!(store.update(push).await.is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"{not json");

        let (store, problem) = JsonStore::<Vec<String>>::open(path.clone(), false).await;
        assert!(problem.is_some());
        store.update(push).await.unwrap();
        assert_eq!(store.get().await.unwrap(), vec!["x".to_string()]);
        std::fs::remove_dir_all(dir).unwrap();
    }

    fn tempfile_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gxs-store-{}-{}", std::process::id(), fsutil::now_secs()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }
}
