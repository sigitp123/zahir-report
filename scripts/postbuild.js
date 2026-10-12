// Berkas pendamping hasil build. Windows: satu ZahirInsight.exe sudah mandiri; ditambah README + skrip Inno Setup (opsional, untuk Setup.exe)
const fs = require('fs'), path = require('path');
const os = process.argv[2] || 'win'; const root = path.join(__dirname, '..'); const out = path.join(root, 'dist', os);
const ver = require('../package.json').version;
if (os === 'win') {
  fs.writeFileSync(path.join(out, 'portable.txt'), 'Data Zahir Insight disimpan di folder ini (data\\).\r\n');
  fs.writeFileSync(path.join(out, 'BACA DULU.txt'), [
    `Zahir Insight ${ver} — Windows`, '',
    'ZahirInsight.exe adalah satu file mandiri: letakkan di mana saja (mis. C:\\ZahirInsight\\) lalu dobel-klik.',
    'Browser terbuka otomatis ke http://localhost:3300 — login dengan akun Zahir Online / Zahir ERP.',
    'Kalau browser tidak terbuka, buka sendiri alamat itu.', '',
    'Desain laporan disimpan terenkripsi di folder instalasi (bila ada portable.txt di samping exe) atau di',
    '%LOCALAPPDATA%\\ZahirInsight\\data\\reports.<nama-db>.dat — satu file per perusahaan/database.', '',
    'Custom query dikelola di Zahir Online (menu Custom Query); aplikasi hanya membacanya. Laporan bawaan Buku Besar',
    'memerlukan custom query bb_trx dan bb_saldo_awal (atau buku_besar_faktur_invoice) di database yang dibuka.', '',
    'Pengaturan lewat variabel lingkungan (opsional): PORT=3301  REPORT_SCOPE=global  ZAHIR_INSECURE_TLS=1',
    '  contoh:  set PORT=3301 && ZahirInsight.exe', '',
    'Jalan otomatis saat Windows start / sebagai service: pakai installer (ZahirInsight-Setup.exe) atau NSSM.',
    'Aplikasi berjalan di latar belakang tanpa jendela. Klik ikon lagi = membuka browser; untuk mematikannya klik tombol',
    '"Tutup aplikasi" di pojok kanan atas Zahir Insight.', ''].join('\r\n'));
  // skrip Inno Setup -> ZahirInsight-Setup.exe (kompilasi di Windows dengan Inno Setup 6: iscc installer.iss)
  fs.writeFileSync(path.join(out, 'installer.iss'), [
    '; Kompilasi dengan Inno Setup 6 (https://jrsoftware.org/isinfo.php):  iscc installer.iss',
    '#define AppName "Zahir Insight"', `#define AppVersion "${ver}"`, '#define AppExe "ZahirInsight.exe"', '',
    '[Setup]', 'AppId={{6D3B2A5E-5A1C-4E6B-9C0F-7A1E3B9D2C41}', 'AppName={#AppName}', 'AppVersion={#AppVersion}', 'AppPublisher=Zahir Insight',
    'DefaultDirName={autopf}\\Zahir Insight', 'DefaultGroupName=Zahir Insight', 'OutputDir=.', 'OutputBaseFilename=ZahirInsight-Setup-{#AppVersion}',
    'SetupIconFile=..\\..\\build\\icon.ico', 'UninstallDisplayIcon={app}\\{#AppExe}', 'Compression=lzma2/max', 'SolidCompression=yes', 'WizardStyle=modern', 'PrivilegesRequiredOverridesAllowed=dialog', '',
    '[Languages]',
    '; Bahasa Indonesia dipakai bila tersedia (Languages\\Unofficial\\Indonesian.isl); selain itu Inggris bawaan',
    '#if FileExists(AddBackslash(CompilerPath) + "Languages\\Unofficial\\Indonesian.isl")',
    'Name: "id"; MessagesFile: "compiler:Languages\\Unofficial\\Indonesian.isl"',
    '#elif FileExists(AddBackslash(CompilerPath) + "Languages\\Indonesian.isl")',
    'Name: "id"; MessagesFile: "compiler:Languages\\Indonesian.isl"',
    '#else',
    'Name: "en"; MessagesFile: "compiler:Default.isl"',
    '#endif', '',
    '[Tasks]', 'Name: "desktopicon"; Description: "Buat shortcut di Desktop"; GroupDescription: "Shortcut:"',
    'Name: "startup"; Description: "Jalankan otomatis saat Windows start"; GroupDescription: "Opsi:"; Flags: unchecked', '',
    '[Dirs]', 'Name: "{app}\\data"; Permissions: users-modify', '',
    '[Files]', 'Source: "{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion', 'Source: "BACA DULU.txt"; DestDir: "{app}"; Flags: ignoreversion',
    '; portable.txt = data disimpan di folder instalasi ini (bukan %LOCALAPPDATA%)', 'Source: "portable.txt"; DestDir: "{app}"; Flags: ignoreversion', '',
    '[UninstallDelete]', 'Type: filesandordirs; Name: "{app}\\data"', '',
    '[Icons]', 'Name: "{group}\\Zahir Insight"; Filename: "{app}\\{#AppExe}"', 'Name: "{group}\\Hapus Zahir Insight"; Filename: "{uninstallexe}"',
    'Name: "{autodesktop}\\Zahir Insight"; Filename: "{app}\\{#AppExe}"; Tasks: desktopicon',
    'Name: "{commonstartup}\\Zahir Insight"; Filename: "{app}\\{#AppExe}"; Tasks: startup', '',
    '[Run]', 'Filename: "{app}\\{#AppExe}"; Description: "Jalankan Zahir Insight sekarang"; Flags: nowait postinstall skipifsilent', ''].join('\r\n'));
  for (const f of ['Jalankan Zahir Insight.bat']) { try { fs.unlinkSync(path.join(out, f)); } catch {} }
  for (const d of ['data']) { try { fs.rmSync(path.join(out, d), { recursive: true, force: true }); } catch {} }
} else {
  fs.writeFileSync(path.join(out, 'README.txt'), `Zahir Insight ${ver} — Linux\nchmod +x zahir-insight && PORT=3300 ./zahir-insight\nDesain laporan: ~/.zahir-insight/data (atau folder exe bila ada data/ atau portable.txt di situ). Custom query dikelola di Zahir Online. Variabel: PORT, REPORT_SCOPE, DATA_ROOT, ZAHIR_INSECURE_TLS.\n`);
}
console.log('Pendamping disalin ke', out);
