import { LibraryImporter, parseFiles } from '../library-import/native.mjs'
import { app, BrowserWindow, dialog, ipcMain, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { AppSync } from './app-sync.mjs'
import { unprotect, validateConfig } from './enrollment.mjs'
import { connectWithCode } from './connect.mjs'
import { fail, SyncError } from './protocol.mjs'
// No renderer receives enrollment tokens or library keys. Nothing polls in the background.
export function installMediaSync (models, allowed, channels, events) {
  let importer; let importPreview; let instance; let errorCode; let busy = false; let chain = Promise.resolve()
  const secretPath = () => join(app.getPath('userData'), 'dd-media-sync.secret')
  const dbPath = () => join(app.getPath('userData'), 'dd-media-sync.sqlite')
  const gate = fn => { const p = chain.then(fn); chain = p.catch(() => {}); return p }
  const requireVault = () => { if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) fail('os_secret_store_unavailable') }
  const changed = async () => {
    const history = await models.history.find(); const profiles = await models.profiles.find(); const playlists = await models.playlists.find()
    for (const w of BrowserWindow.getAllWindows()) {
      if (!allowed(w.webContents.getURL())) continue
      w.webContents.send(channels.SYNC_HISTORY, { event: events.GENERAL.OVERWRITE, data: history })
      w.webContents.send(channels.SYNC_PLAYLISTS, { event: events.GENERAL.OVERWRITE, data: playlists })
      w.webContents.send(channels.SYNC_PROFILES, { event: events.GENERAL.OVERWRITE, data: profiles })
    }
  }
  function get () {
    if (instance || !existsSync(secretPath())) return instance
    requireVault()
    if (statSync(secretPath()).size > 32768) fail('invalid_enrollment')
    const config = validateConfig(JSON.parse(safeStorage.decryptString(readFileSync(secretPath()))))
    instance = new AppSync(dbPath(), config, models, changed); return instance
  }
  const status = () => { try { return get()?.status() ?? { enabled: false, code: existsSync(dbPath()) || existsSync(secretPath() + '.new') ? 'secret_unavailable' : 'disconnected' } } catch { return { enabled: false, code: 'secret_unavailable' } } }
  // Local mutations are serialized with projection/recovery, but never wait for network calls.
  const wrap = handler => (...args) => gate(async () => {
    let current
    try { current = get() } catch { errorCode = 'local_sync_error' }
    const local = async () => {
      let recovered = true
      try { if (current) await current.recover() } catch { recovered = false; errorCode = 'local_sync_error' }
      const result = await handler(...args)
      if (current && recovered && args[1]?.action !== 1) {
        try { await current.capture() } catch { errorCode = 'local_sync_error' }
      }
      return result
    }
    return current ? current.gate(local) : local()
  })
  const save = config => {
    const encrypted = safeStorage.encryptString(JSON.stringify(config))
    writeFileSync(secretPath() + '.new', encrypted, { flag: 'wx', mode: 0o600 }); renameSync(secretPath() + '.new', secretPath())
    get(); errorCode = undefined; return status()
  }
  // The third argument is the import passphrase, or {address, code, label} for code sign-in.
  ipcMain.handle('dd-media-sync', async (event, action, input) => {
    if (!allowed(event.senderFrame?.url ?? '') || event.senderFrame !== event.sender.mainFrame) return { code: 'unauthorized' }
    if (action === 'status') return { ...status(), ...(errorCode ? { code: errorCode } : {}) }
    if (busy) return { code: 'client_busy' }; busy = true
    try {
      if (action === 'import') {
        requireVault(); if (existsSync(secretPath()) || existsSync(dbPath())) fail('disconnect_before_enrollment')
        const selected = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { title: 'Import protected media sync enrollment', properties: ['openFile'], filters: [{ name: 'Protected enrollment', extensions: ['json'] }] })
        if (selected.canceled) return status()
        if (statSync(selected.filePaths[0]).size > 16384) fail('invalid_enrollment')
        return save(validateConfig(unprotect(JSON.parse(readFileSync(selected.filePaths[0], 'utf8')), input)))
      }
      if (action === 'connect') {
        requireVault(); if (existsSync(secretPath()) || existsSync(dbPath())) fail('disconnect_before_enrollment')
        if (!input || typeof input !== 'object') fail('invalid_action')
        return save(await connectWithCode({ address: input.address, code: input.code, label: input.label }))
      }
      if (action === 'disconnect') {
        await gate(async () => { instance?.close(); instance = undefined; for (const path of [secretPath(), secretPath() + '.new', dbPath(), dbPath() + '-wal', dbPath() + '-shm']) if (existsSync(path)) unlinkSync(path) })
        errorCode = undefined; return status()
      }
      if (action === 'enable-library') { const current = get(); if (!current) fail('not_enrolled'); return await current.gate(() => current.enableLibrary()) }
      if (action === 'enable-profiles') { const current = get(); if (!current) fail('not_enrolled'); return await current.gate(() => current.enableProfiles()) }
      if (!['sync', 'keep-local', 'use-remote'].includes(action)) fail('invalid_action')
      const current = get(); if (!current) fail('not_enrolled')
      errorCode = undefined; return await current.sync(action === 'sync' ? undefined : action)
    } catch (error) { return { ...status(), code: error instanceof SyncError ? error.code : 'sync_failed' } } finally { busy = false }
  })
  const importHandler = wrap(async (event, action) => {
    if (!allowed(event.senderFrame?.url ?? '') || event.senderFrame !== event.sender.mainFrame) return { code: 'unauthorized' }
    importer ??= new LibraryImporter(models, join(app.getPath('userData'), 'dd-library-import.sqlite'))
    try {
      if (action === 'pending') return { pending: importer.pending() }
      if (action === 'preview') {
        if (importer.pending()) return { code: 'unfinished_import', pending: true }
        importPreview = undefined
        const selected = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { title: 'Import FreeTube or PipePipe library exports', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Library exports', extensions: ['db', 'json', 'zip'] }] })
        if (selected.canceled) return { canceled: true }
        importPreview = await importer.preview(await parseFiles(selected.filePaths))
        return { preview: importPreview.summary }
      }
      if (action === 'cancel') { importPreview = undefined; return { canceled: true } }
      if (action === 'commit') {
        if (!importPreview) throw Error('preview_required')
        let current; try { current = get() } catch { errorCode = 'local_sync_error' }
        const needed = Object.values(importPreview.summary.counts).reduce((a, b) => a + b, 0)
        if (current && current.client.state.pending.length + needed > 1000) throw Error('outbox_full')
        const result = await importer.apply(importPreview.records, 1000 - (current?.client.state.pending.length ?? 0)); importPreview = undefined; await changed(); return { done: true, ...result }
      }
      if (action === 'resume') { let current; try { current = get() } catch { errorCode = 'local_sync_error' }; const result = await importer.resume(1000 - (current?.client.state.pending.length ?? 0)); await changed(); return { done: true, ...result } }
      if (action === 'discard') { importer.discard(); return { canceled: true } }
      return { code: 'invalid_action' }
    } catch (error) { return { code: ['import_file_limit', 'import_change_limit', 'outbox_full', 'preview_required', 'unfinished_import', 'import_recovery_review_required', 'existing_collection_not_portable'].includes(error.message) ? error.message : 'invalid_import_file', pending: importer.pending() } }
  })
  ipcMain.handle('dd-library-import', (event, action) => {
    if (!allowed(event.senderFrame?.url ?? '') || event.senderFrame !== event.sender.mainFrame) return { code: 'unauthorized' }
    return importHandler(event, action)
  })
  app.on('will-quit', () => importer?.close())
  app.on('will-quit', () => instance?.close())
  return { wrap }
}
