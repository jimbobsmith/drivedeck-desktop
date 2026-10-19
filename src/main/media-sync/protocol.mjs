// DriveDeck media protocol derived from platform cc0b45a; fork code under AGPL-3.0-or-later.
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto'
export const LIMITS = Object.freeze({ bodyBytes: 16384, ciphertextBytes: 4096, page: 100, records: 5000, changes: 10000, receipts: 20000, devices: 16, owners: 8, outbox: 1000, requestsPerMinute: 120, rateBuckets: 1024 })
export class SyncError extends Error { constructor (code, status = 400) { super(code); this.code = code; this.status = status } }
export const fail = (code, status = 400) => { throw new SyncError(code, status) }
export const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
export const integer = value => Number.isSafeInteger(value) && value >= 0
export function exact (value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length || !fields.every(k => Object.hasOwn(value, k))) fail('invalid_shape')
}
export function b64 (value, minimum, maximum = minimum) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) fail('invalid_encoding')
  const bytes = Buffer.from(value, 'base64url')
  if (bytes.toString('base64url') !== value || bytes.length < minimum || bytes.length > maximum) fail('invalid_encoding')
  return bytes
}
export function validateMutation (value) {
  const fields = ['protocol', 'serverGeneration', 'mutationId', 'recordKey', 'kind', 'operation', 'baseRevision', 'resumeEpoch', 'envelope']
  exact(value, fields)
  if (value.protocol !== 1) fail('unsupported_protocol', 409)
  if (!uuid(value.serverGeneration) || !uuid(value.mutationId) || typeof value.recordKey !== 'string' || !/^[a-f0-9]{64}$/.test(value.recordKey) || !['subscription', 'resume'].includes(value.kind) || !['put', 'remove'].includes(value.operation) || !integer(value.baseRevision) || !integer(value.resumeEpoch)) fail('invalid_mutation')
  exact(value.envelope, ['keyEpoch', 'nonce', 'ciphertext'])
  if (value.envelope.keyEpoch !== 1) fail('unsupported_key_epoch', 409)
  b64(value.envelope.nonce, 12); b64(value.envelope.ciphertext, 16, LIMITS.ciphertextBytes)
  return Object.fromEntries(fields.map(k => [k, k === 'envelope' ? { keyEpoch: 1, nonce: value.envelope.nonce, ciphertext: value.envelope.ciphertext } : value[k]]))
}
export function validatePayload (value) {
  const fields = value?.kind === 'subscription' ? ['kind', 'provider', 'id'] : ['kind', 'provider', 'id', 'positionMs', 'sessionId', 'checkpointSeq']
  exact(value, fields)
  if (value.provider !== 'youtube' || !['subscription', 'resume'].includes(value.kind) || typeof value.id !== 'string' || !(value.kind === 'subscription' ? /^UC[A-Za-z0-9_-]{22}$/ : /^[A-Za-z0-9_-]{11}$/).test(value.id)) fail('invalid_identity')
  if (value.kind === 'resume' && (!integer(value.positionMs) || value.positionMs > 31536000000 || !uuid(value.sessionId) || !integer(value.checkpointSeq))) fail('invalid_checkpoint')
  return value
}
export function generateKeys () { return { encryptionKey: randomBytes(32).toString('base64url'), routingKey: randomBytes(32).toString('base64url') } }
export function recordKey (keys, payload) {
  validatePayload(payload)
  return createHmac('sha256', b64(keys.routingKey, 32)).update(JSON.stringify(['youtube', payload.kind, payload.id])).digest('hex')
}
function aad (ownerId, m) { return Buffer.from(JSON.stringify(['drivedeck.media-sync.v1', ownerId, m.mutationId, m.recordKey, m.kind, m.operation, m.baseRevision, m.resumeEpoch, m.envelope.keyEpoch])) }
export function seal (keys, ownerId, header, payload) {
  if (!uuid(ownerId)) fail('invalid_owner')
  validatePayload(payload)
  const m = { protocol: 1, ...header, recordKey: recordKey(keys, payload), kind: payload.kind, envelope: { keyEpoch: 1, nonce: randomBytes(12).toString('base64url') } }
  const cipher = createCipheriv('aes-256-gcm', b64(keys.encryptionKey, 32), b64(m.envelope.nonce, 12), { authTagLength: 16 })
  cipher.setAAD(aad(ownerId, m))
  m.envelope.ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64url')
  return validateMutation(m)
}
export function open (keys, ownerId, value) {
  const m = validateMutation(value); const bytes = b64(m.envelope.ciphertext, 16, LIMITS.ciphertextBytes)
  let payload
  try {
    const decipher = createDecipheriv('aes-256-gcm', b64(keys.encryptionKey, 32), b64(m.envelope.nonce, 12), { authTagLength: 16 })
    decipher.setAAD(aad(ownerId, m)); decipher.setAuthTag(bytes.subarray(-16))
    payload = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(0, -16)), decipher.final()]).toString('utf8'))
  } catch { fail('authentication_failed') }
  validatePayload(payload)
  if (payload.kind !== m.kind || recordKey(keys, payload) !== m.recordKey) fail('identity_binding_failed')
  return payload
}
export { randomUUID }
