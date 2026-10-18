// Rebuilds SPECTRA-standalone.html from the source files in the repo root.
//
//   node tools/build-standalone.js
//
// The previous build is the base: its loader, page shell, fonts and images are
// kept as they are. The scripts are re-packed from the current sources, and
// the page template is regenerated from VJ Fractal.dc.html with every local
// reference swapped for the uuid the bundle already uses for that file.
const fs = require('fs'), zlib = require('zlib'), path = require('path');

const dir = process.argv[2] || path.join(__dirname, '..');
const out = process.argv[3] || path.join(dir, 'SPECTRA-standalone.html');
const prev = fs.readFileSync(path.join(dir, 'SPECTRA-standalone.html'), 'utf8');
const norm = s => s.replace(/\r\n/g, '\n');

const block = t => {
  const open = '<script type="__bundler/' + t + '">';
  const i = prev.indexOf(open);
  if (i < 0) throw new Error('bundle block missing: ' + t);
  const j = prev.indexOf('</script>', i);
  return { whole: prev.slice(i, j + 9), body: prev.slice(i + open.length, j) };
};
const manB = block('manifest'), tplB = block('template'), extB = block('ext_resources');
const man = JSON.parse(manB.body), oldTpl = JSON.parse(tplB.body), ext = JSON.parse(extB.body);

// Scripts are referenced from the template in head order; csi.js is an
// external resource. Images are matched to their entries by content.
const ORDER = ['support.js', 'vj-engine.js', 'deep-zoom.js', 'cam-fly.js', 'wave-mesh.js', 'wave-gl.js', 'scene-thumbs.js'];
const srcIds = [...oldTpl.matchAll(/<script src="([0-9a-f-]{36})">/g)].map(m => m[1]);
// A script added since the previous build has no bundle entry yet: give it one.
for (let i = srcIds.length; i < ORDER.length; i++) {
  const id = require('crypto').randomUUID();
  man[id] = { mime: 'application/javascript', compressed: true, data: '' };
  srcIds.push(id);
}
if (srcIds.length !== ORDER.length) throw new Error('expected ' + ORDER.length + ' scripts in the template, found ' + srcIds.length);
const ids = {};
ORDER.forEach((f, i) => { ids[f] = srcIds[i]; });
ids['csi.js'] = ext.find(x => x.id === 'csiJs').uuid;
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.png'))) {
  const b = fs.readFileSync(path.join(dir, f));
  for (const [id, e] of Object.entries(man)) {
    if (e.mime === 'image/png' && !e.compressed && Buffer.from(e.data, 'base64').equals(b)) ids[f] = id;
  }
}

for (const f of Object.keys(ids)) {
  if (!f.endsWith('.js')) continue;
  const e = man[ids[f]];
  if (!e) throw new Error('no manifest entry for ' + f);
  const src = norm(fs.readFileSync(path.join(dir, f), 'utf8'));
  e.data = zlib.gzipSync(Buffer.from(src, 'utf8'), { level: 9 }).toString('base64');
  e.compressed = true;
}

let t = norm(fs.readFileSync(path.join(dir, 'VJ Fractal.dc.html'), 'utf8'));
const fonts = oldTpl.match(/<style>\/\* vietnamese \*\/[\s\S]*?<\/style>/);
if (!fonts) throw new Error('inlined font faces not found in the previous build');
t = t.replace(/<meta name="ext-resource-dependency"[^>]*>\n?/, '');
t = t.replace(/<link href="https:\/\/fonts\.googleapis\.com\/css2[^>]*>/, () => fonts[0]);
t = t.replace(/<template id="__bundler_thumbnail">[\s\S]*?<\/template>/, '');
// The bundle has no service worker or manifest to load.
t = t.replace(/<link rel="manifest"[^>]*>\n?/, '');
t = t.replace(/(src|href)="(?:\.\/)?([\w.-]+\.(?:js|png))(?:\?[^"]*)?"/g, (m, a, f) => ids[f] ? `${a}="${ids[f]}"` : m);

// Served normally, support.js re-fetches the page source to recover the
// template's camelCase attributes. Inside the bundle it cannot, so the <x-dc>
// block is pre-encoded the way support.js's encodeCase does it (camelCase
// attributes to sc-camel-*, table/select tags to sc-raw-*).
const RAW = ['select', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th', 'caption'];
const a = t.indexOf('<x-dc>'), b = t.lastIndexOf('</x-dc>');
if (a < 0 || b < a) throw new Error('<x-dc> block not found');
let dc = t.slice(a, b);
dc = dc.replace(/(\s)([a-z]+[A-Z][A-Za-z0-9]*)(\s*=)/g, (_, sp, name, eq) => sp + 'sc-camel-' + name.replace(/[A-Z]/g, c => '-' + c.toLowerCase()) + eq);
for (const r of RAW) dc = dc.replace(new RegExp('(</?)' + r + '(?=[\\s>])', 'gi'), '$1sc-raw-' + r);
t = t.slice(0, a) + dc + t.slice(b);

const enc = s => JSON.stringify(s).replace(/<\/(script)/gi, '<\\/$1');
const html = prev
  .replace(manB.whole, () => '<script type="__bundler/manifest">' + JSON.stringify(man) + '</script>')
  .replace(tplB.whole, () => '<script type="__bundler/template">' + enc(t) + '</script>');
fs.writeFileSync(out, html);
console.log('wrote ' + out + ' (' + html.length + ' bytes, ' + Object.keys(ids).length + ' files)');
