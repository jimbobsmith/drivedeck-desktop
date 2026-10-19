// Synthetic validation enrollment only. For personal libraries use media-sync-enrollment.mjs and your own private passphrase.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateKeys } from '../../src/main/media-sync/protocol.mjs';
import { protect } from '../../src/main/media-sync/enrollment.mjs';
const [platformDirectory, outputDirectory] = process.argv.slice(2);
if (!platformDirectory || !outputDirectory || process.argv.length !== 4) throw Error('PlatformAndFreshPrivateDirectoryRequired');
const output = resolve(outputDirectory);
if (!output.toLowerCase().startsWith(resolve('D:/tmp/dd').toLowerCase() + sep)) throw Error('DisposableScratchRequired');
mkdirSync(output, {mode: 0o700});
const { Store } = await import(pathToFileURL(resolve(platformDirectory, 'services/media-sync/store.mjs')));
const store = new Store(join(output, 'service.sqlite'));
try {
  const owner = store.createOwner(), keys = generateKeys();
  for (const name of ['desktop', 'android']) {
    const credential = store.enroll(owner.ownerId);
    const config = {schema: 'drivedeck.media-sync.enrollment.v1', endpoint: 'http://127.0.0.1:8789', credential, keys};
    writeFileSync(join(output, name + '-enrollment.json'), JSON.stringify(protect(config, 'synthetic test passphrase')), {flag: 'wx', mode: 0o600});
  }
  console.log('{"enrollmentsCreated":2,"syntheticOnly":true}');
} finally { store.close(); }
