import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { createTimeZonePrefCookie } from '../../src/renderer/helpers/timezone-cookie.mjs'

test('builds the PREF time zone cookie with / replaced by .', () => {
  assert.equal(createTimeZonePrefCookie('America/Winnipeg'), 'PREF=tz=America.Winnipeg')
  assert.equal(createTimeZonePrefCookie('UTC'), 'PREF=tz=UTC')
})

test('returns no cookie when the time zone cannot be resolved', () => {
  for (const timeZone of [undefined, null, '', 5]) {
    assert.equal(createTimeZonePrefCookie(timeZone), undefined)
  }
})

test('a TZ value ICU cannot resolve does not make the helper throw', () => {
  const probe = spawnSync(process.execPath, ['-e', 'console.log(JSON.stringify(Intl.DateTimeFormat().resolvedOptions().timeZone === undefined ? null : Intl.DateTimeFormat().resolvedOptions().timeZone))'], {
    env: { ...process.env, TZ: 'UTC+5' },
    encoding: 'utf8'
  })
  assert.equal(probe.status, 0)
  const timeZone = JSON.parse(probe.stdout)
  assert.doesNotThrow(() => createTimeZonePrefCookie(timeZone === null ? undefined : timeZone))
})
