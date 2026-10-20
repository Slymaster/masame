# Gallery thumbnails

The tiles in Settings › Workshop show `public/assets/gallery/<kind>-<id>.webp`, 320×200, about 10 to 17 KB each:
`decor-<décor>.webp` for each entry of `src/board3d/decors.ts`, `stones-<set>.webp` for each entry of
`src/board3d/stoneSets.ts`. The Ambiances row reuses its décor's picture, the Auto tile the décor Auto picks right now.
A missing file is fine: the tile shows its neutral placeholder.

They are rendered with the demo bench (`board3d.html`), at device pixel ratio 2 (640×400), then scaled down.

## 1. A receiver for the PNGs

Save as `recv.py` outside the repo and run `python3 -I recv.py /path/to/out` (it listens on 127.0.0.1:8799):

```python
import base64, http.server, os, sys
OUT = sys.argv[1]
class H(http.server.BaseHTTPRequestHandler):
    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*'); self.send_header('Access-Control-Allow-Headers', '*')
    def do_OPTIONS(self): self.send_response(204); self.cors(); self.end_headers()
    def do_POST(self):
        name = os.path.basename(self.path.strip('/'))
        body = self.rfile.read(int(self.headers['Content-Length'])).decode()
        open(os.path.join(OUT, name), 'wb').write(base64.b64decode(body.split(',', 1)[1]))
        self.send_response(200); self.cors(); self.end_headers()
http.server.HTTPServer(('127.0.0.1', 8799), H).serve_forever()
```

## 2. Render

`pnpm dev`, open `http://localhost:1420/board3d.html` on a Retina screen (`demo.ts` already exposes `view` on `window`),
click *Setup position* (19×19), then run in the page's console:

```js
const post = async name => fetch('http://127.0.0.1:8799/' + name, { method: 'POST', body: document.getElementById('c').toDataURL('image/png') })
const wait = ms => new Promise(r => setTimeout(r, ms))
// décors: Contemplation, home view, afternoon light
for (const decor of ['atelier', 'washitsu', 'lanterne', 'clair']) {
  view.setOptions({ camera: 'contemplation', time: 'afternoon', decor }); await wait(4000)
  view.debug.orbit(null); view.resize(320, 200); await wait(1500)
  view.debug.sample([[1, 1]]); await post(`decor-${decor}.png`) // sample() renders settled; read the canvas in the same task
}
// stones: a macro of the lower-left group, Atelier, afternoon
for (const stones of ['japonaise']) {
  view.setOptions({ decor: 'atelier', stones }); await wait(4000)
  view.resize(320, 200, { left: 0, top: 0, width: 320, height: 200 }); await wait(1200)
  view.debug.closeUp([-100, 145], 190, 50); await post(`stones-${stones}.png`); view.debug.closeUp(null)
}
```

## 3. Convert

```sh
for f in out/*.png; do cwebp -quiet -resize 320 200 -q 88 -m 6 "$f" -o public/assets/gallery/$(basename "${f%.png}").webp; done
```

(`ffmpeg -i in.png -vf scale=320:200 -quality 88 out.webp` works too.) Keep each file near 15 KB.
