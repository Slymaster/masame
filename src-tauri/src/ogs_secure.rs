// Native mobile credential backends. Never use the desktop plaintext fallback on a phone.
use crate::failure::{Failure, Res};
use crate::ogs_mobile::SecureStore;

pub struct NativeStore { pub identifier: String }
const ACCOUNT: &str = "ogs.mobile.v1";

#[cfg(target_os = "ios")]
impl SecureStore for NativeStore {
    fn read(&self) -> Res<Option<String>> {
        use security_framework::passwords::{generic_password, PasswordOptions};
        let mut options = PasswordOptions::new_generic_password(&self.identifier, ACCOUNT);
        options.set_access_synchronized(Some(false));
        match generic_password(options) {
            Ok(bytes) => String::from_utf8(bytes).map(Some).map_err(|_| Failure::new("ogs_storage_corrupt")),
            Err(e) if e.code() == -25300 => Ok(None), // errSecItemNotFound
            Err(_) => Err(Failure::new("ogs_storage")), // locked/unavailable is not signed out
        }
    }
    fn write(&self, value: &str) -> Res<()> {
        use security_framework::{access_control::{ProtectionMode, SecAccessControl}, passwords::{set_generic_password_options, PasswordOptions}};
        let mut options = PasswordOptions::new_generic_password(&self.identifier, ACCOUNT);
        options.set_access_synchronized(Some(false));
        // Set protection on creation. Subsequent SecItemUpdate queries use only the identity and preserve it.
        if self.read()?.is_none() {
            options.set_access_control(SecAccessControl::create_with_protection(Some(ProtectionMode::AccessibleWhenUnlockedThisDeviceOnly), 0)
                .map_err(|_| Failure::new("ogs_storage"))?);
        }
        set_generic_password_options(value.as_bytes(), options).map_err(|_| Failure::new("ogs_storage"))
    }
    fn delete(&self) -> Res<()> {
        match security_framework::passwords::delete_generic_password(&self.identifier, ACCOUNT) {
            Ok(()) => Ok(()), Err(e) if e.code() == -25300 => Ok(()), Err(_) => Err(Failure::new("ogs_storage")),
        }
    }
}

#[cfg(target_os = "android")]
#[path = "ogs_secure_android.rs"]
mod android;
