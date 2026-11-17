// Menyalin Leaflet, Chart.js, dan font ke public/vendor (self-host, AGENTS).
// Folder hasilnya ikut di-commit, jadi server produksi tidak perlu devDependencies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = (p) => path.join(root, 'node_modules', p);
const out = path.join(root, 'public', 'vendor');

if (!fs.existsSync(nm('leaflet'))) {
  console.log('copy-vendor: devDependencies tidak terpasang, dilewati (pakai public/vendor yang ada).');
  process.exit(0);
}
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
fs.cpSync(nm('leaflet/dist'), path.join(out, 'leaflet'), { recursive: true });
fs.copyFileSync(nm('chart.js/dist/chart.umd.js'), path.join(out, 'chart.umd.js'));
for (const pkg of ['fraunces', 'ibm-plex-sans', 'ibm-plex-mono']) {
  const files = nm(`@fontsource/${pkg}/files`);
  for (const f of fs.readdirSync(files)) if (/-latin-(400|600)-normal\.woff2$/.test(f)) fs.copyFileSync(path.join(files, f), path.join(out, 'fonts', f));
}
console.log('copy-vendor: selesai.');
