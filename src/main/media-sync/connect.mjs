// Sign in with a one-time code from the service portal (drivedeck-platform #53).
// Must stay byte-compatible with services/media-sync/web/connect.mjs there; the
// shared vector in tools/fork/fixtures/connect-code-vector.json pins it.
import { createCipheriv, createDecipheriv, hkdfSync } from 'node:crypto'
import { b64, exact, fail, SyncError } from './protocol.mjs'
import { validateConfig } from './enrollment.mjs'
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const WRAP_AAD = 'media-sync.v1/key-wrap/1'
// Accepts canonical Crockford base32 only: case, spaces and dashes are ignored, I/L read as 1 and O as 0.
export function parseCode (text) {
  const clean = String(text).toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0')
  if (clean.length !== 26 || [...clean].some(c => !ALPHABET.includes(c))) fail('invalid_code')
  let bits = 0; let value = 0; const out = []
  for (const c of clean) {
    value = ((value << 5) | ALPHABET.indexOf(c)) & 0xfff; bits += 5
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8 }
  }
  if (value & ((1 << bits) - 1)) fail('invalid_code')
  return Buffer.from(out)
}
const hkdf = (secret, info, length) => Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), `media-sync.v1/${info}`, length))
export function deriveConnect (code) {
  const secret = parseCode(code)
  return { lookupId: hkdf(secret, 'lookup', 16).toString('base64url'), proof: hkdf(secret, 'proof', 32).toString('base64url'), wrapKey: hkdf(secret, 'wrap', 32) }
}
export function unwrapKeys (wrapped, wrapKey) {
  const bytes = b64(wrapped, 12 + 16 + 1, 512)
  let text
  try {
    const decipher = createDecipheriv('aes-256-gcm', wrapKey, bytes.subarray(0, 12), { authTagLength: 16 })
    decipher.setAAD(Buffer.from(WRAP_AAD)); decipher.setAuthTag(bytes.subarray(-16))
    text = Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString('utf8')
  } catch { fail('authentication_failed') }
  const keys = JSON.parse(text)
  exact(keys, ['encryptionKey', 'routingKey']); b64(keys.encryptionKey, 32); b64(keys.routingKey, 32)
  return keys
}
// Test helper mirroring the portal: wraps keys for a code with a chosen nonce.
export function wrapKeys (keys, wrapKey, nonce) {
  const cipher = createCipheriv('aes-256-gcm', wrapKey, nonce, { authTagLength: 16 }); cipher.setAAD(Buffer.from(WRAP_AAD))
  const plain = JSON.stringify({ encryptionKey: keys.encryptionKey, routingKey: keys.routingKey })
  return Buffer.concat([nonce, cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64url')
}
export function serviceOrigin (text) {
  let url
  try { url = new URL(String(text).trim()) } catch { fail('invalid_service_address') }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') fail('invalid_service_address')
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)))) fail('verified_transport_required')
  return url.origin
}
export function validLabel (label) {
  if (typeof label !== 'string' || !label.trim() || Buffer.byteLength(label) > 96 || [...label].some(c => c.charCodeAt(0) < 32)) fail('invalid_device_label')
  return label.trim()
}
// Redeems the code and returns the same value a protected enrollment file holds.
export async function connectWithCode ({ address, code, label }) {
  const origin = serviceOrigin(address); const name = validLabel(label); const { lookupId, proof, wrapKey } = deriveConnect(code)
  let response
  try {
    response = await fetch(origin + '/v1/connect', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'content-type': 'application/json', 'x-dd-sync-version': '1' }, body: JSON.stringify({ protocol: 1, lookupId, proof, label: name }) })
  } catch { fail('offline') }
  let value
  try { value = await response.json() } catch { fail('invalid_response') }
  if (response.status !== 200) fail(typeof value?.code === 'string' && /^[a-z_]{1,64}$/.test(value.code) ? value.code : 'connect_failed', response.status)
  try {
    exact(value, ['protocol', 'credential', 'wrappedKeys'])
    return validateConfig({ schema: 'drivedeck.media-sync.enrollment.v1', endpoint: origin + '/', credential: value.credential, keys: unwrapKeys(value.wrappedKeys, wrapKey) })
  } catch (error) { throw error instanceof SyncError && error.code === 'authentication_failed' ? error : new SyncError('invalid_response') }
}
