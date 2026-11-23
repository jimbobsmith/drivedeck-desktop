// What DD FreeTube does when YouTube blocks the address it plays from.
// Pure rules, kept apart from the Watch page so they can be tested.

export const SWITCH_MODES = Object.freeze(['automatic', 'ask', 'off'])
export const DEFAULT_SWITCH_MODE = 'automatic'

// The apostrophe is char code 8217, the one YouTube uses.
const BOT_MESSAGES = new Set(['Sign in to confirm you’re not a bot', 'Please sign in'])

/** The kind of block a local API playability status shows, or null. */
export function blockFromPlayability (playabilityStatus) {
  if (!playabilityStatus) return null
  if (playabilityStatus.status !== 'LOGIN_REQUIRED' && playabilityStatus.status !== 'UNPLAYABLE') return null
  return BOT_MESSAGES.has(playabilityStatus.reason) ? 'ip-block' : null
}

/**
 * The kind of block a stream error shows, or null. Only streams this computer
 * fetches itself count: a proxied stream comes from someone else's address.
 */
export function blockFromStreamError ({ httpStatus, expired, streamsFromThisComputer }) {
  if (!streamsFromThisComputer) return null
  if (httpStatus === 429) return 'rate-limit'
  // An expired watch session also answers 403; a new address does not fix it.
  if (httpStatus === 403 && !expired) return 'stream-403'
  return null
}

/**
 * Limits for automatic switches, so a block a new address cannot fix does not
 * keep switching servers. A switch the user asks for is never limited.
 */
export class SwitchBudget {
  constructor ({ perVideo = 2, perWindow = 4, windowMs = 15 * 60 * 1000, now = Date.now } = {}) {
    this.perVideo = perVideo
    this.perWindow = perWindow
    this.windowMs = windowMs
    this.now = now
    this.recent = []
  }

  prune () {
    const since = this.now() - this.windowMs
    this.recent = this.recent.filter(item => item.at >= since)
  }

  /** @returns {{ ok: true } | { ok: false, reason: 'video' | 'window', count: number }} */
  check (videoId) {
    this.prune()
    const forVideo = this.recent.filter(item => item.videoId === videoId).length
    if (forVideo >= this.perVideo) return { ok: false, reason: 'video', count: forVideo }
    if (this.recent.length >= this.perWindow) return { ok: false, reason: 'window', count: this.recent.length }
    return { ok: true }
  }

  record (videoId) {
    this.recent.push({ videoId, at: this.now() })
  }
}

/**
 * The first thing the Watch page shows for a block.
 * @returns {'none' | 'unavailable' | 'busy' | 'switch' | 'ask' | 'paused'}
 */
export function decide ({ mode, protonCode, budget }) {
  if (mode === 'off' || protonCode === 'unsupported' || protonCode === 'unauthorized') return 'none'
  if (protonCode === 'unavailable' || protonCode === 'unknown') return 'unavailable'
  if (protonCode === 'busy') return 'busy'
  // A switch already running (from another window) is joined, not asked about.
  if (protonCode === 'switching') return 'switch'
  if (mode === 'ask') return 'ask'
  return budget.ok ? 'switch' : 'paused'
}
