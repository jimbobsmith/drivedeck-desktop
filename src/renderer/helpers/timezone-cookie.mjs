/**
 * Builds the `PREF=tz=...` cookie value YouTube expects, or `undefined` when there is no usable time zone.
 *
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` is `undefined` when the TZ environment
 * variable holds a value ICU cannot resolve (for example POSIX style values such as `UTC+5`
 * or a misspelled zone). Calling `.replace()` on it threw and broke loading the watch page,
 * so the cookie is left out in that case.
 *
 * @param {unknown} timeZone resolved IANA time zone name, if there is one
 * @returns {string | undefined}
 */
export function createTimeZonePrefCookie (timeZone) {
  if (typeof timeZone !== 'string' || timeZone.length === 0) {
    return undefined
  }

  return `PREF=tz=${timeZone.replace('/', '.')}`
}
