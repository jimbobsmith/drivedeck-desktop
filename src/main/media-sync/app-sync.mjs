// Manual, optional sync. App writes stay in NeDB; SQLite journals an idempotent projection across files.
import { randomUUID, recordKey, validatePayload, fail, isLibrary } from './protocol.mjs'
import { Client } from './client.mjs'
import { librarySnapshot, projectLibrary } from './library.mjs'
import { profileSnapshot, projectProfile, reconcileProfileSubscription } from './profiles.mjs'
export const same = (a, b) => a?.kind === b?.kind && a?.id === b?.id && (a?.positionMs ?? null) === (b?.positionMs ?? null) && (a?.watchedAtMs ?? null) === (b?.watchedAtMs ?? null) && (a?.name ?? null) === (b?.name ?? null) && JSON.stringify(a?.items ?? null) === JSON.stringify(b?.items ?? null) && (a?.bgColor ?? null) === (b?.bgColor ?? null) && (a?.textColor ?? null) === (b?.textColor ?? null)
export class AppSync {
  constructor (filename, config, models, changed = () => {}) {
    this.client = new Client(filename, config.endpoint, config.credential, config.keys)
    this.models = models; this.changed = changed; this.chain = Promise.resolve(); this.syncing = false
    this.client.state.baseline ??= {}; this.client.save()
    this.client.beforePullPage = () => this.gate(async () => { await this.recover(); await this.capture() })
  }

  gate (fn) { const next = this.chain.then(fn); this.chain = next.catch(() => {}); return next }
  async snapshot () {
    const result = {}; const profiles = await this.models.profiles.find(); const history = await this.models.history.find()
    for (const channel of profiles.find(p => p._id === 'allChannels')?.subscriptions ?? []) {
      const p = { kind: 'subscription', provider: 'youtube', id: channel.id }
      try { validatePayload(p); result[recordKey(this.client.keys, p)] = p } catch { /* Unsupported identities remain local. */ }
    }
    for (const row of history) {
      const p = { kind: 'resume', provider: 'youtube', id: row.videoId, positionMs: Math.round(row.watchProgress * 1000), sessionId: randomUUID(), checkpointSeq: 0 }
      if (typeof row.watchProgress !== 'number') continue
      try { validatePayload(p); result[recordKey(this.client.keys, p)] = p } catch { /* Invalid/nonportable progress remains local. */ }
    }
    if (this.client.state.libraryEnabled) Object.assign(result, await librarySnapshot(this.models, this.client.keys, history))
    if (this.client.state.profilesEnabled) Object.assign(result, await profileSnapshot(this.models, this.client.keys))
    return result
  }

  async capture (basis = null) {
    const c = this.client; const prior = structuredClone(c.state); const current = await this.snapshot()
    try {
      // Each checkpoint batch and its baseline commit in the same SQLite row.
      const save = c.save.bind(c); c.save = () => {}
      try {
        for (const key of new Set([...Object.keys(current), ...Object.keys(c.state.baseline)])) {
          const p = current[key]; const old = c.state.baseline[key]
          if (!same(p, old)) { c.edit(p ?? old, p ? 'put' : 'remove'); const entry = c.state.pending.at(-1); if ((this.syncBase || basis) && !entry.predecessor) entry.baseRevision = (this.syncBase ?? basis)[key]?.revision ?? 0 }
        }
        c.state.baseline = current
      } finally { c.save = save }
      c.save()
    } catch (error) { c.state = prior; throw error }
  }

  async recover () {
    const c = this.client; const journal = c.state.projection
    if (!journal) return
    const current = await this.snapshot(); const projected = new Set()
    for (const [key, record] of Object.entries(journal.target)) {
      const desired = record.operation === 'put' ? record.payload : undefined
      if (!same(current[key], journal.before[key]) && !same(current[key], desired)) {
        // A local edit after a crash wins locally and becomes an explicit pending mutation.
        continue
      }
      await this.project(record); projected.add(key)
    }
    c.state.baseline = structuredClone(journal.before)
    // Adopt successfully projected values without echoing them back to the service.
    const after = await this.snapshot()
    for (const [key, record] of Object.entries(journal.target)) {
      // History represents the latest observation, so an older imported event cannot erase a later local view.
      if (projected.has(key) && record.operation === 'put' && record.payload.kind === 'history' && after[key]?.watchedAtMs > record.payload.watchedAtMs) {
        c.edit(after[key]); c.state.baseline[key] = after[key]
      } else if (same(after[key], record.operation === 'put' ? record.payload : undefined)) {
        if (after[key]) c.state.baseline[key] = after[key]; else delete c.state.baseline[key]
      }
    }
    delete c.state.projection; c.save(); await this.capture(journal.basis); await this.changed()
  }

  async project (record) {
    const p = record.payload
    if (p.kind === 'profile' || p.kind === 'profile-member') {
      if (!this.client.state.profilesEnabled) fail('profiles_upgrade_required')
      return projectProfile(this.models, record, this.client.state)
    }
    if (isLibrary(p.kind)) { if (!this.client.state.libraryEnabled) fail('library_upgrade_required'); return projectLibrary(this.models, record) }
    if (p.kind === 'subscription') {
      const profiles = await this.models.profiles.find()
      const main = profiles.find(row => row._id === 'allChannels') ?? { _id: 'allChannels', name: 'All Channels', bgColor: '#000000', textColor: '#FFFFFF', subscriptions: [] }
      if (record.operation === 'remove') {
        // Remove from named profiles too: they are subsets of the allChannels library.
        for (const profile of profiles) if (profile.subscriptions.some(row => row.id === p.id)) await this.models.profiles.upsert({ ...profile, subscriptions: profile.subscriptions.filter(row => row.id !== p.id) })
      } else if (!main.subscriptions.some(row => row.id === p.id)) {
        await this.models.profiles.upsert({ ...main, subscriptions: [...main.subscriptions, { id: p.id, name: p.id, thumbnail: '' }] })
      }
      if (this.client.state.profilesEnabled) await reconcileProfileSubscription(this.models, p.id, record.operation === 'remove')
    } else if (record.operation === 'remove') {
      // Remove only resume progress; unrelated watch-history metadata stays local.
      await this.models.history.clearWatchProgress(p.id)
    } else {
      const old = (await this.models.history.find()).find(row => row.videoId === p.id)
      await this.models.history.upsert({ ...{ videoId: p.id, title: `Synced resume: ${p.id}`, author: '', authorId: '', published: 0, description: '', viewCount: 0, lengthSeconds: 0, timeWatched: 0, isLive: false, type: 'video' }, ...old, watchProgress: p.positionMs / 1000 })
    }
  }

  async sync (choice) {
    if (this.syncing) fail('client_busy'); this.syncing = true; this.syncBase = structuredClone(this.client.state.remote)
    try {
      await this.gate(async () => { await this.recover(); await this.capture() })
      // Freeze projection atomically with the pull cursor, then idempotently apply NeDB files.
      const c = this.client; const save = c.save.bind(c)
      const flush = await c.flush(); if (flush.offline) return { ...this.status(), code: 'offline' }
      const pullSave = () => { this.journal(); save() }
      c.save = pullSave
      try { await c.pull() } finally { c.save = save }
      await this.gate(async () => {
        await this.recover()
        if (choice) { for (const key of Object.keys(c.state.conflicts)) c.resolve(key, choice); this.journal(); c.save(); await this.recover() }
      })
      if ((await c.flush()).offline) return { ...this.status(), code: 'offline' }
      c.state.lastSyncComplete = true; c.save(); return this.status()
    } catch (error) { if (!error.code || error.name === 'TimeoutError') return { ...this.status(), code: 'offline' }; throw error } finally { this.syncing = false; this.syncBase = null }
  }

  journal () {
    const c = this.client; const target = structuredClone(c.state.local)
    for (const [key, payload] of Object.entries(c.state.baseline)) if (!target[key]) target[key] = { payload, operation: 'remove' }
    c.state.projection = { before: structuredClone(c.state.baseline), basis: structuredClone(this.syncBase ?? c.state.remote), target }
  }

  enableLibrary () { this.client.state.libraryEnabled = true; this.client.save(); return this.status() }
  enableProfiles () { this.client.state.profilesEnabled = true; this.client.save(); return this.status() }
  status () { const s = this.client.state; return { enabled: true, libraryEnabled: !!s.libraryEnabled, profilesEnabled: !!s.profilesEnabled, code: s.blocked ? 'restored_service' : Object.keys(s.conflicts).length ? 'conflict' : s.pending.length ? 'pending' : s.lastSyncComplete ? 'synced' : 'ready', pending: s.pending.length, conflicts: Object.keys(s.conflicts).length } }
  close () { this.client.close() }
}
