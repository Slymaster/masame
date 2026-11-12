// Offline preparation and read-only validation. Nothing here registers OAuth, publishes files or changes DNS.
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function callbackConfig(value) {
  let url
  try { url = new URL(value) } catch { throw new Error('MASAME_OGS_CALLBACK_URL must be the exact registered HTTPS callback') }
  if (value !== url.href || !url.hostname.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) || url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash
    || !url.hostname.includes('.') || /(^|\.)(localhost|local|example\.(com|org|net)|invalid|test|example)$/.test(url.hostname)
    || /^\[|^[\d.]+$/.test(url.hostname) || !/^\/[a-zA-Z0-9/_-]+$/.test(url.pathname) || url.pathname.endsWith('/'))
    throw new Error('The OGS callback needs a real HTTPS host and a fixed path, without query, fragment, credentials or port')
  return { url: url.href, host: url.hostname, path: url.pathname }
}
export function associations(callback, fingerprints, appID = 'CN9TKA949C.com.sylvainrey.masame') {
  if (!fingerprints.length || fingerprints.some(f => !/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f)))
    throw new Error('MASAME_OGS_ANDROID_CERT_SHA256 must contain comma-separated signing certificate SHA256 fingerprints')
  return {
    assetlinks: [{ relation: ['delegate_permission/common.handle_all_urls'], target: {
      namespace: 'android_app', package_name: 'com.sylvainrey.masame', sha256_cert_fingerprints: fingerprints,
    } }],
    apple: { applinks: { details: [{ appIDs: [appID], components: [{ '/': callback.path }] }] } },
  }
}
export function validateAssociations(callback, expected, assetlinks, apple) {
  const android = assetlinks.find(a => a.relation?.includes('delegate_permission/common.handle_all_urls')
    && a.target?.namespace === 'android_app' && a.target?.package_name === 'com.sylvainrey.masame')
  if (!expected.assetlinks[0].target.sha256_cert_fingerprints.every(f => android?.target?.sha256_cert_fingerprints?.includes(f)))
    throw new Error('Hosted assetlinks.json does not authorize every configured signing certificate')
  if (!apple.applinks?.details?.some(d => d.appIDs?.includes('CN9TKA949C.com.sylvainrey.masame')
    && d.components?.some(c => c['/'] === callback.path && !c.exclude)))
    throw new Error('Hosted apple-app-site-association does not authorize the exact Masame callback')
}
async function main() {
  const command = process.argv[2] ?? 'check'
  const c = callbackConfig(process.env.MASAME_OGS_CALLBACK_URL)
  const fingerprints = (process.env.MASAME_OGS_ANDROID_CERT_SHA256 ?? '').split(',').map(f => f.trim().toUpperCase()).filter(Boolean)
  const files = associations(c, fingerprints)
  if (process.env.MASAME_OGS_OAUTH_REGISTERED !== '1') throw new Error('Register this exact callback on the existing public OGS client, then set MASAME_OGS_OAUTH_REGISTERED=1')
  if (command === 'prepare') {
    const dir = resolve('src-tauri/ogs-mobile.generated')
    await mkdir(resolve(dir, '.well-known'), { recursive: true })
    const config = { plugins: { 'deep-link': { mobile: [{ scheme: ['https'], host: c.host, path: [c.path], appLink: true }] } } }
    await writeFile(resolve(dir, 'tauri.conf.json'), JSON.stringify(config, null, 2) + '\n')
    await writeFile(resolve(dir, '.well-known/assetlinks.json'), JSON.stringify(files.assetlinks, null, 2) + '\n')
    await writeFile(resolve(dir, '.well-known/apple-app-site-association'), JSON.stringify(files.apple, null, 2) + '\n')
    // A safe landing page when the OS cannot open Masame. No scripts, analytics, external resources or echoed query.
    await writeFile(resolve(dir, 'callback.html'), '<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Masame</title><p>Return to Masame to finish signing in. If it did not open, cancel and try again.</p>\n')
    console.log('Prepared local OGS configuration and association files. No files were published.')
  } else if (command === 'verify') {
    const read = async path => {
      const r = await fetch(`https://${c.host}/.well-known/${path}`, { redirect: 'error', signal: AbortSignal.timeout(15_000) })
      if (!r.ok || !r.headers.get('content-type')?.includes('application/json')) throw new Error(`Association ${path} must return 200 application/json without redirects`)
      const body = await r.text()
      if (body.length > 128_000) throw new Error('Association response too large')
      return JSON.parse(body)
    }
    const [android, apple] = await Promise.all([read('assetlinks.json'), read('apple-app-site-association')])
    validateAssociations(c, files, android, apple)
    console.log('Verified hosted Android and iOS associations for the configured callback.')
  } else if (command !== 'check') throw new Error('Expected check, prepare or verify')
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e.message); process.exitCode = 1 })
