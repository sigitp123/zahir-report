// Build portable: node scripts/build.js win|linux
// 1) salin aplikasi ke dist/.stage, 2) npm ci --omit=dev (hanya dependensi produksi), 3) pkg dengan seluruh node_modules sebagai asset, 4) salin berkas pendamping
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const os = process.argv[2] || 'win'; const root = path.join(__dirname, '..'); const stage = path.join(root, 'dist', '.stage');
const target = os === 'win' ? 'node18-win-x64' : os === 'mac' ? 'node18-macos-x64' : 'node18-linux-x64';
const outName = os === 'win' ? 'ZahirInsight.exe' : 'zahir-insight'; const out = path.join(root, 'dist', os, outName);
fs.rmSync(stage, { recursive: true, force: true }); fs.mkdirSync(stage, { recursive: true });
fs.writeFileSync(path.join(stage, 'build-id.json'), JSON.stringify({ id: new Date().toISOString().slice(0, 16).replace('T', ' ') }));
for (const f of ['server.js', 'package.json', 'package-lock.json']) if (fs.existsSync(path.join(root, f))) fs.copyFileSync(path.join(root, f), path.join(stage, f));
for (const d of ['public', 'custom_queries']) fs.cpSync(path.join(root, d), path.join(stage, d), { recursive: true });
const pk = JSON.parse(fs.readFileSync(path.join(stage, 'package.json'), 'utf8'));
pk.pkg = { assets: ['public/**/*', 'custom_queries/*.json', 'build-id.json', 'node_modules/**/*'] }; delete pk.devDependencies; delete pk.scripts;
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(pk, null, 2));
console.log('> npm ci --omit=dev'); execSync('npm ci --omit=dev --ignore-scripts --no-audit --no-fund', { cwd: stage, stdio: 'inherit' });
console.log('> pkg', target); fs.mkdirSync(path.dirname(out), { recursive: true });
// cache base Node.js milik proyek (terpisah dari cache global) supaya base Windows bisa diberi ikon Zahir SEBELUM dibungkus
const cache = path.join(root, 'build', 'pkg-cache'); fs.mkdirSync(cache, { recursive: true }); process.env.PKG_CACHE_PATH = cache;
const findBase = () => { const hits = []; (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/^fetched-.*-win-x64$/.test(f)) hits.push(p); } })(cache); return hits[0]; };
if (os === 'win' && !findBase()) { console.log('> mengunduh base Node.js Windows'); execSync(`"${path.join(root, 'node_modules', '.bin', 'pkg')}" . --targets ${target} --output "${out}"`, { cwd: stage, stdio: 'inherit', env: process.env }); }
if (os === 'win') {
  const base = findBase();
  // penanda = ukuran file setelah disematkan; kalau pkg-fetch pernah mengunduh ulang, ukurannya beda -> disematkan lagi
  // penanda = ukuran base + sidik jari ikon/skrip; beda (base diunduh ulang, ikon diganti) -> disematkan lagi
  const crypto = require('crypto'); const fp = () => crypto.createHash('md5').update(fs.readFileSync(path.join(root, 'build', 'icon.ico'))).update(fs.readFileSync(path.join(__dirname, 'winres.js'))).update(require('../package.json').version).digest('hex');
  const mark = () => String(fs.statSync(base).size) + ':' + fp();
  const patched = () => { try { return fs.readFileSync(base + '.zahir', 'utf8') === mark(); } catch { return false; } };
  if (base && !patched()) { execSync(`node "${path.join(__dirname, 'winres.js')}" "${base}"`, { stdio: 'inherit' }); fs.writeFileSync(base + '.zahir', mark()); }
  if (base) process.env.PKG_NODE_PATH = base;   // pakai base yang sudah diberi ikon; pkg-fetch tidak memeriksa hash/unduh ulang
}
execSync(`"${path.join(root, "node_modules", ".bin", "pkg")}" . --targets ${target} --output "${out}"`, { cwd: stage, stdio: "inherit", env: process.env });
require("./postbuild.js");
