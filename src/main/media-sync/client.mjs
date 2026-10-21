import { createHash } from 'node:crypto'
import { privateDatabase } from './store.mjs'
import { b64, fail, integer, LIMITS, open, SyncError, randomUUID, recordKey, seal, validatePayload } from './protocol.mjs'
export class Client {
  constructor (filename, baseUrl, credential, keys) {
    const url = new URL(baseUrl)
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)))) fail('verified_transport_required')
    const keyFingerprint = createHash('sha256').update(b64(keys.encryptionKey, 32)).update(b64(keys.routingKey, 32)).digest('hex')
    this.baseUrl = url.origin; this.credential = credential; this.keys = keys; this.busy = false
    this.db = privateDatabase(filename)
    if (this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().some(row => row.name !== 'client_state')) { this.db.close(); fail('foreign_client_database') }
    this.db.exec('CREATE TABLE IF NOT EXISTS client_state (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL) STRICT')
    const existing = this.db.prepare('SELECT body FROM client_state WHERE id=1').get()
    this.state = existing ? JSON.parse(existing.body) : { protocol: 1, keyFingerprint, ownerId: credential.ownerId, deviceId: credential.deviceId, generation: credential.serverGeneration, cursor: 0, epoch: 0, remote: {}, local: {}, pending: [], conflicts: {}, blocked: false }
    if (this.state.ownerId !== credential.ownerId || this.state.deviceId !== credential.deviceId || this.state.protocol !== 1 || this.state.keyFingerprint !== keyFingerprint) { this.db.close(); fail('client_state_mismatch') }
    this.save()
  }

  save () { this.db.prepare('INSERT INTO client_state VALUES (1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(JSON.stringify(this.state)) }
  edit (payload, operation = 'put') {
    validatePayload(payload); if (!['put', 'remove'].includes(operation)) fail('invalid_operation')
    if (this.state.pending.length >= LIMITS.outbox) fail('outbox_full', 423)
    const key = recordKey(this.keys, payload); const value = structuredClone(payload)
    this.state.local[key] = { payload: value, operation, epoch: payload.kind === 'resume' ? this.state.epoch : 0 }
    this.state.pending.push({ intentId: randomUUID(), payload: value, operation, epoch: payload.kind === 'resume' ? this.state.epoch : 0, baseRevision: this.state.remote[key]?.revision ?? 0, predecessor: this.state.pending.findLast(p => recordKey(this.keys, p.payload) === key)?.intentId ?? null, wire: null }); this.save()
    return key
  }

  async request (path, method = 'GET', value) {
    const response = await fetch(this.baseUrl + path, { method, redirect: 'error', signal: AbortSignal.timeout(5000), headers: { authorization: `Bearer ${this.credential.deviceId}.${this.credential.token}`, 'x-dd-sync-version': '1', ...(this.state.libraryEnabled ? { 'x-dd-sync-library': '2' } : {}), ...(value ? { 'content-type': 'application/json' } : {}) }, body: value ? JSON.stringify(value) : undefined })
    const chunks = []; let size = 0
    for await (const chunk of response.body) { size += chunk.length; if (size > 1048576) fail('response_too_large'); chunks.push(chunk) }
    let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { fail('invalid_response') }
    if (body.protocol !== 1) fail('unsupported_protocol', 409)
    if (body.code === 'library_upgrade_required' || body.code === 'unsupported_library_version') fail(body.code, 409)
    if (body.code === 'server_generation_changed') { this.state.blocked = true; this.save(); fail('server_generation_changed', 409) }
    return { status: response.status, body }
  }

  async flush () {
    if (this.busy) fail('client_busy', 409); if (this.state.blocked) fail('resnapshot_required', 409)
    this.busy = true
    try {
      while (this.state.pending.length) {
        const entry = this.state.pending[0]; const key = recordKey(this.keys, entry.payload)
        if (this.state.conflicts[key]) return { pending: this.state.pending.length, conflict: true }
        if (!entry.wire) { entry.wire = seal(this.keys, this.credential.ownerId, { serverGeneration: this.state.generation, mutationId: entry.intentId, operation: entry.operation, baseRevision: entry.baseRevision ?? (this.state.remote[key]?.revision ?? 0), resumeEpoch: entry.epoch }, entry.payload); this.save() }
        let result
        try { result = await this.request('/v1/mutations', 'POST', entry.wire) } catch (error) { if (error instanceof SyncError) throw error; return { pending: this.state.pending.length, offline: true } }
        if (result.status === 409) { this.state.conflicts[key] = { revision: result.body.revision, code: result.body.code }; this.save(); return { pending: this.state.pending.length, conflict: true } }
        if (result.status !== 200) fail(result.status === 401 ? 'unauthorized' : result.status === 429 ? 'rate_limited' : 'sync_rejected', result.status)
        if (!integer(result.body.revision) || result.body.serverGeneration !== this.state.generation) fail('invalid_receipt')
        this.state.remote[key] = { revision: result.body.revision, payload: entry.payload, operation: entry.operation, epoch: entry.epoch }
        this.state.pending.shift()
        for (const next of this.state.pending) if (next.predecessor === entry.intentId) { next.baseRevision = result.body.revision; next.predecessor = null }
        this.save()
      }
      return { pending: 0 }
    } finally { this.busy = false }
  }

  async pull ({ pageSize = LIMITS.page } = {}) {
    if (this.busy) fail('client_busy', 409); if (this.state.blocked) fail('resnapshot_required', 409)
    this.busy = true
    try {
      let watermark
      for (let pages = 0; pages <= LIMITS.changes; pages++) {
        const query = new URLSearchParams({ generation: this.state.generation, after: String(this.state.cursor), limit: String(pageSize), ...(watermark === undefined ? {} : { until: String(watermark) }) })
        const response = await this.request('/v1/changes?' + query)
        if (response.status !== 200) fail(response.status === 401 ? 'unauthorized' : 'pull_rejected', response.status)
        const r = response.body
        if (r.serverGeneration !== this.state.generation || !integer(r.watermark) || !integer(r.cursor) || r.cursor < this.state.cursor || r.cursor > r.watermark || !integer(r.resumeEpoch) || !Array.isArray(r.changes) || r.changes.length > pageSize || (watermark !== undefined && r.watermark !== watermark)) fail('invalid_page')
        watermark = r.watermark
        if (this.beforePullPage) await this.beforePullPage()
        const next = structuredClone(this.state)
        if (r.resumeEpoch < next.epoch) fail('epoch_rollback')
        if (r.resumeEpoch > next.epoch) {
          next.epoch = r.resumeEpoch; next.pending = next.pending.filter(p => p.payload.kind !== 'resume' || p.epoch >= next.epoch)
          for (const map of [next.local, next.remote]) for (const [key, record] of Object.entries(map)) if (record.payload.kind === 'resume' && record.epoch < next.epoch) { delete map[key]; delete next.conflicts[key] }
        }
        let last = next.cursor
        for (const change of r.changes) {
          if (!integer(change.sequence) || change.sequence <= last || change.sequence > r.cursor) fail('invalid_change_order'); last = change.sequence
          if (change.kind === 'reset' && change.mutation === null) continue
          const m = change.mutation; if (!m || change.kind !== m.kind) fail('invalid_change')
          const payload = open(this.keys, this.credential.ownerId, m)
          if (payload.kind === 'resume' && m.resumeEpoch < next.epoch) continue
          if ((next.remote[m.recordKey]?.revision ?? 0) >= change.sequence) continue
          const record = { payload, operation: m.operation, epoch: m.resumeEpoch, revision: change.sequence }; next.remote[m.recordKey] = record
          if (!next.pending.some(p => recordKey(this.keys, p.payload) === m.recordKey)) next.local[m.recordKey] = record
        }
        if (r.cursor !== last && r.changes.length) fail('invalid_page_cursor')
        if (!r.changes.length && r.cursor !== r.watermark) fail('nonadvancing_page')
        next.cursor = r.cursor
        const prior = this.state; this.state = next
        try { this.save() } catch (error) { this.state = prior; throw error }
        if (r.cursor === watermark) return { cursor: r.cursor }
      }
      fail('page_limit')
    } finally { this.busy = false }
  }

  resolve (key, choice) {
    const conflict = this.state.conflicts[key]; const remote = this.state.remote[key]
    if (!conflict || !remote || remote.revision < conflict.revision || !['keep-local', 'use-remote'].includes(choice)) fail('pull_before_resolution')
    const local = this.state.local[key]; this.state.pending = this.state.pending.filter(p => recordKey(this.keys, p.payload) !== key); delete this.state.conflicts[key]
    if (choice === 'use-remote') { this.state.local[key] = structuredClone(remote); this.save() } else { const epoch = local.payload.kind === 'resume' ? this.state.epoch : 0; this.state.local[key] = { ...local, epoch }; this.state.pending.push({ intentId: randomUUID(), payload: local.payload, operation: local.operation, epoch, baseRevision: remote.revision, predecessor: null, wire: null }); this.save() }
  }

  values (kind) { return Object.values(this.state.local).filter(r => r.payload.kind === kind && r.operation === 'put').map(r => structuredClone(r.payload)) }
  close () { this.db.close() }
}
