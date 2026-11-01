import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { connectWithCode, deriveConnect, parseCode, serviceOrigin, unwrapKeys, wrapKeys } from '../../src/main/media-sync/connect.mjs';
import { generateKeys } from '../../src/main/media-sync/protocol.mjs';
// Same vector as drivedeck-platform services/media-sync/fixtures/connect-code-vector.json (#53).
const vector = JSON.parse(readFileSync(new URL('./fixtures/connect-code-vector.json', import.meta.url), 'utf8'));
const b = value => Buffer.from(value, 'base64url');

test('the platform connect-code vector derives and unwraps identically in the desktop main process', () => {
  for (const typed of [vector.code, vector.codeLowercaseSpaced, vector.code.replace(/1/g, 'l').replace(/0/g, 'o')]) {
    const d = deriveConnect(typed);
    assert.deepEqual([d.lookupId, d.proof, d.wrapKey.toString('base64url')], [vector.lookupId, vector.proof, vector.wrapKey]);
  }
  assert.equal(wrapKeys(vector.keys, b(vector.wrapKey), b(vector.nonce)), vector.wrappedKeys);
  assert.deepEqual(unwrapKeys(vector.wrappedKeys, b(vector.wrapKey)), vector.keys);
  assert.throws(() => parseCode(vector.code.slice(0, -1) + '9'), { code: 'invalid_code' });
  const tampered = b(vector.wrappedKeys); tampered[20] ^= 1;
  assert.throws(() => unwrapKeys(tampered.toString('base64url'), b(vector.wrapKey)), { code: 'authentication_failed' });
});

test('service addresses must be an HTTPS origin, or literal loopback HTTP for local testing', () => {
  assert.equal(serviceOrigin(' https://sync.example.test/ '), 'https://sync.example.test');
  assert.equal(serviceOrigin('http://127.0.0.1:8789'), 'http://127.0.0.1:8789');
  for (const bad of ['http://192.168.1.10:8789', 'https://sync.example.test/portal', 'https://u:p@sync.example.test', 'sync.example.test']) assert.throws(() => serviceOrigin(bad));
});

async function fakeService (t, reply) {
  const seen = [];
  const server = createServer((req, res) => {
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', () => { seen.push({ method: req.method, url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString() || 'null') }); const [status, value] = reply(seen.at(-1)); res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { address: `http://127.0.0.1:${server.address().port}/`, seen };
}

test('sign-in sends only lookup, proof and label, and stores the same config an enrollment file holds', async t => {
  const keys = generateKeys(); const credential = { protocol: 1, ownerId: randomUUID(), deviceId: randomUUID(), token: generateKeys().encryptionKey, serverGeneration: randomUUID() };
  const d = deriveConnect(vector.code);
  const f = await fakeService(t, req => req.body.lookupId === d.lookupId && req.body.proof === d.proof ? [200, { protocol: 1, credential, wrappedKeys: wrapKeys(keys, d.wrapKey, Buffer.alloc(12, 7)) }] : [403, { protocol: 1, code: 'invalid_connect_code' }]);
  const config = await connectWithCode({ address: f.address, code: vector.codeLowercaseSpaced, label: '  DD FreeTube on desk ' });
  assert.deepEqual(config, { schema: 'drivedeck.media-sync.enrollment.v1', endpoint: f.address, credential, keys });
  const sent = f.seen[0];
  assert.equal(sent.method, 'POST'); assert.equal(sent.url, '/v1/connect');
  assert.equal(sent.headers['x-dd-sync-version'], '1'); assert.equal(sent.headers.authorization, undefined);
  assert.deepEqual(sent.body, { protocol: 1, lookupId: d.lookupId, proof: d.proof, label: 'DD FreeTube on desk' });
  assert.equal(JSON.stringify(sent).includes(d.wrapKey.toString('base64url')), false);
});

test('service refusals keep their sanitized code and a wrong wrap is not accepted as keys', async t => {
  const refused = await fakeService(t, () => [403, { protocol: 1, code: 'invalid_connect_code' }]);
  await assert.rejects(connectWithCode({ address: refused.address, code: vector.code, label: 'Desk' }), { code: 'invalid_connect_code' });
  const other = deriveConnect('0000-0000-0000-0000-0000-0000-00');
  const wrong = await fakeService(t, () => [200, { protocol: 1, credential: { protocol: 1, ownerId: randomUUID(), deviceId: randomUUID(), token: generateKeys().encryptionKey, serverGeneration: randomUUID() }, wrappedKeys: wrapKeys(generateKeys(), other.wrapKey, Buffer.alloc(12)) }]);
  await assert.rejects(connectWithCode({ address: wrong.address, code: vector.code, label: 'Desk' }), { code: 'authentication_failed' });
  const extra = await fakeService(t, () => [200, { protocol: 1, credential: {}, wrappedKeys: 'x', keys: generateKeys() }]);
  await assert.rejects(connectWithCode({ address: extra.address, code: vector.code, label: 'Desk' }), { code: 'invalid_response' });
  await assert.rejects(connectWithCode({ address: refused.address, code: vector.code, label: '' }), { code: 'invalid_device_label' });
});
