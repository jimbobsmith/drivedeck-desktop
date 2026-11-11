import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { appendTimeZoneCookie } from '../../src/main/timezone-cookie.mjs'

test('appends the PREF time zone cookie with / replaced by .', () => {
  assert.equal(appendTimeZoneCookie('CONSENT=YES+', 'America/Winnipeg'), 'CONSENT=YES+;PREF=tz=America.Winnipeg')
  assert.equal(appendTimeZoneCookie('A=1', 'UTC'), 'A=1;PREF=tz=UTC')
})

test('leaves the cookie alone when the time zone cannot be resolved', () => {
  for (const timeZone of [undefined, null, '', 5]) {
    assert.equal(appendTimeZoneCookie('A=1', timeZone), 'A=1')
  }
})

test('a TZ value ICU cannot resolve yields no time zone, and the helper copes', () => {
  const probe = spawnSync(process.execPath, ['-e', 'console.log(JSON.stringify(Intl.DateTimeFormat().resolvedOptions().timeZone ?? null))'], {
    env: { ...process.env, TZ: 'Bogus/Zone' },
    encoding: 'utf8'
  })
  assert.equal(probe.status, 0)
  const timeZone = JSON.parse(probe.stdout)
  // Node/ICU versions differ on whether this is undefined or a fallback name;
  // either way the helper must not throw.
  assert.doesNotThrow(() => appendTimeZoneCookie('A=1', timeZone === null ? undefined : timeZone))
})
