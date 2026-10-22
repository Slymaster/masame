// The opponent's hand model (Workshop option): downloaded once by Rust from the project's GitHub, size and SHA-256
// pinned there (src-tauri/src/hand.rs). The webview never passes a URL.
import { call } from './katago'

/** Whether the model is on disk with the pinned size (the hash is checked when it is read). */
export const handInstalled = () => call<boolean>('hand_state')
/** Downloads and verifies the model; resolves at once if a verified copy is already there. */
export const installHand = () => call<void>('hand_install')
/** The verified glTF bytes, sent raw over IPC. */
export const handBytes = () => call<ArrayBuffer>('hand_bytes')
