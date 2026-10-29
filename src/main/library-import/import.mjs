// Source-derived, local-only library parsing. No provider requests or account settings.
import { validatePayload, fail } from './shared.mjs'
export const MAX_IMPORT_BYTES = 64 * 1024 * 1024
export const MAX_IMPORT_RECORDS = 5000
const channelId = /^UC[A-Za-z0-9_-]{22}$/
const videoId = /^[A-Za-z0-9_-]{11}$/
const encoder = new TextEncoder()
export const identity = (p) => p.kind + ':' + p.id
const same = (a, b) =>
  JSON.stringify(
    a &&
      Object.fromEntries(
        Object.entries(a).sort(([a], [b]) => a.localeCompare(b))
      )
  ) ===
  JSON.stringify(
    b &&
      Object.fromEntries(
        Object.entries(b).sort(([a], [b]) => a.localeCompare(b))
      )
  )
export async function importId (namespace, value) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      encoder.encode(namespace + '\0' + value)
    )
  )
  bytes[6] = (bytes[6] & 15) | 64
  bytes[8] = (bytes[8] & 63) | 128
  const hex = Array.from(bytes.slice(0, 16), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-')
}
export function canonical (value, type) {
  const pattern = type === 'channel' ? channelId : videoId
  if (typeof value !== 'string') return null
  if (pattern.test(value)) return value
  try {
    const u = new URL(value)
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash) { return null }
    let id
    if (type === 'video' && u.hostname === 'youtu.be' && !u.search) { id = u.pathname.slice(1) }
    if (
      ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(u.hostname)
    ) {
      if (type === 'channel' && !u.search) { id = /^\/channel\/([^/]+)\/?$/.exec(u.pathname)?.[1] } else if (type === 'video') {
        id =
          u.pathname === '/watch' &&
          [...u.searchParams.keys()].every((k) => k === 'v') &&
          u.searchParams.getAll('v').length === 1
            ? u.searchParams.get('v')
            : /^\/(?:shorts|live|embed)\/([^/]+)\/?$/.exec(u.pathname)?.[1]
      }
    }
    return pattern.test(id ?? '') ? id : null
  } catch {
    return null
  }
}
function list (value) {
  if (!Array.isArray(value) || value.length > MAX_IMPORT_RECORDS) { fail('import_collection_limit') }
  return value
}
function name (value) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    encoder.encode(value).length > 160 ||
    [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  ) { fail('invalid_import_name') }
  return value
}
function color (value, fallback) {
  return typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value)
    ? value.toUpperCase()
    : fallback
}
const payload = (kind, id, extra = {}) => ({
  kind,
  provider: 'youtube',
  ...(kind === 'profile' || kind === 'profile-member'
    ? { version: 3 }
    : ['playlist', 'watch-later', 'history'].includes(kind)
        ? { version: 2 }
        : {}),
  id,
  ...extra,
})
function appendRecord (records, index, p) {
  validatePayload(p)
  const key = identity(p); const at = index.get(key)
  if (at !== undefined) {
    const old = records[at]
    if (['profile', 'playlist'].includes(p.kind) && !same(old, p))fail('duplicate_import_identity')
    if (p.kind === 'history' && old.watchedAtMs > p.watchedAtMs) return
    records[at] = p
  } else {
    index.set(key, records.length); records.push(p)
    if (records.length > MAX_IMPORT_RECORDS)fail('import_record_limit')
  }
}
export async function parseExportText (text) {
  if (
    typeof text !== 'string' ||
    encoder.encode(text).length > MAX_IMPORT_BYTES
  ) { fail('import_file_limit') }
  text = text.replace(/^\uFEFF/, '').trim()
  if (!text) return finalize('Empty export', [], { unsupported: 0, ignoredSettings: 0, remotePlaylists: 0 })
  let data
  try {
    data = JSON.parse(text)
  } catch {
    try {
      data = text
        .split(/\r?\n/)
        .filter((s) => s.trim())
        .map((s) => JSON.parse(s))
    } catch {
      fail('invalid_import_json')
    }
  }
  const records = []
  const warnings = { unsupported: 0, ignoredSettings: 0, remotePlaylists: 0 }
  const index = new Map()
  const add = p => appendRecord(records, index, p)
  const subscribe = (value) => {
    const id = canonical(value, 'channel')
    if (id) add(payload('subscription', id))
    else warnings.unsupported++
    return id
  }
  if (
    !Array.isArray(data) &&
    Array.isArray(data?.subscriptions) &&
    !Object.hasOwn(data, '_id')
  ) {
    for (const row of list(data.subscriptions)) {
      if (row?.service_id === 0) subscribe(row.url)
      else warnings.unsupported++
    }
    return finalize('PipePipe / NewPipe subscriptions JSON', records, warnings)
  }
  const rows = list(Array.isArray(data) ? data : [data])
  if (!rows.length) return finalize('Empty export', records, warnings)
  let source
  if (rows.every((r) => r && Array.isArray(r.subscriptions))) {
    source = 'FreeTube subscriptions and categories'
    for (const row of rows) {
      if (typeof row._id !== 'string' || !row._id || row._id.length > 256) { fail('invalid_import_identity') }
      const id = await importId('freetube-profile', row._id)
      if (row._id !== 'allChannels') {
        add(
          payload('profile', id, {
            name: name(row.name),
            bgColor: color(row.bgColor, '#333333'),
            textColor: color(row.textColor, '#FFFFFF'),
          })
        )
      }
      for (const item of list(row.subscriptions)) {
        const channel = subscribe(item?.id)
        if (channel && row._id !== 'allChannels') {
          add(
            payload('profile-member', id + ':' + channel, {
              profileId: id,
              channelId: channel,
            })
          )
        }
      }
    }
  } else if (
    rows.every(
      (r) => r && Array.isArray(r.videos) && typeof r.playlistName === 'string'
    )
  ) {
    source = 'FreeTube playlists and Watch Later'
    for (const row of rows) {
      if (typeof row._id !== 'string' || !row._id || row._id.length > 256) { fail('invalid_import_identity') }
      const items = []
      for (const item of list(row.videos)) {
        const id = canonical(item?.videoId, 'video')
        if (id) items.push(id)
        else warnings.unsupported++
      }
      if (items.length > 200) fail('playlist_not_portable')
      add(
        row._id === 'watchLater'
          ? payload('watch-later', 'watch-later', { items })
          : payload('playlist', await importId('freetube-playlist', row._id), {
              name: name(row.playlistName),
              items,
            })
      )
    }
  } else if (rows.every((r) => r && typeof r.videoId === 'string')) {
    source = 'FreeTube watch history and progress'
    for (const row of rows) {
      const id = canonical(row.videoId, 'video')
      if (!id) {
        warnings.unsupported++
        continue
      }
      if (Number.isSafeInteger(row.timeWatched) && row.timeWatched > 0) { add(payload('history', id, { watchedAtMs: row.timeWatched })) }
      if (
        typeof row.watchProgress === 'number' &&
        Number.isFinite(row.watchProgress) &&
        row.watchProgress >= 0
      ) {
        add(
          payload('resume', id, {
            positionMs: Math.round(row.watchProgress * 1000),
            sessionId: await importId('freetube-resume', id),
            checkpointSeq: 0,
          })
        )
      }
    }
  } else fail('unsupported_import_format')
  return finalize(source, records, warnings)
}
function finalize (source, records, warnings) {
  const map = new Map()
  for (const p of records) {
    const key = identity(p)
    const old = map.get(key)
    if (old && p.kind === 'history' && old.watchedAtMs > p.watchedAtMs) { continue }
    if (old && ['profile', 'playlist'].includes(p.kind) && !same(old, p)) { fail('duplicate_import_identity') }
    map.set(key, p)
  }
  const result = [...map.values()]
  return { source, records: result, warnings, counts: countRecords(result) }
}
export function countRecords (records) {
  const counts = {}
  for (const p of records) counts[p.kind] = (counts[p.kind] ?? 0) + 1
  return counts
}
export function additiveItems (existing, incoming) {
  const remaining = new Map()
  for (const id of existing) remaining.set(id, (remaining.get(id) ?? 0) + 1)
  const result = [...existing]
  for (const id of incoming) {
    const n = remaining.get(id) ?? 0
    if (n) remaining.set(id, n - 1)
    else result.push(id)
  }
  if (result.length > 200) fail('playlist_not_portable')
  return result
}
export function mergeImport (existing, imported) {
  const map = new Map(existing.map((p) => [identity(p), validatePayload(p)]))
  const changes = []
  let retained = 0
  for (const p of finalize('selection', imported, {}).records) {
    validatePayload(p)
    const key = identity(p)
    const old = map.get(key)
    let next = p
    if (old) {
      if (p.kind === 'history') { next = old.watchedAtMs >= p.watchedAtMs ? old : p } else if (p.items) { next = { ...old, items: additiveItems(old.items, p.items) } } else next = old // Existing names, colors, subscriptions and resume positions win.
    }
    if (!same(old, next)) {
      changes.push(next)
      map.set(key, next)
    } else retained++
  }
  if (map.size > MAX_IMPORT_RECORDS) fail('import_record_limit')
  return { changes, retained, counts: countRecords(changes) }
}
export const BACKUP_COLUMNS = Object.freeze({
  subscriptions: ['uid', 'service_id', 'url'],
  feed_group: ['uid', 'name'],
  feed_group_subscription_join: ['group_id', 'subscription_id'],
  streams: ['uid', 'service_id', 'url'],
  stream_history: ['stream_id', 'access_date'],
  stream_state: ['stream_id', 'progress_time'],
  playlists: ['uid', 'name'],
  playlist_stream_join: ['playlist_id', 'stream_id', 'join_index'],
  remote_playlists: ['uid'],
})
export const BACKUP_TABLES = Object.freeze([
  'subscriptions',
  'feed_group',
  'feed_group_subscription_join',
  'streams',
  'stream_history',
  'stream_state',
  'playlists',
  'playlist_stream_join',
  'remote_playlists',
])
export async function parsePipePipeTables (
  tables,
  databaseFingerprint,
  { watchLaterUid = null } = {}
) {
  const records = []
  const warnings = {
    unsupported: 0,
    ignoredSettings: 1,
    remotePlaylists: (tables.remote_playlists ?? []).length,
  }
  const index = new Map()
  const add = p => appendRecord(records, index, p)
  const subscriptions = new Map()
  const streams = new Map()
  for (const row of list(tables.subscriptions ?? [])) {
    const id = row.service_id === 0 ? canonical(row.url, 'channel') : null
    if (id) {
      subscriptions.set(row.uid, id)
      add(payload('subscription', id))
    } else warnings.unsupported++
  }
  for (const row of list(tables.streams ?? [])) {
    const id = row.service_id === 0 ? canonical(row.url, 'video') : null
    if (id) streams.set(row.uid, id)
  }
  const groups = new Map()
  for (const row of list(tables.feed_group ?? [])) {
    const id = await importId(
      'pipepipe-backup-profile',
      databaseFingerprint + ':' + row.uid
    )
    groups.set(row.uid, id)
    add(
      payload('profile', id, {
        name: name(row.name),
        bgColor: color(row.bg_color, '#333333'),
        textColor: color(row.text_color, '#FFFFFF'),
      })
    )
  }
  for (const row of list(tables.feed_group_subscription_join ?? [])) {
    const profileId = groups.get(row.group_id)
    const channelId = subscriptions.get(row.subscription_id)
    if (profileId && channelId) {
      add(
        payload('profile-member', profileId + ':' + channelId, {
          profileId,
          channelId,
        })
      )
    } else warnings.unsupported++
  }
  for (const row of list(tables.stream_history ?? [])) {
    const id = streams.get(row.stream_id)
    if (id && Number.isSafeInteger(row.access_date) && row.access_date > 0) { add(payload('history', id, { watchedAtMs: row.access_date })) } else warnings.unsupported++
  }
  for (const row of list(tables.stream_state ?? [])) {
    const id = streams.get(row.stream_id)
    if (id && Number.isSafeInteger(row.progress_time) && row.progress_time >= 0) {
      add(
        payload('resume', id, {
          positionMs: row.progress_time,
          sessionId: await importId('pipepipe-resume', id),
          checkpointSeq: 0,
        })
      )
    } else warnings.unsupported++
  }
  for (const row of list(tables.playlists ?? [])) {
    const items = Array.from(
      list(
        (tables.playlist_stream_join ?? []).filter(
          (j) => j.playlist_id === row.uid
        )
      )
    )
      .sort((a, b) => a.join_index - b.join_index)
      .flatMap((j) => {
        const id = streams.get(j.stream_id)
        if (!id) {
          warnings.unsupported++
          return []
        }
        return [id]
      })
    if (items.length > 200) fail('playlist_not_portable')
    const watch = row.uid === watchLaterUid
    add(
      watch
        ? payload('watch-later', 'watch-later', { items })
        : payload(
            'playlist',
            await importId(
              'pipepipe-backup-playlist',
              databaseFingerprint + ':' + row.uid
            ),
            { name: name(row.name), items }
          )
    )
  }
  return finalize('PipePipe database backup', records, warnings)
}
