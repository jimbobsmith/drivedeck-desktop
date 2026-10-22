import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { DesktopUpdates, supportsAutomaticInstallation } from '../../src/main/desktop-updates.mjs'
import { AutomaticUpdateChecks } from '../../src/renderer/helpers/desktop-update-checks.mjs'
import config from '../../_scripts/ebuilder.config.mjs'
const require = createRequire(import.meta.url)
const { GitHubProvider } = require('electron-updater/out/providers/GitHubProvider.js')
const semver = createRequire(require.resolve('electron-updater'))('semver')
const { DigestTransform } = createRequire(require.resolve('electron-updater'))('builder-util-runtime')
test('the actual updater digest verifier rejects corrupt downloads before installation', async () => {
  const expected = createHash('sha512').update('correct installer').digest('base64')
  const discard = () => new Writable({ write(chunk, encoding, done) { done() } })
  await pipeline(Readable.from(['correct installer']), new DigestTransform(expected, 'sha512', 'base64'), discard())
  await assert.rejects(pipeline(Readable.from(['corrupt installer']), new DigestTransform(expected, 'sha512', 'base64'), discard()), { code: 'ERR_CHECKSUM_MISMATCH' })
})
test('disabled setting makes no startup checks, enabling schedules, disabling cancels all automatic checks', () => {
  let calls = 0; let tick; const cancelled = []
  const scheduler = new AutomaticUpdateChecks(() => calls++, (fn, ms) => { tick = fn; assert.equal(ms, 21600000); return 42 }, id => cancelled.push(id))
  scheduler.setEnabled(false); assert.equal(calls, 0)
  scheduler.setEnabled(true); assert.equal(calls, 1)
  tick(); assert.equal(calls, 2)
  scheduler.setEnabled(false); tick(); assert.equal(calls, 2)
  assert.deepEqual(cancelled, [42])
  scheduler.setEnabled(true); assert.equal(calls, 3)
  scheduler.dispose(); tick(); assert.equal(calls, 3)
})
test('only installed NSIS and real packaged AppImage enable automatic installation', () => {
  for (const packageType of [undefined, 'zip', 'portable', 'deb']) assert.equal(supportsAutomaticInstallation({ packaged: true, platform: 'win32', packageType }), false)
  assert.equal(supportsAutomaticInstallation({ packaged: true, platform: 'win32', packageType: 'nsis' }), true)
  assert.equal(supportsAutomaticInstallation({ packaged: false, platform: 'win32', packageType: 'nsis' }), false)
  assert.equal(supportsAutomaticInstallation({ packaged: true, platform: 'linux', packageType: 'deb' }), false)
  assert.equal(supportsAutomaticInstallation({ packaged: true, platform: 'linux', appImage: '/fixture.AppImage' }), true)
})
function setup({ supported = true, consent = true } = {}) {
  const updater = new EventEmitter()
  const calls = []
  updater.checkForUpdates = async () => { calls.push('check'); updater.emit('update-available', { version: '0.1.0-alpha.2' }) }
  updater.downloadUpdate = async () => { calls.push('download'); updater.emit('update-downloaded', { version: '0.1.0-alpha.2' }) }
  updater.quitAndInstall = (...args) => calls.push(['install', ...args])
  const prompts = []
  const controller = new DesktopUpdates(updater, { supported, version: '0.1.0-alpha.1', confirmDownload: async () => { prompts.push('download'); return consent }, confirmInstall: async () => { prompts.push('install'); return consent } })
  return { controller, updater, calls, prompts }
}
test('checks offer updates without downloading or installing, and configure alpha without downgrade', async () => {
  const { controller, updater, calls } = setup()
  assert.equal((await controller.run('check')).code, 'available')
  assert.deepEqual(calls, ['check'])
  assert.equal(updater.autoDownload, false)
  assert.equal(updater.autoInstallOnAppQuit, false)
  assert.equal(updater.allowPrerelease, true)
  assert.equal(updater.channel, 'alpha')
  assert.equal(updater.allowDowngrade, false)
})
test('download and restart each require separate confirmation', async () => {
  const { controller, calls, prompts } = setup()
  await controller.run('check'); await controller.run('download')
  assert.equal((await controller.run('status')).code, 'downloaded')
  assert.deepEqual(calls, ['check', 'download'])
  await controller.run('install')
  assert.deepEqual(prompts, ['download', 'install'])
  assert.deepEqual(calls.at(-1), ['install', false, true])
})
test('cancel and premature actions never download or install', async () => {
  const { controller, calls } = setup({ consent: false })
  await controller.run('download'); await controller.run('install')
  await controller.run('check'); await controller.run('download')
  assert.deepEqual(calls, ['check'])
  assert.equal((await controller.run('status')).code, 'available')
})
test('declining restart leaves downloaded update ready', async () => {
  const { controller, updater, calls } = setup({ consent: false })
  updater.emit('update-downloaded', { version: '0.1.0-alpha.2' })
  await controller.run('install')
  assert.deepEqual(calls, [])
  assert.equal((await controller.run('status')).code, 'downloaded')
})
test('offline errors are recoverable and never expose error paths or URLs', async () => {
  const { controller, updater } = setup()
  updater.checkForUpdates = async () => { throw new Error('secret/path?token=private') }
  assert.equal((await controller.run('check')).code, 'failed')
  assert.doesNotMatch(JSON.stringify(await controller.run('status')), /secret|token|private/)
  updater.checkForUpdates = async () => updater.emit('update-not-available')
  assert.equal((await controller.run('check')).code, 'current')
  updater.emit('error', new Error('private'))
  assert.equal((await controller.run('status')).code, 'failed')
})
test('parallel clicks serialize and status stays responsive during download', async () => {
  const { controller, updater, calls } = setup()
  await controller.run('check')
  let finish
  updater.downloadUpdate = () => new Promise(resolve => { finish = resolve; calls.push('download') })
  const downloading = controller.run('download')
  await new Promise(resolve => setImmediate(resolve))
  updater.emit('download-progress', { percent: 54.8 })
  assert.equal((await controller.run('status')).percent, 54)
  await controller.run('download'); await controller.run('check')
  assert.deepEqual(calls, ['check', 'download'])
  updater.emit('update-downloaded', { version: '0.1.0-alpha.2' }); finish()
  await downloading
})
test('unsupported packages never invoke updater methods', async () => {
  const { controller, calls } = setup({ supported: false })
  for (const action of ['check', 'download', 'install']) assert.equal((await controller.run(action)).code, 'manual')
  assert.deepEqual(calls, [])
})
for (const platform of ['win32', 'linux']) test(`actual GitHub updater selects fork alpha metadata for ${platform}`, async () => {
  const requests = []
  const updater = { allowPrerelease: true, channel: 'alpha', currentVersion: semver.parse('0.1.0-alpha.1'), fullChangelog: false }
  const executor = { request: async options => {
    requests.push(`https://${options.hostname}${options.path}`)
    if (options.path.endsWith('.atom')) return '<feed><entry><title>DD preview</title><link href="https://github.com/jimbobsmith/drivedeck-desktop/releases/tag/v0.1.0-alpha.2"/><content>Preview</content></entry></feed>'
    return 'version: 0.1.0-alpha.2\nfiles:\n  - url: dd-freetube.exe\n    sha512: test\n'
  } }
  const provider = new GitHubProvider(config.publish[0], updater, { executor, platform })
  const result = await provider.getLatestVersion()
  assert.equal(result.version, '0.1.0-alpha.2')
  assert.ok(requests.every(url => url.startsWith('https://github.com/jimbobsmith/drivedeck-desktop/')))
  assert.ok(requests.at(-1).endsWith(platform === 'linux' ? '/alpha-linux.yml' : '/alpha.yml'))
})
