use super::*;
impl NativeStore {
    fn access(&self, operation: &str, value: &str) -> Res<Option<String>> {
        use jni::{jni_sig, jni_str, objects::{JClass, JObject, JString}};
        let ctx = ndk_context::android_context();
        let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) };
        let response = vm.attach_current_thread(|env| -> jni::errors::Result<String> {
            // ndk-context owns a global reference. Borrow it, then create our own local reference for this frame.
            let raw_context = ctx.context().cast();
            let borrowed = unsafe { env.as_cast_raw::<JObject>(&raw_context)? };
            let context = env.new_local_ref(&*borrowed)?;
            // A Rust runtime thread has no app classloader in FindClass. Resolve through the Context's loader.
            let loader = env.call_method(&context, jni_str!("getClassLoader"), jni_sig!("()Ljava/lang/ClassLoader;"), &[])?.l()?;
            let name = env.new_string("com.sylvainrey.masame.OgsVault")?;
            let class = env.call_method(&loader, jni_str!("loadClass"), jni_sig!("(Ljava/lang/String;)Ljava/lang/Class;"), &[(&name).into()])?.l()?;
            let class = env.cast_local::<JClass>(class)?;
            let op = env.new_string(operation)?;
            let data = env.new_string(value)?;
            let result = env.call_static_method(&class, jni_str!("access"),
                jni_sig!("(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;"),
                &[(&context).into(), (&op).into(), (&data).into()])?.l()?;
            env.cast_local::<JString>(result)?.try_to_string(env)
        }).map_err(|_| Failure::new("ogs_storage"))?;
        let result: serde_json::Value = serde_json::from_str(&response).map_err(|_| Failure::new("ogs_storage"))?;
        match result["error"].as_str() {
            Some("invalidated") => Err(Failure::new("ogs_storage_invalidated")),
            Some(_) => Err(Failure::new("ogs_storage")),
            None => Ok(result["value"].as_str().map(String::from)),
        }
    }
}
impl SecureStore for NativeStore {
    fn read(&self) -> Res<Option<String>> { self.access("read", "") }
    fn write(&self, value: &str) -> Res<()> { self.access("write", value).map(|_| ()) }
    fn delete(&self) -> Res<()> { self.access("delete", "").map(|_| ()) }
}
