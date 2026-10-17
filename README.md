# Zahir Insight

Buku Besar (Faktur Pajak & Invoice) yang menarik data dari `custom_queries` Zahir dan
merender tampilannya sendiri di browser — tanpa Jasper.

## Jalankan
```bash
npm install
npm start            # http://localhost:3300
# PORT=8080 npm start
```

## Alur
1. **Login** — email & password akun Zahir. Server bisa `demo.zahirerp.com`,
   `https://erp.perusahaan.com`, atau `http://192.168.1.10:8989`.
   Backend memanggil `GET /api/v2/me` (Basic auth + header `client`), seperti CoretaxFaktur.
2. **Pilih database** — daftar dari `/api/v3|v2/user_companies` (dicoba berurutan).
   Setelah dipilih, `GET /api/v2/user_companies/{id}` dibaca; kalau respons memuat
   host/slug, alamat itu dipakai untuk data; kalau tidak, memakai server login.
   Bisa juga isi alamat database manual.
3. **Filter & tampilkan** — tanggal, akun (multi), kontak, departemen, proyek.
   Data diambil per 5.000 baris dengan progress bar, lalu dikelompokkan per akun
   (bisa dibuka/tutup), ekspor Excel, cetak.

## Custom query ringan (disarankan — jauh lebih cepat)
Import dua custom query di folder `custom_queries/` ke setiap database yang akan dipakai:
- `bb_trx.json` — baris transaksi mentah + no faktur pajak & no invoice
- `bb_saldo_awal.json` — akumulasi debit/kredit per akun untuk saldo awal

Dengan keduanya, saldo awal hanya dihitung sekali per periode dan running saldo / total
dihitung di browser. Bila belum diimport, tools otomatis memakai `buku_besar_faktur_invoice`
(cara lama, per bulan).

## Konfigurasi
- `ZAHIR_CLIENT_B64` — override `client_id:client_secret` (base64) bawaan.
- Nama custom query bisa diganti di form login → *Pengaturan lanjutan*
  (default `buku_besar_faktur_invoice`). Kolom tabel mengikuti field hasil query.

## Catatan
- Server ini stateless; token disimpan di `sessionStorage` browser dan hilang saat tab ditutup.
- Akun yang dipakai harus punya hak baca custom query di database tersebut.

## Laporan buatan user
Dari katalog klik **+ Laporan Baru**: isi judul, kategori, nama custom query, pilih filter,
klik *Tes query* untuk membaca field, atur kolom, simpan. Desain tersimpan di `data/reports.json`
(ikut di-backup bersama folder aplikasi). Ikon ✎ di katalog untuk mengubah/menghapus.

## Rekomendasi cara pengambilan data (v2.29)

Di desainer laporan, tombol **✦ Bingung? Minta rekomendasi AI** di samping "Cara pengambilan data" membaca definisi
custom query (SQL + peta field) — dari API Zahir Online, atau dari file `custom_queries/<nama>.json` di folder ini, atau SQL
yang ditempel manual — lalu menganalisis strukturnya (filter tanggal, GROUP BY/SUM, saldo awal, fungsi window, rasio,
format baris Jasper) dan menyarankan *Sekaligus* / *Per bulan digabung* / *Per bulan dijumlahkan* beserta alasannya.
Analisis ini berjalan lokal (tanpa internet).

Opsional: bila ingin ditambah penjelasan dari model AI, jalankan server dengan
`ANTHROPIC_API_KEY=sk-ant-...` (dan `AI_MODEL=...` bila ingin model lain). Tanpa kunci, fitur tetap jalan dengan analisis aturan.

Di popup filter laporan juga ada pilihan **Hasil**: tampilkan di layar, atau *Ekspor langsung ke Excel* (server yang menarik
data dan menulis file — untuk data sangat besar).

## Hemat beban server Zahir (v2.32)

Semua data tetap hanya DIBACA dari Zahir; empat hal berikut mengurangi jumlah/ukuran permintaan:

1. **Cache hasil di browser** — laporan + filter yang sama persis dalam 15 menit ditampilkan dari memori (0 permintaan ke server). Status menunjukkan "dari hasil pengambilan HH:MM"; tombol **⟳** memaksa ambil ulang. Cache hilang saat halaman ditutup/di-refresh.
2. **Kolom seperlunya** — untuk laporan tabel/crosstab yang kolomnya sudah didesain, aplikasi mencoba `$select=kolom,…` (dicek sekali per custom query dengan permintaan 1 baris). Bila server Zahir mengabaikannya, aplikasi otomatis kembali meminta baris utuh. Status menampilkan "kolom diminta seperlunya (N kolom)" bila aktif.
3. **Saldo awal 2 potongan tak tumpang tindih** — buku besar mode cepat kini meminta saldo awal "sebelum tahun berjalan" + "1 Jan s/d sehari sebelum periode" (sebelumnya potongan pertama mencakup seluruh riwayat, sehingga tahun berjalan dipindai dua kali). Bila periode mulai 1 Januari, hanya 1 permintaan.
4. **Konfirmasi laporan sangat besar** — bila perkiraan baris melebihi batas, muncul konfirmasi *Tetap lanjutkan / Batal* (lanjut = ditarik penuh seperti biasa). Batasnya diatur di halaman daftar laporan, baris **"Konfirmasi bila laporan lebih dari … baris"** (bawaan 300.000; 0 = tidak pernah bertanya). Tersimpan di `data/settings.json` (`rowWarn`), berlaku untuk semua pemakai server itu; bawaan awal bisa diganti lewat env `ROW_WARN`.

Berlaku juga untuk *Ekspor langsung ke Excel* (poin 2 dan 3 dikerjakan di server aplikasi).

## Buku Besar Valas / USD (v2.33)

Laporan baru di katalog: **Buku Besar Valas (USD) - Faktur Pajak & Invoice**. Tampilannya sama dengan buku besar biasa,
ditambah kolom **KURS** dan header dua tingkat **NILAI USD** (Debit / Kredit / Saldo) di samping **NILAI IDR** (Debit / Kredit / Saldo).

- Sumber data: custom query `bb_trx_valas` dan `bb_saldo_awal_valas` (folder `custom_queries/`) — sama seperti `bb_trx` / `bb_saldo_awal`
  tetapi ikut membawa `jurnalvc.debit_a` dan `jurnalvc.kredit_a` (nilai dalam mata uang transaksi).
  Keduanya otomatis dibuat di database saat database dibuka (atau lewat tombol *Periksa custom query bawaan*).
- Saldo awal & saldo berjalan USD dihitung dengan aturan yang sama dengan IDR (sisi debit/kredit per klasifikasi akun).
- KURS = nilai IDR ÷ nilai USD pada baris yang sama.
- Baris *Total* berisi jumlah debit/kredit kedua blok; baris *Saldo Akhir* hanya mengisi blok mata uang dasar (blok nilai asli kosong, seperti footer JRXML).
- Ekspor Excel (dari layar maupun *Ekspor langsung*) ikut memakai header dua tingkat.
- Laporan buku besar biasa (`bb`) tidak berubah.

### Transaksi USD tanpa nilai asli (v2.36.1)

Di **Buku Besar Valas**, baris transaksi yang `currency_id`-nya = ID mata uang USD (default `fdbc942a-81dc-42f3-8f77-0774358dc084`)
mengosongkan KURS dan DEBIT/KREDIT/SALDO nilai asli (`debit_a`/`kredit_a`) — sama dengan aturan di JRXML *General Ledger - Advance*.
Saldo berjalan tetap dihitung, jadi baris berikutnya tidak bergeser.
Untuk akun yang mata uangnya USD (dibaca dari `/api/v2/accounts`, `currency.code`), baris *Saldo Awal* dan *Total* di blok nilai asli juga kosong (`is_usd_account` di JRXML).
Bila API akun tidak mengirim mata uang akun, aturan per akun ini tidak aktif.

- ID bisa diganti lewat env `USD_CURRENCY_ID` (server → browser lewat `/version`).
- Butuh custom query `bb_trx_valas` versi terbaru (membawa kolom `mata_uang_id`). Di database yang sudah punya versi lama,
  tombol *Periksa custom query bawaan* menandainya "lama": hapus `bb_trx_valas` di Zahir lalu periksa ulang agar dibuat ulang.

## Trial Balance IDR & USD (v2.34)

Katalog → **Neraca Saldo → Trial Balance (IDR & USD)**. Per akun: Beginning Balance (debit/kredit), Mutation (debit/kredit),
Net Mutation, Ending Balance (debit/kredit) — dua kali, untuk **IDR** (= nilai mata uang akun, `debit_a`/`kredit_a`) dan
**USD** (= mata uang dasar, `debit`/`kredit`). Angka format Indonesia; IDR tanpa desimal, USD 2 desimal; nol = "-".

- Sumber data: custom query `bb_saldo_awal_valas` (sudah dipasang bersama buku besar valas). Tiga permintaan saja:
  saldo awal sebelum tahun berjalan, saldo awal 1 Jan s/d sehari sebelum periode, dan mutasi periode.
- Mengikuti Trial Balance Zahir: akun laba-rugi (klasifikasi ≥ 4) saldo awalnya 0; akumulasi laba-rugi sebelum periode
  dipindah ke akun **Laba Berjalan** (tahun berjalan) dan **Laba Ditahan** (tahun-tahun sebelumnya). Akun dicari dari daftar
  akun berdasarkan nama ("Laba Berjalan"/"Laba Tahun Berjalan", "Laba Ditahan"); bila tidak ada, tampil sebagai baris tanpa kode.
- Net Mutation mengikuti sisi normal akun: kewajiban/modal/pendapatan (klasifikasi 2,3,4,8) = kredit − debit, lainnya debit − kredit.
- Kode akun ditampilkan berformat seperti di Zahir (mis. 1113-00-002), diambil dari daftar akun API.
- Baris TOTAL hanya untuk USD (mata uang dasar), dijumlahkan dari nilai sebelum pembulatan; kolom IDR berisi campuran mata uang akun sehingga tidak dijumlahkan.
- Filter: tanggal, rentang akun, akun tertentu, departemen, proyek. Ekspor Excel (biasa & langsung) dengan header 3 tingkat.
- Label/desimal bisa diubah di `CATALOG` (`tb:{curA, curB, decA, decB}`) di `public/index.html`.

## Jurnal - All Transaction & desain Trial Balance (v2.35)

Katalog → **Jurnal → Jurnal - All Transaction**. Per transaksi: baris kepala (Type, #Transaction, Date, Business Partner,
Description, DEPT, KODE PROJEK), baris akun (Account, Account code, kode DEPT, debit/kredit **USD** dan **IDR**), lalu baris
**Balance**. USD = mata uang dasar (`debit`/`kredit`), IDR = mata uang akun (`debit_a`/`kredit_a`), sama dengan trial balance.

- Sumber data: custom query `jurnal_all_trx` (folder `custom_queries/`, dipasang otomatis). Diambil bertahap per tahun/bulan
  seperti buku besar. Filter: tanggal, kontak, departemen, proyek.
- Ekspor Excel (biasa & langsung) dengan header 2 tingkat; baris kepala tebal, Balance diberi warna total.

Trial Balance dan Jurnal kini bisa diubah lewat ✎ seperti buku besar (bentuk tampilan *Trial balance 2 mata uang* /
*Jurnal per transaksi* di perancang): judul, kategori, custom query, filter, label & tampil/sembunyi kolom (jurnal: juga urutan),
label & jumlah desimal mata uang, dan judul kelompok trial balance (Beginning Balance / Mutation / Ending Balance).
*Kembalikan ke bawaan* menghapus desain kustom.

## Versi online di Vercel (v2.36)

Kode yang sama bisa dijalankan sebagai situs di Vercel (`api/index.js` + `vercel.json`). Mode ini aktif otomatis bila env
`VERCEL` ada (selalu diset oleh Vercel). Perbedaan dengan versi lokal/desktop:

| | Lokal / desktop | Vercel |
|---|---|---|
| Server Zahir | Zahir Online & server lokal (IP) | **Hanya Zahir Online** (`*.zahironline.com`, `*.zahirerp.com`) — atur lewat env `ZAHIR_ALLOWED_HOSTS` |
| Desain laporan (✎, + Laporan Baru) | disimpan di `data/` | **tidak tersedia** — hanya laporan bawaan |
| Batas konfirmasi baris | diatur di halaman | env `ROW_WARN` |
| Ekspor Excel | dibuat server (streaming) | **dibuat di browser** (xlsxw.js + ExcelJS) |
| Ekspor langsung | ada | **tidak tersedia** (batas durasi fungsi 300 dtk) |
| Baris per permintaan | 10.000 | 2.500 (batas respons fungsi 4,5 MB) |

### Deploy
1. Push repo ini ke GitHub → di Vercel: **Add New → Project → Import** repo tersebut. Framework: *Other*. Pengaturan build
   sudah ada di `vercel.json` (install tanpa devDependencies, region `sin1` Singapura agar dekat server Zahir Online).
2. Env (Project → Settings → Environment Variables), semuanya opsional:
   - `LOGIN_RSA_PRIVATE_KEY` — kunci privat RSA (PEM) untuk mengenkripsi password di browser. Buat dengan
     `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048` lalu tempel isinya. Tanpa ini login tetap jalan lewat HTTPS
     (kredensial dikirim sebagai header Basic).
   - `ZAHIR_CLIENT_B64`, `ROW_WARN`, `ANTHROPIC_API_KEY` / `AI_MODEL`, `ZAHIR_ALLOWED_HOSTS` — sama seperti versi lokal.
3. Deploy. Setiap push ke branch utama otomatis ter-deploy ulang.

Catatan: semua data tetap ditarik dari Zahir Online lewat fungsi Vercel (proxy `/zapi`); tidak ada data yang disimpan di Vercel.

## Mengubah nomor versi

Satu tempat saja: `"version"` di `package.json` (mis. `2.31.0`). Label di aplikasi, properti exe, nama installer, dan
pengecekan versi server/tampilan semuanya mengikuti. Setelah diubah, build ulang (`npm run build:win` / `npm run build:desktop`).

## Deploy ke customer

Ada dua jalur; kode yang sama, hanya cara menjalankannya yang berbeda.

### A. Dihosting (satu alamat untuk banyak customer) — Docker / Kubernetes
```bash
docker build -t registry.anda/zahir-insight:2.30.0 .
docker run -d -p 3300:3300 -v insight-data:/data -e REPORT_SCOPE=company registry.anda/zahir-insight:2.30.0
```
Manifest Kubernetes lengkap (PVC, Deployment, Service, Ingress) ada di `k8s/deployment.yaml` — ganti image dan host, lalu `kubectl apply -f k8s/deployment.yaml`.

Variabel lingkungan:
| Variabel | Nilai | Keterangan |
|---|---|---|
| `PORT` | `3300` | port HTTP |
| `REPORT_SCOPE` | `company` / `global` | `company` (bawaan) = desain laporan dipisah per database/perusahaan Zahir (`data/reports.<slug>.json`). `global` = satu daftar bersama untuk semua perusahaan. Saat pertama kali pindah ke `company`, `reports.json` lama otomatis disalin ke perusahaan yang pertama dibuka. |
| `DATA_ROOT` | path | folder tempat `data/` dan `custom_queries/` ditulis (default: folder aplikasi / folder exe) |
| `ZAHIR_INSECURE_TLS` | `1` | terima sertifikat self-signed server Zahir on-premise |
| `ANTHROPIC_API_KEY` | | opsional, penjelasan AI tambahan untuk rekomendasi cara pengambilan data |

### B. Dipasang di komputer customer — satu file .exe (tanpa install Node)
```bash
npm install            # sekali
npm run build:win      # -> dist/win/ZahirInsight.exe (+ BACA DULU.txt, installer.iss)
npm run build:linux    # -> dist/linux/zahir-insight
```
`ZahirInsight.exe` mandiri: ikon Z Zahir & info versi tersemat, bisa diletakkan di mana saja lalu dobel-klik — browser terbuka
otomatis. Desain laporan (per perusahaan) disimpan **terenkripsi** (AES-256-GCM, berkas `.dat`) di folder
instalasi bila ada `portable.txt` di samping exe (installer membuatnya), selain itu di `%LOCALAPPDATA%\ZahirInsight\`.
Custom query dikelola di Zahir Online. Tiga custom query **bawaan** (`bb_trx`, `bb_saldo_awal`, `buku_besar_faktur_invoice` di
folder `custom_queries/`) ikut dibundel dan **dibuat otomatis** di database Zahir saat database itu dibuka pertama kali (POST ke API
custom_queries) — pengguna tidak perlu import manual. Custom query lain dibuat sendiri di Zahir lalu dirujuk namanya di desain laporan. Saat ada versi
baru cukup ganti exe-nya. Enkripsi aktif otomatis pada build .exe; di `node server.js` berkas tetap JSON biasa (`DATA_ENCRYPT=1`
untuk memaksa; `DATA_KEY` untuk kunci sendiri).

Installer (`ZahirInsight-Setup-<versi>.exe` dengan shortcut Start Menu/Desktop, opsi jalan saat Windows start, uninstaller):
pasang [Inno Setup 6](https://jrsoftware.org/isinfo.php) di Windows, lalu di folder `dist\win`:
```
iscc installer.iss
```
Ikon diambil dari `build/icon.ico` (dibuat dari `public/logo.png`); untuk mengganti, timpa file .ico itu lalu build ulang.

### C. Versi desktop (jendela sendiri + ikon tray) — Electron
Aplikasi yang sama dibungkus Electron: punya jendela sendiri (muncul di taskbar, bisa di-pin), ikon di system tray dengan menu
*Buka / Buka di browser / Keluar*, satu instance (klik ikon lagi = fokus ke jendela). Menutup jendela (✕) = aplikasi berhenti sepenuhnya.
```bash
npm install                 # sekali (mengambil electron + electron-builder, ±150 MB)
npm run desktop             # coba langsung tanpa build
npm run build:desktop       # -> dist/desktop/ZahirInsight-Desktop-Setup-<versi>.exe (installer NSIS, pilih folder, shortcut, uninstaller)
npm run build:desktop:portable   # -> satu exe portable tanpa installer
```
Build installer desktop harus dijalankan **di Windows** (di Linux/mac electron-builder butuh wine). Pertama kali di Windows,
jalankan terminal sebagai Administrator atau aktifkan Developer Mode (electron-builder perlu membuat symlink saat mengekstrak cache).
Build memakai salinan bersih dengan node_modules produksi lengkap (`scripts/build-desktop.js`) dan electron-builder 24.13 — versi 25
melewatkan sebagian modul bersarang (error "Cannot find module" saat dijalankan). Data: `%APPDATA%\Zahir Insight\data`
(terenkripsi), atau di samping exe bila ada `portable.txt`/`data` di sana. Server internal memakai port 3300 bila bebas (jadi juga bisa
dibuka dari browser biasa), kalau tidak memakai port acak. Ukuran installer ±90 MB (Chromium di dalamnya).

Pilih salah satu untuk client: **B** (ringan, dibuka di browser) atau **C** (terasa seperti aplikasi desktop). Keduanya memakai data
dan desain laporan dengan format yang sama.

Build pertama mengunduh base Node.js (±40 MB) dari GitHub — perlu internet; hasil exe ±100 MB karena berisi Node.js + ExcelJS.

## Tampilan Buku Besar Valas = General Ledger - Advance (v2.37)
Tampilan Buku Besar Valas dibuat sama dengan laporan *General Ledger - Advance* di Zahir Online: judul akun `kode - nama`, blok **USD** (DEBIT/KREDIT/SALDO mata uang dasar) lalu blok **IDR** (DEBIT_A/KREDIT_A/SALDO nilai asli), tanggal `Jan 5, 2026`, angka tanpa nol desimal berlebih, baris Saldo Awal/Saldo Akhir berlabel, kontak kosong = `-`, dan baris kedua deskripsi `(IDR 975,000,000 X kurs)`. Kolom KURS dihapus; kolom NO FAKTUR PAJAK dan NO INVOICE tetap dipertahankan. Aturan USD (nilai asli dikosongkan) tidak berubah.
