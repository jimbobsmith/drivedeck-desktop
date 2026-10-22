// Synthetic, isolated actual NeDB <-> actual service evidence; no installed app.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { AppSync } from '../../src/main/media-sync/app-sync.mjs';
import { generateKeys, randomUUID, recordKey } from '../../src/main/media-sync/protocol.mjs';
const [platform, output] = process.argv.slice(2).map(value => resolve(value));
assert.ok(platform && output && output.replaceAll('\\','/').toLowerCase().startsWith('d:/tmp/dd/'));
assert.equal(existsSync(output),false,'fresh disposable evidence directory required');mkdirSync(output,{recursive:true});
const load = path => import(pathToFileURL(join(platform,'services/media-sync',path)).href);
const [{Store},{Client},{listen,stop}] = await Promise.all([load('store.mjs'),load('client.mjs'),load('server.mjs')]);
process.chdir(output);delete process.env.IS_ELECTRON_MAIN;
const hooks=registerHooks({resolve(specifier,context,next){try{return next(specifier,context);}catch(error){if(context.parentURL?.includes('/src/datastores/')&&specifier.startsWith('.'))return next(specifier+'.js',context);throw error;}}});
const models=await import('../../src/datastores/handlers/base.js');await models.loadDatastores();hooks.deregister();
const store=new Store(':memory:'),owner=store.createOwner(),a=store.enroll(owner.ownerId),b=store.enroll(owner.ownerId),keys=generateKeys();
const {server,baseUrl}=await listen(store);const config={schema:'drivedeck.media-sync.enrollment.v1',endpoint:baseUrl,credential:a,keys};
const desktop=new AppSync(join(output,'desktop.sqlite'),config,models),peer=new Client(':memory:',baseUrl,b,keys);
desktop.enableProfiles();peer.state.profilesEnabled=true;
const pull=desktop.client.pull.bind(desktop.client);desktop.client.pull=()=>pull({pageSize:1});
const id='UC'+'a'.repeat(22),channel={kind:'subscription',provider:'youtube',id},profile={kind:'profile',provider:'youtube',version:3,id:randomUUID(),name:'Trips',bgColor:'#123456',textColor:'#FFFFFF'};
const member={kind:'profile-member',provider:'youtube',version:3,id:profile.id+':'+id,profileId:profile.id,channelId:id};
try {
 // Deliberately put membership before definition and global subscription, each
 // on its own production HTTP page. beforePullPage recovery/capture is active.
 peer.edit(member);peer.edit(profile);peer.edit(channel);await peer.flush();await desktop.sync();
 let row=(await models.profiles.find()).find(r=>r.ddSyncId===profile.id);assert.equal(row.subscriptions[0].id,id);assert.equal(desktop.client.state.pending.length,0);
 await models.profiles.upsert({_id:row._id,name:'Desktop rename',bgColor:'#654321',textColor:row.textColor,subscriptions:row.subscriptions});await desktop.sync();await peer.pull();const pk=recordKey(keys,profile);assert.equal(peer.state.local[pk].payload.name,'Desktop rename');
 // Real datastore local rename conflicts with a separate client's rename.
 row=(await models.profiles.find()).find(r=>r.ddSyncId===profile.id);await models.profiles.upsert({_id:row._id,name:'Local intent',bgColor:row.bgColor,textColor:row.textColor,subscriptions:row.subscriptions});await desktop.capture();
 peer.edit({...peer.state.local[pk].payload,name:'Other intent'});await peer.flush();const conflict=await desktop.sync();assert.equal(conflict.conflicts,1);await desktop.sync('keep-local');await peer.pull();assert.equal(peer.state.local[pk].payload.name,'Local intent');
 // An independently published member cannot undo the global unsubscribe.
 peer.edit(channel,'remove');peer.edit(member);await peer.flush();await desktop.sync();assert.ok((await models.profiles.find()).every(r=>r.subscriptions.length===0));
 await peer.pull();peer.edit(peer.state.local[pk].payload,'remove');await peer.flush();await desktop.sync();assert.equal((await models.profiles.find()).filter(r=>r._id!=='allChannels').length,0);
 const result={schema:1,passed:true,transport:'literal-loopback HTTP',datastores:'actual FreeTube NeDB handlers plus SQLite journal',pageSize:1,checks:['member-before-definition-and-global-subscription','no-echo-on-page-recovery','desktop-rename-color-to-peer','explicit-local-rename-conflict','global-unsubscribe-no-resurrection','profile-deletion-no-ghost'],personalData:false,deviceAccess:false};
 writeFileSync(join(output,'result.json'),JSON.stringify(result,null,2)+'\n');process.stdout.write(JSON.stringify(result)+'\n');
} finally {desktop.close();peer.close();await stop(server);store.close();}
