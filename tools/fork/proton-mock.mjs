#!/usr/bin/env node
// A stand-in for the Proton API client's local Quick switch request, so DD
// FreeTube's side can be tested without a real VPN. It speaks the Windows pipe
// protocol of the Proton client (src-tauri/src/platform/windows/pipe.rs in
// jimbobsmith/protonvpn-linux-ui): read one request, write one JSON reply,
// close. `QuickSwitch` replies {switched, server, message}; any other request
// replies like the client's automation handler with automation off:
// {ok: false, message, state}.
//
// Run:   node tools/fork/proton-mock.mjs --path /tmp/dd-proton.sock --scenario ok --delay 3000
// Then:  DD_PROTON_CONTROL=pipe:/tmp/dd-proton.sock pnpm run dev
// On Windows use a pipe path such as \\.\pipe\dd-proton-mock.
//
// Scenarios:
//   ok            each switch takes --delay ms, then reports the next server
//   fail          each switch reports the previous tunnel stayed up
//   no-favorites  the reply the client gives with no favorites saved
//   one-favorite  the reply the client gives when the only favorite is current
//   never         accepts the switch and never answers (tests "no answer")
//   flaky         fails the first switch, then behaves like ok

import net from 'node:net'
import { rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const SERVERS = ['CA#101', 'CA#202', 'US-NY#303', 'CH#404']

export function startProtonMock ({ path, scenario = 'ok', delayMs = 2000, log = () => {} } = {}) {
  const state = { phase: 'connected', connected: true, server: SERVERS[0], country: 'CA', signedIn: true }
  const requests = []
  let switches = 0
  let next = 1
  const sockets = new Set()

  function stateJson () {
    return { phase: state.phase, connected: state.connected, server: state.server, country: state.country, signedIn: state.signedIn }
  }

  async function quickSwitch () {
    switches++
    const previous = { ...state }
    state.phase = 'connecting'
    state.connected = false
    await new Promise(resolve => setTimeout(resolve, delayMs))
    const failNow = scenario === 'fail' || (scenario === 'flaky' && switches === 1)
    if (failNow) {
      Object.assign(state, previous)
      return { switched: false, server: '', message: 'Could not reach a favorite server (mock). The previous tunnel stayed up.' }
    }
    state.server = SERVERS[next % SERVERS.length]
    state.country = state.server.slice(0, 2)
    next++
    state.phase = 'connected'
    state.connected = true
    return { switched: true, server: state.server, message: 'Quick switch finished. The new tunnel is up.' }
  }

  async function handle (request) {
    requests.push(request)
    log(`request: ${request || '(empty)'}`)
    if (request.toLowerCase() === 'quickswitch') {
      if (scenario === 'no-favorites') return { switched: false, server: '', message: 'No favorites are saved yet.' }
      if (scenario === 'one-favorite') return { switched: false, server: '', message: 'No alternate favorite target is available.' }
      if (scenario === 'never') return new Promise(() => {})
      return quickSwitch()
    }
    return { ok: false, message: 'Automation is off. Start the app with --automation to allow it. Nothing was changed.', state: stateJson() }
  }

  if (process.platform !== 'win32') {
    try { rmSync(path, { force: true }) } catch {}
  }
  const server = net.createServer(socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    socket.once('data', async chunk => {
      const reply = await handle(chunk.toString('utf8').trim())
      log(`reply: ${JSON.stringify(reply)}`)
      if (!socket.destroyed) socket.end(JSON.stringify(reply))
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, () => {
      resolve({
        path,
        state,
        requests,
        get switches () { return switches },
        close: () => new Promise(resolve => {
          for (const socket of sockets) socket.destroy()
          server.close(() => resolve())
        })
      })
    })
  })
}

function args (argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1]
  }
  return out
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const options = args(process.argv.slice(2))
  const path = options.path ?? (process.platform === 'win32' ? '\\\\.\\pipe\\dd-proton-mock' : '/tmp/dd-proton-mock.sock')
  const mock = await startProtonMock({
    path,
    scenario: options.scenario ?? 'ok',
    delayMs: Number(options.delay ?? 2000),
    log: line => console.log(`[proton-mock] ${line}`)
  })
  console.log(`[proton-mock] listening on ${mock.path}; start DD FreeTube with DD_PROTON_CONTROL=pipe:${mock.path}`)
  process.on('SIGINT', async () => { await mock.close(); process.exit(0) })
}
