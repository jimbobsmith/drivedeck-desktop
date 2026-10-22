// Read the frozen production graph plus installed optional/peer packages.
// Include full notices conservatively, even for tree-shaken production modules.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {createRequire} = require('node:module');
const fallback = JSON.parse(fs.readFileSync('docs/fork/license-source-fallbacks.json','utf8'));
const packages = new Map();
function metadataFor(name, from) {
 const resolver=createRequire(from);
 return resolver.resolve.paths('dd-license-lookup').map(folder=>path.join(folder,name,'package.json')).find(file=>fs.existsSync(file));
}
function collect(name, from, optional=false) {
 const metadata=metadataFor(name,from);
 if(!metadata){if(optional)return;throw Error('DependencyPackageNotFound: '+name);}
 const pkg=JSON.parse(fs.readFileSync(metadata,'utf8'));
 const key=pkg.name+'@'+pkg.version;
 if(packages.has(key))return;
 const directory=path.dirname(metadata);
 const files=fs.readdirSync(directory).filter(file=>/^(licen[cs]e|copying|notice)([._-]|$)/i.test(file)&&fs.statSync(path.join(directory,file)).isFile()).sort();
 let text;
 if(files.length)text=files.map(file=>file+'\n\n'+fs.readFileSync(path.join(directory,file),'utf8').replaceAll('\r\n','\n').trimEnd()).join('\n\n');
 else {
  if(!fallback[key]||fallback[key].declaredLicense!==pkg.license)throw Error('MissingLicenseNotice: '+key);
  text=fallback[key].text.replaceAll('\r\n','\n');
 }
 const repository=typeof pkg.repository==='string'?pkg.repository:pkg.repository?.url;
 packages.set(key,{name:pkg.name,version:pkg.version,license:pkg.license,repository,noticeSource:files.length?'package-tarball':fallback[key].sources,noticeSha256:crypto.createHash('sha256').update(text).digest('hex'),text});
 const realMetadata=fs.realpathSync(metadata);
 for(const dep of Object.keys(pkg.dependencies||{}).sort())collect(dep,realMetadata,!!pkg.optionalDependencies?.[dep]);
 for(const dep of Object.keys({...pkg.optionalDependencies,...pkg.peerDependencies}).sort())collect(dep,realMetadata,true);
}
const project=JSON.parse(fs.readFileSync('package.json','utf8'));
for(const name of Object.keys(project.dependencies).sort())collect(name,path.resolve('package.json'));
const entries=[...packages].sort(([a],[b])=>a<b?-1:a>b?1:0);
const result='DD FreeTube production third-party notices\n\nApplication licensing remains AGPL-3.0-or-later. The frozen production dependency\ngraph and installed peers/optional dependencies are included conservatively, even\nwhere webpack removes code. Each dependency retains its own terms. Four upstream\nnpm packages omit standalone license files; their pinned source notices or\nexplicitly identified license declarations/standard terms are preserved below.\n\n'+entries.map(([key,value])=>'===== '+key+' =====\nLicense: '+value.license+'\nSource: '+(Array.isArray(value.noticeSource)?value.noticeSource.join('\nSource: '):value.repository||'package tarball')+'\n\n'+value.text).join('\n\n')+'\n';
const inventory=JSON.stringify(entries.map(([,value])=>{const {text,...item}=value;return item;}),null,2)+'\n';
for(const [target,contents]of [['docs/fork/THIRD_PARTY_NOTICES.txt',result],['docs/fork/production-license-inventory.json',inventory]]){
 if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8').replaceAll('\r\n','\n')!==contents)throw Error('ProductionNoticesOutOfDate');}
 else fs.writeFileSync(target,contents);
}
console.log('Production notices verified for '+packages.size+' pinned packages.');
