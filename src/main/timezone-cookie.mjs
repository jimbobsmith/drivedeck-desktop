/**
 * Appends the PREF time zone cookie YouTube expects to an existing Cookie header value.
 *
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` is `undefined` when the TZ environment
 * variable holds a value ICU cannot resolve (for example POSIX style values such as `UTC+5`
 * or a misspelled zone). Calling `.replace()` on it threw an uncaught exception in the main
 * process and broke video playback, so in that case the cookie is left out instead.
 *
 * @param {string} cookie existing Cookie header value (non-empty)
 * @param {unknown} timeZone resolved IANA time zone name, if there is one
 * @returns {string}
 */
export function appendTimeZoneCookie (cookie, timeZone) {
  if (typeof timeZone !== 'string' || timeZone.length === 0) {
    return cookie
  }

  return `${cookie};PREF=tz=${timeZone.replace('/', '.')}`
}
