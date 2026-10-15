// Offline joseki generator (Node 22+, runs the TypeScript directly):
//   node scripts/joseki/generate.ts [--family joseki|fuseki] [--quick] [--judge net] [--human net] [--katago bin] [--visits 800] [--budget 3000] [--out file] [--date YYYY-MM-DD]
// --family fuseki builds the opening tree from the empty board (fuseki.v1.json; --budget = its node cap, default 2500).
// Every engine answer is appended to scripts/joseki/.cache/[fuseki-]<judge>-<visits>.jsonl: a killed run resumes where it
// stopped, and a rerun on the same cache rewrites the same bytes.

import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { ROOTS } from '../../src/joseki/sym.ts'
import { cached, FUSEKI, fuseki, generate } from './tree.ts'
import type { Resp } from './tree.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const models = join(homedir(), 'Library/Application Support/com.sylvainrey.masame/models')
const { values: a } = parseArgs({ options: {
  family: { type: 'string' }, quick: { type: 'boolean' }, judge: { type: 'string' }, human: { type: 'string' }, katago: { type: 'string' },
  visits: { type: 'string' }, budget: { type: 'string' }, out: { type: 'string' }, date: { type: 'string' },
} })
const family = a.family ?? 'joseki', isFuseki = family === 'fuseki'
if (!['joseki', 'fuseki'].includes(family)) throw new Error(`unknown --family ${family}`)
const kata = existsSync(models) ? readdirSync(models).filter(f => f.startsWith('kata1-')).map(f => join(models, f)).sort((x, y) => statSync(x).size - statSync(y).size) : []
// --quick: the 4-4 root on the lightest network, about a minute; it writes the fixture the app's tests use
const judge = a.judge ?? (a.quick ? kata[0] : kata.at(-1))
const human = a.human ?? join(models, 'b18c384nbt-humanv0.bin.gz')
const katago = a.katago ?? join(root, 'src-tauri/binaries/katago-aarch64-apple-darwin')
const visits = +(a.visits ?? (a.quick ? 64 : 800)), budget = +(a.budget ?? (a.quick ? 160 : isFuseki ? FUSEKI.cap : 3000))
const out = a.out ?? join(root, a.quick ? `src/joseki/${isFuseki ? 'fuseki-' : ''}fixture.json` : `public/assets/joseki/${family}.v1.json`)
for (const f of [judge, human, katago]) if (!f || !existsSync(f)) throw new Error(`missing ${f ?? 'judge network'} (see --judge, --human, --katago)`)

const cacheDir = join(root, 'scripts/joseki/.cache')
mkdirSync(cacheDir, { recursive: true })
const cacheFile = join(cacheDir, `${isFuseki ? 'fuseki-' : ''}${basename(judge!).replace(/\.bin\.gz$/, '')}-${visits}.jsonl`)
const store = new Map<string, Resp>()
if (existsSync(cacheFile)) for (const line of readFileSync(cacheFile, 'utf8').split('\n')) {
  try { const { k, r } = JSON.parse(line); store.set(k, r) } catch { /* a line cut short by a kill */ }
}
const salt = `${basename(judge!)}|${basename(human)}`
const key = (q: object) => createHash('sha1').update(salt + JSON.stringify(q)).digest('hex')
const judgeQueries = (q: Record<string, unknown>) => (q.maxVisits as number) > 1
const cachedJudges = [...store.values()].filter(r => !r.humanPolicy).length
console.log(`judge ${basename(judge!)} · ${visits} visits · budget ${budget} · cache ${store.size} answers (${cachedJudges} judge)`)

const kg = spawn(katago, ['analysis', '-config', join(root, 'src-tauri/resources/katago/analysis.cfg'), '-model', judge!, '-human-model', human,
  '-override-config', 'reportAnalysisWinratesAs=BLACK,numAnalysisThreads=4,nnCacheSizePowerOfTwo=22'],
{ stdio: ['pipe', 'pipe', openSync(join(cacheDir, 'katago.log'), 'a')] })
const pending = new Map<string, { resolve: (r: Resp) => void; reject: (e: Error) => void }>()
let nextId = 0
kg.on('exit', code => { for (const p of pending.values()) p.reject(new Error(`KataGo exited (${code}), see ${cacheDir}/katago.log`)) })
createInterface({ input: kg.stdout! }).on('line', line => {
  const r = JSON.parse(line)
  if (r.warning) return console.warn('KataGo:', r.warning, r.field ?? '')
  const p = pending.get(r.id)
  if (!p) return console.warn('KataGo:', line.slice(0, 200))
  pending.delete(r.id)
  if (r.error) return p.reject(new Error(`KataGo: ${r.error}`))
  // keep what the tree reads: the cache stays ~10x smaller
  const infos = (r.moveInfos ?? []).map(({ move, visits, scoreLead, order, pv, isSymmetryOf }: Resp['moveInfos'][number]) => ({ move, visits, scoreLead, order, pv, isSymmetryOf }))
  p.resolve(r.humanPolicy ? { rootInfo: { scoreLead: r.rootInfo.scoreLead }, moveInfos: [], humanPolicy: r.humanPolicy }
    : { rootInfo: { scoreLead: r.rootInfo.scoreLead }, moveInfos: infos, policy: r.policy })
})

const start = Date.now()
let fresh = 0, done = cachedJudges
const engine = (q: Record<string, unknown>) => new Promise<Resp>((resolve, reject) => {
  const id = String(nextId++)
  pending.set(id, { resolve, reject })
  kg.stdin!.write(JSON.stringify({ id, ...q }) + '\n')
}).then(r => {
  if (judgeQueries(q)) {
    fresh++; done++
    const rate = fresh * visits / ((Date.now() - start) / 1000), eta = (budget - done) * visits / rate
    if (fresh % 10 === 0) console.log(`judge ${done}/${budget} · ${rate.toFixed(0)} visits/s · ETA ${Math.floor(eta / 3600)}h${String(Math.round(eta / 60) % 60).padStart(2, '0')}`)
  }
  return r
})

const katagoVersion = execFileSync(katago, ['version'], { encoding: 'utf8' }).split('\n')[0].trim()
// build.date = the day of the newest engine answer, so the same cache always gives the same bytes
const day = (t: Date) => t.toISOString().slice(0, 10)
const build: Record<string, unknown> = {}
const ask = cached(engine, key, store, (k, r) => { appendFileSync(cacheFile, JSON.stringify({ k, r }) + '\n'); if (!a.date) build.date = day(new Date()) })
Object.assign(build, {
  date: a.date ?? day(existsSync(cacheFile) ? statSync(cacheFile).mtime : new Date()), katago: katagoVersion, judge: basename(judge!), human: basename(human), visits, komi: 6.5,
  context: isFuseki
    ? `The empty 19x19 board, Black first; Japanese rules. Positions are stored up to the board's 8 symmetries. A move is kept when a shipped profile plays it at least 4 % of the time, or when it is KataGo's best; up to ${FUSEKI.maxPly} moves and ${budget} positions, the most likely lines first.`
    : 'B D16, W D4, B Q4, then White\'s root stone in the top-right; Black to play; Japanese rules. Positions are stored up to the mirror (x,y)->(18-y,18-x). '
      + 'Bias: both neighbouring corners belong to the approaching side, and ladders toward the lower left meet White\'s D4.',
})
const json = isFuseki ? await fuseki({ visits, komi: 6.5, cap: budget, build }, ask)
  : await generate({ roots: a.quick ? ROOTS.slice(0, 1) : ROOTS, visits, budget, komi: 6.5, build }, ask)
kg.stdin!.end()
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, json)
console.log(`${out}: ${(json.length / 1024).toFixed(0)} KB, ${json.split('\n').length - 3} nodes, ${fresh} fresh judge queries in ${((Date.now() - start) / 60000).toFixed(1)} min`)
