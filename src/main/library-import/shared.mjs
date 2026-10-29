export class SyncError extends Error {
  constructor (code, status = 400) {
    super(code)
    this.code = code
    this.status = status
  }
}
export const fail = (code, status = 400) => {
  throw new SyncError(code, status)
}
export const uuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value
  )
export const integer = (value) => Number.isSafeInteger(value) && value >= 0
export function exact (value, fields) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== fields.length ||
    !fields.every((k) => Object.hasOwn(value, k))
  ) { fail('invalid_shape') }
}
export const LIBRARY_KINDS = Object.freeze([
  'playlist',
  'watch-later',
  'history',
])
export const isLibrary = (kind) => LIBRARY_KINDS.includes(kind)
export function validatePayload (value) {
  if (value?.kind === 'profile' || value?.kind === 'profile-member') {
    if (value.kind === 'profile-member') {
      exact(value, ['kind', 'provider', 'version', 'id', 'profileId', 'channelId'])
      if (!uuid(value.profileId) || typeof value.channelId !== 'string' || !/^UC[A-Za-z0-9_-]{22}$/.test(value.channelId) || value.id !== value.profileId + ':' + value.channelId) fail('profile_not_portable')
    } else {
      exact(value, ['kind', 'provider', 'version', 'id', 'name', 'bgColor', 'textColor'])
      if (!uuid(value.id) || typeof value.name !== 'string' || !value.name.trim() || new TextEncoder().encode(value.name).length > 160 || [...value.name].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || (c.codePointAt(0) >= 0xD800 && c.codePointAt(0) <= 0xDFFF)) || ![value.bgColor, value.textColor].every(c => typeof c === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c))) fail('profile_not_portable')
    }
    if (value.version !== 3 || value.provider !== 'youtube') fail('unsupported_profiles_version')
    return value
  }
  if (isLibrary(value?.kind)) {
    const fields =
      value.kind === 'history'
        ? ['kind', 'provider', 'id', 'version', 'watchedAtMs']
        : value.kind === 'playlist'
          ? ['kind', 'provider', 'id', 'version', 'name', 'items']
          : ['kind', 'provider', 'id', 'version', 'items']
    exact(value, fields)
    if (value.version !== 2 || value.provider !== 'youtube') { fail('unsupported_library_version') }
    if (value.kind === 'history') {
      if (
        typeof value.id !== 'string' ||
        !/^[A-Za-z0-9_-]{11}$/.test(value.id) ||
        !integer(value.watchedAtMs) ||
        value.watchedAtMs < 1 ||
        value.watchedAtMs > 8640000000000000
      ) { fail('invalid_history') }
    } else {
      if (
        value.kind === 'playlist' ? !uuid(value.id) : value.id !== 'watch-later'
      ) { fail('invalid_playlist_identity') }
      if (
        value.kind === 'playlist' &&
        (typeof value.name !== 'string' ||
          !value.name.trim() ||
          new TextEncoder().encode(value.name).length > 160 ||
          [...value.name].some(
            (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127
          ))
      ) { fail('invalid_playlist_name') }
      if (
        !Array.isArray(value.items) ||
        value.items.length > 200 ||
        value.items.some(
          (id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(id)
        )
      ) { fail('playlist_not_portable') }
    }
    return value
  }
  const fields =
    value?.kind === 'subscription'
      ? ['kind', 'provider', 'id']
      : ['kind', 'provider', 'id', 'positionMs', 'sessionId', 'checkpointSeq']
  exact(value, fields)
  if (
    value.provider !== 'youtube' ||
    !['subscription', 'resume'].includes(value.kind) ||
    typeof value.id !== 'string' ||
    !(
      value.kind === 'subscription'
        ? /^UC[A-Za-z0-9_-]{22}$/
        : /^[A-Za-z0-9_-]{11}$/
    ).test(value.id)
  ) { fail('invalid_identity') }
  if (
    value.kind === 'resume' &&
    (!integer(value.positionMs) ||
      value.positionMs > 31536000000 ||
      !uuid(value.sessionId) ||
      !integer(value.checkpointSeq))
  ) { fail('invalid_checkpoint') }
  return value
}
