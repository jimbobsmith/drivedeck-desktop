// Only this opt-out-controlled scheduler initiates automatic network checks.
export class AutomaticUpdateChecks {
  constructor (check, every = setInterval, cancel = clearInterval) {
    this.check = check
    this.schedule = every
    this.cancel = cancel
    this.enabled = false
    this.timer = undefined
  }

  setEnabled (enabled) {
    if (enabled === this.enabled) return
    this.enabled = enabled
    if (this.timer !== undefined) this.cancel(this.timer)
    this.timer = undefined
    if (!enabled) return
    this.check()
    this.timer = this.schedule(() => { if (this.enabled) this.check() }, 6 * 60 * 60 * 1000)
  }

  dispose () { this.setEnabled(false) }
}
