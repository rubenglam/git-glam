use aes_gcm::{Aes256Gcm, KeyInit, aead::Aead};
use base64::Engine;
use std::{fs, path::Path};
#[cfg(windows)]
fn unprotect(bytes: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{CRYPT_INTEGER_BLOB, CryptUnprotectData},
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes
            .len()
            .try_into()
            .map_err(|_| "Token demasiado grande")?,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    // DPAPI allocates output with LocalAlloc; copy it before releasing the buffer.
    let ok = unsafe {
        CryptUnprotectData(
            &input,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            1,
            &mut output,
        )
    };
    if ok == 0 {
        return Err("Windows no pudo descifrar las credenciales anteriores".into());
    }
    let data =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe { LocalFree(output.pbData as _) };
    Ok(data)
}
#[cfg(not(windows))]
fn unprotect(_bytes: &[u8]) -> Result<Vec<u8>, String> {
    Err("La importación de credenciales requiere Windows".into())
}
fn decode(stored: &str, local: &Path) -> Result<String, String> {
    if let Some(value) = stored.strip_prefix("raw:") {
        return Ok(value.into());
    }
    let encoded = stored
        .strip_prefix("enc:")
        .ok_or("Formato de token anterior no válido")?;
    let encrypted = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| "Token anterior no válido")?;
    let clear = if encrypted.starts_with(b"v10") {
        if encrypted.len() < 31 {
            return Err("Token anterior incompleto".into());
        }
        let state: serde_json::Value = serde_json::from_slice(
            &fs::read(local).map_err(|e| format!("No se pudo leer la clave anterior: {e}"))?,
        )
        .map_err(|_| "Clave anterior no válida")?;
        let key = state["os_crypt"]["encrypted_key"]
            .as_str()
            .ok_or("Clave anterior no disponible")?;
        let key = base64::engine::general_purpose::STANDARD
            .decode(key)
            .map_err(|_| "Clave anterior no válida")?;
        let wrapped = key
            .strip_prefix(b"DPAPI")
            .ok_or("Formato de clave anterior no compatible")?;
        let key = unprotect(wrapped)?;
        let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| "Clave anterior no válida")?;
        cipher
            .decrypt(
                aes_gcm::Nonce::from_slice(&encrypted[3..15]),
                &encrypted[15..],
            )
            .map_err(|_| "No se pudo descifrar el token anterior")?
    } else {
        unprotect(&encrypted)?
    };
    String::from_utf8(clear).map_err(|_| "Token anterior no válido".into())
}
fn migrate(source: &Path, target: &Path) -> Result<(), String> {
    let marker = target.join(".electron-tokens-migrated");
    if marker.exists() {
        return Ok(());
    }
    let token_file = source.join("tokens.json");
    if !token_file.is_file() {
        return Ok(());
    }
    let tokens: serde_json::Value =
        serde_json::from_slice(&fs::read(token_file).map_err(|e| e.to_string())?)
            .map_err(|e| format!("No se pudieron leer los tokens anteriores: {e}"))?;
    let map = tokens
        .as_object()
        .ok_or("Archivo de tokens anterior no válido")?;
    for (path, value) in map {
        let value = value.as_str().ok_or("Token anterior no válido")?;
        let key = crate::tokens::key_path(Path::new(path));
        let entry = keyring::Entry::new("Git Glam", &key).map_err(|e| e.to_string())?;
        match entry.get_password() {
            Ok(_) => continue,
            Err(keyring::Error::NoEntry) => (),
            Err(e) => {
                return Err(format!(
                    "No se pudo consultar el almacén de credenciales: {e}"
                ));
            }
        };
        let token = decode(value, &source.join("Local State"))?;
        if !token.is_empty() {
            entry
                .set_password(&token)
                .map_err(|e| format!("No se pudo importar una credencial: {e}"))?;
        }
    }
    fs::create_dir_all(target).map_err(|e| e.to_string())?;
    let temp = tempfile::NamedTempFile::new_in(target).map_err(|e| e.to_string())?;
    match temp.persist_noclobber(marker) {
        Ok(_) => Ok(()),
        Err(e) if e.error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
pub fn import_existing(target: &Path) -> Result<(), String> {
    if target.join(".electron-tokens-migrated").exists() {
        return Ok(());
    }
    let Some(roaming) = std::env::var_os("APPDATA") else {
        return Ok(());
    };
    for name in ["git-graph-desktop", "Git Glam"] {
        let source = Path::new(&roaming).join(name);
        if source.join("tokens.json").is_file() {
            return migrate(&source, target);
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn handles_plaintext_and_invalid_tokens() {
        assert_eq!(decode("raw:test", Path::new("unused")).unwrap(), "test");
        assert!(decode("enc:not base64", Path::new("unused")).is_err());
        assert!(decode("unknown", Path::new("unused")).is_err());
    }
}
#[cfg(all(test, windows))]
mod windows_tests {
    use super::*;
    #[test]
    fn decrypts_chromium_aes_gcm_token() {
        use windows_sys::Win32::{
            Foundation::LocalFree,
            Security::Cryptography::{CRYPT_INTEGER_BLOB, CryptProtectData},
        };
        let key = [7u8; 32];
        let input = CRYPT_INTEGER_BLOB {
            cbData: 32,
            pbData: key.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };
        let ok = unsafe {
            CryptProtectData(
                &input,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                1,
                &mut output,
            )
        };
        assert_ne!(ok, 0);
        let encrypted_key =
            unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
        unsafe { LocalFree(output.pbData as _) };
        let mut wrapped = b"DPAPI".to_vec();
        wrapped.extend(encrypted_key);
        let local = tempfile::NamedTempFile::new().unwrap();
        fs::write(local.path(),serde_json::to_vec(&serde_json::json!({"os_crypt":{"encrypted_key":base64::engine::general_purpose::STANDARD.encode(wrapped)}})).unwrap()).unwrap();
        let nonce = [9u8; 12];
        let cipher = Aes256Gcm::new_from_slice(&key).unwrap();
        let encrypted = cipher
            .encrypt(
                aes_gcm::Nonce::from_slice(&nonce),
                b"fixture-token".as_ref(),
            )
            .unwrap();
        let mut payload = b"v10".to_vec();
        payload.extend(nonce);
        payload.extend(encrypted);
        let encoded = format!(
            "enc:{}",
            base64::engine::general_purpose::STANDARD.encode(payload)
        );
        assert_eq!(decode(&encoded, local.path()).unwrap(), "fixture-token");
    }
}
#[cfg(all(test, windows))]
mod credential_tests {
    use super::*;
    #[test]
    fn imports_to_windows_credential_manager_without_overwriting() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("legacy");
        let target = tmp.path().join("tauri");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&target).unwrap();
        let repo = tmp.path().join("repo-common");
        fs::create_dir(&repo).unwrap();
        let path = repo.to_string_lossy().to_string();
        let key = crate::tokens::key_path(&repo);
        let entry = keyring::Entry::new("Git Glam", &key).unwrap();
        let _ = entry.delete_credential();
        fs::write(
            source.join("tokens.json"),
            serde_json::to_vec(&serde_json::json!({path:"raw:fixture-only"})).unwrap(),
        )
        .unwrap();
        let result = migrate(&source, &target);
        let read = entry.get_password();
        let deleted = entry.delete_credential();
        assert!(result.is_ok());
        assert_eq!(read.unwrap(), "fixture-only");
        assert!(deleted.is_ok());
        assert!(target.join(".electron-tokens-migrated").exists());
    }
}
