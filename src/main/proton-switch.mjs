// Ask the Proton API client on this computer for a Quick switch when YouTube
// blocks the current exit address. The Proton client owns the switch; DD
// FreeTube only asks, waits for the reported result, and shows it.
//
// Windows: \\.\pipe\com.jimbobsmith.ProtonApi. Send `QuickSwitch`, read one
//   JSON reply {switched, server, message}. `{"command":"status"}` answers
//   with the connection state.
// Linux: session bus name com.jimbobsmith.ProtonApi, object
//   /com/jimbobsmith/ProtonApi, method QuickSwitch, reply a{sv} with the same
//   three keys. Called through busctl, or gdbus when busctl is missing.
// DD_PROTON_CONTROL=pipe:<path> talks the Windows pipe protocol on <path>
//   instead, on any system. tools/fork/proton-mock.mjs serves it for tests.
//
// The Proton client says a switch "can take a few minutes" and that a caller
// timeout is not a result, so the wait is long and a timeout is reported as
// "no answer", never as a failure of the switch.

import net from 'node:net'
import { execFile as nodeExecFile } from 'node:child_process'

export const PIPE_NAME = '\\\\.\\pipe\\com.jimbobsmith.ProtonApi'
export const BUS_NAME = 'com.jimbobsmith.ProtonApi'
export const OBJECT_PATH = '/com/jimbobsmith/ProtonApi'
export const SWITCH_TIMEOUT_MS = 10 * 60 * 1000
export const STATUS_TIMEOUT_MS = 3000

function coded (message, code) {
  return Object.assign(new Error(message), { code })
}

/**
 * One request on a pipe-protocol endpoint: write the request, collect the
 * reply until the server closes the connection.
 */
export function pipeRequest (path, request, timeoutMs, connect = net.connect) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let settled = false
    const socket = connect(path)
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      if (error) reject(error)
      else resolve(value)
    }
    const text = () => Buffer.concat(chunks).toString('utf8').trim()
    const timer = setTimeout(() => finish(coded('No answer in time', 'ETIMEDOUT')), timeoutMs)
    socket.on('connect', () => socket.write(request))
    socket.on('data', chunk => chunks.push(chunk))
    socket.on('end', () => finish(null, text()))
    socket.on('close', () => finish(null, text()))
    // The Windows server disconnects right after writing, which can surface
    // as EPIPE/ECONNRESET after the reply already arrived.
    socket.on('error', error => (chunks.length > 0 ? finish(null, text()) : finish(error)))
  })
}

/** The QuickSwitch reply, from JSON (pipe) text. */
export function parseSwitchReply (text) {
  let value
  try { value = JSON.parse(text) } catch { throw coded('The Proton VPN app sent a reply DD FreeTube could not read.', 'EBADREPLY') }
  if (typeof value !== 'object' || value === null || typeof value.switched !== 'boolean') {
    throw coded('The Proton VPN app sent a reply DD FreeTube could not read.', 'EBADREPLY')
  }
  return {
    switched: value.switched,
    server: typeof value.server === 'string' ? value.server : '',
    message: typeof value.message === 'string' ? value.message : ''
  }
}

/**
 * The connection state from a pipe `status` reply. The Proton client refuses
 * the status command unless it runs with --automation, but every reply still
 * carries `state`, which is all this needs. Missing state is not an error.
 */
export function parseStatusReply (text) {
  try {
    const state = JSON.parse(text)?.state
    if (typeof state !== 'object' || state === null) return { connected: null, server: '' }
    return {
      connected: typeof state.connected === 'boolean' ? state.connected : null,
      server: typeof state.server === 'string' ? state.server : '',
      country: typeof state.country === 'string' ? state.country : ''
    }
  } catch {
    return { connected: null, server: '' }
  }
}

/** busctl --json=short output for an a{sv} reply. */
export function parseBusctlReply (text) {
  let value
  try { value = JSON.parse(text) } catch { throw coded('The Proton VPN app sent a reply DD FreeTube could not read.', 'EBADREPLY') }
  const dict = value?.data?.[0]
  const field = (name, type) => (dict?.[name]?.type === type ? dict[name].data : undefined)
  const switched = field('switched', 'b')
  if (typeof switched !== 'boolean') throw coded('The Proton VPN app sent a reply DD FreeTube could not read.', 'EBADREPLY')
  return { switched, server: field('server', 's') ?? '', message: field('message', 's') ?? '' }
}

function gvariantString (text, key) {
  // GVariant text quotes with ' unless the string holds one, then with ".
  const match = text.match(new RegExp(`'${key}': <(?:'((?:[^'\\\\]|\\\\.)*)'|"((?:[^"\\\\]|\\\\.)*)")>`))
  if (!match) return ''
  return (match[1] ?? match[2]).replace(/\\(.)/g, '$1')
}

/** gdbus call output, such as ({'switched': <true>, 'server': <'CA#1'>, 'message': <'…'>},) */
export function parseGdbusReply (text) {
  const switched = text.match(/'switched': <(true|false)>/)
  if (!switched) throw coded('The Proton VPN app sent a reply DD FreeTube could not read.', 'EBADREPLY')
  return { switched: switched[1] === 'true', server: gvariantString(text, 'server'), message: gvariantString(text, 'message') }
}

export function pipeTransport (path, { switchTimeoutMs = SWITCH_TIMEOUT_MS, statusTimeoutMs = STATUS_TIMEOUT_MS } = {}) {
  return {
    kind: 'pipe',
    async status () {
      try {
        const reply = await pipeRequest(path, '{"command":"status"}', statusTimeoutMs)
        return { available: true, ...parseStatusReply(reply) }
      } catch (error) {
        // One request at a time: a busy pipe means a switch is running.
        if (error.code === 'EBUSY' || error.code === 'ETIMEDOUT') return { available: true, busy: true, connected: null, server: '' }
        return { available: false }
      }
    },
    async quickSwitch () {
      let reply
      try {
        reply = await pipeRequest(path, 'QuickSwitch', switchTimeoutMs)
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED') throw coded('The Proton VPN app is not running.', 'EUNAVAILABLE')
        if (error.code === 'EBUSY') throw coded('The Proton VPN app is busy with another request.', 'EBUSY')
        throw error
      }
      return parseSwitchReply(reply)
    }
  }
}

function run (execFile, file, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        if (error.killed || error.signal === 'SIGTERM') reject(coded('No answer in time', 'ETIMEDOUT'))
        else reject(Object.assign(error, { stderr: String(stderr ?? '') }))
      } else {
        resolve(String(stdout))
      }
    })
  })
}

export function dbusTransport (execFile = nodeExecFile) {
  const seconds = Math.ceil(SWITCH_TIMEOUT_MS / 1000)
  // Tools are tried in order; ENOENT moves on to the next one.
  const tools = [
    {
      hasOwner: ['busctl', ['--user', '--json=short', 'call', 'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'NameHasOwner', 's', BUS_NAME]],
      readOwner: text => JSON.parse(text)?.data?.[0] === true,
      call: ['busctl', ['--user', '--json=short', `--timeout=${seconds}`, 'call', BUS_NAME, OBJECT_PATH, BUS_NAME, 'QuickSwitch']],
      parse: parseBusctlReply
    },
    {
      hasOwner: ['gdbus', ['call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus', '--method', 'org.freedesktop.DBus.NameHasOwner', BUS_NAME]],
      readOwner: text => text.includes('true'),
      call: ['gdbus', ['call', '--session', '--timeout', String(seconds), '--dest', BUS_NAME, '--object-path', OBJECT_PATH, '--method', `${BUS_NAME}.QuickSwitch`]],
      parse: parseGdbusReply
    }
  ]
  async function each (work) {
    let last
    for (const tool of tools) {
      try {
        return await work(tool)
      } catch (error) {
        last = error
        if (error.code !== 'ENOENT') throw error
      }
    }
    throw coded('Neither busctl nor gdbus is installed, so DD FreeTube cannot reach the Proton VPN app.', last?.code ?? 'ENOENT')
  }
  return {
    kind: 'dbus',
    async status () {
      try {
        const owned = await each(tool => run(execFile, ...tool.hasOwner, STATUS_TIMEOUT_MS).then(tool.readOwner))
        // The bus call has no status method, so the server is not known here.
        return owned ? { available: true, connected: null, server: '' } : { available: false }
      } catch {
        return { available: false }
      }
    },
    async quickSwitch () {
      return each(async tool => {
        let text
        try {
          text = await run(execFile, ...tool.call, SWITCH_TIMEOUT_MS + 5000)
        } catch (error) {
          if (/ServiceUnknown|NameHasNoOwner|not provided by any \.service|was not provided/i.test(error.stderr ?? '')) {
            throw coded('The Proton VPN app is not running.', 'EUNAVAILABLE')
          }
          if (/NoReply|Timeout|timed out/i.test(error.stderr ?? '')) throw coded('No answer in time', 'ETIMEDOUT')
          throw error
        }
        return tool.parse(text)
      })
    }
  }
}

export function unsupportedTransport () {
  return {
    kind: 'none',
    async status () { return { available: false, unsupported: true } },
    async quickSwitch () { throw coded('Switching Proton VPN servers is not available on this system.', 'EUNSUPPORTED') }
  }
}

/** The transport for this system, or the one DD_PROTON_CONTROL names. */
export function transportFor ({ platform = process.platform, env = process.env, execFile } = {}) {
  const override = env.DD_PROTON_CONTROL
  if (typeof override === 'string' && override.startsWith('pipe:') && override.length > 5) return pipeTransport(override.slice(5))
  if (platform === 'win32') return pipeTransport(PIPE_NAME)
  if (platform === 'linux') return dbusTransport(execFile)
  return unsupportedTransport()
}

/**
 * The one switch for the whole app. A second request while one runs waits
 * for the same result, so two windows never stack switches.
 *
 * State codes: unknown, unsupported, unavailable, ready, busy, switching
 * (step: tunnel | network), switched, failed, no-answer.
 */
export class ProtonSwitch {
  constructor (transport, { afterSwitch = async () => {}, onChange = () => {}, now = Date.now } = {}) {
    this.transport = transport
    this.afterSwitch = afterSwitch
    this.onChange = onChange
    this.now = now
    this.running = null
    this.state = { code: transport.kind === 'none' ? 'unsupported' : 'unknown' }
  }

  set (state) {
    this.state = { ...state, at: this.now() }
    this.onChange({ ...this.state })
    return { ...this.state }
  }

  async status () {
    if (this.running) return { ...this.state }
    const found = await this.transport.status()
    if (this.running) return { ...this.state }
    if (found.unsupported) return this.set({ code: 'unsupported' })
    if (!found.available) return this.set({ code: 'unavailable' })
    if (found.busy) return this.set({ code: 'busy' })
    return this.set({ code: 'ready', connected: found.connected ?? null, server: found.server ?? '' })
  }

  quickSwitch () {
    if (!this.running) {
      this.running = this.runSwitch().finally(() => { this.running = null })
    }
    return this.running
  }

  async runSwitch () {
    this.set({ code: 'switching', step: 'tunnel' })
    let reply
    try {
      reply = await this.transport.quickSwitch()
    } catch (error) {
      if (error.code === 'ETIMEDOUT') return this.set({ code: 'no-answer' })
      if (error.code === 'EUNAVAILABLE' || error.code === 'ENOENT') return this.set({ code: 'unavailable' })
      if (error.code === 'EUNSUPPORTED') return this.set({ code: 'unsupported' })
      if (error.code === 'EBUSY') return this.set({ code: 'busy' })
      return this.set({ code: 'failed', message: error.message || String(error) })
    }
    if (!reply.switched) return this.set({ code: 'failed', message: reply.message })
    this.set({ code: 'switching', step: 'network', server: reply.server })
    try {
      await this.afterSwitch()
    } catch {
      // The tunnel is up; a slow first request is not a reason to stop.
    }
    return this.set({ code: 'switched', server: reply.server, message: reply.message })
  }
}
