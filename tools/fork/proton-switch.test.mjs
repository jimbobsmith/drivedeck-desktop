import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  dbusTransport, parseBusctlReply, parseGdbusReply, parseStatusReply, parseSwitchReply,
  pipeTransport, ProtonSwitch, transportFor, unsupportedTransport
} from '../../src/main/proton-switch.mjs'
import { blockFromPlayability, blockFromStreamError, decide, SwitchBudget } from '../../src/renderer/helpers/proton-block.mjs'
import { startProtonMock } from './proton-mock.mjs'

let counter = 0
function socketPath () {
  if (process.platform === 'win32') return `\\\\.\\pipe\\dd-proton-mock-test-${process.pid}-${counter++}`
  const dir = mkdtempSync(join(tmpdir(), 'dd-proton-'))
  return join(dir, 'control.sock')
}

async function withMock (options, work) {
  const mock = await startProtonMock({ path: socketPath(), delayMs: 20, ...options })
  try {
    return await work(mock)
  } finally {
    await mock.close()
    if (process.platform !== 'win32') rmSync(mock.path, { force: true })
  }
}

test('the pipe status reads the connection state from the reply the client sends with automation off', async () => {
  await withMock({}, async mock => {
    const found = await pipeTransport(mock.path).status()
    assert.deepEqual(found, { available: true, connected: true, server: 'CA#101', country: 'CA' })
    assert.deepEqual(mock.requests, ['{"command":"status"}'])
  })
})

test('a pipe nobody serves means the Proton app is not running', async () => {
  const found = await pipeTransport(socketPath()).status()
  assert.equal(found.available, false)
  const controller = new ProtonSwitch(pipeTransport(socketPath()))
  assert.equal((await controller.status()).code, 'unavailable')
  assert.equal((await controller.quickSwitch()).code, 'unavailable')
})

test('a switch reports switching, then network, then switched with the new server', async () => {
  await withMock({}, async mock => {
    const seen = []
    let settled = 0
    const controller = new ProtonSwitch(pipeTransport(mock.path), {
      afterSwitch: async () => { settled++ },
      onChange: state => seen.push([state.code, state.step ?? '', state.server ?? ''])
    })
    const result = await controller.quickSwitch()
    assert.equal(result.code, 'switched')
    assert.equal(result.server, 'CA#202')
    assert.equal(settled, 1)
    assert.deepEqual(seen, [['switching', 'tunnel', ''], ['switching', 'network', 'CA#202'], ['switched', '', 'CA#202']])
    assert.deepEqual(mock.requests, ['QuickSwitch'])
  })
})

test('two windows asking at once share one switch', async () => {
  await withMock({ delayMs: 100 }, async mock => {
    const controller = new ProtonSwitch(pipeTransport(mock.path))
    const [a, b] = await Promise.all([controller.quickSwitch(), controller.quickSwitch()])
    assert.equal(mock.switches, 1)
    assert.equal(a.server, b.server)
    // A status read during a switch does not touch the pipe or hide the switch.
    const running = controller.quickSwitch()
    assert.equal((await controller.status()).code, 'switching')
    await running
    assert.equal(mock.switches, 2)
  })
})

test('the client\'s refusals come back as failed with its own words', async () => {
  for (const [scenario, words] of [
    ['fail', 'The previous tunnel stayed up.'],
    ['no-favorites', 'No favorites are saved yet.'],
    ['one-favorite', 'No alternate favorite target is available.']
  ]) {
    await withMock({ scenario }, async mock => {
      const result = await new ProtonSwitch(pipeTransport(mock.path)).quickSwitch()
      assert.equal(result.code, 'failed', scenario)
      assert.match(result.message, new RegExp(words.replace(/[.]/g, '\\.')), scenario)
    })
  }
})

test('a switch that never answers is reported as no answer, not as a failure', async () => {
  await withMock({ scenario: 'never' }, async mock => {
    const result = await new ProtonSwitch(pipeTransport(mock.path, { switchTimeoutMs: 200 })).quickSwitch()
    assert.equal(result.code, 'no-answer')
  })
})

test('after a failed switch the next one can still succeed', async () => {
  await withMock({ scenario: 'flaky' }, async mock => {
    const controller = new ProtonSwitch(pipeTransport(mock.path))
    assert.equal((await controller.quickSwitch()).code, 'failed')
    assert.equal((await controller.quickSwitch()).code, 'switched')
  })
})

test('replies are read strictly', () => {
  assert.deepEqual(parseSwitchReply('{"switched":true,"server":"CA#1","message":"up"}'), { switched: true, server: 'CA#1', message: 'up' })
  assert.throws(() => parseSwitchReply(''), { code: 'EBADREPLY' })
  assert.throws(() => parseSwitchReply('{"ok":true}'), { code: 'EBADREPLY' })
  assert.deepEqual(parseStatusReply('not json'), { connected: null, server: '' })
  assert.deepEqual(parseBusctlReply('{"type":"a{sv}","data":[{"switched":{"type":"b","data":true},"server":{"type":"s","data":"CH#4"},"message":{"type":"s","data":"Quick switch finished. The new tunnel is up."}}]}'),
    { switched: true, server: 'CH#4', message: 'Quick switch finished. The new tunnel is up.' })
  assert.deepEqual(parseGdbusReply("({'switched': <false>, 'server': <''>, 'message': <\"Favorite 'x' was not found.\">},)\n"),
    { switched: false, server: '', message: "Favorite 'x' was not found." })
  assert.deepEqual(parseGdbusReply("({'message': <'Quick switch finished. The new tunnel is up.'>, 'server': <'CA#9'>, 'switched': <true>},)"),
    { switched: true, server: 'CA#9', message: 'Quick switch finished. The new tunnel is up.' })
})

function fakeExecFile (answers) {
  const calls = []
  const execFile = (file, args, options, done) => {
    calls.push([file, ...args])
    const answer = answers(file, args)
    setImmediate(() => answer.error ? done(answer.error, '', answer.stderr ?? '') : done(null, answer.stdout, ''))
  }
  return { execFile, calls }
}

test('Linux uses busctl, and gdbus when busctl is missing', async () => {
  const missing = Object.assign(new Error('spawn busctl ENOENT'), { code: 'ENOENT' })
  const { execFile, calls } = fakeExecFile((file, args) => {
    if (file === 'busctl') return { error: missing }
    if (args.includes('org.freedesktop.DBus.NameHasOwner')) return { stdout: '(true,)\n' }
    return { stdout: "({'switched': <true>, 'server': <'CA#7'>, 'message': <'Quick switch finished. The new tunnel is up.'>},)\n" }
  })
  const transport = dbusTransport(execFile)
  assert.deepEqual(await transport.status(), { available: true, connected: null, server: '' })
  assert.deepEqual(await transport.quickSwitch(), { switched: true, server: 'CA#7', message: 'Quick switch finished. The new tunnel is up.' })
  const call = calls.find(item => item[0] === 'gdbus' && item.includes('com.jimbobsmith.ProtonApi.QuickSwitch'))
  assert.ok(call, 'gdbus called QuickSwitch')
  assert.ok(call.includes('600'), 'with a ten minute timeout')
})

test('Linux reports a missing bus name as not running', async () => {
  const { execFile } = fakeExecFile((file, args) => {
    if (args.includes('NameHasOwner')) return { stdout: '{"type":"b","data":[false]}' }
    return { error: Object.assign(new Error('exit 1'), { code: 1 }), stderr: 'Call failed: The name com.jimbobsmith.ProtonApi was not provided by any .service files' }
  })
  const controller = new ProtonSwitch(dbusTransport(execFile))
  assert.equal((await controller.status()).code, 'unavailable')
  assert.equal((await controller.quickSwitch()).code, 'unavailable')
})

test('the transport follows the system, and DD_PROTON_CONTROL points at a mock', async () => {
  assert.equal(transportFor({ platform: 'win32', env: {} }).kind, 'pipe')
  assert.equal(transportFor({ platform: 'linux', env: {} }).kind, 'dbus')
  assert.equal(transportFor({ platform: 'darwin', env: {} }).kind, 'none')
  assert.equal(transportFor({ platform: 'linux', env: { DD_PROTON_CONTROL: 'pipe:/tmp/x.sock' } }).kind, 'pipe')
  const controller = new ProtonSwitch(unsupportedTransport())
  assert.equal(controller.state.code, 'unsupported')
  assert.equal((await controller.status()).code, 'unsupported')
})

test('only the bot check counts as a block in the video information', () => {
  assert.equal(blockFromPlayability({ status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you’re not a bot' }), 'ip-block')
  assert.equal(blockFromPlayability({ status: 'UNPLAYABLE', reason: 'Please sign in' }), 'ip-block')
  // The plain apostrophe is not YouTube's text.
  assert.equal(blockFromPlayability({ status: 'LOGIN_REQUIRED', reason: "Sign in to confirm you're not a bot" }), null)
  assert.equal(blockFromPlayability({ status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm your age' }), null)
  assert.equal(blockFromPlayability({ status: 'OK' }), null)
})

test('stream errors count only for streams this computer fetched itself', () => {
  assert.equal(blockFromStreamError({ httpStatus: 429, expired: false, streamsFromThisComputer: true }), 'rate-limit')
  assert.equal(blockFromStreamError({ httpStatus: 403, expired: false, streamsFromThisComputer: true }), 'stream-403')
  assert.equal(blockFromStreamError({ httpStatus: 403, expired: true, streamsFromThisComputer: true }), null)
  assert.equal(blockFromStreamError({ httpStatus: 429, expired: false, streamsFromThisComputer: false }), null)
  assert.equal(blockFromStreamError({ httpStatus: 404, expired: false, streamsFromThisComputer: true }), null)
})

test('automatic switches stop after two for one video and four in fifteen minutes', () => {
  let now = 0
  const budget = new SwitchBudget({ now: () => now })
  assert.deepEqual(budget.check('a'), { ok: true })
  budget.record('a'); budget.record('a')
  assert.deepEqual(budget.check('a'), { ok: false, reason: 'video', count: 2 })
  assert.deepEqual(budget.check('b'), { ok: true })
  budget.record('b'); budget.record('c')
  assert.deepEqual(budget.check('d'), { ok: false, reason: 'window', count: 4 })
  now += 15 * 60 * 1000 + 1
  assert.deepEqual(budget.check('a'), { ok: true })
})

test('the setting decides between switching, asking and nothing', () => {
  const ok = { ok: true }
  const spent = { ok: false, reason: 'window', count: 4 }
  assert.equal(decide({ mode: 'automatic', protonCode: 'ready', budget: ok }), 'switch')
  assert.equal(decide({ mode: 'automatic', protonCode: 'ready', budget: spent }), 'paused')
  assert.equal(decide({ mode: 'ask', protonCode: 'ready', budget: spent }), 'ask')
  assert.equal(decide({ mode: 'off', protonCode: 'ready', budget: ok }), 'none')
  assert.equal(decide({ mode: 'automatic', protonCode: 'unavailable', budget: ok }), 'unavailable')
  assert.equal(decide({ mode: 'ask', protonCode: 'busy', budget: ok }), 'busy')
  assert.equal(decide({ mode: 'automatic', protonCode: 'unsupported', budget: ok }), 'none')
  // Another window already started a switch: wait for it instead of asking.
  assert.equal(decide({ mode: 'ask', protonCode: 'switching', budget: ok }), 'switch')
})
