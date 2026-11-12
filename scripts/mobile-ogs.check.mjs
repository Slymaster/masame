import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callbackConfig, associations, validateAssociations } from './mobile-ogs.mjs'

test('rejects missing, fake and broad mobile redirects', () => {
  for (const url of [undefined, '', 'http://auth.masame.app/callback', 'https://example.com/callback', 'https://localhost/callback',
    'https://auth.example.com/callback', 'https://auth.example.org/callback', 'https://auth.example.net/callback', 'https://auth.localhost/callback', 'https://auth.local/callback',
    'https://127.0.0.1/callback', 'https://auth.invalid/callback', 'https://auth.masame.app/', 'https://auth.masame.app/callback?x=1',
    'https://user@auth.masame.app/callback', 'https://auth.masame.app:123/callback', 'https://auth.masame.app/callback#x', 'https://*.masame.app/callback', 'https://auth.masame.app:443/callback'])
    assert.throws(() => callbackConfig(url))
})
test('generates exact-path associations, requiring real certificate syntax', () => {
  // Pure fixture only: this test neither claims nor contacts this hostname.
  const c = callbackConfig('https://auth.masame.app/oauth/ogs/callback')
  const fingerprint = Array(32).fill('AB').join(':')
  assert.throws(() => associations(c, []))
  const files = associations(c, [fingerprint])
  assert.equal(c.path, '/oauth/ogs/callback')
  assert.doesNotThrow(() => validateAssociations(c, files, files.assetlinks, files.apple))
  assert.throws(() => validateAssociations(c, files, [], files.apple))
  assert.throws(() => validateAssociations(c, files, files.assetlinks, { applinks: { details: [] } }))
})
