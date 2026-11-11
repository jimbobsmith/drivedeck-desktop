// Automatic sync scheduler for the main process. It only decides *when* to call
// `run()`; all network, capture and projection work stays in AppSync.sync().
//
// - First run shortly after start, then every `intervalMs`.
// - A local change schedules a run after `debounceMs` (poke()).
// - Offline or failed runs back off exponentially up to `maxBackoffMs`.
// - A conflict or restored service (server_generation_changed / resnapshot_required) pauses it until the user acts; resume()
//   (called after a manual sync) restarts it.
const PAUSING = new Set(['conflict', 'restored_service', 'server_generation_changed', 'resnapshot_required'])

export class AutoSync {
  constructor ({ run, enabled, intervalMs = 120000, debounceMs = 15000, startDelayMs = 10000, maxBackoffMs = 1800000, setTimer = setTimeout, clearTimer = clearTimeout }) {
    Object.assign(this, { run, enabled, intervalMs, debounceMs, startDelayMs, maxBackoffMs, setTimer, clearTimer })
    this.timer = null; this.failures = 0; this.paused = false; this.stopped = true; this.running = false; this.again = false
  }

  start () { this.stopped = false; this.paused = false; this.failures = 0; this.schedule(this.startDelayMs) }
  stop () { this.stopped = true; this.cancel() }
  cancel () { if (this.timer !== null) { this.clearTimer(this.timer); this.timer = null } }
  schedule (ms) { if (this.stopped) return; this.cancel(); this.timer = this.setTimer(() => { this.timer = null; this.tick() }, ms); this.timer.unref?.() }

  // A local edit was captured. Run soon, unless the user has not enabled auto sync or a conflict is waiting.
  poke () {
    if (this.stopped || this.paused) return
    if (this.running) { this.again = true; return }
    // While runs are failing, keep the back-off timer: edits during an outage must not cause rapid retries.
    if (this.failures > 0) return
    this.schedule(this.debounceMs)
  }

  // The user acted (manual sync, conflict resolution, toggle): leave the paused state and try again.
  resume (ms = this.debounceMs) { if (this.stopped) return; this.paused = false; this.failures = 0; this.schedule(ms) }

  async tick () {
    if (this.stopped) return
    if (!this.enabled()) return this.schedule(this.intervalMs)
    if (this.paused) return
    this.running = true; this.again = false
    let code
    try { code = (await this.run())?.code } catch { code = 'sync_failed' }
    this.running = false
    if (this.stopped) return
    if (PAUSING.has(code)) { this.paused = true; return }
    if (code === 'client_busy') return this.schedule(this.debounceMs)
    if (code === 'offline' || (code && !['synced', 'pending', 'ready'].includes(code))) {
      this.failures += 1
      return this.schedule(Math.min(this.intervalMs * 2 ** this.failures, this.maxBackoffMs))
    }
    this.failures = 0
    this.schedule(this.again ? this.debounceMs : this.intervalMs)
  }
}
