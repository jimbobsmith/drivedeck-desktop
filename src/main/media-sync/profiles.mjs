import { fail, randomUUID, recordKey, validatePayload } from './protocol.mjs'
const channelId = id => typeof id === 'string' && /^UC[A-Za-z0-9_-]{22}$/.test(id)
const member = (profileId, id) => ({ kind: 'profile-member', provider: 'youtube', version: 3, id: profileId + ':' + id, profileId, channelId: id })
export async function profileSnapshot (models, keys) {
  const result = {}; const seen = new Set()
  for (const row of await models.profiles.find()) {
    if (row._id === 'allChannels') continue
    if (!row.ddSyncId || row.ddSyncOrigin !== row._id) { row.ddSyncId = randomUUID(); row.ddSyncOrigin = row._id; await models.profiles.upsert(row) }
    const p = validatePayload({ kind: 'profile', provider: 'youtube', version: 3, id: row.ddSyncId, name: row.name, bgColor: typeof row.bgColor === 'string' ? row.bgColor.toUpperCase() : row.bgColor, textColor: typeof row.textColor === 'string' ? row.textColor.toUpperCase() : row.textColor })
    const key = recordKey(keys, p); if (seen.has(key)) fail('duplicate_profile_identity'); seen.add(key); result[key] = p
    for (const id of new Set([...(row.subscriptions ?? []).filter(c => channelId(c.id)).map(c => c.id), ...(row.ddSyncDeferredSubscriptions ?? [])])) {
      const value = validatePayload(member(p.id, id)); result[recordKey(keys, value)] = value
    }
  }
  return result
}
export async function projectProfile (models, record, state) {
  const p = validatePayload(record.payload)
  const profileId = p.kind === 'profile' ? p.id : p.profileId
  const records = Object.values(state.local)
  const definition = p.kind === 'profile' ? record : records.find(r => r.payload.kind === 'profile' && r.payload.id === profileId)
  // Members cannot recreate a deleted definition, including a concurrent add.
  if (!definition || definition.operation === 'remove') {
    if (p.kind === 'profile' && record.operation === 'remove') {
      const row = (await models.profiles.find()).find(r => r._id !== 'allChannels' && r.ddSyncId === profileId)
      if (row) await models.profiles.delete(row._id)
    }
    return
  }
  const profiles = await models.profiles.find()
  if (!profiles.some(row => row._id === 'allChannels')) await models.profiles.upsert({ _id: 'allChannels', name: 'All Channels', bgColor: '#000000', textColor: '#FFFFFF', subscriptions: [] })
  const old = profiles.find(row => row._id !== 'allChannels' && row.ddSyncId === profileId)
  const metadata = definition.payload
  const channels = new Map((profiles.find(row => row._id === 'allChannels')?.subscriptions ?? []).map(c => [c.id, c]))
  const wanted = new Set([...(old?.subscriptions ?? []).filter(c => channelId(c.id)).map(c => c.id), ...(old?.ddSyncDeferredSubscriptions ?? [])])
  const effective = p.kind === 'profile-member' ? [...records.filter(r => !(r.payload.kind === 'profile-member' && r.payload.id === p.id)), record] : records
  for (const r of effective) {
    if (r.payload.kind !== 'profile-member' || r.payload.profileId !== profileId) continue
    if (r.operation === 'remove') wanted.delete(r.payload.channelId); else wanted.add(r.payload.channelId)
  }
  // Membership never subscribes globally. Deferred membership survives page order
  // and restart until its separate global subscription arrives.
  for (const r of records) if (r.payload.kind === 'subscription' && r.operation === 'remove') wanted.delete(r.payload.id)
  const localOnly = (old?.subscriptions ?? []).filter(c => !channelId(c.id))
  await models.profiles.upsert({ ...old, _id: old?._id ?? 'dd-sync-profile-' + profileId, ddSyncId: profileId, ddSyncOrigin: old?._id ?? 'dd-sync-profile-' + profileId, name: metadata.name, bgColor: metadata.bgColor, textColor: metadata.textColor, subscriptions: [...[...wanted].filter(id => channels.has(id)).map(id => channels.get(id)), ...localOnly], ddSyncDeferredSubscriptions: [...wanted].filter(id => !channels.has(id)).sort() })
}
export async function reconcileProfileSubscription (models, id, remove) {
  for (const row of await models.profiles.find()) {
    if (row._id === 'allChannels') continue
    const deferred = row.ddSyncDeferredSubscriptions ?? []
    if (remove) {
      if (deferred.includes(id)) await models.profiles.upsert({ ...row, ddSyncDeferredSubscriptions: deferred.filter(value => value !== id) })
    } else if (deferred.includes(id)) {
      const main = (await models.profiles.find()).find(p => p._id === 'allChannels')
      const channel = main?.subscriptions.find(c => c.id === id)
      if (channel) await models.profiles.upsert({ ...row, subscriptions: row.subscriptions.some(c => c.id === id) ? row.subscriptions : [...row.subscriptions, channel], ddSyncDeferredSubscriptions: deferred.filter(value => value !== id) })
    }
  }
}
