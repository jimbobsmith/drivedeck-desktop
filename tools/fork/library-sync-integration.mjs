// Opt-in synthetic cross-client evidence. No personal profiles or devices; no provider/media requests.
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {registerHooks} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
const [platform,adb,serial,output]=process.argv.slice(2);
if (!platform || !adb || serial !== 'emulator-5582' || !output || !resolve(output).replaceAll('\\','/').startsWith('D:/tmp/dd/')) throw Error('Explicit platform, adb, task emulator and fresh D:/tmp/dd output required');
mkdirSync(output,{recursive:false,mode:0o700});
const exec=promisify(execFile);const run=async args => (await exec(adb,['-s',serial,...args],{timeout:90000,maxBuffer:1048576})).stdout;
assert.equal((await run(['emu','avd','name'])).trim().split(/\r?\n/)[0].trim(),'DD_Library_Sync_API36');
const source=name=>import(pathToFileURL(join(platform,'services/media-sync',name)).href);
const {Store}=await source('store.mjs');const {listen,stop}=await source('server.mjs');const {generateKeys,randomUUID}=await source('protocol.mjs');
const {AppSync}=await import('../../src/main/media-sync/app-sync.mjs');
process.chdir(output);delete process.env.IS_ELECTRON_MAIN;
const hooks=registerHooks({resolve(specifier,context,next){try{return next(specifier,context);}catch(error){if(context.parentURL?.includes('/src/datastores/')&&specifier.startsWith('.'))return next(specifier+'.js',context);throw error;}}});
const models=await import('../../src/datastores/handlers/base.js');await models.loadDatastores();hooks.deregister();
const store=new Store(join(output,'service.sqlite'));const owner=store.createOwner();const keys=generateKeys();const android=store.enroll(owner.ownerId);const desktop=store.enroll(owner.ownerId);
let server,port,app;const permit=randomUUID();const database='dd-library-'+randomUUID()+'.sqlite';
const result={schema:1,scope:'real NeDB + dedicated Room database, synthetic library, local HTTP; no provider or playback proof',phases:[]};
async function instrument(phase){const text=await run(['shell','am','instrument','-w','-r','-e','class','org.schabi.newpipe.mediasync.MediaSyncLibraryTest#actualServiceLibraryFlow','-e','libraryDatabase',database,'-e','libraryPermit',permit,'-e','libraryPhase',phase,'com.drivedeck.player.test.test/androidx.test.runner.AndroidJUnitRunner']);writeFileSync(join(output,'android-'+phase+'.log'),text,{mode:0o600});assert.match(text,/OK \(1 test\)/);result.phases.push(phase);}
try {
 ({server,baseUrl:result.localEndpoint}=await listen(store));port=server.address().port;
 const config={schema:'drivedeck.media-sync.enrollment.v1',endpoint:'http://127.0.0.1:8789',credential:android,keys,permit};
 const stage=join(output,'android-config.json');writeFileSync(stage,JSON.stringify(config),{flag:'wx',mode:0o600});
 await run(['shell','run-as','com.drivedeck.player.test','mkdir','-p','cache']);await run(['push',stage,'/data/local/tmp/dd-library-config.json']);await run(['shell','run-as','com.drivedeck.player.test','cp','/data/local/tmp/dd-library-config.json','cache/dd-library-config.json']);await run(['shell','rm','/data/local/tmp/dd-library-config.json']);await run(['reverse','tcp:8789','tcp:'+port]);
 app=new AppSync(join(output,'desktop.sqlite'),{endpoint:result.localEndpoint,credential:desktop,keys},models);app.enableLibrary();
 const id='11111111-1111-4111-8111-111111111111',videoId='aBcDeFgH123';
 await models.playlists.create({_id:'trip',ddSyncId:id,ddSyncOrigin:'trip',playlistName:'Desktop trip',videos:[{videoId},{videoId:'ZyxWVuts987'},{videoId}]});await models.playlists.create({_id:'watchLater',playlistName:'Watch Later',videos:[{videoId}]});await models.history.upsert({videoId,timeWatched:1000,title:'LOCAL TITLE'});
 assert.equal((await app.sync()).code,'synced');await instrument('receive');assert.equal((await app.sync()).code,'synced');
 let list=(await models.playlists.find()).find(p=>p.ddSyncId===id);assert.equal(list.playlistName,'Android trip');assert.deepEqual(list.videos.map(v=>v.videoId),['ZyxWVuts987',videoId,videoId]);
 await stop(server);server=undefined;await instrument('offline');await models.playlists.upsert({...list,playlistName:'Desktop concurrent'});await app.capture();
 ({server}=await listen(store,port));assert.equal((await app.sync()).code,'synced');await instrument('retry-conflict');assert.equal((await app.sync()).code,'synced');list=(await models.playlists.find()).find(p=>p.ddSyncId===id);assert.equal(list.playlistName,'Offline Android');assert.deepEqual(list.videos.map(v=>v.videoId),[videoId]);
 result.phases.push('desktop-final-convergence');result.passed=true;delete result.localEndpoint;writeFileSync(join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally {
 app?.close();if(server)await stop(server);store.close();await run(['reverse','--remove','tcp:8789']).catch(()=>{});await run(['shell','run-as','com.drivedeck.player.test','rm','-f','cache/dd-library-config.json']).catch(()=>{});
}
