use keyring::{Entry, Error};
use tauri::async_runtime::spawn_blocking;

const SERVICE: &str = "com.lectern.app";

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, Error> + Send + 'static,
) -> Result<T, String> {
    spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn secret_get(key: String) -> Result<Option<String>, String> {
    blocking(move || match Entry::new(SERVICE, &key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(Error::NoEntry) => Ok(None),
        Err(e) => Err(e),
    })
    .await
}

#[tauri::command]
pub async fn secret_set(key: String, value: String) -> Result<(), String> {
    blocking(move || Entry::new(SERVICE, &key)?.set_password(&value)).await
}

#[tauri::command]
pub async fn secret_delete(key: String) -> Result<(), String> {
    blocking(
        move || match Entry::new(SERVICE, &key)?.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(e) => Err(e),
        },
    )
    .await
}
