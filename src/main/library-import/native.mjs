import { DatabaseSync } from 'node:sqlite'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { parseExportText, mergeImport, countRecords, importId, canonical, MAX_IMPORT_BYTES } from './import.mjs'
import { readPipePipeZip } from './archive.mjs'
import { readPipePipeDatabase } from './sqlite-import.mjs'
import { validatePayload } from './shared.mjs'
import { privateDatabase } from '../media-sync/store.mjs'
import { projectProfile } from '../media-sync/profiles.mjs'
import { projectLibrary } from '../media-sync/library.mjs'
const video = id => ({ videoId: id, title: 'Imported video: ' + id, author: '', authorId: '', published: 0, description: '', viewCount: 0, lengthSeconds: 0, timeWatched: 0, isLive: false, type: 'video' })
const p = (kind, id, fields = {}) => ({ kind, provider: 'youtube', ...(['profile', 'profile-member'].includes(kind) ? { version: 3 } : ['playlist', 'watch-later', 'history'].includes(kind) ? { version: 2 } : {}), id, ...fields })
export async function parseFiles (paths) {
  if (!Array.isArray(paths) || !paths.length || paths.length > 20) throw Error('invalid_import_selection')
  let size = 0; const result = []
  for (const path of paths) {
    size += statSync(path).size
    if (size > MAX_IMPORT_BYTES) throw Error('import_file_limit')
    const bytes = readFileSync(path)
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      const data = await readPipePipeZip(bytes); const directory = mkdtempSync(join(tmpdir(), 'dd-media-import-')); const file = join(directory, 'source.sqlite')
      if (dirname(resolve(directory)) !== resolve(tmpdir()) || !directory.includes('dd-media-import-')) throw Error('invalid_import_directory')
      let db
      try {
        writeFileSync(file, data, { mode: 0o600, flag: 'wx' }); db = new DatabaseSync(file, { readOnly: true, allowExtension: false, timeout: 1000 })
        db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF')
        const adapter = { exec (sql) { const statement = db.prepare(sql); const values = statement.all(); if (!values.length) return []; const columns = Object.keys(values[0]); return [{ columns, values: values.map(row => columns.map(key => row[key])) }] } }
        result.push(await readPipePipeDatabase(adapter, data))
      } finally {
        db?.close()
        rmSync(directory, { recursive: true, force: true })
      }
    } else result.push(await parseExportText(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  }
  return result
}
export async function snapshot (models) {
  const records = []; Object.defineProperty(records, 'opaque', { value: new Set() })
  const add = row => { try { validatePayload(row); records.push(row); return true } catch { records.opaque.add(row.kind + ':' + row.id); return false } }
  const profiles = await models.profiles.find(); const lists = await models.playlists.find()
  for (const channel of profiles.find(r => r._id === 'allChannels')?.subscriptions ?? []) if (canonical(channel.id, 'channel')) records.push(p('subscription', channel.id))
  for (const row of profiles) {
    if (row._id === 'allChannels') continue
    const id = row.ddSyncId ?? await importId('freetube-profile', row._id)
    if (!add(p('profile', id, { name: row.name, bgColor: row.bgColor?.toUpperCase(), textColor: row.textColor?.toUpperCase() }))) continue
    for (const channel of row.subscriptions ?? []) if (canonical(channel.id, 'channel')) records.push(p('profile-member', id + ':' + channel.id, { profileId: id, channelId: channel.id }))
  }
  for (const row of lists) {
    const items = (row.videos ?? []).map(v => v.videoId)
    const item = row._id === 'watchLater' ? p('watch-later', 'watch-later', { items }) : p('playlist', row.ddSyncId ?? await importId('freetube-playlist', row._id), { name: row.playlistName, items })
    if (items.some(id => !canonical(id, 'video'))) records.opaque.add(item.kind + ':' + item.id); else add(item)
  }
  for (const row of await models.history.find()) {
    if (!canonical(row.videoId, 'video')) continue
    if (Number.isSafeInteger(row.timeWatched) && row.timeWatched > 0) records.push(p('history', row.videoId, { watchedAtMs: row.timeWatched }))
    if (Number.isFinite(row.watchProgress) && row.watchProgress >= 0) records.push(p('resume', row.videoId, { positionMs: Math.round(row.watchProgress * 1000), sessionId: await importId('desktop-existing-resume', row.videoId), checkpointSeq: 0 }))
  }
  return records
}
async function localAliases (models, records) {
  const aliases = new Map()
  for (const row of await models.profiles.find()) if (row._id !== 'allChannels' && row.ddSyncId)aliases.set('profile:' + await importId('freetube-profile', row._id), row.ddSyncId)
  for (const row of await models.playlists.find()) if (row._id !== 'watchLater' && row.ddSyncId)aliases.set('playlist:' + await importId('freetube-playlist', row._id), row.ddSyncId)
  return records.map(row => {
    if (row.kind === 'profile-member') { const id = aliases.get('profile:' + row.profileId); return id ? { ...row, profileId: id, id: id + ':' + row.channelId } : row }
    const id = aliases.get(row.kind + ':' + row.id); return id ? { ...row, id } : row
  })
}
function portablePlan (before, records) {
  if (records.some(r => before.opaque.has(r.kind + ':' + r.id) || (r.kind === 'profile-member' && before.opaque.has('profile:' + r.profileId)))) throw Error('existing_collection_not_portable')
  return mergeImport(before, records)
}
export class LibraryImporter {
  constructor (models, filename) {
    this.models = models; this.filename = filename; this.db = privateDatabase(filename)
    this.db.exec('CREATE TABLE IF NOT EXISTS import_journal(id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)')
  }

  pending () { return !!this.db.prepare('SELECT id FROM import_journal WHERE id=1').get() }
  discard () { this.db.exec('DELETE FROM import_journal') }
  async preview (parsed) {
    const records = parsed.flatMap(r => r.records); const plan = portablePlan(await snapshot(this.models), await localAliases(this.models, records))
    if (plan.changes.length > 1000) throw Error('import_change_limit')
    return { records, summary: { sources: parsed.map(r => r.source), counts: countRecords(plan.changes), retained: plan.retained, warnings: parsed.map(r => r.warnings), pending: this.pending() } }
  }

  async apply (records, maxChanges = 1000) {
    if (this.pending()) throw Error('unfinished_import')
    records = await localAliases(this.models, records)
    const plan = portablePlan(await snapshot(this.models), records)
    if (plan.changes.length > 1000) throw Error('import_change_limit')
    if (plan.changes.length > maxChanges) throw Error('outbox_full')
    this.db.prepare('INSERT OR REPLACE INTO import_journal VALUES(1,?)').run(JSON.stringify({ version: 2, records: plan.changes, applied: [], inFlight: null }))
    return this.resume(maxChanges)
  }

  async resume (maxChanges = 1000) {
    const stored = this.db.prepare('SELECT body FROM import_journal WHERE id=1').get()
    if (!stored) return { counts: {} }
    const journal = JSON.parse(stored.body)
    if (journal.version !== 2 || !Array.isArray(journal.applied)) throw Error('import_recovery_review_required')
    const save = () => this.db.prepare('UPDATE import_journal SET body=? WHERE id=1').run(JSON.stringify(journal))
    const before = await snapshot(this.models)
    const present = new Set(before.map(r => r.kind + ':' + r.id))
    // An acknowledged item removed after interruption is deliberate local intent.
    // An unacknowledged write is ambiguous: only acknowledge if already satisfied.
    if (journal.applied.some(key => !present.has(key))) throw Error('import_recovery_review_required')
    if (journal.inFlight) {
      if (portablePlan(before, [journal.inFlight]).changes.length) throw Error('import_recovery_review_required')
      journal.applied.push(journal.inFlight.kind + ':' + journal.inFlight.id); journal.inFlight = null; save()
    }
    const imported = await localAliases(this.models, journal.records.filter(r => !journal.applied.includes(r.kind + ':' + r.id)))
    const plan = portablePlan(before, imported)
    if (plan.changes.length > maxChanges) throw Error('outbox_full')
    const target = new Map(before.map(x => [x.kind + ':' + x.id, x]))
    for (const row of plan.changes) target.set(row.kind + ':' + row.id, row)
    const state = { local: Object.fromEntries([...target].map(([key, payload]) => [key, { payload, operation: 'put' }])) }
    const priority = { subscription: 0, profile: 1, 'profile-member': 2, playlist: 3, 'watch-later': 3, history: 4, resume: 5 }
    for (const row of plan.changes.sort((a, b) => priority[a.kind] - priority[b.kind])) {
      journal.inFlight = row; save()
      if (row.kind === 'subscription') {
        const profiles = await this.models.profiles.find(); const main = profiles.find(r => r._id === 'allChannels') ?? { _id: 'allChannels', name: 'All Channels', bgColor: '#000000', textColor: '#FFFFFF', subscriptions: [] }
        if (!main.subscriptions.some(c => c.id === row.id)) await this.models.profiles.upsert({ ...main, subscriptions: [...main.subscriptions, { id: row.id, name: row.id, thumbnail: '' }] })
      } else if (['profile', 'profile-member'].includes(row.kind)) await projectProfile(this.models, { payload: row, operation: 'put' }, state)
      else if (row.kind === 'resume') {
        const old = (await this.models.history.find()).find(r => r.videoId === row.id)
        if (!old || old.watchProgress == null) await this.models.history.upsert({ ...video(row.id), ...old, watchProgress: row.positionMs / 1000 })
      } else await projectLibrary(this.models, { payload: row, operation: 'put' })
      journal.applied.push(row.kind + ':' + row.id); journal.inFlight = null; save()
    }
    this.discard(); return { counts: plan.counts, retained: plan.retained }
  }

  close () { if (this.db.isOpen) this.db.close() }
}
