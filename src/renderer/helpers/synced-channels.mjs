// Chooses which synced channels (name is only the ID, or no picture) to look up next. `attempted` outlives a
// page visit, so channels whose lookup failed are not retried until every other candidate has had a turn.
// Lives for the whole app run, across visits to the page.
export const hydrationAttempted = new Set()

export function pickChannelsToHydrate (channels, attempted, budget) {
  const needs = channels.filter(channel => channel.name === channel.id || !channel.thumbnail)
  let candidates = needs.filter(channel => !attempted.has(channel.id))
  if (candidates.length === 0 && needs.length > 0) {
    attempted.clear()
    candidates = needs
  }
  const picked = candidates.slice(0, budget)
  for (const channel of picked) { attempted.add(channel.id) }
  return picked
}
