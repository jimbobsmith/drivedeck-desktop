const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawn, spawnSync} = require('node:child_process');
const executable = path.resolve(process.argv[2]);
if (!fs.statSync(executable).isFile()) throw Error('PackageExecutableRequired');
const scratch = process.env.RUNNER_TEMP || (process.platform === 'win32' ? 'D:/tmp/dd' : os.tmpdir());
const output = fs.mkdtempSync(path.join(scratch, 'dd-desktop-smoke-'));
const profile = path.join(output, 'DD FreeTube'); fs.mkdirSync(profile);
for (const name of ['session', 'logs', 'crashes']) fs.mkdirSync(path.join(output, name));
fs.writeFileSync(path.join(profile, 'settings.db'), JSON.stringify({_id:'checkForUpdates', value:false})+'\n');
const env = {...process.env, APPDATA:output, LOCALAPPDATA:output, XDG_CONFIG_HOME:output, XDG_CACHE_HOME:output, XDG_DATA_HOME:output, TEMP:output, TMP:output};
delete env.NODE_OPTIONS; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, ['--inspect-brk=127.0.0.1:0'], {env, windowsHide:true, stdio:['ignore','pipe','pipe']});
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
let exited, ws, id=0, stderr='', resolveInspector;
const inspector = new Promise(resolve=>{resolveInspector=resolve});
child.on('exit',code=>{exited=code});
child.stderr.on('data',b=>{stderr=(stderr+b).slice(-8192); const m=stderr.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:[^\s]+)/); if(m)resolveInspector(m[1]);});
child.stdout.resume();
const pending=new Map(), events=new Map();
async function deadline(p,ms=20000){let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('SmokeDeadline')),ms)})])}finally{clearTimeout(timer)}}
const call=(method,params={})=>deadline(new Promise((resolve,reject)=>{const seq=++id; pending.set(seq,{resolve,reject}); ws.send(JSON.stringify({id:seq,method,params}));}));
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true}); if(r.exceptionDetails)throw Error('RuntimeEvaluationFailed'); return r.result.value;}
const report={result:'failed', isolatedProfile:true, normalSandboxFlags:true, installerExecuted:false};
(async()=>{try{
 ws=new WebSocket(await deadline(inspector));
 ws.onmessage=e=>{const r=JSON.parse(e.data); if(r.id){const p=pending.get(r.id); if(p){pending.delete(r.id);r.error?p.reject(Error('InspectorCommandFailed')):p.resolve(r.result)}} else if(events.has(r.method)){events.get(r.method)(r.params);events.delete(r.method)}};
 await deadline(new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject}));
 await call('Runtime.enable');await call('Debugger.enable');
 const paused=new Promise(resolve=>events.set('Debugger.paused',resolve));
 await call('Runtime.runIfWaitingForDebugger');const frame=(await deadline(paused)).callFrames[0].callFrameId;
 const isolated=await call('Debugger.evaluateOnCallFrame',{callFrameId:frame,returnByValue:true,expression:`(()=>{const e=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json')('electron');if(e.app.isReady())throw Error('LateGuard');globalThis.__ddElectron=e;e.app.setPath('appData',${JSON.stringify(output)});globalThis.__ddProtocol=[];e.app.setPath('sessionData',${JSON.stringify(path.join(output,'session'))});e.app.setPath('logs',${JSON.stringify(path.join(output,'logs'))});e.app.setPath('crashDumps',${JSON.stringify(path.join(output,'crashes'))});e.app.setAsDefaultProtocolClient=scheme=>{__ddProtocol.push(['set',scheme]);return false};e.app.removeAsDefaultProtocolClient=scheme=>{__ddProtocol.push(['remove',scheme]);return false};return true})()`});
 if(isolated.exceptionDetails){report.guardErrorClass=isolated.exceptionDetails.exception?.className;throw Error('IsolationFailed');}
 await call('Debugger.resume');await call('Debugger.disable');
 for(let i=0;i<60;i++){
  await pause(1000);
  const state=await evaluate(`(async()=>{const w=__ddElectron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('app://bundle/'));if(!w)return null;return w.webContents.executeJavaScript(\`(async()=>({title:document.title,body:document.body.innerText.length,status:await window.ftElectron.desktopUpdates('status')}))()\`)})()`);
  if(state?.body>100 && state.title.includes('DD FreeTube')){report.ui=state;break}
  if(exited!==undefined)throw Error('EarlyExit');
 }
 if(!report.ui)throw Error('UINotReady');
 report.identity=await evaluate(`({defaultDirectory:process.getBuiltinModule('path').basename(__ddElectron.app.getPath('userData')),name:__ddElectron.app.getName(),version:__ddElectron.app.getVersion(),profileIsIsolated:__ddElectron.app.getPath('userData')===${JSON.stringify(profile)},protocols:__ddProtocol})`);
 if(report.identity.name!=='DD FreeTube'||report.identity.defaultDirectory!=='DD FreeTube'||!report.identity.profileIsIsolated||report.identity.protocols.some(p=>p[1]!=='dd-freetube'))throw Error('IdentityMismatch');
 if(!['idle','manual'].includes(report.ui.status.code))throw Error('UnexpectedAutomaticNetworkCheck');
 report.result='passed';
}catch(error){report.errorType=error.message}
finally{
 if(ws){try{await evaluate('__ddElectron.app.quit();true')}catch{}ws.close()}
 for(let i=0;i<200&&exited===undefined;i++)await pause(100);
 if(exited===undefined){
  if(process.platform==='win32')spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',timeout:10000});
  else child.kill();
  report.forcedTermination=true;report.result='failed';
 }
 report.exitCode=exited;
 if(exited!==0)report.result='failed';
 fs.writeFileSync(path.join('build','ui-smoke.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));process.exitCode=report.result==='passed'?0:1;
}})();
