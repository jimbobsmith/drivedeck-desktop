import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AppSync } from '../../src/main/media-sync/app-sync.mjs';
import { generateKeys, randomUUID, recordKey, validatePayload, open } from '../../src/main/media-sync/protocol.mjs';
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
test('actual Android-produced public profile/member vectors decrypt and route identically in the desktop production protocol',()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/public-android-profiles-v3.json',import.meta.url),'utf8'));assert.match(fixture.warning,/public.*synthetic/i);assert.equal(fixture.cases.length,2);
 for(const value of fixture.cases){assert.deepEqual(open(fixture.keys,fixture.owner,value.mutation),value.payload);assert.equal(recordKey(fixture.keys,value.payload),value.recordKey);}
});
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

const definition = () => ({kind:'profile',provider:'youtube',version:3,id:randomUUID(),name:'Trips',bgColor:'#123456',textColor:'#FFFFFF'});
const membership = (p, channel=id) => ({kind:'profile-member',provider:'youtube',version:3,id:p.id+':'+channel,profileId:p.id,channelId:channel});
async function remote(app, payload, operation='put') {
 const record={payload,operation,revision:1};app.client.state.local[recordKey(app.client.keys,payload)]=record;await app.project(record);
}
test('profiles opt in separately and use stable independent identities even with matching names and copied data',async t=>{
 const {app}=await fixture(t);await models.profiles.create({_id:'allChannels',subscriptions:[{id}]});
 for(const _id of ['first','second']) await models.profiles.create({_id,name:'Same',bgColor:'#123456',textColor:'#FFFFFF',subscriptions:[{id}]});
 await app.capture();assert.ok(app.client.state.pending.every(p=>!p.payload.kind.startsWith('profile')));app.enableProfiles();await app.capture();
 const profiles=Object.values(await app.snapshot()).filter(p=>p.kind==='profile');assert.equal(profiles.length,2);assert.notEqual(profiles[0].id,profiles[1].id);
 const old=(await models.profiles.find()).find(p=>p._id==='first');await models.profiles.create({...old,_id:'copied'});assert.equal(new Set(Object.values(await app.snapshot()).filter(p=>p.kind==='profile').map(p=>p.id)).size,3);
 const before=app.client.state.pending.length;await app.capture();const after=app.client.state.pending.length;await app.capture();assert.equal(app.client.state.pending.length,after);assert.ok(after>before);
});
test('profile membership scales beyond100 channels using individual records without truncation',async t=>{
 const {app}=await fixture(t);app.enableProfiles();const subscriptions=Array.from({length:250},(_,i)=>({id:'UC'+String(i).padStart(22,'a')}));
 await models.profiles.create({_id:'allChannels',subscriptions});await models.profiles.create({_id:'large',name:'Large',bgColor:'#000000',textColor:'#FFFFFF',subscriptions});
 const snapshot=Object.values(await app.snapshot());assert.equal(snapshot.filter(p=>p.kind==='profile-member').length,250);assert.equal(snapshot.filter(p=>p.kind==='profile').length,1);
});
test('ordinary upstream editor-shaped replacement retains UUID and deferred membership across rename/color edits',async t=>{
 const {app}=await fixture(t);app.enableProfiles();const other='UC'+'z'.repeat(22);
 await models.profiles.create({_id:'allChannels',subscriptions:[{id}]});await models.profiles.create({_id:'edited',name:'Before',bgColor:'#123456',textColor:'#FFFFFF',subscriptions:[{id}],ddSyncDeferredSubscriptions:[other]});
 await app.capture();const first=(await models.profiles.find()).find(p=>p._id==='edited');
 await models.profiles.upsert({_id:'edited',name:'After',bgColor:'#654321',textColor:'#000000',subscriptions:[{id}]});await app.capture();
 const after=(await models.profiles.find()).find(p=>p._id==='edited');assert.equal(after.ddSyncId,first.ddSyncId);assert.equal(after.ddSyncOrigin,'edited');assert.deepEqual(after.ddSyncDeferredSubscriptions,[other]);
 const edits=app.client.state.pending.filter(p=>p.payload.kind==='profile');assert.equal(edits.length,2);assert.equal(edits[0].payload.id,edits[1].payload.id);assert.equal(edits[1].payload.name,'After');assert.equal(edits[1].operation,'put');assert.ok(app.client.state.pending.every(p=>p.operation==='put'));
 await models.profiles.delete('edited');await app.capture();await models.profiles.upsert({_id:'edited',name:'Explicit fresh profile',bgColor:'#123456',textColor:'#FFFFFF',subscriptions:[]});await app.capture();
 assert.notEqual((await models.profiles.find()).find(p=>p._id==='edited').ddSyncId,first.ddSyncId);
});
test('remote name and colors update actual named profile while unsupported local membership and global metadata remain',async t=>{
 const {app}=await fixture(t);app.enableProfiles();const p=definition(),m=membership(p);await models.profiles.create({_id:'allChannels',subscriptions:[{id,name:'Retained',thumbnail:'local'}]});
 await remote(app,p);await remote(app,m);let row=(await models.profiles.find()).find(r=>r.ddSyncId===p.id);row.subscriptions.push({id:'local-other-provider',name:'Keep'});await models.profiles.upsert(row);
 await remote(app,{...p,name:'Renamed',bgColor:'#654321'});row=(await models.profiles.find()).find(r=>r.ddSyncId===p.id);assert.equal(row.name,'Renamed');assert.equal(row.bgColor,'#654321');assert.equal(row.subscriptions[0].name,'Retained');assert.ok(row.subscriptions.some(c=>c.id==='local-other-provider'));
 await remote(app,m,'remove');row=(await models.profiles.find()).find(r=>r.ddSyncId===p.id);assert.deepEqual(row.subscriptions.map(c=>c.id),['local-other-provider']);assert.equal((await models.profiles.find()).find(r=>r._id==='allChannels').subscriptions.length,1);
});
test('member arriving before definition/global subscription survives restart without silently subscribing or echo deletion',async t=>{
 const {app,c,file}=await fixture(t);app.enableProfiles();const p=definition(),m=membership(p);await remote(app,m);assert.equal((await models.profiles.find()).length,0);await remote(app,p);
 let row=(await models.profiles.find()).find(r=>r.ddSyncId===p.id);assert.deepEqual(row.subscriptions,[]);assert.deepEqual(row.ddSyncDeferredSubscriptions,[id]);
 const snapshot=await app.snapshot();assert.ok(Object.values(snapshot).some(v=>v.kind==='profile-member'));app.client.state.baseline=snapshot;app.client.save();
 const reopened=new AppSync(file,c,models);try {await reopened.capture();assert.equal(reopened.client.state.pending.length,0);await remote(reopened,sub);row=(await models.profiles.find()).find(r=>r.ddSyncId===p.id);assert.equal(row.subscriptions[0].id,id);assert.deepEqual(row.ddSyncDeferredSubscriptions,[]);}finally{reopened.close();}
});
test('global unsubscribe suppresses stale and concurrent membership without re-subscribing; profile delete suppresses orphan add',async t=>{
 const {app}=await fixture(t);app.enableProfiles();const p=definition(),m=membership(p);await remote(app,sub);await remote(app,p);await remote(app,m);await remote(app,sub,'remove');await remote(app,m);
 let rows=await models.profiles.find();assert.ok(rows.every(r=>r.subscriptions.length===0));assert.ok(!Object.values(await app.snapshot()).some(v=>v.kind==='profile-member'));
 await remote(app,p,'remove');await remote(app,m);rows=await models.profiles.find();assert.equal(rows.filter(r=>r._id!=='allChannels').length,0);
 const recreated={...p,id:randomUUID()};await remote(app,recreated);assert.equal((await models.profiles.find()).find(r=>r.ddSyncId===recreated.id).subscriptions.length,0);
});
test('profile projection journal recovery retains a local rename and preserves exact field validation',async t=>{
 const {app,c}=await fixture(t);app.enableProfiles();const p=definition();await remote(app,p);await app.capture();app.client.state.pending=[];
 const k=recordKey(c.keys,p),incoming={...p,name:'Remote'};app.client.state.local[k]={payload:incoming,operation:'put',revision:8};app.client.state.remote[k]=app.client.state.local[k];app.journal();app.client.save();
 const row=(await models.profiles.find()).find(r=>r.ddSyncId===p.id);await models.profiles.upsert({...row,name:'Local after crash'});await app.recover();assert.equal((await models.profiles.find()).find(r=>r.ddSyncId===p.id).name,'Local after crash');assert.ok(app.client.state.pending.some(entry=>entry.payload.name==='Local after crash'));
 assert.throws(()=>validatePayload({...p,name:'x'.repeat(161)}));assert.throws(()=>validatePayload({...membership(p),id:'bad'}));assert.throws(()=>validatePayload({...p,subscriptions:[]}));
 for(const name of ['\uFEFF','\uD800','\uDC00']) assert.throws(()=>validatePayload({...p,name}));
});
