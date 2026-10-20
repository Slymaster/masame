// Dev demo for Board3D (board3d.html): exercises the app contract without the app.
import '@fontsource/cormorant-garamond/latin-500-italic.css'
import '@fontsource/manrope/latin-400.css'
import '@fontsource/manrope/latin-500.css'
import GoBoard, { type Sign, type Vertex } from '@sabaki/go-board'
import { Board3D, type Board3DOptions, type Board3DState } from './Board3D'
import { DECORS } from './decors'
import { arm, run, selftestOn } from './selftest'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const SETUP: Vertex[] = [[15, 3], [3, 15], [15, 16], [3, 3], [2, 5], [2, 9], [5, 16], [5, 15], [6, 15], [4, 15], [6, 16], [16, 2], [15, 2], [16, 3], [16, 4], [17, 4], [17, 5], [15, 1], [14, 1], [16, 1], [9, 3], [16, 13], [16, 10], [9, 16]]

let N = 19
let history: GoBoard[] = [GoBoard.fromDimensions(N)]
let toPlay: Sign = 1
let last: Vertex | null = null
const board = () => history[history.length - 1]

/** Demo stand-in for KataGo's ownership: Gaussian stone influence, squashed. Row-major from the top-left, +1 = Black. */
function fakeOwnership(b: GoBoard): number[] {
  const st: [number, number, number][] = [], k = 1 / (2 * 1.8 * 1.8), out: number[] = []
  b.signMap.forEach((r, y) => r.forEach((c, x) => { if (c) st.push([x, y, c]) }))
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let s = 0
    for (const [sx, sy, c] of st) s += c * Math.exp(-((x - sx) ** 2 + (y - sy) ** 2) * k)
    out.push(Math.tanh(s * 1.4))
  }
  return out
}

function play(v: Vertex): boolean {
  const b = board()
  if (state().counting) return false
  try {
    const nb = b.makeMove(toPlay, v, { preventSuicide: true, preventOverwrite: true, preventKo: true })
    history.push(nb); last = v; toPlay = -toPlay as Sign
    render()
    if ($<HTMLInputElement>('ai').checked && toPlay === -1) aiMove()
    return true
  } catch { return false }
}

let thinking = false
function aiMove() {
  thinking = true; view.setThinking(true); render()
  setTimeout(() => {
    thinking = false; view.setThinking(false)
    const b = board(), empty: Vertex[] = []
    b.signMap.forEach((r, y) => r.forEach((c, x) => { if (!c) empty.push([x, y]) }))
    for (let i = 0; i < 40 && empty.length; i++) {
      const v = empty.splice(Math.floor(Math.random() * empty.length), 1)[0]
      try {
        history.push(b.makeMove(-1, v, { preventSuicide: true, preventOverwrite: true, preventKo: true }))
        last = v; toPlay = 1
        view.drop(v, -1) // like App.tsx: drop() first, then the state update
        break
      } catch { /* try another */ }
    }
    render()
  }, 1600 + Math.random() * 1500)
}

function state(): Board3DState {
  const b = board(), ombre = $<HTMLInputElement>('ombre').checked, counting = $<HTMLInputElement>('counting').checked
  const own = ombre || counting ? fakeOwnership(b) : null
  return {
    signMap: b.signMap, last, toPlay, coords: $<HTMLInputElement>('coords').checked, sound: $<HTMLInputElement>('sound').checked,
    interactive: !thinking, ownership: counting ? null : own,
    counting: counting && own ? {
      dead: b.signMap.map((r, y) => r.map((c, x) => !!c && Math.sign(own[y * N + x]) === -c && Math.abs(own[y * N + x]) > 0.5)),
      territory: b.signMap.map((r, y) => r.map((c, x) => {
        const o = own[y * N + x], dead = !!c && Math.sign(o) === -c && Math.abs(o) > 0.5
        return (!c || dead) && Math.abs(o) > 0.6 ? (Math.sign(o) as Sign) : 0
      })),
    } : null,
    captures: { black: b.getCaptures(1), white: b.getCaptures(-1) },
  }
}

const view = new Board3D($<HTMLCanvasElement>('c'), play, {
  onFallback: r => { $('msg').textContent = `Fallback requested: ${r} (the app would switch to the 2D BoardView)` },
})
Object.assign(window, { view })
const ro = new ResizeObserver(([e]) => view.resize(e.contentRect.width, e.contentRect.height))
ro.observe($('wrap'))
if (selftestOn) arm(view, $<HTMLCanvasElement>('c'), ro)

function render() {
  view.update(state())
  for (const [g, v] of [['size', String(N)], ['camera', view.options.camera], ['time', view.options.time], ['decor', view.options.decor]] as const)
    for (const b of $(g).querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === v))
  const b = board()
  $('info').textContent = `${toPlay === 1 ? 'Black' : 'White'} to play${thinking ? ' (thinking…)' : ''}\ncaptures B ${b.getCaptures(1)} · W ${b.getCaptures(-1)}\nquality ${JSON.stringify(view.debug.quality)}`
}

function reset(n: number, setup: boolean) {
  N = n; history = [GoBoard.fromDimensions(N)]; toPlay = 1; last = null
  if (setup) for (const [x, y] of SETUP) {
    const v: Vertex = [Math.round(x * (N - 1) / 18), Math.round(y * (N - 1) / 18)]
    try { history.push(board().makeMove(toPlay, v, { preventOverwrite: true, preventSuicide: true })); last = v; toPlay = -toPlay as Sign } catch { /* skip */ }
  }
  render()
}

$('size').addEventListener('click', e => { const v = (e.target as HTMLElement).dataset.v; if (v) reset(+v, true) })
$('camera').addEventListener('click', e => { const v = (e.target as HTMLElement).dataset.v; if (v) { view.setOptions({ camera: v as Board3DOptions['camera'] }); render() } })
$('time').addEventListener('click', e => { const v = (e.target as HTMLElement).dataset.v; if (v) { view.setOptions({ time: v as Board3DOptions['time'] }); render() } })
// décor picker (built here: the page's markup stays as it was)
const dec = Object.assign(document.createElement('div'), { className: 'seg', id: 'decor' })
dec.innerHTML = DECORS.map(d => `<button data-v="${d}">${d}</button>`).join('')
$('time').after(dec)
dec.addEventListener('click', e => { const v = (e.target as HTMLElement).dataset.v; if (v) { view.setOptions({ decor: v as Board3DOptions['decor'] }); render() } })
$('hc').addEventListener('change', e => view.setOptions({ highContrast: (e.target as HTMLInputElement).checked }))
for (const id of ['ombre', 'counting', 'coords', 'sound']) $(id).addEventListener('change', render)
$('ai').addEventListener('change', () => { if ($<HTMLInputElement>('ai').checked && toPlay === -1) aiMove() })
$('setup').addEventListener('click', () => reset(N, true))
$('clear').addEventListener('click', () => reset(N, false))
$('undo').addEventListener('click', () => { if (history.length > 1) { history.pop(); toPlay = -toPlay as Sign; last = null; render() } })
$('bench').addEventListener('click', () => { $('info').textContent += `\n${JSON.stringify(view.debug.bench(60))}` })
window.addEventListener('keydown', e => {
  if (e.key === 'v') { view.setOptions({ camera: view.options.camera === 'study' ? 'contemplation' : 'study' }); render() }
  if (e.key === 't') { $<HTMLInputElement>('ombre').click() }
})
reset(19, true)
if (selftestOn) void run(view)
