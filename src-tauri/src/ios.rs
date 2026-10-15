// iPhone glue through Foundation: app activity notifications and the iCloud backup flag.

use block2::RcBlock;
use objc2_foundation::{NSNotification, NSNotificationCenter, NSNumber, NSString, NSURLIsExcludedFromBackupKey, NSURL};
use std::path::Path;
use std::ptr::NonNull;
use std::rc::Rc;

/// Calls `f(false)` when the app stops being active (Control Center, a call, the app switcher, the background) and
/// `f(true)` when it is active again. Not tao's Suspended/Resumed: Resumed comes on willEnterForeground only, so a
/// Control Center pull would never resume. UIKit posts these on the main thread.
pub fn on_active_change(f: impl Fn(bool) + 'static) {
    let f = Rc::new(f);
    let center = NSNotificationCenter::defaultCenter();
    for (name, active) in [("UIApplicationWillResignActiveNotification", false), ("UIApplicationDidEnterBackgroundNotification", false),
                           ("UIApplicationDidBecomeActiveNotification", true)] {
        let f = f.clone();
        let block = RcBlock::new(move |_: NonNull<NSNotification>| f(active));
        // The center keeps the observer (and its block) for the app's lifetime.
        let _ = unsafe { center.addObserverForName_object_queue_usingBlock(Some(&NSString::from_str(name)), None, None, &block) };
    }
}

/// Apple's rule for data that can be downloaded again: keep it out of iCloud backups.
pub fn exclude_from_backup(dir: &Path) -> Result<(), String> {
    let url = NSURL::fileURLWithPath(&NSString::from_str(&dir.to_string_lossy()));
    let yes = NSNumber::new_bool(true);
    unsafe { url.setResourceValue_forKey_error(Some(&yes), NSURLIsExcludedFromBackupKey) }.map_err(|e| e.localizedDescription().to_string())
}
