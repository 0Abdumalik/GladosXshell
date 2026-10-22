use serde::ser::SerializeStruct;

pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),
    #[error("ssh error: {0}")]
    Ssh(#[from] russh::Error),
    #[error("key error: {0}")]
    Key(#[from] russh::keys::Error),
    #[error("sftp error: {0}")]
    Sftp(#[from] russh_sftp::client::error::Error),
    #[error("pty error: {0}")]
    Pty(String),
    #[error("{}", host_key_changed(.host, .presented, .known))]
    HostKeyChanged {
        host: String,
        presented: String,
        known: Vec<String>,
    },
    #[error("host key for {host} ({fingerprint}) is not trusted")]
    HostKeyRejected { host: String, fingerprint: String },
    #[error("host key certificates are not supported")]
    HostKeyCertificate,
    #[error("authentication failed")]
    AuthFailed,
    /// Reaching the server failed before authentication; the message is user-facing.
    #[error("{0}")]
    Connect(String),
    #[error("known hosts store is corrupt: {0}")]
    Store(String),
    #[error("connection store error: {0}")]
    Profile(String),
    #[error("secret storage error: {0}")]
    Secret(String),
    #[error("invalid input: {0}")]
    Invalid(String),
    /// A local data file (favorites, history, log) could not be used; the message is user-facing.
    #[error("{0}")]
    Data(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("permission denied: {0}")]
    PermissionDenied(String),
    #[error("already exists: {0}")]
    Exists(String),
    #[error("not supported: {0}")]
    Unsupported(String),
    #[error("the remote file changed since it was downloaded")]
    RemoteChanged,
    #[error("cancelled")]
    Cancelled,
    /// Saved secrets are behind a master password that has not been entered yet.
    #[error("{}", locked())]
    Locked,
    #[error("session is closed")]
    Closed,
    /// An error about one input, named so the frontend can show it next to that field.
    #[error("{error}")]
    Field { field: &'static str, error: Box<Error> },
}

impl Error {
    pub fn kind(&self) -> &'static str {
        match self {
            Error::Io(_) => "io",
            Error::Ssh(_) => "ssh",
            Error::Key(_) => "key",
            Error::Sftp(_) => "sftp",
            Error::Pty(_) => "pty",
            Error::HostKeyChanged { .. } => "host_key_changed",
            Error::HostKeyRejected { .. } => "host_key_rejected",
            Error::HostKeyCertificate => "host_key_certificate",
            Error::AuthFailed => "auth_failed",
            Error::Connect(_) => "connect",
            Error::Store(_) => "store",
            Error::Profile(_) => "profile",
            Error::Secret(_) => "secret",
            Error::Invalid(_) => "invalid",
            Error::Data(_) => "data",
            Error::NotFound(_) => "not_found",
            Error::PermissionDenied(_) => "permission_denied",
            Error::Exists(_) => "exists",
            Error::Unsupported(_) => "unsupported",
            Error::RemoteChanged => "remote_changed",
            Error::Cancelled => "cancelled",
            Error::Locked => "locked",
            Error::Closed => "closed",
            Error::Field { error, .. } => error.kind(),
        }
    }

    pub(crate) fn invalid(message: impl Into<String>) -> Self {
        Error::Invalid(message.into())
    }

    /// Marks the error as being about the input `field`, such as `"passphrase"`.
    pub fn on(self, field: &'static str) -> Self {
        Error::Field { field, error: Box::new(self) }
    }

    /// The input the error is about, if one was named with [`Error::on`].
    pub fn field(&self) -> Option<&'static str> {
        match self {
            Error::Field { field, .. } => Some(field),
            _ => None,
        }
    }
}

fn host_key_changed(host: &str, presented: &str, known: &[String]) -> String {
    use crate::i18n::ltr;
    let (host, presented) = (ltr(host), ltr(presented));
    let known = crate::i18n::join_list(&known.iter().map(|k| ltr(k)).collect::<Vec<_>>());
    crate::tr!(
        "{host} 现在出示的密钥指纹是 {presented}，记录中的是 {known}",
        "{host} now presents the key fingerprint {presented}, but known hosts has {known}",
        "{host} ھازىر كۆرسەتكەن ئاچقۇچ بارماق ئىزى {presented}، خاتىرىدىكىسى {known}"
    )
}

fn locked() -> String {
    crate::tr!(
        "保存的密码已用主密码锁定，请先输入主密码",
        "Saved passwords are locked with the master password. Enter the master password first",
        "ساقلانغان ئىملار ئاساسىي ئىم بىلەن قۇلۇپلانغان، ئالدى بىلەن ئاساسىي ئىمنى كىرگۈزۈڭ"
    )
}

impl serde::Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("Error", 3)?;
        s.serialize_field("kind", self.kind())?;
        s.serialize_field("message", &self.to_string())?;
        match self.field() {
            Some(field) => s.serialize_field("field", field)?,
            None => s.skip_field("field")?,
        }
        s.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn field_rides_along_with_the_inner_error() {
        let plain = serde_json::to_value(Error::Data("x".into())).unwrap();
        assert_eq!(plain, serde_json::json!({ "kind": "data", "message": "x" }));
        let named = Error::Data("y".into()).on("name");
        assert_eq!((named.kind(), named.to_string().as_str()), ("data", "y"));
        let value = serde_json::to_value(named).unwrap();
        assert_eq!(value, serde_json::json!({ "kind": "data", "message": "y", "field": "name" }));
    }
}
