import { fail, randomUUID, recordKey, validatePayload } from './protocol.mjs'
const video = id => ({ videoId: id, title: 'Synced video: ' + id, author: '', authorId: '', published: 0, description: '', viewCount: 0, lengthSeconds: 0, timeWatched: 0, isLive: false, type: 'video' })
export async function librarySnapshot (models, keys, history) {
  const result = {}; const seen = new Set(); const lists = await models.playlists.find()
  for (const row of lists) {
    const watch = row._id === 'watchLater'
    if (!watch && (!row.ddSyncId || row.ddSyncOrigin !== row._id)) { row.ddSyncId = randomUUID(); row.ddSyncOrigin = row._id; await models.playlists.upsert(row) }
    const p = watch ? { kind: 'watch-later', provider: 'youtube', version: 2, id: 'watch-later', items: [] } : { kind: 'playlist', provider: 'youtube', version: 2, id: row.ddSyncId, name: row.playlistName, items: [] }
    p.items = (row.videos ?? []).map(item => item.videoId)
    validatePayload(p); const key = recordKey(keys, p); if (seen.has(key)) fail('duplicate_playlist_identity'); seen.add(key); result[key] = p
  }
  if (!lists.some(row => row._id === 'watchLater')) {
    const p = { kind: 'watch-later', provider: 'youtube', version: 2, id: 'watch-later', items: [] }; result[recordKey(keys, p)] = p
  }
  for (const row of history) {
    if (!Number.isSafeInteger(row.timeWatched) || row.timeWatched < 1 || !/^[A-Za-z0-9_-]{11}$/.test(row.videoId)) continue
    const p = validatePayload({ kind: 'history', provider: 'youtube', version: 2, id: row.videoId, watchedAtMs: row.timeWatched }); result[recordKey(keys, p)] = p
  }
  return result
}
export async function projectLibrary (models, record) {
  const p = validatePayload(record.payload); const remove = record.operation === 'remove'
  if (p.kind === 'history') {
    const old = (await models.history.find()).find(row => row.videoId === p.id)
    if (!old && remove) return
    await models.history.upsert({ ...video(p.id), ...old, timeWatched: remove ? 0 : Math.max(old?.timeWatched ?? 0, p.watchedAtMs) })
    return
  }
  const watch = p.kind === 'watch-later'; const lists = await models.playlists.find()
  const old = lists.find(row => watch ? row._id === 'watchLater' : row.ddSyncId === p.id)
  if (remove) { if (old) await models.playlists.delete(old._id); return }
  const existing = new Map()
  for (const item of old?.videos ?? []) { if (!existing.has(item.videoId)) existing.set(item.videoId, []); existing.get(item.videoId).push(item) }
  const videos = p.items.map(id => existing.get(id)?.shift() ?? { ...video(id), timeAdded: 0, playlistItemId: randomUUID() })
  await models.playlists.upsert({ description: '', protected: false, ...old, _id: old?._id ?? (watch ? 'watchLater' : 'dd-sync-' + p.id), ...(watch ? {} : { ddSyncId: p.id, ddSyncOrigin: old?._id ?? 'dd-sync-' + p.id }), playlistName: watch ? 'Watch Later' : p.name, videos })
}
