// Development-only UI fixture. All native calls are in memory; it never opens the real library or OGS.
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { GamesSheet } from '../../src/GamesSheet'
import * as library from '../../src/library'
import { setLang } from '../../src/i18n'
import '../../src/styles.css'

setLang('fr')
let fail = false
let entries: library.Entry[] = [{ id: 'ogs-42', date: 1794400000000, source: 'ogs', size: 19, komi: 6.5, handicap: 0,
  black: { name: 'Moi', rank: '5k' }, white: { name: 'Adversaire de test', rank: '6k' }, me: 1, result: 'B+R', ogsId: 42, review: { moments: 3 } }]
Object.assign(window, { __TAURI_INTERNALS__: { invoke: async (cmd: string, args: Record<string, unknown>) => {
  if (cmd === 'library_list') return entries
  if (cmd === 'library_delete') {
    if (fail) throw { code: 'library_io', detail: 'Erreur disque simulée' }
    entries = entries.filter(e => e.id !== args.id)
    return
  }
  if (cmd === 'plugin:dialog|message') return window.confirm(String(args.message)) ? 'Supprimer' : 'Annuler'
  throw new Error(`Unexpected fixture command: ${cmd}`)
} } })

function Fixture() {
  const [status, setStatus] = useState('Goban affiché : ogs-42'), [open, setOpen] = useState(true)
  return <><main style={{ padding: 24 }}><h1>Test isolé de suppression</h1><p>{status}</p>
    <p>Exercices conservés : 3. Récompenses conservées : 8.</p>
    <label><input type="checkbox" onChange={e => { fail = e.target.checked }} /> Simuler une erreur disque</label>
    <button onClick={() => setOpen(true)}>Mes parties</button></main>
    {open && <GamesSheet opener={null} onClose={() => setOpen(false)} onOpen={e => setStatus(`Ouverture : ${e.id}`)}
      onDelete={async e => { await library.remove(e.id); setStatus('Goban vide') }} onResume={() => {}} onImport={() => {}} onImportOgs={() => {}} />}
  </>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
