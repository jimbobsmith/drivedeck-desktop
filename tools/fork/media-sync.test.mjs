import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AppSync } from '../../src/main/media-sync/app-sync.mjs';
import { generateKeys, randomUUID, recordKey } from '../../src/main/media-sync/protocol.mjs';
import { protect, unprotect, validateConfig } from '../../src/main/media-sync/enrollment.mjs';
const scratch = process.platform === 'win32' ? 'D:/tmp/dd' : tmpdir(); mkdirSync(scratch, {recursive: true});
const directory = mkdtempSync(join(scratch, 'freetube-app-sync-test-'));
// Load the real upstream NeDB handlers with their build-time extensionless imports, in private scratch.
process.chdir(directory); delete process.env.IS_ELECTRON_MAIN;
const hooks = registerHooks({resolve(specifier, context, next) {
  try { return next(specifier, context); } catch (error) {
    if (context.parentURL?.includes('/src/datastores/') && specifier.startsWith('.')) return next(specifier + '.js', context);
    throw error;
  }
}});
const models = await import('../../src/datastores/handlers/base.js'); await models.loadDatastores(); hooks.deregister();
const id = 'UC' + 'a'.repeat(22), videoId = 'aBcDeFgH123';
const sub = {kind: 'subscription', provider: 'youtube', id};
const resume = ms => ({kind: 'resume', provider: 'youtube', id: videoId, positionMs: ms, sessionId: randomUUID(), checkpointSeq: 1});
const config = () => ({schema: 'drivedeck.media-sync.enrollment.v1', endpoint: 'http://127.0.0.1:8789', credential: {protocol: 1, ownerId: randomUUID(), deviceId: randomUUID(), token: generateKeys().encryptionKey, serverGeneration: randomUUID()}, keys: generateKeys()});
async function fixture(t) {
  await models.history.deleteAll(); for (const p of await models.profiles.find()) await models.profiles.delete(p._id);
  const c = config(), file = join(directory, randomUUID() + '.sqlite'), app = new AppSync(file, c, models);
  t.after(() => app.close()); return {app, c, file};
}
test('actual FreeTube NeDB writes capture only portable IDs/progress and persist causal bases', async t => {
  const {app} = await fixture(t);
  await models.profiles.create({_id: 'allChannels', subscriptions: [{id, name: 'LOCAL TITLE', thumbnail: 'private'}]});
  await models.history.upsert({videoId, watchProgress: 123.456, title: 'LOCAL VIDEO'});
  await app.capture(); assert.equal(app.client.state.pending.length, 2);
  const intent = app.client.state.pending.find(p => p.payload.kind === 'resume'); assert.equal(intent.payload.positionMs, 123456); assert.equal(intent.baseRevision, 0);
  assert.equal(JSON.stringify(app.client.state.pending).includes('LOCAL'), false);
});
test('remote projection updates real NeDB models, preserves local metadata and leaves playback untouched', async t => {
  const {app} = await fixture(t);
  await models.profiles.create({_id: 'allChannels', subscriptions: [{id, name: 'retained', thumbnail: 'local'}]});
  await app.project({payload: sub, operation: 'put'});
  assert.equal((await models.profiles.find())[0].subscriptions[0].name, 'retained');
  await app.project({payload: resume(20000), operation: 'put'});
  assert.equal((await models.history.find())[0].watchProgress, 20);
  await app.project({payload: resume(20000), operation: 'remove'});
  assert.equal((await models.history.find())[0].watchProgress, undefined);
  assert.equal((await models.history.find())[0].title, 'Synced resume: ' + videoId);
});
test('projection journal replays after restart without echoing a remote checkpoint', async t => {
  const {app, c, file} = await fixture(t), p = resume(15000), key = recordKey(c.keys, p);
  app.client.state.local[key] = {payload: p, operation: 'put', revision: 1}; app.client.state.remote[key] = app.client.state.local[key];
  app.journal(); app.client.save();
  const reopened = new AppSync(file, c, models);
  try { await reopened.recover(); assert.equal((await models.history.find())[0].watchProgress, 15); assert.equal(reopened.client.state.pending.length, 0); assert.equal(reopened.client.state.projection, undefined); } finally { reopened.close(); }
});
test('local edit after interrupted projection is retained as a causal conflict rather than overwritten', async t => {
  const {app, c} = await fixture(t), p = resume(90000), key = recordKey(c.keys, p);
  await models.history.upsert({videoId, watchProgress: 30}); await app.capture(); app.client.state.pending = [];
  app.syncBase = {}; app.client.state.local[key] = {payload: p, operation: 'put', revision: 1}; app.client.state.remote[key] = app.client.state.local[key]; app.journal(); app.client.save();
  await models.history.updateWatchProgress(videoId, 10); app.syncBase = null;
  await app.recover(); assert.equal((await models.history.find())[0].watchProgress, 10); assert.equal(app.client.state.pending[0].baseRevision, 0);
});
test('reset projection removes local resume progress without deleting unrelated watch metadata', async t => {
  const {app} = await fixture(t); await models.history.upsert({videoId, watchProgress: 90, title: 'retained'}); await app.capture(); app.client.state.pending = []; app.client.state.local = {};
  app.journal(); app.client.save(); await app.recover(); assert.equal((await models.history.find())[0].watchProgress, undefined); assert.equal((await models.history.find())[0].title, 'retained'); assert.equal(app.client.state.pending.length, 0);
});
test('subscription deletion keeps named profiles consistent with allChannels', async t => {
  const {app} = await fixture(t); for (const _id of ['allChannels', 'named']) await models.profiles.create({_id, subscriptions: [{id, name: 'local'}]});
  await app.project({payload: sub, operation: 'remove'}); assert.ok((await models.profiles.find()).every(p => p.subscriptions.length === 0));
});
test('protected enrollment round trips, rejects wrong passphrase/tampering and unsafe endpoint', () => {
  const c = config(), password = 'synthetic test passphrase', e = protect(c, password);
  assert.deepEqual(validateConfig(unprotect(e, password)), c);
  assert.throws(() => unprotect(e, 'wrong test passphrase'));
  assert.throws(() => unprotect({...e, iterations: 1}, password));
  assert.throws(() => unprotect({...e, nonce: generateKeys().routingKey}, password));
  assert.throws(() => validateConfig({...c, endpoint: 'http://example.invalid'}));
});

test('offline sync preserves enabled enrollment and retry controls alongside durable local edits', async t => {
  const {app} = await fixture(t); await models.history.upsert({videoId, watchProgress: 12});
  app.client.flush = async () => ({offline: true, pending: app.client.state.pending.length});
  const result = await app.sync(); assert.equal(result.code, 'offline'); assert.equal(result.enabled, true); assert.equal(result.pending, 1); assert.equal((await models.history.find())[0].watchProgress, 12);
});
