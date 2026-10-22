// Checks never download or install. Keep consent/failure paths independently testable.
export function supportsAutomaticInstallation ({ packaged, platform, packageType, appImage }) {
  return packaged && ((platform === 'win32' && packageType === 'nsis') || (platform === 'linux' && !!appImage))
}

export class DesktopUpdates {
  constructor (updater, { supported, version, confirmDownload, confirmInstall }) {
    this.updater = updater
    this.confirmDownload = confirmDownload
    this.confirmInstall = confirmInstall
    this.supported = supported
    this.busy = false
    this.state = { code: supported ? 'idle' : 'manual', current: version }
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.allowDowngrade = false
    updater.allowPrerelease = true
    updater.channel = 'alpha'
    // Setting channel enables downgrades in electron-updater; override it after.
    updater.allowDowngrade = false
    updater.logger = null
    updater.on('checking-for-update', () => this.set('checking'))
    updater.on('update-available', info => this.set('available', { version: info.version }))
    updater.on('update-not-available', () => this.set('current'))
    updater.on('download-progress', info => this.set('downloading', { percent: Math.max(0, Math.min(100, Math.floor(info.percent || 0))) }))
    updater.on('update-downloaded', info => this.set('downloaded', { version: info.version }))
    updater.on('error', () => this.set('failed'))
    updater.on('update-cancelled', () => this.set('available'))
  }

  set (code, extra = {}) {
    this.state = { current: this.state.current, version: this.state.version, ...extra, code }
  }

  async run (action) {
    if (action === 'status') return { ...this.state }
    if (!this.supported || this.busy) return { ...this.state }
    if (!['check', 'download', 'install'].includes(action)) return { code: 'invalid_action' }
    this.busy = true
    try {
      if (action === 'check' && !['downloaded', 'downloading'].includes(this.state.code)) {
        this.set('checking')
        await this.updater.checkForUpdates()
      } else if (action === 'download' && this.state.code === 'available') {
        if (await this.confirmDownload(this.state.version)) {
          this.set('downloading', { percent: 0 })
          await this.updater.downloadUpdate()
        }
      } else if (action === 'install' && this.state.code === 'downloaded') {
        if (await this.confirmInstall(this.state.version)) this.updater.quitAndInstall(false, true)
      }
    } catch {
      this.set('failed')
    } finally {
      this.busy = false
    }
    return { ...this.state }
  }
}
