// Opt-in integration test driver for a REAL Electron app and production preload IPC.
// No production assets, sandbox flags, sync engine or expected peer database is replaced.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const [repoInput, outputInput, enrollmentInput] = process.argv.slice(2);
const repo = fs.realpathSync(repoInput), output = path.resolve(outputInput), enrollment = path.resolve(enrollmentInput);
if (!output.replaceAll('\\','/').startsWith('D:/tmp/dd/')) throw Error('OwnedScratchRequired');
fs.mkdirSync(output,{recursive:true});
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
async function command(command){
 switch(command.action){
 case 'enroll': {
  const status=await renderer(`window.ftElectron.mediaSync('status')`);
  if(!status.enabled){await evaluate(`(()=>{__ddElectron.dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(enrollment)}]});return true})()`);const result=await renderer(`window.ftElectron.mediaSync('import','synthetic-e2e-only-20261028')`);if(!result.enabled)throw Error('ProductionEnrollmentFailed:'+result.code)}
  return renderer(`window.ftElectron.mediaSync('enable-profiles')`);
 }
 case 'profiles': return renderer(`window.ftElectron.dbProfiles(1)`);
 case 'upsert-profile': return renderer(`window.ftElectron.dbProfiles(2,${JSON.stringify(command.profile)})`);
 case 'create-profile': return renderer(`window.ftElectron.dbProfiles(0,${JSON.stringify(command.profile)})`);
 case 'remove-profile': return renderer(`window.ftElectron.dbProfiles(3,${JSON.stringify(command.id)})`);
 case 'sync': return renderer(`window.ftElectron.mediaSync(${JSON.stringify(command.choice??'sync')})`);
 case 'status': return renderer(`window.ftElectron.mediaSync('status')`);
 case 'ui': {
  await renderer(`(()=>{location.hash='#/settings/profile';return true})()`);await sleep(300);
  const result=await renderer(`({title:document.title,text:document.body.innerText.slice(0,6000)})`);
  const destination=path.join(output,'ui-'+String(command.label??'state').replace(/[^a-z0-9-]/gi,'_')+'.png');
  await evaluate(`(async()=>{const w=__ddElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('app://bundle/'));process.getBuiltinModule('fs').writeFileSync(${JSON.stringify(destination)},(await w.webContents.capturePage()).toPNG());return true})()`);
  return {...result,screenshot:destination};
 }
 case 'quit': await evaluate('__ddElectron.app.quit();true');return {quit:true};
 default: throw Error('UnsupportedBoundedAction');
 }
}
(async()=>{try{await startup();const input=readline.createInterface({input:process.stdin});for await(const line of input){let request;try{request=JSON.parse(line);const value=await command(request);emit({id:request.id,value});if(request.action==='quit')break}catch(error){emit({id:request?.id,error:error.message})}}}catch(error){emit({fatal:error.message,stderr:stderr.split('\n').filter(line=>/error|failed/i.test(line)).slice(-4)})}finally{if(ws){try{await evaluate('__ddElectron.app.quit();true')}catch{}ws.close()}for(let n=0;n<100&&exited===undefined;n++)await sleep(100);if(exited===undefined){child.kill();process.exitCode=1}emit({closed:true,exitCode:exited})}})();
