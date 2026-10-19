// Offline owner-side enrollment; never sends library keys to the server.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { generateKeys, uuid, fail } from '../../src/main/media-sync/protocol.mjs';
import { protect, unprotect, validateConfig } from '../../src/main/media-sync/enrollment.mjs';
export function command(args) {
  const [action, input, outputOrCredential, passOrEndpoint, output, passwordFile] = args;
  if (action === 'create-recovery' && args.length === 4) {
    const owner = JSON.parse(readFileSync(input, 'utf8'));
    if (!uuid(owner.ownerId)) fail('invalid_owner');
    const recovery = {schema: 'drivedeck.media-sync.recovery.v1', ownerId: owner.ownerId, keys: generateKeys()};
    writeFileSync(outputOrCredential, JSON.stringify(protect(recovery, readFileSync(passOrEndpoint, 'utf8').trimEnd())), {flag: 'wx', mode: 0o600});
  } else if (action === 'enroll' && args.length === 6) {
    const passphrase = readFileSync(passwordFile, 'utf8').trimEnd(), recovery = unprotect(JSON.parse(readFileSync(input, 'utf8')), passphrase), credential = JSON.parse(readFileSync(outputOrCredential, 'utf8'));
    if (recovery.schema !== 'drivedeck.media-sync.recovery.v1' || credential.ownerId !== recovery.ownerId) fail('owner_mismatch');
    const config = validateConfig({schema: 'drivedeck.media-sync.enrollment.v1', endpoint: passOrEndpoint, credential, keys: recovery.keys});
    writeFileSync(output, JSON.stringify(protect(config, passphrase)), {flag: 'wx', mode: 0o600});
  } else fail('usage');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { command(process.argv.slice(2)); console.log('{"result":"completed"}'); } catch { console.error('{"result":"failed"}'); process.exitCode = 1; }
}
