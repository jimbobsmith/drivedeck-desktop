import { DatabaseSync } from 'node:sqlite';
import { deflateRawSync } from 'node:zlib';
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LibraryImporter, snapshot, parseFiles } from '../../src/main/library-import/native.mjs';
import { parseExportText } from '../../src/main/library-import/import.mjs';
const scratch=process.platform==='win32'?'D:/tmp/dd':tmpdir();mkdirSync(scratch,{recursive:true});
const dir=mkdtempSync(join(scratch,'dd-desktop-import-'));process.chdir(dir);delete process.env.IS_ELECTRON_MAIN;
const hooks=registerHooks({resolve(specifier,context,next){try{return next(specifier,context);}catch(e){if(context.parentURL?.includes('/src/datastores/')&&specifier.startsWith('.'))return next(specifier+'.js',context);throw e;}}});
const models=await import('../../src/datastores/handlers/base.js');await models.loadDatastores();hooks.deregister();
const channel='UC'+'a'.repeat(22),video='abcdefghijk';
async function reset(){for(const p of await models.profiles.find())await models.profiles.delete(p._id);for(const p of await models.playlists.find())await models.playlists.delete(p._id);await models.history.deleteAll();}
async function fixture(t){await reset();const importer=new LibraryImporter(models,join(dir,crypto.randomUUID()+'.sqlite'));t.after(()=>importer.close());return importer;}
test('actual NeDB preview leaves stores unchanged; commit creates categories with memberships, independently from playlists',async t=>{
 const importer=await fixture(t);
 const parsed=await parseExportText(JSON.stringify({_id:'science',name:'Science',bgColor:'#112233',textColor:'#FFFFFF',subscriptions:[{id:channel,name:'Source title',thumbnail:'private'}]}));
 const before=await models.profiles.find();const preview=await importer.preview([parsed]);assert.deepEqual(await models.profiles.find(),before);assert.equal(preview.summary.counts.profile,1);
 await importer.apply(preview.records);const profiles=await models.profiles.find();assert.equal(profiles.length,2);assert.equal(profiles.find(p=>p.name==='Science').subscriptions[0].id,channel);assert.equal((await models.playlists.find()).length,0);
 assert.deepEqual((await importer.preview([parsed])).summary.counts,{});assert.deepEqual((await importer.apply(parsed.records)).counts,{});
});
test('real local metadata, deliberate progress and newer history survive reimport; duplicate occurrences and Watch Later identity remain exact',async t=>{
 const importer=await fixture(t);
 await models.history.upsert({videoId:video,title:'Keep local title',timeWatched:200000,watchProgress:4});
 const history=await parseExportText(JSON.stringify({videoId:video,timeWatched:100000,watchProgress:90}));await importer.apply(history.records);
 const h=(await models.history.find())[0];assert.equal(h.title,'Keep local title');assert.equal(h.timeWatched,200000);assert.equal(h.watchProgress,4);
 const lists=await parseExportText(JSON.stringify([{_id:'ordinary',playlistName:'Watch Later',videos:[{videoId:video},{videoId:video}]},{_id:'watchLater',playlistName:'Later',videos:[{videoId:video}]}]));
 await importer.apply(lists.records);await importer.apply(lists.records);const rows=await models.playlists.find();assert.equal(rows.length,2);assert.equal(rows.find(r=>r._id==='watchLater').videos.length,1);assert.equal(rows.find(r=>r._id!=='watchLater').videos.length,2);
});
test('interrupted cross-file local import survives process reopen and preserves an intervening category rename',async t=>{
 const importer=await fixture(t);const parsed=await parseExportText(JSON.stringify({_id:'one',name:'Original',bgColor:'#000000',textColor:'#FFFFFF',subscriptions:[{id:channel}]}));
 const upsert=models.profiles.upsert;let failed=false;
 models.profiles.upsert=async function(row){const result=await upsert.call(this,row);if(row.name==='Original'&&!failed){failed=true;throw Error('simulated-power-loss');}return result;};
 try{await assert.rejects(importer.apply(parsed.records),/simulated-power-loss/);}finally{models.profiles.upsert=upsert;}
 assert.equal(importer.pending(),true);const profile=(await models.profiles.find()).find(p=>p.name==='Original');await models.profiles.upsert({...profile,name:'Local rename after interruption'});
 await assert.rejects(importer.apply(parsed.records),/unfinished_import/);
 importer.close();const reopened=new LibraryImporter(models,importer.filename);t.after(()=>reopened.close());
 await reopened.resume();assert.equal(reopened.pending(),false);const after=(await models.profiles.find()).find(p=>p._id===profile._id);assert.equal(after.name,'Local rename after interruption');assert.equal(after.subscriptions[0].id,channel);
 assert.equal((await snapshot(models)).filter(p=>p.kind==='profile').length,1);
});

test('exporting and importing existing local FreeTube identities never clones categories or changes their sync IDs',async t=>{
 const importer=await fixture(t),id=crypto.randomUUID();
 const row={_id:'existing-source-id',ddSyncId:id,ddSyncOrigin:'existing-source-id',name:'Existing',bgColor:'#000000',textColor:'#FFFFFF',subscriptions:[{id:channel,name:'Keep',thumbnail:''}]};
 await models.profiles.upsert({_id:'allChannels',name:'All Channels',bgColor:'#000000',textColor:'#FFFFFF',subscriptions:row.subscriptions});await models.profiles.upsert(row);
 const parsed=await parseExportText(JSON.stringify(row));assert.deepEqual((await importer.preview([parsed])).summary.counts,{});
 await importer.apply(parsed.records);assert.equal((await models.profiles.find()).length,2);assert.equal((await models.profiles.find()).find(p=>p._id===row._id).ddSyncId,id);
});

const crc = (bytes) => {
  let n = -1;
  for (const b of bytes) {
    n ^= b;
    for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  }
  return (n ^ -1) >>> 0;
};
function zip(bytes, { descriptor = true, name = "newpipe.db" } = {}) {
  const text = Buffer.from(name),
    compressed = deflateRawSync(bytes),
    checksum = crc(bytes),
    flags = descriptor ? 8 : 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(flags, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(text.length, 26);
  if (!descriptor) {
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(bytes.length, 22);
  }
  const desc = Buffer.alloc(descriptor ? 16 : 0);
  if (descriptor) {
    desc.writeUInt32LE(0x08074b50);
    desc.writeUInt32LE(checksum, 4);
    desc.writeUInt32LE(compressed.length, 8);
    desc.writeUInt32LE(bytes.length, 12);
  }
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(flags, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(bytes.length, 24);
  central.writeUInt16LE(text.length, 28);
  const start = local.length + text.length + compressed.length + desc.length,
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + text.length, 12);
  end.writeUInt32LE(start, 16);
  return Buffer.concat([local, text, compressed, desc, central, text, end]);
}

test('native ZIP reads descriptor archives, explicit Watch Later mapping and latest of 6001 dated history events without reading enrollment', async()=>{
 const path=join(dir,'backup.sqlite');const db=new DatabaseSync(path);
 db.exec("PRAGMA user_version=903; CREATE TABLE subscriptions(uid INTEGER,service_id INTEGER,url TEXT); CREATE TABLE streams(uid INTEGER,service_id INTEGER,url TEXT); CREATE TABLE playlists(uid INTEGER,name TEXT); CREATE TABLE playlist_stream_join(playlist_id INTEGER,stream_id INTEGER,join_index INTEGER); CREATE TABLE stream_history(stream_id INTEGER,access_date INTEGER); CREATE TABLE dd_media_sync(id INTEGER PRIMARY KEY,body TEXT); INSERT INTO dd_media_sync VALUES(1,'not enrollment JSON'),(2,'{\"watch-later\":1}'); INSERT INTO playlists VALUES(1,'Localized'); INSERT INTO playlist_stream_join VALUES(1,1,0)");
 db.prepare('INSERT INTO streams VALUES(1,0,?)').run('https://www.youtube.com/watch?v='+video);
 const insert=db.prepare('INSERT INTO stream_history VALUES(1,?)');db.exec('BEGIN');for(let n=0;n<6001;n++)insert.run(100000+n);db.exec('COMMIT');db.close();
 const archive=join(dir,'backup.zip');writeFileSync(archive,zip(readFileSync(path)));
 const [parsed]=await parseFiles([archive]);assert.equal(parsed.counts['watch-later'],1);assert.equal(parsed.records.find(p=>p.kind==='history').watchedAtMs,106000);
});
test('unrelated existing oversized playlists stay untouched during category import',async t=>{
 const importer=await fixture(t);const list={_id:'big',playlistName:'Keep',videos:Array.from({length:201},()=>({videoId:video}))};await models.playlists.upsert(list);
 const parsed=await parseExportText(JSON.stringify({_id:'new-category',name:'New',bgColor:'#000000',textColor:'#FFFFFF',subscriptions:[]}));await importer.apply(parsed.records);
 assert.deepEqual(await models.playlists.find(),[list]);
 const touching=await parseExportText(JSON.stringify({...list,videos:[]}));await assert.rejects(importer.preview([touching]),/existing_collection_not_portable/);
});
test('resume never resurrects a category deleted after an interrupted write',async t=>{
 const importer=await fixture(t),parsed=await parseExportText(JSON.stringify({_id:'deleted',name:'Delete me',bgColor:'#000000',textColor:'#FFFFFF',subscriptions:[{id:channel}]}));
 const upsert=models.profiles.upsert;
 models.profiles.upsert=async function(row){const result=await upsert.call(this,row);if(row.name==='Delete me')throw Error('interrupted');return result;};
 try{await assert.rejects(importer.apply(parsed.records),/interrupted/);}finally{models.profiles.upsert=upsert;}
 const row=(await models.profiles.find()).find(p=>p.name==='Delete me');await models.profiles.delete(row._id);
 importer.close();const reopened=new LibraryImporter(models,importer.filename);t.after(()=>reopened.close());
 await assert.rejects(reopened.resume(),/import_recovery_review_required/);assert.equal((await models.profiles.find()).filter(p=>p.name==='Delete me').length,0);assert(reopened.pending());
});

test('commit recalculates available sync outbox capacity before any local write',async t=>{
 const importer=await fixture(t),parsed=await parseExportText(JSON.stringify({_id:'allChannels',subscriptions:[{id:channel}]}));
 await assert.rejects(importer.apply(parsed.records,0),/outbox_full/);assert.equal(importer.pending(),false);assert.deepEqual(await models.profiles.find(),[]);
});
