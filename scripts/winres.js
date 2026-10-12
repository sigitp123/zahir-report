// Menyematkan ikon logo Zahir + info versi ke ZahirInsight.exe (murni JS, jalan di Windows/Linux/mac)
const fs = require('fs'), path = require('path');
const ResEdit = require('resedit');
const exe = process.argv[2]; const ico = path.join(__dirname, '..', 'build', 'icon.ico');
const pkg = require('../package.json'); const ver = (pkg.version + '.0.0.0').split('.').slice(0, 4).map(Number);
const pe = ResEdit.NtExecutable.from(fs.readFileSync(exe)); const res = ResEdit.NtExecutableResource.from(pe);
const icons = ResEdit.Data.IconFile.from(fs.readFileSync(ico)).icons.map(i => i.data);
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, icons);
const vi = ResEdit.Resource.VersionInfo.createEmpty();
vi.setFileVersion(ver[0], ver[1], ver[2], ver[3], 1033); vi.setProductVersion(ver[0], ver[1], ver[2], ver[3], 1033);
vi.setStringValues({ lang: 1033, codepage: 1200 }, { ProductName: 'Zahir Insight', FileDescription: 'Zahir Insight', CompanyName: 'Zahir Insight', LegalCopyright: 'Zahir Insight', OriginalFilename: 'ZahirInsight.exe', InternalName: 'ZahirInsight', FileVersion: pkg.version, ProductVersion: pkg.version });
vi.outputToResourceEntries(res.entries); res.outputResource(pe);
pe.newHeader.optionalHeader.subsystem = 2;   // 2 = WINDOWS_GUI: tidak membuka jendela console hitam saat dijalankan
fs.writeFileSync(exe, Buffer.from(pe.generate()));
console.log('Ikon & info versi disematkan ke', exe);
