import { app, dialog, ipcMain, shell } from 'electron'
import electronUpdater from 'electron-updater'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DesktopUpdates, supportsAutomaticInstallation } from './desktop-updates.mjs'

export function installDesktopUpdates (allowed) {
  let packageType
  try { packageType = readFileSync(join(process.resourcesPath, 'dd-package-type'), 'utf8') } catch {}
  const controller = new DesktopUpdates(electronUpdater.autoUpdater, {
    supported: supportsAutomaticInstallation({ packaged: app.isPackaged, platform: process.platform, packageType, appImage: process.env.APPIMAGE }),
    version: app.getVersion(),
    confirmDownload: async version => (await dialog.showMessageBox({
      type: 'question',
      title: 'DD FreeTube update',
      message: `Download DD FreeTube ${version}?`,
      detail: 'The update comes from the DriveDeck GitHub release. You choose when to restart. Initial preview builds are unsigned.',
      buttons: ['Cancel', 'Download'],
      defaultId: 0,
      cancelId: 0
    })).response === 1,
    confirmInstall: async version => (await dialog.showMessageBox({
      type: 'question',
      title: 'Restart DD FreeTube',
      message: `Restart and install DD FreeTube ${version}?`,
      detail: 'Playback will stop and all DD FreeTube windows will close. Your local library is retained.',
      buttons: ['Later', 'Restart and install'],
      defaultId: 0,
      cancelId: 0
    })).response === 1
  })
  ipcMain.handle('dd-desktop-updates', async (event, action) => {
    if (event.senderFrame !== event.sender.mainFrame || !allowed(event.senderFrame?.url ?? '')) return { code: 'unauthorized' }
    if (action === 'releases') {
      await shell.openExternal('https://github.com/jimbobsmith/drivedeck-desktop/releases')
      return controller.run('status')
    }
    return controller.run(action)
  })
}
