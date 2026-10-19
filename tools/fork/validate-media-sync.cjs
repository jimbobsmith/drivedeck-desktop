// Opt-in packaged-app validation: dedicated emulator by default; fresh phone through the approved wrapper.
// Synthetic IDs/keys and isolated profiles only. Phone mode requires a private fresh-install permit.
const fs = require('node:fs'), path = require('node:path'), {spawn, spawnSync} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const [executableArg, outputArg, enrollmentArg, platformArg, adb, serial] = process.argv.slice(2);
const executable = path.resolve(executableArg || ''), output = path.resolve(outputArg || ''), enrollment = path.resolve(enrollmentArg || '');
const phonePermit = process.env.DD_SYNC_FRESH_PHONE_PERMIT;
const phone = /^[a-f0-9]{64}$/.test(phonePermit || '');
const prefix = path.resolve('D:/tmp/dd').toLowerCase() + path.sep;
if (process.argv.length !== 8 || !output.toLowerCase().startsWith(prefix) || !enrollment.toLowerCase().startsWith(prefix) || path.basename(executable).toLowerCase() !== 'freetube.exe' || !(phone ? serial && !/^emulator-/.test(serial) : /^emulator-\d+$/.test(serial))) throw Error('ExplicitDisposableArgumentsRequired');
function android(args, input) {
 const r = spawnSync(adb, ['-s', serial, ...args], {encoding: 'utf8', input, timeout: 90000, maxBuffer: 1048576});
 if (r.status !== 0) throw Error('AndroidCommandFailed'); return r.stdout;
}
if (phone) {
 if (['ranchu','goldfish'].includes(android(['shell','getprop','ro.hardware']).trim()) ||
     android(['shell','run-as','com.drivedeck.player.test','cat','no_backup/media-sync-phone-validation.permit']).trim() !== phonePermit) throw Error('FreshPhonePermitRequired');
} else {
 if (!android(['emu','avd','name']).includes('DD_Player_Foundation_API36') || !['ranchu','goldfish'].includes(android(['shell','getprop','ro.hardware']).trim())) throw Error('DedicatedPlayerEmulatorRequired');
}
if (android(['reverse','--list']).split('\n').some(line => /\btcp:8789\b/.test(line))) throw Error('ExistingReverseMustRemainUntouched');
fs.mkdirSync(output); const profile = path.join(output, 'profile');
for (const name of ['', 'session', 'logs', 'crashes', 'roaming', 'local', 'temp']) fs.mkdirSync(path.join(profile, name), {recursive: true});
fs.writeFileSync(path.join(profile, 'settings.db'), Object.entries({checkForUpdates: false, backendFallback: false, backendPreference: 'local', landingPage: 'settings'}).map(([_id,value]) => JSON.stringify({_id,value})).join('\n')+'\n');
const env = {...process.env, APPDATA: path.join(profile,'roaming'), LOCALAPPDATA: path.join(profile,'local'), TEMP: path.join(profile,'temp'), TMP: path.join(profile,'temp')}; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
let cdp, child, server, store, exitCode = null, inspectorResolve;
const inspector = new Promise(resolve => { inspectorResolve = resolve; });
const report = {schema: 'drivedeck.media-sync.actual-apps.v1', result: 'failed', syntheticDataOnly: true, actualPackagedDesktop: true, actualAndroidAppDatabase: true, physicalDeviceTouched: phone, formFactor: phone ? (process.env.DD_SYNC_VALIDATION_FORM_FACTOR || 'phone') : 'emulator', deployed: false, playbackQualification: false};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function deadline(p, ms, code) { let timer; try { return await Promise.race([p, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(code)), ms); })]); } finally { clearTimeout(timer); } }
async function connect(url) {
 const socket = new WebSocket(url), pending = new Map(), events = new Map(); let id = 0;
 socket.addEventListener('message', event => {const m=JSON.parse(event.data); if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error('InspectorCommandFailed')):p.resolve(m.result)}}else{const w=events.get(m.method);if(w){events.delete(m.method);w(m.params)}}});
 await deadline(new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})}),10000,'InspectorConnectionDeadline');
 return {call(method,params={}){const seq=++id;return deadline(new Promise((resolve,reject)=>{pending.set(seq,{resolve,reject});socket.send(JSON.stringify({id:seq,method,params}))}),20000,'InspectorDeadline')},event(method){return deadline(new Promise(resolve=>events.set(method,resolve)),15000,'InspectorEventDeadline')},close(){socket.close()}};
}
async function evaluate(expression) {
 const r = await cdp.call('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
 if (r.exceptionDetails) {fs.writeFileSync(path.join(output,'private-inspector-error.json'),JSON.stringify(r.exceptionDetails));throw Error('RuntimeEvaluationFailed')}
 return r.result.value;
}
async function renderer(expression) { return evaluate(`(async()=>{const w=__ddElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('app://bundle/'));if(!w)throw Error('NoWindow');return w.webContents.executeJavaScript(${JSON.stringify(expression)})})()`); }
async function capture(name) { await evaluate(`(async()=>{const w=__ddElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('app://bundle/'));w.showInactive();await new Promise(r=>setTimeout(r,400));const img=await w.webContents.capturePage();process.getBuiltinModule('fs').writeFileSync(${JSON.stringify(path.join(output,name))},img.toPNG());return true})()`); }
function requireTrue(v, code) { if (!v) throw Error(code); }
async function instrument(phase, reset = false) {
 const method = phone ? (phase === 'reset' ? 'freshInstallIsEmpty' : phase === 'enroll' ? 'protectedEnrollmentThroughNativeSettings' : phase === 'ui' ? 'settingsExposeManualControlsInBothOrientations' : phase === 'secrets' ? 'enrollmentTamperingFailsAndKeysStayOutsideRoomState' : phase === 'disconnect' ? 'disconnectPreservesLocalLibrary' : 'actualAppCrossClientFlow') : null;
 const testClass = phone ? 'MediaSyncPhoneValidationTest#' + method : 'MediaSyncIntegrationTest'+(reset?(phase==='ui'?'#settingsExposeManualControlsInBothOrientations':'#actualAppCrossClientFlow'):'');
 const args = ['-s',serial,'shell','am','instrument','-w','-e','disableAnalytics','true','-e','class','org.schabi.newpipe.mediasync.'+testClass,'-e','phase',phase,...(phone?['-e','freshPhonePermit',phonePermit]:[]),'com.drivedeck.player.test.test/androidx.test.runner.AndroidJUnitRunner'];
 let androidProcess;
 let text;
 try {
  text = await deadline(new Promise((resolve,reject)=>{androidProcess=spawn(adb,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='';for(const stream of [androidProcess.stdout,androidProcess.stderr])stream.on('data',chunk=>{if(out.length<1048576)out+=chunk.toString()});androidProcess.on('error',reject);androidProcess.on('exit',code=>code===0?resolve(out):reject(Error('AndroidCommandFailed')))}),90000,'AndroidDeadline');
 } catch (error) {
  androidProcess?.kill();
  android(['shell','am','force-stop','com.drivedeck.player.test']);
  throw error;
 }
 fs.writeFileSync(path.join(output,`android-${phase}.log`),text);
 requireTrue(((phone || reset)?/OK \(1 test\)/:/OK \(4 tests\)/).test(text) && !/FAILURES|INSTRUMENTATION_FAILED/.test(text), 'AndroidPhaseFailed');
}

(async () => {
 try {
  const {Store} = await import(pathToFileURL(path.resolve(platformArg,'services/media-sync/store.mjs')));
  const service = await import(pathToFileURL(path.resolve(platformArg,'services/media-sync/server.mjs')));
  store = new Store(path.join(enrollment,'service.sqlite')); server = (await service.listen(store,8789)).server;
  android(['reverse','tcp:8789','tcp:8789']);
  android(['shell',"run-as com.drivedeck.player.test sh -c 'mkdir -p cache && cat > cache/media-sync-enrollment.json'"],fs.readFileSync(path.join(enrollment,'android-enrollment.json'),'utf8'));
  await instrument('reset', true);
  child = spawn(executable,['--inspect-brk=127.0.0.1:0','--user-data-dir='+profile],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.on('exit',code=>{exitCode=code}); let stderr='', size=0; const log=fs.createWriteStream(path.join(output,'desktop-private.log'));
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{if(size<1048576){log.write(chunk.subarray(0,1048576-size));size+=chunk.length}if(stream===child.stderr && stderr.length<8192){stderr+=chunk.toString();const match=stderr.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/);if(match)inspectorResolve(match[1])}});
  cdp=await connect(await deadline(inspector,15000,'InspectorStartupDeadline'));await cdp.call('Runtime.enable');await cdp.call('Debugger.enable');const pause=cdp.event('Debugger.paused');await cdp.call('Runtime.runIfWaitingForDebugger');const paused=await pause;
  const guard=await cdp.call('Debugger.evaluateOnCallFrame',{callFrameId:paused.callFrames[0].callFrameId,returnByValue:true,expression:`(()=>{const e=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json')('electron');if(e.app.isReady())throw Error('TooLate');globalThis.__ddElectron=e;globalThis.__ddProtocol={set:0,remove:0};e.app.setPath('userData',${JSON.stringify(profile)});e.app.setPath('sessionData',${JSON.stringify(path.join(profile,'session'))});e.app.setPath('logs',${JSON.stringify(path.join(profile,'logs'))});e.app.setPath('crashDumps',${JSON.stringify(path.join(profile,'crashes'))});e.app.setAsDefaultProtocolClient=()=>{__ddProtocol.set++;return false};e.app.removeAsDefaultProtocolClient=()=>{__ddProtocol.remove++;return false};e.dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(path.join(enrollment,'desktop-enrollment.json'))}]});return {beforeReady:true,protocolGuard:true,filePickerOnlyStubbed:true}})()`});requireTrue(!guard.exceptionDetails,'IsolationGuardFailed');report.guard=guard.result.value;
  await cdp.call('Debugger.resume');await cdp.call('Debugger.disable');
  let ready=false;for(let i=0;i<50;i++){await sleep(500);try{ready=await renderer("!!window.ftElectron?.mediaSync && document.body.innerText.includes('Personal media sync')");if(ready)break}catch{}}requireTrue(ready,'SettingsUiNotReady');
  await capture('desktop-settings-disconnected.png');
  await renderer("(()=>{const i=document.getElementById('media-sync-passphrase');i.value='synthetic test passphrase';i.dispatchEvent(new Event('input',{bubbles:true}));[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='Import protected enrollment').click();return true})()");
  let enrolled;for(let i=0;i<40;i++){await sleep(250);enrolled=await renderer("window.ftElectron.mediaSync('status')");if(enrolled.enabled&&await renderer("[...document.querySelectorAll('button')].some(b=>b.innerText.trim()==='Sync now')"))break}
report.desktopEnrollment=enrolled;requireTrue(enrolled.enabled,'DesktopEnrollmentFailed');
  // Writes use the shipped renderer bridge and production main-process handlers, not fixture databases.
  requireTrue(await renderer(`(async()=>{const a=window.ftElectron;let p=(await a.dbProfiles(1)).find(p=>p._id==='allChannels');p.subscriptions.push({id:'UC'+'a'.repeat(22),name:'Desktop local title',thumbnail:''});await a.dbProfiles(2,p);await a.dbHistory(2,{videoId:'aBcDeFgH123',title:'Desktop local video',author:'',authorId:'',watchProgress:90,timeWatched:0,lengthSeconds:600,type:'video'});return true})()`),'DesktopModelWriteFailed');
  let synced=await renderer("window.ftElectron.mediaSync('sync')");report.initialDesktopSync=synced;requireTrue(synced.code==='synced','InitialDesktopSyncFailed');
  if(phone){await instrument('enroll');report.androidNativeEnrollmentDialogAndSyncButton=true;report.androidFileChoiceIntercepted=true;}
  await instrument('receive');report.androidReceiveAndPublish=true;
  synced=await renderer("window.ftElectron.mediaSync('sync')");requireTrue(synced.code==='synced','DesktopPullFailed');
  requireTrue(await renderer(`(async()=>{const a=window.ftElectron;const p=(await a.dbProfiles(1)).find(p=>p._id==='allChannels');const h=await a.dbHistory(1);return p.subscriptions.some(c=>c.id==='UC'+'b'.repeat(22))&&h.some(v=>v.videoId==='bBcDeFgH123'&&v.watchProgress===20)})()`),'AndroidToDesktopModelsMissing');report.bidirectionalAppModels=true;
  await renderer(`(async()=>{const a=window.ftElectron;await a.dbProfiles(21,{channelId:'UC'+'a'.repeat(22),profileIds:['allChannels']});await a.dbHistory(20,{videoId:'aBcDeFgH123',watchProgress:15});return a.mediaSync('sync')})()`);
  await instrument('rewind');report.subscriptionRemovalAndDeliberateRewind=true;
  if(phone){
   await instrument('readd');
   requireTrue((await renderer("window.ftElectron.mediaSync('sync')")).code==='synced','DesktopReaddPullFailed');
   requireTrue(await renderer("window.ftElectron.dbProfiles(1).then(p=>p.find(p=>p._id==='allChannels').subscriptions.some(c=>c.id==='UC'+'a'.repeat(22)))"),'ReaddedSubscriptionMissing');
   report.acknowledgedSubscriptionReadd=true;
  }
  await service.stop(server);server=null;store.close();store=null;
  await renderer("window.ftElectron.dbHistory(20,{videoId:'aBcDeFgH123',watchProgress:12})");
  await renderer("(()=>{[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='Sync now').click();return true})()");
  let offlineControls=false;for(let i=0;i<40;i++){await sleep(250);offlineControls=await renderer("document.body.innerText.includes('Service unavailable.') && [...document.querySelectorAll('button')].some(b=>b.innerText.trim()==='Sync now') && !document.getElementById('media-sync-passphrase')");if(offlineControls)break}
  requireTrue(offlineControls,'DesktopOfflineRetryControlsLost');report.desktopOfflineLocalEditRetained=true;report.desktopOfflineRetryControlsRetained=true;
  await instrument('offline');android(['shell','am','force-stop','com.drivedeck.player.test']);report.androidOutboxSurvivesProcessStop=true;
  store=new Store(path.join(enrollment,'service.sqlite'));server=(await service.listen(store,8789)).server;await instrument('retry');
  requireTrue((await renderer("window.ftElectron.mediaSync('sync')")).code==='synced','DesktopRecoveryPullFailed');
  requireTrue(await renderer("window.ftElectron.dbHistory(1).then(h=>h.some(v=>v.videoId==='bBcDeFgH123'&&v.watchProgress===8))"),'RecoveredCheckpointMissing');report.offlineRestartRecovery=true;
  await instrument('conflict');requireTrue((await renderer("window.ftElectron.mediaSync('sync')")).code==='synced','DesktopConflictPullFailed');
  requireTrue(await renderer("window.ftElectron.dbHistory(1).then(h=>h.some(v=>v.videoId==='aBcDeFgH123'&&v.watchProgress===7))"),'ExplicitResolutionMissing');report.explicitConcurrentResumeResolution=true;
  if(phone)await instrument('secrets');
  await instrument('ui',true);
  // Refresh the real settings view, then use its actual Sync now button.
  await sleep(500);
  requireTrue(await renderer("(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='Sync now');if(!b)return false;b.click();return true})()"),'SyncButtonMissing');await sleep(1500);
  requireTrue(await renderer("document.body.innerText.includes('Sync complete.') && !document.querySelector('video')"),'SettingsStatusOrAutoplayFailure');
  report.desktopSyncButtonPassed=true;await capture('desktop-settings-synced.png');
  for(const name of ['portrait','landscape']){const r=spawnSync(adb,['-s',serial,'exec-out','run-as','com.drivedeck.player.test','cat','cache/media-sync-'+name+'.png'],{maxBuffer:10485760});requireTrue(r.status===0,'AndroidScreenshotFailed');fs.writeFileSync(path.join(output,'android-settings-'+name+'.png'),r.stdout)}report.androidSettingsBothOrientations=true;report.desktopSettingsButtonAndStatus=true;report.noDesktopAutoplay=true;
  if(phone){await instrument('disconnect');report.androidDisconnectedWithoutLibraryLoss=true;}
  report.runtime=await evaluate('({electron:process.versions.electron,node:process.versions.node,protocolGuard:__ddProtocol})');report.result='passed';
 } catch(error) { report.errorCode=/^[A-Za-z]+$/.test(error.message)?error.message:'ValidationFailed'; }
 finally {
  if(cdp){try{await evaluate('__ddElectron.app.quit();true')}catch{}cdp.close()}
  if(child){for(let i=0;i<30&&exitCode===null;i++)await sleep(100);if(exitCode===null)child.kill();report.desktopExit=exitCode}
  if(server){const service=await import(pathToFileURL(path.resolve(platformArg,'services/media-sync/server.mjs')));await service.stop(server)}store?.close();
  android(['reverse','--remove','tcp:8789']);
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(report.result!=='passed')process.exitCode=1;
 }
})();
