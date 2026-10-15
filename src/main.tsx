import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/cormorant-garamond/latin-500-italic.css'
import '@fontsource/cormorant-garamond/latin-400-italic.css'
import '@fontsource/manrope/latin-400.css'
import '@fontsource/manrope/latin-500.css'
import '@fontsource/manrope/latin-600.css'
import './styles.css'
import { App } from './App'

// Linen grain: sparse dark specks, generated once (as in the mood board).
{
  const c = Object.assign(document.createElement('canvas'), { width: 220, height: 220 }), x = c.getContext('2d')!
  const im = x.createImageData(220, 220)
  for (let i = 0; i < im.data.length; i += 4) {
    const v = Math.random()
    im.data[i] = im.data[i + 1] = im.data[i + 2] = 90
    im.data[i + 3] = v < 0.5 ? v * 26 : 0
  }
  x.putImageData(im, 0, 0)
  document.documentElement.style.setProperty('--noise', `url(${c.toDataURL()})`)
}

// Dev only (stripped from builds): a declarative stand-in for the Tauri bridge, for UI previews (see devMock.ts).
if (import.meta.env.DEV && sessionStorage.getItem('baduk.devMock')) await import('./devMock')

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
