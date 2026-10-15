package com.sylvainrey.masame

import android.graphics.Color
import android.os.Bundle
import android.view.View
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // the bars show the linen beneath them (no white scrim behind the 3-button bar), with dark icons: the page is always light
    val linen = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
    enableEdgeToEdge(linen, linen)
    super.onCreate(savedInstanceState)
    // Android 15 draws apps under the status and navigation bars, and its WebView (before Chrome ~136) reports no
    // env(safe-area-inset-*) for them: the page is kept inside the bars (and above the keyboard) here instead, on
    // the linen window background, and the insets are consumed so the page never adds them a second time.
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { v, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
      WindowInsetsCompat.CONSUMED
    }
  }
}
