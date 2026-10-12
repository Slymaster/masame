#!/usr/bin/env node
// Generate src-tauri/resources/licenses/THIRD_PARTY_LICENSES.txt (Rust crates + bundled JS packages, with their
// licence texts) and copy LICENSE + THIRD_PARTY_NOTICES.md next to it, so release bundles ship them.
// Run from anywhere: `node scripts/third-party-licenses.mjs` (tauri's beforeBuildCommand does it on every build).
// Needs cargo, rustc and pnpm on PATH; exits non-zero if a package has no resolvable licence text.
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'src-tauri', 'resources', 'licenses')
const run = (cmd) => execSync(cmd, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'inherit'] })
const fail = (msg) => { console.error(`third-party-licenses: ${msg}`); process.exit(1) }
const norm = (s) => s.replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/\s+$/, '') + '\n'
const LICENCE_FILE = /^(licen[cs]e|copying|notice|unlicense)/i
const ids = (expr) => (expr ?? '').split(/[\s()\/]+/).filter((t) => t && !['AND', 'OR', 'WITH'].includes(t))

// --- Rust: every resolved package for the host platform except our own crate.
// shortcut: also lists build-deps and proc-macros that never ship; harmless over-inclusion, filter by dep kind if size matters.
const host = run('rustc -vV').match(/^host: (.+)$/m)?.[1] ?? fail('cannot read host triple from rustc -vV')
const meta = JSON.parse(run(`cargo metadata --format-version 1 --locked --filter-platform ${host} --manifest-path "${join('src-tauri', 'Cargo.toml')}"`))
const resolved = new Set(meta.resolve.nodes.map((n) => n.id))
const own = new Set(meta.workspace_members)
const rust = meta.packages.filter((p) => resolved.has(p.id) && !own.has(p.id)).map((p) => ({
  name: p.name, version: p.version, license: p.license, repository: p.repository, authors: p.authors,
  dir: dirname(p.manifest_path), extra: p.license_file,
}))

// --- JS: production deps as pnpm resolves them.
// iconv-lite and jschardet are aliased to an empty module in vite.config.ts, so they (and safer-buffer, iconv-lite's only user) are not bundled.
const NOT_BUNDLED = new Set(['iconv-lite', 'jschardet', 'safer-buffer'])
const js = []
for (const [license, pkgs] of Object.entries(JSON.parse(run('pnpm licenses list --prod --json')))) {
  for (const p of pkgs) {
    if (NOT_BUNDLED.has(p.name)) continue
    p.versions.forEach((version, i) => {
      const dir = p.paths[i]
      const pj = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      const repo = typeof pj.repository === 'string' ? pj.repository : pj.repository?.url
      js.push({ name: p.name, version, license, repository: repo ?? p.homepage, authors: [p.author].filter(Boolean), dir })
    })
  }
}

// --- Licence files and canonical text per SPDX id (from LICENSE-<ID> files, or single-id packages with one file).
const byOrder = (a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en', { numeric: true })
const all = [...rust, ...js].sort(byOrder)
const allIds = new Set(all.flatMap((p) => ids(p.license)))
const idFor = (file) => {
  const tag = file.replace(/^licen[cs]e[-_.]?/i, '').replace(/\.(txt|md)$/i, '').toUpperCase()
  if (tag === 'APACHE' || tag === 'APACHE2') return 'Apache-2.0'
  return [...allIds].find((id) => id.toUpperCase() === tag)
}
const canonical = new Map() // SPDX id -> hash
for (const p of all) {
  const names = readdirSync(p.dir).filter((f) => LICENCE_FILE.test(f) && statSync(join(p.dir, f)).isFile())
  if (p.extra && !names.includes(p.extra)) names.push(p.extra)
  p.files = names.sort().map((f) => {
    const text = norm(readFileSync(join(p.dir, f), 'utf8'))
    return { name: f, text, hash: createHash('sha256').update(text).digest('hex').slice(0, 12) }
  })
}
for (const p of all) for (const f of p.files) { const id = idFor(f.name); if (id && !canonical.has(id)) canonical.set(id, f.hash) }
for (const p of all) {
  const pids = ids(p.license)
  if (pids.length === 1 && p.files.length === 1 && !canonical.has(pids[0])) canonical.set(pids[0], p.files[0].hash)
}

// --- Render.
const printed = new Set()
const noFile = []
const section = (title, pkgs) => [`\n==== ${title} (${pkgs.length}) ====\n`, ...pkgs.map((p) => {
  const lines = [`\n---- ${p.name} ${p.version}`, `Licence: ${p.license ?? 'not declared'}`, `Repository: ${p.repository ?? 'not declared'}`]
  if (!p.files.length) {
    noFile.push(p)
    lines.push(`Authors: ${p.authors?.join(', ') || 'not declared'}`, 'No licence file in the package; standard texts:')
    for (const id of ids(p.license)) {
      const h = canonical.get(id) ?? fail(`${p.name} ${p.version} (${p.license}) ships no licence file and no ${id} text was found elsewhere`)
      lines.push(`  ${id}: see text [${h}]`)
    }
  }
  for (const f of p.files) {
    if (printed.has(f.hash)) lines.push(`[${f.name}] same as text [${f.hash}] above`)
    else { printed.add(f.hash); lines.push(`[${f.name}] text [${f.hash}]:`, '', f.text) }
  }
  return lines.join('\n')
})].join('\n')

// A no-file package may point to a text first printed later in the sort order; that is fine ("see", not "above").
const body = [
  'Third-party software in Masame',
  'Generated by scripts/third-party-licenses.mjs from Cargo.lock and pnpm-lock.yaml. Licence texts of the',
  'Go engine and its libraries are in the katago/, macos-engine/, windows-engine/ and linux-engine/ folders next to',
  'this file.',
  section('Rust crates', rust.sort(byOrder)),
  section('JavaScript packages and fonts', js.sort(byOrder)),
].join('\n')

for (const id of new Set(noFile.flatMap((p) => ids(p.license)))) if (!printed.has(canonical.get(id))) fail(`canonical ${id} text was never printed`)
for (const name of ['tauri', 'three', 'react', '@fontsource/manrope']) if (!all.some((p) => p.name === name)) fail(`self-check: ${name} missing`)

writeFileSync(join(OUT, 'THIRD_PARTY_LICENSES.txt'), body + '\n')
copyFileSync(join(ROOT, 'LICENSE'), join(OUT, 'LICENSE'))
copyFileSync(join(ROOT, 'THIRD_PARTY_NOTICES.md'), join(OUT, 'THIRD_PARTY_NOTICES.md'))
const size = statSync(join(OUT, 'THIRD_PARTY_LICENSES.txt')).size
console.log(`third-party-licenses: ${rust.length} crates, ${js.length} JS packages, ${noFile.length} without licence file, ${printed.size} distinct texts, ${(size / 1024).toFixed(0)} KiB`)
