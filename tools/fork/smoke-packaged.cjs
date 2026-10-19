const fs = require('node:fs');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
// Opt-in test harness for an unchanged Windows build; never a playback implementation.
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
 console.log('node tools/fork/smoke-packaged.cjs <win-unpacked/FreeTube.exe> <fresh-output-directory-under-D:/tmp/dd>');
 process.exit(0);
}
if (args.length !== 2) throw new Error('ExecutableAndFreshOutputRequired');
const executable = path.resolve(args[0]);
const output = path.resolve(args[1]);
const scratchPrefix = path.resolve('D:/tmp/dd').toLowerCase() + path.sep;
if (!output.toLowerCase().startsWith(scratchPrefix)) throw new Error('DisposableScratchOutputRequired');
if (path.basename(executable).toLowerCase() !== 'freetube.exe' || !fs.statSync(executable).isFile()) throw new Error('BuiltFreeTubeExecutableRequired');
fs.mkdirSync(output, {recursive: false});
const profile = path.join(output, 'profile');
for (const name of ['', 'session', 'logs', 'crashes', 'roaming', 'local', 'temp']) fs.mkdirSync(path.join(profile,name), {recursive:true});
const settings = {defaultVolume:0.35, checkForUpdates:false, backendFallback:false, backendPreference:'local'};
fs.writeFileSync(path.join(profile, 'settings.db'), Object.entries(settings).map(([_id,value])=>JSON.stringify({_id,value})).join('\n')+'\n');
const report = {schemaVersion:1, result:'failed', phase:'launch', applicationSourceModified:false,
  packagedExecutable:true, isolatedProfile:true, normalSandboxFlags:true, profilePreferences:settings,
  realProviderVideoId:'aqz-KE-bpKQ', syncServiceAdded:false, providerAVSyncProven:false, audibleOutputProven:false};
const env = {...process.env, APPDATA:path.join(profile,'roaming'), LOCALAPPDATA:path.join(profile,'local'), TEMP:path.join(profile,'temp'), TMP:path.join(profile,'temp')};
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
const child = spawn(executable, ['--inspect-brk=127.0.0.1:0','--user-data-dir='+profile,'--crash-dumps-dir='+path.join(profile,'crashes'),'https://www.youtube.com/watch?v=aqz-KE-bpKQ'], {env,windowsHide:false,stdio:['ignore','pipe','pipe']});
let stderr='',logBytes=0,exitCode=null,cdp;
const log=fs.createWriteStream(path.join(output,'app-private.log'));
let inspectorResolve;
const inspector = new Promise(resolve=>{inspectorResolve=resolve});
child.on('exit',code=>{exitCode=code});
for(const stream of [child.stdout,child.stderr]) stream.on('data',chunk=>{
 if(logBytes<1048576){const kept=chunk.subarray(0,1048576-logBytes);log.write(kept);logBytes+=kept.length;}
 if(stream===child.stderr && stderr.length<8192){stderr+=chunk.toString();const match=stderr.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:[^\s]+)/);if(match)inspectorResolve(match[1]);}
});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function deadline(promise,ms,label){let t;try{return await Promise.race([promise,new Promise((_,reject)=>{t=setTimeout(()=>reject(new Error(label)),ms)})])}finally{clearTimeout(t)}}
async function connect(url){
 const ws=new WebSocket(url);let id=0;const pending=new Map(),waiters=new Map();
 ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const p=pending.get(message.id);if(p){pending.delete(message.id);message.error?p.reject(new Error('InspectorCommandFailed')):p.resolve(message.result)}}else{const w=waiters.get(message.method);if(w){waiters.delete(message.method);w(message.params)}}});
 await deadline(new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})}),10000,'InspectorConnectionDeadline');
 return {call(method,params={}){const seq=++id;return deadline(new Promise((resolve,reject)=>{pending.set(seq,{resolve,reject});ws.send(JSON.stringify({id:seq,method,params}))}),10000,'InspectorCallDeadline')},event(method){return deadline(new Promise(resolve=>waiters.set(method,resolve)),10000,'InspectorEventDeadline')},close(){ws.close()}};
}
async function evaluate(expression){const value=await cdp.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(value.exceptionDetails)throw new Error('RuntimeEvaluationFailed');return value.result.value}
const sampleExpression=`(async()=>{const w=__ddElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('app://bundle/'));if(!w)return {windowFound:false};if(!w.isVisible())w.showInactive();return {windowFound:true,windowVisible:w.isVisible(),windowMinimized:w.isMinimized(),page:await w.webContents.executeJavaScript(\`(()=>({ready:document.readyState,bodyCharacters:document.body?.innerText.length||0,videos:[...document.querySelectorAll('video')].map(v=>({time:v.currentTime,duration:Number.isFinite(v.duration)?v.duration:null,paused:v.paused,ended:v.ended,muted:v.muted,volume:v.volume,readyState:v.readyState,width:v.videoWidth,height:v.videoHeight,errorCode:v.error?.code||0,frames:v.getVideoPlaybackQuality().totalVideoFrames,droppedFrames:v.getVideoPlaybackQuality().droppedVideoFrames,audioDecodedBytes:v.webkitAudioDecodedByteCount||0}))}))()\`)}})()`;
async function capture(name){await evaluate(`(async()=>{const w=__ddElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('app://bundle/'));const image=await w.webContents.capturePage();process.getBuiltinModule('fs').writeFileSync(${JSON.stringify(path.join(output,name))},image.toPNG());return true})()`)}
async function media(command){return evaluate(`(async()=>{const w=__ddElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('app://bundle/'));return w.webContents.executeJavaScript(${JSON.stringify(command)})})()`)}
(async()=>{
 try{
  cdp=await connect(await deadline(inspector,15000,'InspectorStartupDeadline'));
  await cdp.call('Runtime.enable');await cdp.call('Debugger.enable');const pause=cdp.event('Debugger.paused');
  await cdp.call('Runtime.runIfWaitingForDebugger');const paused=await pause;
  const guard=await cdp.call('Debugger.evaluateOnCallFrame',{callFrameId:paused.callFrames[0].callFrameId,returnByValue:true,expression:`(()=>{const e=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json')('electron');if(e.app.isReady())throw Error('GuardTooLate');globalThis.__ddElectron=e;globalThis.__ddProtocol={set:0,remove:0};globalThis.__ddRenderExit=[];e.app.on('web-contents-created',(_event,c)=>c.on('render-process-gone',(_event,d)=>__ddRenderExit.push({type:c.getType(),reason:d.reason,exitCode:d.exitCode})));e.app.setPath('userData',${JSON.stringify(profile)});e.app.setPath('sessionData',${JSON.stringify(path.join(profile,'session'))});e.app.setPath('logs',${JSON.stringify(path.join(profile,'logs'))});e.app.setPath('crashDumps',${JSON.stringify(path.join(profile,'crashes'))});e.app.setAsDefaultProtocolClient=()=>{__ddProtocol.set++;return false};e.app.removeAsDefaultProtocolClient=()=>{__ddProtocol.remove++;return false};return {beforeReady:!e.app.isReady(),userDataIsIsolated:e.app.getPath('userData')===${JSON.stringify(profile)},sessionDataIsIsolated:e.app.getPath('sessionData')===${JSON.stringify(path.join(profile,'session'))}}})()`});
  if(guard.exceptionDetails)throw new Error('ProfileGuardFailed');report.guard=guard.result.value;
  await cdp.call('Debugger.resume');await cdp.call('Debugger.disable');report.phase='ui';
  const samples=[];let ready;
  for(let i=0;i<90;i++){
   await sleep(1000);const sample=await evaluate(sampleExpression);samples.push(sample);
   if(sample.windowFound && sample.page.bodyCharacters>100 && !report.ui){report.ui=sample;await capture('baseline-ui.png');}
   const v=sample.page?.videos?.find(v=>v.width>0 && v.readyState>=3 && !v.paused && v.time>5 && v.frames>100);
   if(v && sample.windowVisible && !sample.windowMinimized){ready=v;break}
   if(exitCode!==null)throw new Error('ApplicationExitedBeforePlayback');
  }
  report.observationSamples=samples;
  if(!ready)throw new Error('ProviderPlaybackNotReady');report.phase='transport';
  await capture('baseline-playback.png');await sleep(5000);const advancing=(await evaluate(sampleExpression)).page.videos[0];
  report.playback={initial:ready,afterFiveSeconds:advancing};
  if(advancing.time-ready.time<3 || advancing.frames<=ready.frames)throw new Error('PlaybackDidNotAdvance');
  const pauseTime=await media('(()=>{const v=document.querySelector("video");v.pause();return v.currentTime})()');await sleep(1200);
  const held=(await evaluate(sampleExpression)).page.videos[0];report.pauseStable=held.paused && Math.abs(held.time-pauseTime)<0.25;
  await media('document.querySelector("video").play().then(()=>true)');await sleep(2500);
  const resumed=(await evaluate(sampleExpression)).page.videos[0];report.resumeAdvanced=!resumed.paused && resumed.time-held.time>1;
  const target=Math.min(resumed.time+20,ready.duration-10);await media('(()=>{document.querySelector("video").currentTime='+target+';return true})()');const seekStarted=Date.now(),seekSamples=[];let sought,seekPassed=false;
  for(let i=0;i<30;i++){await sleep(1000);sought=(await evaluate(sampleExpression)).page.videos[0];seekSamples.push(sought);if(sought.time>target+1 && sought.frames>resumed.frames && sought.readyState>=3 && !sought.paused && !sought.errorCode){seekPassed=true;break}}
  report.seek={target,waitMs:Date.now()-seekStarted,after:sought,passed:seekPassed,samples:seekSamples};
  if(seekPassed)await capture('baseline-after-seek.png');
  if(!report.pauseStable || !report.resumeAdvanced || !report.seek.passed)throw new Error('TransportValidationFailed');
  report.runtime=await evaluate('({electron:process.versions.electron,chromium:process.versions.chrome,node:process.versions.node,protocolRegistrationSuppressed:__ddProtocol,renderProcessExits:__ddRenderExit})');
  report.result='passed';report.phase='complete';
 }catch(error){report.errorType=error.message && /^[A-Za-z]+$/.test(error.message)?error.message:error.constructor.name}
 finally{
  if(cdp){try{report.runtime=await evaluate('({electron:process.versions.electron,chromium:process.versions.chrome,node:process.versions.node,protocolRegistrationSuppressed:__ddProtocol,renderProcessExits:__ddRenderExit})')}catch{}try{await evaluate('__ddElectron.app.quit();true')}catch{}cdp.close()}
  for(let i=0;i<50 && exitCode===null;i++)await sleep(100);
  report.processExitCode=exitCode;report.cleanProcessExit=exitCode===0;
  if(exitCode===null){spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',timeout:10000});report.forcedTermination=true;report.result='failed'}
  if(!report.cleanProcessExit)report.result='failed';log.end();fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({result:report.result,phase:report.phase,errorType:report.errorType,cleanProcessExit:report.cleanProcessExit,uiFound:!!report.ui,playback:!!report.playback}));
  process.exitCode=report.result==='passed'?0:1;
 }
})().catch(()=>{spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',timeout:10000});process.exitCode=1});
