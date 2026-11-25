import { BrowserWindow, ipcMain, net, session } from 'electron'
import { ProtonSwitch, transportFor } from './proton-switch.mjs'

const NETWORK_CHECK_URL = 'https://www.youtube.com/generate_204'
const NETWORK_CHECK_MS = 20000

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

// Sockets and DNS answers from before the switch belong to the old tunnel.
// Drop them, then wait until YouTube answers through the new one.
async function settleNetwork () {
  const ses = session.defaultSession
  await ses.closeAllConnections()
  await ses.clearHostResolverCache()
  const until = Date.now() + NETWORK_CHECK_MS
  while (Date.now() < until) {
    try {
      // Each try is short: a request stuck on the old route must not hold the replay.
      const signal = AbortSignal.timeout(Math.max(1, Math.min(4000, until - Date.now())))
      const response = await net.fetch(NETWORK_CHECK_URL, { method: 'HEAD', cache: 'no-store', signal })
      if (response.status > 0) return
    } catch {}
    await delay(1000)
  }
}

export function installProtonSwitch (allowed) {
  const controller = new ProtonSwitch(transportFor(), {
    afterSwitch: settleNetwork,
    onChange: state => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send('dd-proton-switch-state', state)
      }
    }
  })
  ipcMain.handle('dd-proton-switch', async (event, action) => {
    if (event.senderFrame !== event.sender.mainFrame || !allowed(event.senderFrame?.url ?? '')) return { code: 'unauthorized' }
    if (action === 'status') return controller.status()
    if (action === 'switch') return controller.quickSwitch()
    return { code: 'invalid_action' }
  })
  return controller
}
