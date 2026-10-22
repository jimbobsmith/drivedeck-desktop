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
  if (!uuid(value.serverGeneration) || !uuid(value.mutationId) || typeof value.recordKey !== 'string' || !/^[a-f0-9]{64}$/.test(value.recordKey) || !['subscription', 'resume', 'profile', 'profile-member', ...LIBRARY_KINDS].includes(value.kind) || !['put', 'remove'].includes(value.operation) || !integer(value.baseRevision) || !integer(value.resumeEpoch)) fail('invalid_mutation')
  if (value.kind === 'watch-later' && value.operation !== 'put') fail('watch_later_clear_with_empty_list')
  exact(value.envelope, ['keyEpoch', 'nonce', 'ciphertext'])
  if (value.envelope.keyEpoch !== 1) fail('unsupported_key_epoch', 409)
  b64(value.envelope.nonce, 12); b64(value.envelope.ciphertext, 16, LIMITS.ciphertextBytes)
  return Object.fromEntries(fields.map(k => [k, k === 'envelope' ? { keyEpoch: 1, nonce: value.envelope.nonce, ciphertext: value.envelope.ciphertext } : value[k]]))
}
export const LIBRARY_KINDS = Object.freeze(['playlist', 'watch-later', 'history'])
export const isLibrary = kind => LIBRARY_KINDS.includes(kind)
export function validatePayload (value) {
  if (value?.kind === 'profile' || value?.kind === 'profile-member') {
    if (value.kind === 'profile-member') {
      exact(value, ['kind', 'provider', 'version', 'id', 'profileId', 'channelId'])
      if (!uuid(value.profileId) || typeof value.channelId !== 'string' || !/^UC[A-Za-z0-9_-]{22}$/.test(value.channelId) || value.id !== value.profileId + ':' + value.channelId) fail('profile_not_portable')
    } else {
      exact(value, ['kind', 'provider', 'version', 'id', 'name', 'bgColor', 'textColor'])
      if (!uuid(value.id) || typeof value.name !== 'string' || !value.name.trim() || Buffer.byteLength(value.name, 'utf8') > 160 || [...value.name].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || (c.codePointAt(0) >= 0xD800 && c.codePointAt(0) <= 0xDFFF)) || ![value.bgColor, value.textColor].every(c => typeof c === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c))) fail('profile_not_portable')
    }
    if (value.version !== 3 || value.provider !== 'youtube') fail('unsupported_profiles_version')
    return value
  }
  if (isLibrary(value?.kind)) {
    const fields = value.kind === 'history' ? ['kind', 'provider', 'id', 'version', 'watchedAtMs'] : value.kind === 'playlist' ? ['kind', 'provider', 'id', 'version', 'name', 'items'] : ['kind', 'provider', 'id', 'version', 'items']
    exact(value, fields)
    if (value.version !== 2 || value.provider !== 'youtube') fail('unsupported_library_version')
    if (value.kind === 'history') {
      if (typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(value.id) || !integer(value.watchedAtMs) || value.watchedAtMs < 1 || value.watchedAtMs > 8640000000000000) fail('invalid_history')
    } else {
      if (value.kind === 'playlist' ? !uuid(value.id) : value.id !== 'watch-later') fail('invalid_playlist_identity')
      if (value.kind === 'playlist' && (typeof value.name !== 'string' || !value.name.trim() || Buffer.byteLength(value.name, 'utf8') > 160 || [...value.name].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127))) fail('invalid_playlist_name')
      if (!Array.isArray(value.items) || value.items.length > 200 || value.items.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(id))) fail('playlist_not_portable')
    }
    return value
  }
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
