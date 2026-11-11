// Fills in titles for videos that arrived through sync as bare IDs ("Synced video: <id>"), without any
// change to the sync protocol. The title and channel name come from YouTube's public oEmbed endpoint,
// the same host the local backend already talks to; nothing is sent to the sync service.
const ID = /^[A-Za-z0-9_-]{11}$/
// Only the exact generated titles count, so a title the user edited (even one that starts the same way) is never replaced.
export const isPlaceholder = row => ID.test(row?.videoId ?? '') && (row.title === 'Synced video: ' + row.videoId || row.title === 'Synced resume: ' + row.videoId)
const clean = (value, max) => typeof value === 'string' ? Array.from(value, ch => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127) ? ' ' : ch).join('').trim().slice(0, max) : ''

export async function fetchOEmbed (id, fetchFn = fetch) {
  const url = 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id)
  const response = await fetchFn(url, { redirect: 'error', signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } })
  if (!response.ok) return null
  const text = await response.text()
  if (text.length > 16384) return null
  const body = JSON.parse(text)
  const title = clean(body.title, 300)
  return title ? { title, author: clean(body.author_name, 200) } : null
}

// Videos whose lookup failed in this app run. They are skipped until every other placeholder has had a turn,
// so unavailable videos cannot starve later ones; they stay eligible again after that and after a restart.
const failed = new Set()

// One bounded pass. Returns how many history rows were updated. `write` serialises each re-read and write with
// the app's other history mutations (the network fetch itself stays outside it). Only a row that still holds
// its placeholder title is changed, so local edits are never overwritten.
export async function hydrateHistory (models, { fetchFn = fetch, limit = 20, delayMs = 300, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), write = fn => fn(), skip = failed } = {}) {
  const placeholders = (await models.history.find()).filter(isPlaceholder)
  let candidates = placeholders.filter(row => !skip.has(row.videoId))
  if (candidates.length === 0 && placeholders.length > 0) { skip.clear(); candidates = placeholders }
  if (skip.size > 500) skip.clear()
  let updated = 0
  for (const row of candidates.slice(0, limit)) {
    let info = null
    try { info = await fetchOEmbed(row.videoId, fetchFn) } catch { /* Offline or blocked: try again on a later pass. */ }
    if (info) {
      await write(async () => {
        const current = (await models.history.find()).find(entry => entry.videoId === row.videoId)
        if (isPlaceholder(current)) { await models.history.upsert({ ...current, title: info.title, author: current.author || info.author }); updated += 1 }
      })
    } else skip.add(row.videoId)
    await sleep(delayMs)
  }
  return updated
}
