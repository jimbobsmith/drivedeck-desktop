import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto'
import { b64, exact, fail, uuid } from './protocol.mjs'
const SCHEMA = 'drivedeck.media-sync.enrollment.v1'
export function validateConfig (c) {
  exact(c, ['schema', 'endpoint', 'credential', 'keys'])
  if (c.schema !== SCHEMA) fail('invalid_enrollment')
  const u = new URL(c.endpoint)
  if (u.username || u.password || u.search || u.hash || u.pathname !== '/' || !(u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(u.hostname)))) fail('verified_transport_required')
  exact(c.credential, ['protocol', 'ownerId', 'deviceId', 'token', 'serverGeneration'])
  const a = c.credential
  if (a.protocol !== 1 || !uuid(a.ownerId) || !uuid(a.deviceId) || !uuid(a.serverGeneration)) fail('invalid_enrollment')
  b64(a.token, 32); exact(c.keys, ['encryptionKey', 'routingKey']); b64(c.keys.encryptionKey, 32); b64(c.keys.routingKey, 32)
  return c
}
function password (value) { if (typeof value !== 'string' || !/^[\x20-\x7e]{12,128}$/.test(value)) fail('invalid_passphrase'); return value }
export function protect (value, passphrase) {
  const salt = randomBytes(16); const nonce = randomBytes(12); const key = pbkdf2Sync(password(passphrase), salt, 600000, 32, 'sha256')
  try {
    const cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(Buffer.from(SCHEMA))
    return { schema: SCHEMA, kdf: 'PBKDF2-SHA256', iterations: 600000, salt: salt.toString('base64url'), nonce: nonce.toString('base64url'), ciphertext: Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]).toString('base64url') }
  } finally { key.fill(0) }
}
export function unprotect (value, passphrase) {
  exact(value, ['schema', 'kdf', 'iterations', 'salt', 'nonce', 'ciphertext'])
  if (value.schema !== SCHEMA || value.kdf !== 'PBKDF2-SHA256' || value.iterations !== 600000) fail('invalid_enrollment')
  const bytes = b64(value.ciphertext, 16, 8192); const key = pbkdf2Sync(password(passphrase), b64(value.salt, 16), 600000, 32, 'sha256')
  try {
    const cipher = createDecipheriv('aes-256-gcm', key, b64(value.nonce, 12)); cipher.setAAD(Buffer.from(SCHEMA)); cipher.setAuthTag(bytes.subarray(-16))
    return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(0, -16)), cipher.final()]).toString('utf8'))
  } catch { fail('enrollment_decryption_failed') } finally { key.fill(0) }
}
