import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import config from '../../_scripts/ebuilder.config.mjs'
import pkg from '../../package.json' with { type: 'json' }
const require = createRequire(import.meta.url)
const updaterRequire = createRequire(require.resolve('electron-updater'))
const yaml = updaterRequire('js-yaml')
const semver = updaterRequire('semver')
const { GitHubProvider } = require('electron-updater/out/providers/GitHubProvider.js')
const output = process.argv[2] ?? 'build'
const windows = existsSync(join(output, 'alpha.yml'))
const metadataName = windows ? 'alpha.yml' : 'alpha-linux.yml'
const rawMetadata = readFileSync(join(output, metadataName), 'utf8')
const metadata = yaml.load(rawMetadata)
assert.equal(metadata.version, pkg.version)
const hashes = []
for (const entry of metadata.files) {
  const name = decodeURIComponent(entry.url)
  assert.equal(name, name.split(/[\\/]/).at(-1))
  const bytes = readFileSync(join(output, name))
  assert.equal(createHash('sha512').update(bytes).digest('base64'), entry.sha512)
}
const resources = join(output, windows ? 'win-unpacked' : 'linux-unpacked', 'resources')
for (const [source, shipped] of [['LICENSE', 'AGPL-3.0.txt'], ['docs/fork/UPSTREAM_NOTICE.md', 'UPSTREAM_NOTICE.md'], ['docs/fork/THIRD_PARTY_NOTICES.txt', 'THIRD_PARTY_NOTICES.txt'], ['docs/fork/production-license-inventory.json', 'production-license-inventory.json']]) {
  assert.equal(readFileSync(join(resources, 'licenses', shipped), 'utf8').replaceAll('\r\n', '\n'), readFileSync(source, 'utf8').replaceAll('\r\n', '\n'))
}
const feed = yaml.load(readFileSync(join(resources, 'app-update.yml'), 'utf8'))
assert.equal(feed.provider, 'github')
assert.equal(feed.owner, 'jimbobsmith')
assert.equal(feed.repo, 'drivedeck-desktop')
assert.equal(feed.channel, 'alpha')
const requests = []
const provider = new GitHubProvider(config.publish[0], { allowPrerelease: true, channel: 'alpha', currentVersion: semver.parse('0.1.0-alpha.0'), fullChangelog: false }, {
  platform: windows ? 'win32' : 'linux',
  executor: { request: async options => {
    requests.push(`https://${options.hostname}${options.path}`)
    return options.path.endsWith('.atom')
      ? `<feed><entry><title>DD preview</title><link href="https://github.com/jimbobsmith/drivedeck-desktop/releases/tag/v${pkg.version}"/><content>DD preview</content></entry></feed>`
      : rawMetadata
  } }
})
assert.equal((await provider.getLatestVersion()).version, pkg.version)
assert.ok(requests.every(url => url.startsWith('https://github.com/jimbobsmith/drivedeck-desktop/')))
assert.ok(requests.at(-1).endsWith('/' + metadataName))
for (const name of readdirSync(output).filter(name => /\.(exe|AppImage|deb|blockmap)$/.test(name) || /^alpha.*\.yml$/.test(name))) {
  hashes.push(`${createHash('sha256').update(readFileSync(join(output, name))).digest('hex')}  ${name}`)
}
writeFileSync(join(output, windows ? 'SHA256SUMS-windows.txt' : 'SHA256SUMS-linux.txt'), hashes.join('\n') + '\n')
writeFileSync(join(output, 'release-verification.json'), JSON.stringify({ version: pkg.version, platform: windows ? 'win32' : 'linux', generatedMetadata: metadataName, embeddedForkFeedVerified: true, actualProviderSelectionVerified: true, artifactSha512Verified: true, shippedLicenseNoticesVerified: true, sha256Files: hashes.length, signed: false }, null, 2))
console.log(`Verified ${pkg.version}: ${metadataName}, embedded fork feed, provider and ${hashes.length} hashes.`)
