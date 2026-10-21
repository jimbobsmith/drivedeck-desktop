// Opt-in asset authoring; Sharp is a separately supplied tool, not an app dependency.
// Usage: node tools/branding/generate.cjs <path-to-sharp-module>
const fs = require('node:fs');
const path = require('node:path');
if (!process.argv[2]) throw new Error('SupplySharpModulePath');
const sharp = require(path.resolve(process.argv[2]));
const root = path.resolve(__dirname, '../..');
const dir = path.join(root, '_icons');
const source = fs.readFileSync(path.join(root, 'docs/fork/branding/dd-desktop.svg'), 'utf8');
const write = (name, data) => fs.writeFileSync(path.join(dir, name), data);
const paths = [...source.matchAll(/<path[^>]* d="([^"]+)"/g)].map(m => m[1]);
if (paths.length !== 2) throw new Error('UnexpectedArtworkStructure');
const mark = source.match(/<g transform="([^"]+)"/)[1];
(async () => {
  write('icon.svg', source);
  write('iconColor.svg', source);
  // The existing web manifest points at this name; use a square application icon.
  write('logoColor.svg', source);
  await sharp(Buffer.from(source)).png().toFile(path.join(dir, 'iconColor.png'));
  const palette = JSON.parse(fs.readFileSync(path.join(root, 'docs/fork/branding/theme-colors.json'), 'utf8'));
  for (const [file, colors] of Object.entries(palette)) {
    // Retain each theme's contrast colours; replace its glyph with the DD silhouette.
    const svg = file === 'iconColorSmall.svg' ? source.replace('width="1024" height="1024"','width="25" height="25"')
        .replace('viewBox="0 0 108 108"', 'viewBox="26 22 64 64"')
        .replace(/<rect width="108" height="108" fill="url\(#[^"]+bg\)"\/>/, '')
      : `<svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" viewBox="26 22 64 64"><g transform="${mark}"><path fill-rule="evenodd" d="${paths[0]}" fill="${colors[0]}"/><path d="${paths[1]}" fill="${colors[colors.length-1]}"/></g></svg>`;
    write(file, svg);
  }
  // Windows Vista+ accepts PNG-compressed entries; include native small sizes.
  const sizes = [16,24,32,48,64,128,256];
  const pngs = await Promise.all(sizes.map(n => sharp(Buffer.from(source)).resize(n,n).png().toBuffer()));
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1,2); header.writeUInt16LE(sizes.length,4);
  let offset = header.length;
  sizes.forEach((n,i) => {
    const pos = 6 + i*16;
    header[pos] = header[pos+1] = n === 256 ? 0 : n;
    header.writeUInt16LE(1,pos+4); header.writeUInt16LE(32,pos+6);
    header.writeUInt32LE(pngs[i].length,pos+8); header.writeUInt32LE(offset,pos+12);
    offset += pngs[i].length;
  });
  write('icon.ico', Buffer.concat([header,...pngs]));
  // Modern macOS PNG chunks, including Retina representations.
  const chunks = [];
  for (const [type,size] of [['icp4',16],['icp5',32],['icp6',64],['ic07',128],['ic08',256],['ic09',512],['ic10',1024],['ic11',32],['ic12',64],['ic13',256],['ic14',512]]) {
    const data = await sharp(Buffer.from(source)).resize(size,size).png().toBuffer();
    const chunk = Buffer.alloc(8); chunk.write(type); chunk.writeUInt32BE(data.length+8,4);
    chunks.push(chunk,data);
  }
  const icns = Buffer.alloc(8); icns.write('icns'); icns.writeUInt32BE(8+chunks.reduce((n,c)=>n+c.length,0),4);
  write('iconMac.icns', Buffer.concat([icns,...chunks]));
  console.log('Generated launcher, window/tray, theme, ICO and ICNS artwork.');
})().catch(e => { console.error(e); process.exitCode = 1; });
