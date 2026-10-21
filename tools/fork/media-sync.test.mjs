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


test('expanded library is opt-in; real NeDB playlists get stable IDs and preserve order/duplicates', async t => {
  const {app} = await fixture(t); await models.playlists.deleteAll();
  await models.playlists.create({_id: 'local-list', playlistName: 'Trips', videos: [{videoId}, {videoId: 'ZyxWVuts987'}, {videoId}]});
  await models.history.upsert({videoId, timeWatched: 1700000000123, watchProgress: 2});
  await app.capture(); assert.ok(app.client.state.pending.every(p => !['playlist', 'history', 'watch-later'].includes(p.payload.kind)));
  app.enableLibrary(); await app.capture();
  const list = app.client.state.pending.find(p => p.payload.kind === 'playlist').payload;
  assert.deepEqual(list.items, [videoId, 'ZyxWVuts987', videoId]); assert.equal(list.name, 'Trips');
  assert.ok(app.client.state.pending.some(p => p.payload.kind === 'history' && p.payload.watchedAtMs === 1700000000123));
  assert.ok(app.client.state.pending.some(p => p.payload.kind === 'watch-later'));
  const before = app.client.state.pending.length; await app.capture(); assert.equal(app.client.state.pending.length, before);
  assert.equal((await models.playlists.find()).find(p => p._id === 'local-list').ddSyncId, list.id);
});
test('playlist projection renames/reorders without duplicate lists, preserves occurrence metadata and deletes', async t => {
  const {app} = await fixture(t); await models.playlists.deleteAll(); app.enableLibrary();
  const p = {kind: 'playlist', provider: 'youtube', version: 2, id: randomUUID(), name: 'Trip', items: [videoId, 'ZyxWVuts987', videoId]};
  await app.project({payload: p, operation: 'put'});
  let row = (await models.playlists.find())[0]; row.videos[0].title = 'local first'; row.videos[2].title = 'local second'; await models.playlists.upsert(row);
  await app.project({payload: {...p, name: 'Renamed', items: [videoId, videoId]}, operation: 'put'});
  const rows = await models.playlists.find(); assert.equal(rows.length, 1); row = rows[0]; assert.equal(row.playlistName, 'Renamed');
  assert.deepEqual(row.videos.map(v => v.title), ['local first', 'local second']); assert.notEqual(row.videos[0].playlistItemId, row.videos[1].playlistItemId);
  await app.project({payload: p, operation: 'remove'}); assert.equal((await models.playlists.find()).length, 0);
});
test('Watch Later uses its built-in identity rather than a display name; history deletion preserves resume', async t => {
  const {app} = await fixture(t); await models.playlists.deleteAll(); app.enableLibrary();
  await models.playlists.create({_id: 'ordinary', playlistName: 'Watch Later', videos: []});
  await app.project({payload: {kind: 'watch-later', provider: 'youtube', version: 2, id: 'watch-later', items: [videoId]}, operation: 'put'});
  const lists = await models.playlists.find(); assert.equal(lists.length, 2); assert.equal(lists.find(p => p._id === 'watchLater').videos[0].videoId, videoId);
  await models.history.upsert({videoId, watchProgress: 25, title: 'retained'});
  const h = {kind: 'history', provider: 'youtube', version: 2, id: videoId, watchedAtMs: 1700000000123};
  await app.project({payload: h, operation: 'put'}); assert.equal((await models.history.find())[0].timeWatched, h.watchedAtMs);
  await app.project({payload: h, operation: 'remove'}); const row = (await models.history.find())[0]; assert.equal(row.timeWatched, 0); assert.equal(row.watchProgress, 25); assert.equal(row.title, 'retained');
});
test('unsupported or oversized playlists fail visibly instead of truncating or recording deletions', async t => {
  const {app} = await fixture(t); await models.playlists.deleteAll(); app.enableLibrary();
  await models.playlists.create({_id: 'large', playlistName: 'Large', videos: Array.from({length: 201}, () => ({videoId}))});
  const before = JSON.stringify(app.client.state); await assert.rejects(app.capture(), /playlist_not_portable/); assert.equal(JSON.stringify(app.client.state), before);
  await models.playlists.deleteAll();
});


test('older history observations retain a newer local view and publish the merged latest time causally', async t => {
  const {app, c} = await fixture(t); await models.playlists.deleteAll(); app.enableLibrary();
  const p={kind:'history',provider:'youtube',version:2,id:videoId,watchedAtMs:1000};const k=recordKey(c.keys,p);
  await models.history.upsert({videoId,timeWatched:2000}); await app.capture();app.client.state.pending=[];
  app.client.state.local[k]={payload:p,operation:'put',revision:9};app.client.state.remote[k]=app.client.state.local[k];app.journal();app.client.save();await app.recover();
  assert.equal((await models.history.find())[0].timeWatched,2000);const next=app.client.state.pending.find(x=>x.payload.kind==='history');assert.equal(next.payload.watchedAtMs,2000);assert.equal(next.baseRevision,9);
});


test('copying a local playlist never aliases its original portable identity', async t => {
 const {app}=await fixture(t);await models.playlists.deleteAll();app.enableLibrary();await models.playlists.create({_id:'source',playlistName:'Source',videos:[]});await app.capture();
 const original=(await models.playlists.find())[0];await models.playlists.create({...original,_id:'clone',playlistName:'Copy'});const snapshot=await app.snapshot();const ids=Object.values(snapshot).filter(p=>p.kind==='playlist').map(p=>p.id);assert.equal(new Set(ids).size,2);
});
