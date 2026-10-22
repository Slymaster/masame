// The opponent's hand (a Workshop option, desktop only): a small glTF model built into the app. Phones never show it, so
// their builds leave it out.

static HAND: &[u8] = include_bytes!("../assets/hand/hand-v1.glb");

/// The model as raw bytes (an ArrayBuffer in the webview), not a JSON array.
#[tauri::command]
pub fn hand_bytes() -> tauri::ipc::Response { tauri::ipc::Response::new(HAND.to_vec()) }

#[cfg(test)]
mod tests {
    use sha2::{Digest, Sha256};

    #[test]
    fn the_built_in_model_is_hand_v1() {
        let sha: String = Sha256::digest(super::HAND).iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!((super::HAND.len(), sha.as_str()), (529_740, "07b0e19ca7b264bcfa504131b38ff82ef1cd05a7984cf0157784604ce705de96"));
    }
}
