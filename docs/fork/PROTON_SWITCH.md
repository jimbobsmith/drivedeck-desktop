# Proton VPN switch on a YouTube block

When YouTube blocks the address DD FreeTube plays from, DD FreeTube can ask
the Proton API client (jimbobsmith/protonvpn-linux-ui) running on the same
computer for a Quick switch, wait until that client reports the new tunnel is
up, and continue the video where it stopped. The Proton client chooses the
server (its oldest last-connected favorite that is not the current one).
DD FreeTube never picks servers, holds Proton credentials, or changes Proton
settings.

## Setting

Settings > Proton VPN switching > "On a YouTube block":

- **Switch automatically** (default). The video area shows each step:
  switching, "Connected to CA#123. Checking the connection…", then the video
  reloads at the same position.
- **Ask me first.** The video area asks "Switch to another favorite Proton VPN
  server and continue the video?" with **Switch and continue** and **Not now**.
- **Do nothing.** The upstream error stays as it was.

The setting is device-local (not exported with settings). The section also
shows whether the Proton app was found and where it is connected, and offers
**Switch server now** only when a switch can start.

## What counts as a block

- Local API playability `LOGIN_REQUIRED`/`UNPLAYABLE` with YouTube's bot check
  ("Sign in to confirm you’re not a bot", "Please sign in").
- A stream answering HTTP 429, or HTTP 403 while the watch session has not
  expired, when the stream comes from this computer (not proxied through
  Invidious).

With "Switch automatically", at most two automatic switches run for one video
and four in 15 minutes per window; after that the page says automatic switching
is paused and offers **Switch server**. A switch the user asks for is never
limited. One switch runs at a time for the whole app; a second window waits for
the same result.

## The Proton client's local request

| System | Request | Reply |
| --- | --- | --- |
| Windows | Named pipe `\\.\pipe\com.jimbobsmith.ProtonApi`, write `QuickSwitch` | One JSON object `{switched, server, message}` |
| Windows (status) | Same pipe, write `{"command":"status"}` | `{ok, message, state}`; `ok` is false without `--automation`, `state` is still the connection state |
| Linux | Session bus `com.jimbobsmith.ProtonApi`, object `/com/jimbobsmith/ProtonApi`, method `QuickSwitch` (through `busctl`, or `gdbus`) | `a{sv}` with `switched`, `server`, `message` |
| Linux (status) | `org.freedesktop.DBus.NameHasOwner` | Running or not; no server name |
| macOS | none | The feature is hidden in practice: the setting has no effect |

`switched` is true only when the new tunnel is up. The Proton client says the
reply can take a few minutes and that a caller timeout is not a result, so DD
FreeTube waits up to 10 minutes and then says "did not answer", not "failed".
After a switch it drops pooled connections and cached DNS answers and waits up
to 20 seconds for `https://www.youtube.com/generate_204` before reloading.

Code: `src/main/proton-switch.mjs` (transports and the one-at-a-time switch),
`src/main/install-proton-switch.mjs` (IPC, network settle),
`src/renderer/helpers/proton-block.mjs` (what counts, limits, setting),
`src/renderer/components/ProtonSwitchPanel.vue`,
`src/renderer/components/ProtonSwitchSettings.vue`, and the Watch page.

## Testing without a VPN

`tools/fork/proton-mock.mjs` serves the Windows pipe protocol on any path, with
scenarios `ok`, `fail`, `no-favorites`, `one-favorite`, `never`, `flaky`:

```sh
node tools/fork/proton-mock.mjs --path /tmp/dd-proton.sock --scenario ok --delay 4000
DD_PROTON_CONTROL=pipe:/tmp/dd-proton.sock pnpm run dev
```

On Windows use a pipe path such as `\\.\pipe\dd-proton-mock`.

- `pnpm run test:proton-switch`: unit tests against the mock (real sockets on
  Linux, real named pipes on the Windows CI runner) and fake `busctl`/`gdbus`.
- `node tools/fork/proton-switch-e2e.cjs <fresh-dir>` (Linux, after
  `pnpm run pack`, Playwright installed): starts the real app with a fresh
  profile against the mock and checks Settings, an automatic switch with
  replay at the same second, Ask first, and the "not running" state, saving a
  screenshot per step. A YouTube block cannot be produced on purpose, so it
  calls the Watch page's block handler, the same one the bot check and stream
  errors call.

Not proven by these: a real YouTube block, the real Proton client's reply, and
real playback after a real switch. Those need a device check.
