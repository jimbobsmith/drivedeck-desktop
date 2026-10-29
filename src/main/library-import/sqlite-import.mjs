import {
  BACKUP_TABLES,
  BACKUP_COLUMNS,
  MAX_IMPORT_RECORDS,
  parsePipePipeTables,
} from './import.mjs'
import { fail } from './shared.mjs'
export async function readPipePipeDatabase (db, bytes) {
  const tables = {}
  const master = db.exec(
    "SELECT name,type,sql FROM sqlite_master WHERE type IN ('table','view')"
  )
  const entries = master.flatMap((result) =>
    result.values.map((row) =>
      Object.fromEntries(result.columns.map((c, i) => [c, row[i]]))
    )
  )
  const version = db.exec('PRAGMA user_version')[0]?.values[0]?.[0]
  if (!Number.isInteger(version) || version < 1 || version > 903) { fail('unsupported_import_database_version') }
  for (const table of BACKUP_TABLES) {
    const entry = entries.find((r) => r.name === table)
    if (!entry) {
      tables[table] = []
      continue
    }
    if (
      entry.type !== 'table' ||
      !/^CREATE\s+TABLE\b/i.test(entry.sql ?? '') ||
      /\bGENERATED\b|\bAS\s*\(/i.test(entry.sql)
    ) { fail('invalid_import_database_schema') }
    const info = db.exec('PRAGMA table_info("' + table + '")')[0]
    const columns = new Set(
      info?.values.map((r) => r[info.columns.indexOf('name')]) ?? []
    )
    if (!BACKUP_COLUMNS[table].every((c) => columns.has(c))) { fail('invalid_import_database_schema') }
    const selected = [
      ...BACKUP_COLUMNS[table],
      ...(table === 'feed_group'
        ? ['bg_color', 'text_color'].filter((c) => columns.has(c))
        : []),
    ]
    const projection =
      table === 'stream_history'
        ? 'stream_id,MAX(access_date) AS access_date'
        : selected.map((c) => '"' + c + '"').join(',')
    const values = db.exec(
      'SELECT ' +
        projection +
        ' FROM "' +
        table +
        '"' +
        (table === 'stream_history' ? ' GROUP BY stream_id' : '') +
        ' LIMIT ' +
        (MAX_IMPORT_RECORDS + 1)
    )
    tables[table] = values.flatMap((result) =>
      result.values.map((row) =>
        Object.fromEntries(result.columns.map((c, i) => [c, row[i]]))
      )
    )
    if (tables[table].length > MAX_IMPORT_RECORDS) { fail('import_collection_limit') }
  }
  for (const required of ['subscriptions', 'streams', 'playlists']) {
    if (!entries.some((r) => r.name === required && r.type === 'table')) { fail('invalid_import_database_schema') }
  }
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (b) => b.toString(16).padStart(2, '0')
  ).join('')
  let watchLaterUid = null
  const mapping = entries.find(
    (r) =>
      r.name === 'dd_media_sync' &&
      r.type === 'table' &&
      /^CREATE\s+TABLE\b/i.test(r.sql ?? '') &&
      !/\bGENERATED\b|\bAS\s*\(/i.test(r.sql)
  )
  if (mapping) {
    const info = db.exec('PRAGMA table_info("dd_media_sync")')[0]
    const names = new Set(
      info?.values.map((r) => r[info.columns.indexOf('name')]) ?? []
    )
    if (names.has('id') && names.has('body')) {
      const body = db.exec(
        'SELECT body FROM dd_media_sync WHERE id=2 LIMIT 1'
      )[0]?.values[0]?.[0]
      if (typeof body === 'string' && body.length <= 1024 * 1024) {
        try {
          const uid = JSON.parse(body)['watch-later']
          if (
            Number.isSafeInteger(uid) &&
            uid > 0 &&
            tables.playlists.some((r) => r.uid === uid)
          ) { watchLaterUid = uid }
        } catch {}
      }
    }
  }
  // Only the special-list UID is read from mapping row 2. Enrollment row 1 and identities are never imported.
  return parsePipePipeTables(tables, hash, { watchLaterUid })
}
