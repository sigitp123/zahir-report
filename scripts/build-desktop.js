// Build aplikasi desktop (Electron): node scripts/build-desktop.js [nsis|portable]
// Memaketkan dari salinan bersih dengan node_modules produksi lengkap (npm ci --omit=dev), supaya tidak ada modul yang tertinggal.
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const target = process.argv[2] || 'nsis'; const root = path.join(__dirname, '..'); const stage = path.join(root, 'dist', '.stage-desktop');
const pk = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const electronVersion = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
fs.rmSync(stage, { recursive: true, force: true }); fs.mkdirSync(path.join(stage, 'build'), { recursive: true });
fs.writeFileSync(path.join(stage, 'build-id.json'), JSON.stringify({ id: new Date().toISOString().slice(0, 16).replace('T', ' ') }));
for (const f of ['server.js', 'package-lock.json']) if (fs.existsSync(path.join(root, f))) fs.copyFileSync(path.join(root, f), path.join(stage, f));
for (const d of ['public', 'desktop', 'custom_queries']) fs.cpSync(path.join(root, d), path.join(stage, d), { recursive: true });
fs.copyFileSync(path.join(root, 'build', 'icon.ico'), path.join(stage, 'build', 'icon.ico'));   // ikon installer/exe (buildResources)
const spk = { name: pk.name, version: pk.version, description: pk.description, main: 'desktop/main.js', dependencies: pk.dependencies, build: { ...pk.build, electronVersion, files: ['**/*'], directories: { output: path.join(root, 'dist', 'desktop'), buildResources: 'build' } } };
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(spk, null, 2));
console.log('> npm ci --omit=dev'); execSync('npm ci --omit=dev --ignore-scripts --no-audit --no-fund', { cwd: stage, stdio: 'inherit' });
console.log('> electron-builder', target); execSync(`"${path.join(root, 'node_modules', '.bin', 'electron-builder')}" --win ${target} --x64 --project "${stage}"`, { cwd: root, stdio: 'inherit' });
console.log('Selesai: lihat dist/desktop');
