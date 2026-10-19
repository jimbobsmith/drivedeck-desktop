// Explicitly authorized fresh phone/tablet validation. Refuses existing app/test packages.
// No uninstall, clear-data, emulator guard bypass, OS setting changes or personal profile use.
const fs = require('node:fs');
const path = require('node:path');
const {randomBytes} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const [exe, output, enrollment, platform, adb, serial, appApk, testApk, confirmation] = process.argv.slice(2);
if (process.argv.length !== 11 || !['--approved-fresh-phone','--approved-fresh-tablet'].includes(confirmation) || !serial || /^emulator-/.test(serial)) throw Error('ExplicitFreshDeviceApprovalRequired');
const scratch = path.resolve('D:/tmp/dd').toLowerCase()+path.sep;
for(const value of [output,enrollment]) if(!path.resolve(value).toLowerCase().startsWith(scratch)) throw Error('PrivateScratchRequired');
if(fs.existsSync(path.resolve(output)))throw Error('FreshEvidenceDirectoryRequired');
for(const value of [exe,appApk,testApk]) if(!fs.statSync(value).isFile()) throw Error('BuildArtifactRequired');
function android(args,input) {
 const r=spawnSync(adb,['-s',serial,...args],{input,encoding:'utf8',timeout:120000,maxBuffer:1048576,windowsHide:true});
 if(r.status!==0)throw Error('PhoneCommandFailed');return r.stdout;
}
for(const name of ['com.drivedeck.player.test','com.drivedeck.player.test.test']) {
 const packages=android(['shell','pm','list','packages','-u','--user','0',name]).trim().split(/\r?\n/);
 if(packages.includes('package:'+name))throw Error('ExistingPackageProtected');
}
if(['ranchu','goldfish'].includes(android(['shell','getprop','ro.hardware']).trim()))throw Error('PhysicalPhoneRequired');
if(android(['shell','getprop','ro.product.cpu.abi']).trim()!=='arm64-v8a')throw Error('Arm64PhoneRequired');
if(android(['reverse','--list']).split('\n').some(line=>/\btcp:8789\b/.test(line)))throw Error('ExistingReverseProtected');
const permit=randomBytes(32).toString('hex');
let result;
try {
 if(!android(['install','-r',appApk]).includes('Success'))throw Error('AppInstallFailed');
 if(!android(['install','-r',testApk]).includes('Success'))throw Error('TestInstallFailed');
 android(['shell',"run-as com.drivedeck.player.test sh -c 'mkdir -p no_backup && cat > no_backup/media-sync-phone-validation.permit'"],permit);
 result=spawnSync(process.execPath,[path.join(__dirname,'validate-media-sync.cjs'),exe,output,enrollment,platform,adb,serial],{env:{...process.env,DD_SYNC_FRESH_PHONE_PERMIT:permit,DD_SYNC_VALIDATION_FORM_FACTOR:confirmation.endsWith('tablet')?'tablet':'phone'},stdio:'inherit',windowsHide:true,timeout:900000});
 if(result.error)throw Error('ValidationProcessFailed');
} finally {
 // Only disposable files owned by this run. Keep the installed app and its local library.
 android(['shell','run-as','com.drivedeck.player.test','rm','-f','no_backup/media-sync-phone-validation.permit','cache/media-sync-enrollment.json','cache/media-sync-portrait.png','cache/media-sync-landscape.png']);
}
process.exitCode=result?.status ?? 1;
