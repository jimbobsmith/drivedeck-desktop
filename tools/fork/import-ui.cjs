// Opt-in synthetic import UI check for the real unpacked Electron app.
// The file chooser returns generated fixtures; buttons/parser/journal/stores are real.
// No production assets, sandbox flags, sync engine or expected peer database is replaced.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const [repoInput, outputInput] = process.argv.slice(2);
const repo = fs.realpathSync(repoInput), output = path.resolve(outputInput), fixtures = path.join(output,'fixtures');
if (!output.replaceAll('\\','/').startsWith('D:/tmp/dd/')) throw Error('OwnedScratchRequired');
fs.mkdirSync(output,{recursive:false});
fs.mkdirSync(fixtures);
const channel='UC'+'c'.repeat(22);
fs.writeFileSync(path.join(fixtures,'profiles.db'),JSON.stringify({_id:'ui-science',name:'UI imported science',bgColor:'#112233',textColor:'#FFFFFF',subscriptions:[{id:channel,name:'Synthetic imported channel'}]})+'\n');
fs.writeFileSync(path.join(fixtures,'playlists.db'),[{_id:'ui-weekend',playlistName:'UI weekend',videos:[{videoId:'abcdefghijk'},{videoId:'abcdefghijk'}]},{_id:'watchLater',playlistName:'Watch Later',videos:[{videoId:'abcdefghijk'}]}].map(JSON.stringify).join('\n')+'\n');
fs.writeFileSync(path.join(fixtures,'history.db'),JSON.stringify({videoId:'abcdefghijk',timeWatched:1800000000000,watchProgress:12.345})+'\n');
fs.writeFileSync(path.join(fixtures,'pipepipe.json'),JSON.stringify({app_version:'test',app_version_int:1,subscriptions:[{service_id:0,url:'https://www.youtube.com/channel/UC'+'d'.repeat(22),name:'Synthetic PipePipe channel'}]}));
const profile = path.join(output,'DD FreeTube'); fs.mkdirSync(profile,{recursive:true});
for(const name of ['session','logs','crashes'])fs.mkdirSync(path.join(output,name),{recursive:true});
const settings = path.join(profile,'settings.db');
if(!fs.existsSync(settings))fs.writeFileSync(settings,[{_id:'checkForUpdates',value:false},{_id:'fetchSubscriptionsAutomatically',value:false}].map(JSON.stringify).join('\n')+'\n');
const executable = path.join(repo,'build/win-unpacked/DD FreeTube.exe');
if(!fs.existsSync(executable))throw Error('BuildUnpackedApplicationFirst');
const env={...process.env,APPDATA:output,LOCALAPPDATA:output,TEMP:output,TMP:output};
delete env.NODE_OPTIONS;delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(executable,['--inspect-brk=127.0.0.1:0','--user-data-dir='+profile],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
child.stdout.resume();
let exited,stderr='',resolveInspector,rejectInspector,ws,seq=0;
const inspector=new Promise((resolve,reject)=>{resolveInspector=resolve;rejectInspector=reject});
child.on('exit',code=>{exited=code});
child.on('error',error=>{exited=-1;rejectInspector(Error('ElectronSpawnFailed:'+error.code))});
child.stderr.on('data',bytes=>{stderr=(stderr+bytes).slice(-16384);const found=stderr.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:[^\s]+)/);if(found)resolveInspector(found[1])});
const pending=new Map(),events=new Map();
async function deadline(p,ms=20000){let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('E2EDeadline')),ms)})])}finally{clearTimeout(timer)}}
function call(method,params={}){return deadline(new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))}))}
async function evaluate(expression){const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error('MainEvaluationFailed: '+(result.exceptionDetails.exception?.description??'').slice(0,250));return result.result.value}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function renderer(expression){return evaluate(`(async()=>{const w=__ddElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('app://bundle/'));if(!w)throw Error('NoProductionWindow');return w.webContents.executeJavaScript(${JSON.stringify(expression)},true)})()`)}
function emit(value){process.stdout.write(JSON.stringify(value)+'\n')}
async function startup(){
 ws=new WebSocket(await deadline(inspector));
 ws.onmessage=event=>{const result=JSON.parse(event.data);if(result.id){const item=pending.get(result.id);if(item){pending.delete(result.id);result.error?item.reject(Error('InspectorCommandFailed')):item.resolve(result.result)}}else if(events.has(result.method)){events.get(result.method)(result.params);events.delete(result.method)}};
 await deadline(new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject}));
 await call('Runtime.enable');await call('Debugger.enable');
 const paused=new Promise(resolve=>events.set('Debugger.paused',resolve));await call('Runtime.runIfWaitingForDebugger');const frame=(await deadline(paused)).callFrames[0].callFrameId;
 const expression=`(()=>{const e=process.getBuiltinModule('module').createRequire(${JSON.stringify(path.join(repo,'package.json'))})('electron');if(e.app.isReady())throw Error('LateIsolation');globalThis.__ddElectron=e;globalThis.__ddProtocols=[];globalThis.__ddBlockedExternal=0;const originalFetch=globalThis.fetch;globalThis.fetch=(input,init)=>{const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(u.hostname!=='127.0.0.1'){__ddBlockedExternal++;return Promise.reject(Error('ExternalNetworkBlockedByE2E'))}return originalFetch(input,init)};e.app.setPath('appData',${JSON.stringify(output)});e.app.setPath('userData',${JSON.stringify(profile)});e.app.setPath('sessionData',${JSON.stringify(path.join(output,'session'))});e.app.setPath('logs',${JSON.stringify(path.join(output,'logs'))});e.app.setPath('crashDumps',${JSON.stringify(path.join(output,'crashes'))});e.app.setAsDefaultProtocolClient=scheme=>{__ddProtocols.push(['set',scheme]);return false};e.app.removeAsDefaultProtocolClient=scheme=>{__ddProtocols.push(['remove',scheme]);return false};e.app.on('session-created',s=>s.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith('app://bundle/')&&!details.url.startsWith('file:')&&!details.url.startsWith('data:')&&!details.url.startsWith('http://127.0.0.1:')})));e.app.on('browser-window-created',(_,w)=>{w.webContents.setBackgroundThrottling(false);w.on('show',()=>w.hide())});return true})()`;
 const guarded=await call('Debugger.evaluateOnCallFrame',{callFrameId:frame,expression,returnByValue:true});if(guarded.exceptionDetails)throw Error('IsolationFailed');
 await call('Debugger.resume');await call('Debugger.disable');
 let state;
 for(let n=0;n<60;n++){await sleep(250);if(exited!==undefined)throw Error('EarlyAppExit');try{state=await renderer(`({title:document.title,body:document.body.innerText.length,preload:!!window.ftElectron?.mediaSync})`)}catch{}if(state?.preload&&state.body>100)break}
 if(!state?.preload)throw Error('AppUINotReady');
 const identity=await evaluate(`({pid:process.pid,userData:__ddElectron.app.getPath('userData'),name:__ddElectron.app.getName(),version:__ddElectron.app.getVersion(),protocols:__ddProtocols})`);
 if(path.resolve(identity.userData)!==profile||identity.name!=='DD FreeTube')throw Error('ProfileIsolationMismatch');
 emit({ready:true,identity,ui:state,normalSandbox:true,externalRendererRequestsBlocked:true});
}

const assert=require('node:assert/strict');
const proofs=[];
const sha=file=>require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const state=()=>renderer(`(async()=>({profiles:await window.ftElectron.dbProfiles(1),playlists:await window.ftElectron.dbPlaylists(1),history:await window.ftElectron.dbHistory(1)}))()`);
const section=`document.querySelector('[aria-labelledby="library-import-title"]')`;
async function text(){return renderer(`(()=>{const s=${section};return s?{text:s.innerText,preview:s.querySelector('pre')?.innerText??null,busy:[...s.querySelectorAll('button')].some(b=>b.disabled)}:null})()`)}
async function waitFor(predicate){for(let n=0;n<80;n++){const v=await text();if(v&&predicate(v))return v;await sleep(150)}throw Error('ImportUIWaitTimeout:'+JSON.stringify(await text()))}
async function click(label){await renderer(`(()=>{const s=${section};const b=[...s.querySelectorAll('button')].find(b=>b.innerText.trim()===${JSON.stringify(label)});if(!b||b.disabled)throw Error('MissingEnabledButton');b.click();return true})()`)}
async function choose(names){const files=names.map(name=>path.join(fixtures,name));await evaluate(`(()=>{__ddElectron.dialog.showOpenDialog=async()=>({canceled:false,filePaths:${JSON.stringify(files)}});return true})()`);await click('Choose exports and preview');return waitFor(v=>v.preview&&!v.busy)}
async function screen(label){
 await renderer(`(()=>{${section}.scrollIntoView({block:'center'});return true})()`);
 const file=path.join(output,label+'.png');
 const capture=()=>evaluate(`(async()=>{const w=__ddElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('app://bundle/'));process.getBuiltinModule('fs').writeFileSync(${JSON.stringify(file)},(await w.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());return true})()`);
 let paintReady=false;
 for(let n=0;n<40;n++){
  await capture();await sleep(250);
  paintReady=await renderer(`(()=>{let e=${section};if(!e||document.querySelector('.fade-enter-active,.fade-enter-from,.fade-leave-active,.fade-leave-to'))return false;for(;e;e=e.parentElement){const s=getComputedStyle(e);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)<0.99)return false}return true})()`);
  if(paintReady)break;
 }
 assert(paintReady,'Import screen never became fully painted');await capture();return {file,sha256:sha(file),paintReady};
}

async function run(){
 await startup();await renderer(`(()=>{location.hash='#/settings';return true})()`);await waitFor(v=>v.text.includes('Choose exports and preview'));
 const before=await state(),files=['profiles.db','playlists.db','history.db'];
 const preview=await choose(files);assert(preview.preview.includes('Categories: 1'));assert(preview.preview.includes('Playlists: 1'));assert(preview.preview.includes('Watch Later: 1'));assert(preview.preview.includes('Watch history: 1'));assert(preview.preview.includes('Saved progress: 1'));assert.deepEqual(await state(),before);
 proofs.push({name:'FreeTube actual preview is read-only',passed:true,preview:preview.preview,screenshot:await screen('freetube-preview')});
 await click('Cancel');await waitFor(v=>!v.preview&&v.text.includes('Import canceled.'));assert.deepEqual(await state(),before);proofs.push({name:'Cancel preserves actual stores',passed:true});
 await choose(files);await click('Confirm additive merge');await waitFor(v=>!v.preview&&v.text.includes('Library merged locally.'));const committed=await state();assert(committed.profiles.some(p=>p.name==='UI imported science'&&p.subscriptions.some(c=>c.id==='UC'+'c'.repeat(22))));assert(committed.playlists.some(p=>p.playlistName==='UI weekend'&&p.videos.length===2));assert(committed.playlists.some(p=>p._id==='watchLater'&&p.videos.length===1));assert(committed.history.some(h=>h.videoId==='abcdefghijk'&&h.watchProgress===12.345));proofs.push({name:'UI confirm commits category/list/Watch Later/history/progress',passed:true,observed:committed,screenshot:await screen('freetube-committed')});
 const repeat=await choose(files);assert(!/Categories: [1-9]|Subscriptions: [1-9]|Playlists: [1-9]|Watch Later: [1-9]|Watch history: [1-9]|Saved progress: [1-9]/.test(repeat.preview));await click('Confirm additive merge');await waitFor(v=>!v.preview&&v.text.includes('Library merged locally.'));assert.deepEqual(await state(),committed);proofs.push({name:'UI reimport is a no-op',passed:true,preview:repeat.preview});
 const pipe=await choose(['pipepipe.json']);assert(pipe.preview.includes('Subscriptions: 1'));await click('Confirm additive merge');await waitFor(v=>!v.preview&&v.text.includes('Library merged locally.'));const final=await state();assert(final.profiles.find(p=>p._id==='allChannels').subscriptions.some(c=>c.id==='UC'+'d'.repeat(22)));proofs.push({name:'PipePipe JSON actual UI preview and confirm',passed:true,preview:pipe.preview,observed:final,screenshot:await screen('pipepipe-committed')});
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({passed:true,proofs,driverSha256:sha(__filename),exeSha256:sha(executable),asarSha256:sha(path.join(repo,'build/win-unpacked/resources/app.asar')),fixtureHashes:Object.fromEntries(fs.readdirSync(fixtures).map(n=>[n,sha(path.join(fixtures,n))])),limits:['native chooser selection supplied synthetically; application UI buttons, IPC/parser/journal/stores are real','PipePipe ZIP not exercised in desktop UI','no sync enrollment, personal data or provider playback']},null,2));
}
(async()=>{try{await run()}catch(error){fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:error.message,stack:error.stack,proofs},null,2));process.exitCode=1}finally{if(ws){try{await evaluate('__ddElectron.app.quit();true')}catch{}ws.close()}for(let n=0;n<100&&exited===undefined;n++)await sleep(100);if(exited===undefined){child.kill();process.exitCode=1}fs.writeFileSync(path.join(output,'exit.json'),JSON.stringify({exitCode:exited}));emit({passed:!process.exitCode,proofs:proofs.length,exitCode:exited})}})();
