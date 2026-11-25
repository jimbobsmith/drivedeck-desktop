// Opt-in end-to-end check of the Proton VPN switch in the real app, against
// tools/fork/proton-mock.mjs instead of a real VPN. Linux only (it uses a Unix
// socket for the mock). Needs `pnpm run pack` first and Playwright installed.
//
//   node tools/fork/proton-switch-e2e.cjs <fresh-output-directory> [electron-executable]
//
// It uses a fresh profile in the output directory, keeps the browser sandbox
// on, and writes screenshots plus report.json there. A YouTube block cannot be
// produced on purpose, so the check calls the Watch page's block handler, the
// same one the bot check and the 403/429 stream errors call, and then watches
// the page: status, the mock switch, and the replay.

const fs = require('node:fs')
const path = require('node:path')

const [outputArg, executableArg] = process.argv.slice(2)
if (!outputArg) throw new Error('usage: proton-switch-e2e.cjs <fresh-output-directory> [electron-executable]')
const output = path.resolve(outputArg)
fs.mkdirSync(output, { recursive: false })
const root = path.resolve(__dirname, '..', '..')
const executable = executableArg ?? require(path.join(root, 'node_modules', 'electron'))
const profile = path.join(output, 'profile')
fs.mkdirSync(profile)
const settings = { checkForUpdates: false, backendFallback: false, backendPreference: 'local', protonSwitchMode: 'automatic' }
fs.writeFileSync(path.join(profile, 'settings.db'), Object.entries(settings).map(([_id, value]) => JSON.stringify({ _id, value })).join('\n') + '\n')
const socket = path.join(output, 'proton.sock')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const report = { schemaVersion: 1, result: 'failed', steps: [] }

async function main () {
  const { startProtonMock } = await import(path.join(root, 'tools', 'fork', 'proton-mock.mjs'))
  const { _electron } = require('playwright')
  const mock = await startProtonMock({ path: socket, scenario: 'ok', delayMs: 4000 })
  fs.chmodSync(socket, 0o777)
  const env = { ...process.env, DD_PROTON_CONTROL: `pipe:${socket}` }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await _electron.launch({ executablePath: executable, args: [root, `--user-data-dir=${profile}`], env, timeout: 60000 })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.setViewportSize({ width: 1280, height: 800 }).catch(() => {})
    const step = async (name, data = {}) => {
      await page.screenshot({ path: path.join(output, `${String(report.steps.length + 1).padStart(2, '0')}-${name}.png`) })
      report.steps.push({ name, ...data })
    }
    const text = selector => page.locator(selector).first().innerText({ timeout: 15000 })

    // 1. Settings shows the Proton app as found and connected.
    await page.evaluate(() => { location.hash = '#/settings' })
    const section = page.locator('text=Proton VPN switching').first()
    await section.click({ timeout: 30000 }).catch(() => {})
    await page.waitForSelector('text=The Proton VPN app is connected to CA#101', { timeout: 30000 })
    await step('settings-connected', { status: 'connected to CA#101' })

    // 2. Switch server now: the mock switches, the status follows.
    await page.locator('button:has-text("Switch server now")').click()
    await page.waitForSelector('text=The Proton VPN app is switching servers.', { timeout: 5000 })
    await step('settings-switching')
    await page.waitForSelector('text=The Proton VPN app switched to CA#202', { timeout: 30000 })
    await step('settings-switched', { server: 'CA#202' })

    // 3. A block on the Watch page in automatic mode: switch, then replay.
    await page.evaluate(() => { location.hash = '#/watch/aqz-KE-bpKQ' })
    await page.waitForFunction(() => !!document.querySelector('.videoPlayer, .errorContainer, video'), null, { timeout: 60000 })
    await sleep(1500)
    const idle = async () => {
      for (let i = 0; i < 120; i++) {
        const loading = await page.evaluate(() => {
          function findWatch () {
          // Walk the app's component tree; production builds do not tag elements.
          const seen = new Set()
          const visit = vnode => {
            if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return null
            seen.add(vnode)
            const component = vnode.component
            if (component) {
              if (component.type?.name === 'Watch') return component.proxy
              const found = visit(component.subTree)
              if (found) return found
            }
            if (vnode.suspense) {
              const found = visit(vnode.suspense.activeBranch)
              if (found) return found
            }
            if (Array.isArray(vnode.children)) {
              for (const child of vnode.children) {
                const found = visit(child)
                if (found) return found
              }
            }
            return null
          }
          const watch = visit(document.querySelector('#app').__vue_app__._container._vnode)
          if (!watch) throw new Error('Watch page not found')
          return watch
        }
          try { return findWatch().isLoading } catch { return true }
        })
        if (!loading) return
        await sleep(500)
      }
      throw new Error('The Watch page kept loading')
    }
    const block = async () => { await idle(); return page.evaluate(() => {
      function findWatch () {
      // Walk the app's component tree; production builds do not tag elements.
      const seen = new Set()
      const visit = vnode => {
        if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return null
        seen.add(vnode)
        const component = vnode.component
        if (component) {
          if (component.type?.name === 'Watch') return component.proxy
          const found = visit(component.subTree)
          if (found) return found
        }
        if (vnode.suspense) {
          const found = visit(vnode.suspense.activeBranch)
          if (found) return found
        }
        if (Array.isArray(vnode.children)) {
          for (const child of vnode.children) {
            const found = visit(child)
            if (found) return found
          }
        }
        return null
      }
      const watch = visit(document.querySelector('#app').__vue_app__._container._vnode)
      if (!watch) throw new Error('Watch page not found')
      return watch
    }
      const watch = findWatch()
      // What the bot check does: show the block, then hand it over.
      if (!watch.thumbnail) watch.thumbnail = watch.getUnavailableVideoThumbnail()
      watch.errorMessage = watch.t('Video.IP block')
      watch.isLoading = false
      watch.handleYoutubeBlock('ip-block', 42)
      return true
    }) }
    const switchesBefore = mock.switches
    await block()
    await page.waitForSelector('text=switching to another favorite server', { timeout: 10000 })
    await step('watch-switching')
    await page.waitForFunction(() => location.hash.includes('oneTimeTimestamp=42'), null, { timeout: 60000 })
    await step('watch-replayed', { switches: mock.switches - switchesBefore, hash: await page.evaluate(() => location.hash) })

    // 4. Ask first: the prompt, then Switch and continue.
    await page.evaluate(() => {
      function findWatch () {
      // Walk the app's component tree; production builds do not tag elements.
      const seen = new Set()
      const visit = vnode => {
        if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return null
        seen.add(vnode)
        const component = vnode.component
        if (component) {
          if (component.type?.name === 'Watch') return component.proxy
          const found = visit(component.subTree)
          if (found) return found
        }
        if (vnode.suspense) {
          const found = visit(vnode.suspense.activeBranch)
          if (found) return found
        }
        if (Array.isArray(vnode.children)) {
          for (const child of vnode.children) {
            const found = visit(child)
            if (found) return found
          }
        }
        return null
      }
      const watch = visit(document.querySelector('#app').__vue_app__._container._vnode)
      if (!watch) throw new Error('Watch page not found')
      return watch
    }
      findWatch().$store.dispatch('updateProtonSwitchMode', 'ask')
    })
    await page.waitForFunction(() => !!document.querySelector('.videoPlayer, .errorContainer, video'), null, { timeout: 60000 })
    await sleep(1500)
    await block()
    await page.waitForSelector('button:has-text("Switch and continue")', { timeout: 10000 })
    const question = await text('.protonSwitch')
    await step('watch-ask', { question })
    const beforeAsk = mock.switches
    await page.locator('button:has-text("Switch and continue")').click()
    await page.waitForSelector('text=switching to another favorite server', { timeout: 10000 })
    await step('watch-ask-switching')
    for (let i = 0; i < 60 && mock.switches === beforeAsk; i++) await sleep(500)
    await page.waitForSelector('text=Checking the connection', { timeout: 15000 })
    await step('watch-ask-network', { switches: mock.switches - beforeAsk })
    // The page reloads once the connection check is over (up to 20 s offline).
    await page.waitForSelector('.protonSwitch', { state: 'detached', timeout: 45000 })
    await step('watch-ask-replayed')

    // 5. The Proton app goes away: the page says so and offers only Check again.
    await mock.close()
    fs.rmSync(socket, { force: true })
    await page.waitForFunction(() => !!document.querySelector('.videoPlayer, .errorContainer, video'), null, { timeout: 60000 })
    await sleep(1500)
    await page.evaluate(() => {
      function findWatch () {
      // Walk the app's component tree; production builds do not tag elements.
      const seen = new Set()
      const visit = vnode => {
        if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return null
        seen.add(vnode)
        const component = vnode.component
        if (component) {
          if (component.type?.name === 'Watch') return component.proxy
          const found = visit(component.subTree)
          if (found) return found
        }
        if (vnode.suspense) {
          const found = visit(vnode.suspense.activeBranch)
          if (found) return found
        }
        if (Array.isArray(vnode.children)) {
          for (const child of vnode.children) {
            const found = visit(child)
            if (found) return found
          }
        }
        return null
      }
      const watch = visit(document.querySelector('#app').__vue_app__._container._vnode)
      if (!watch) throw new Error('Watch page not found')
      return watch
    }
      findWatch().$store.dispatch('updateProtonSwitchMode', 'automatic')
    })
    await block()
    await page.waitForSelector('text=is not running on this computer', { timeout: 10000 })
    const buttons = await page.locator('.protonSwitch button').allInnerTexts()
    await step('watch-unavailable', { buttons })

    report.result = 'passed'
  } catch (error) {
    await app.windows()[0]?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
    throw error
  } finally {
    report.mockRequests = mock.requests
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
    await app.close().catch(() => {})
    await mock.close().catch(() => {})
  }
}

main().then(() => console.log(JSON.stringify(report, null, 2))).catch(error => {
  report.error = String(error?.stack ?? error)
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.error(report.error)
  process.exit(1)
})
