// Zahir Insight — proxy tipis ke API Zahir ERP / Zahir Online.
// Stateless: token & alamat server disimpan di browser (sessionStorage) dan dikirim per request.
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const major = parseInt(process.versions.node.split('.')[0], 10);
if (major < 18) { console.error(`Butuh Node.js 18 atau lebih baru (terpasang: ${process.version}).`); process.exit(1); }
// Sertifikat HTTPS self-signed di server Zahir on-premise: jalankan dengan ZAHIR_INSECURE_TLS=1
if (process.env.ZAHIR_INSECURE_TLS === '1') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const app = express();
// client_id:client_secret (base64) — sama dengan bawaan CoretaxFaktur; bisa di-override per login
const DEFAULT_CLIENT_B64 = process.env.ZAHIR_CLIENT_B64 || 'NjljYjNlYTMxN2EzMmM0ZTYxNDNlNjY1ZmRiMjBiMTQ6MTAyNmQ1MWQyZTkwZjg=';
const COMPANY_ENDPOINTS = ['/api/v3/user_companies', '/api/v2/user_companies', '/api/v2/companies', '/api/v1/user_companies'];

// Versi online (Vercel): tanpa penyimpanan file, ekspor Excel dibuat di browser, hanya server Zahir Online.
const IS_VERCEL = !!process.env.VERCEL;
// Kunci RSA sesi server: browser mengenkripsi password dengan kunci publik ini,
// jadi di DevTools/Network hanya terlihat ciphertext. Kunci dibuat ulang tiap server start.
// Di Vercel tiap instance berbeda, jadi kunci diambil dari env LOGIN_RSA_PRIVATE_KEY (PEM); tanpa env itu login memakai
// header Basic biasa (tetap terenkripsi HTTPS).
const { publicKey, privateKey } = process.env.LOGIN_RSA_PRIVATE_KEY
  ? (() => { const k = crypto.createPrivateKey(process.env.LOGIN_RSA_PRIVATE_KEY.replace(/\\n/g, '\n')); return { privateKey: k, publicKey: crypto.createPublicKey(k) }; })()
  : IS_VERCEL ? { publicKey: null, privateKey: null } : crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PUB_JWK = publicKey ? publicKey.export({ format: 'jwk' }) : null;
function decryptPassword(b64) {
  return crypto.privateDecrypt(
    { key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(b64, 'base64')
  ).toString('utf8');
}
app.disable('x-powered-by');
app.use(express.json({ limit: '64mb' }));
// versi online tidak punya penyimpanan: desain laporan, pengaturan, dan ekspor di server ditolak dengan pesan jelas
const READONLY_MSG = 'Versi online (Vercel) tidak menyimpan desain/pengaturan dan tidak mendukung ekspor dari server. Gunakan versi desktop untuk fitur ini.';
if (IS_VERCEL) app.use((req, res, next) => {
  if ((req.method !== 'GET' && /^\/(reports|prefs|settings)(\/|$)/.test(req.path)) || /^\/export\//.test(req.path)) return res.status(403).json({ error: READONLY_MSG });
  next();
});
const APP_VERSION = require('./package.json').version;
const BUILD_ID = (() => { try { return require('./build-id.json').id; } catch { return 'dev'; } })();
const isLocal = req => /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress || '');
app.get('/settings', (req, res) => res.json({ port: PORT, url: `http://localhost:${PORT}`, editable: (IS_PKG || IS_DESKTOP) && isLocal(req) }));
app.post('/settings', (req, res) => {
  if (!(IS_PKG || IS_DESKTOP) || !isLocal(req)) return res.status(403).json({ error: 'tidak diizinkan' });
  const port = Number(req.body && req.body.port); if (!Number.isInteger(port) || port < 1024 || port > 65535) return res.status(400).json({ error: 'Port harus angka 1024–65535' });
  if (port === PORT) return res.json({ ok: true, port, restart: false });
  saveSettings({ ...loadSettings(), port });
  res.json({ ok: true, port, restart: true, url: `http://localhost:${port}` });
  // jalan ulang di port baru: desktop -> Electron yang me-relaunch; exe -> jalankan diri sendiri lagi lalu keluar
  setTimeout(() => {
    if (module.exports && typeof module.exports.onRestart === 'function') return module.exports.onRestart(port);
    if (IS_PKG) { try { require('child_process').spawn(process.execPath, [], { detached: true, stdio: 'ignore', env: { ...process.env, PORT: String(port), OPEN_BROWSER: '0' } }).unref(); } catch {} process.exit(0); }
  }, 400);
});
// preferensi aplikasi (berlaku untuk semua pemakai server ini): batas konfirmasi laporan besar (baris); 0 = tidak pernah bertanya
const ROW_WARN_DEFAULT = Number(process.env.ROW_WARN) >= 0 && process.env.ROW_WARN !== undefined ? Number(process.env.ROW_WARN) : 300000;
app.get('/prefs', (req, res) => { const s = loadSettings(); res.json({ rowWarn: Number.isFinite(Number(s.rowWarn)) && s.rowWarn !== undefined ? Number(s.rowWarn) : ROW_WARN_DEFAULT }); });
app.post('/prefs', (req, res) => {
  if (!requireLogin(req, res)) return;
  const v = Number(req.body && req.body.rowWarn); if (!Number.isInteger(v) || v < 0 || v > 1e9) return res.status(400).json({ error: 'Batas harus bilangan bulat ≥ 0 (0 = tidak pernah bertanya)' });
  try { saveSettings({ ...loadSettings(), rowWarn: v }); } catch (e) { return res.status(500).json({ error: 'Tidak bisa menyimpan pengaturan: ' + e.message }); }
  res.json({ ok: true, rowWarn: v });
});
app.post('/quit', (req, res) => {
  const ip = req.socket.remoteAddress || ''; if (!IS_PKG || !/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(ip)) return res.status(403).json({ error: 'tidak diizinkan' });
  res.json({ ok: true }); setTimeout(() => process.exit(0), 300);
});
app.get('/version', (req, res) => res.json({ version: APP_VERSION, build: BUILD_ID, scope: REPORT_SCOPE, pkg: !!process.pkg && process.env.ZI_DESKTOP !== '1', desktop: process.env.ZI_DESKTOP === '1', online: IS_VERCEL, perPage: IS_VERCEL ? 2500 : 10000, usdCurrencyId: USD_CURRENCY_ID }));
// pustaka ExcelJS untuk browser (versi online membuat file Excel di browser)
app.get('/vendor/exceljs.min.js', (req, res) => { res.setHeader('Cache-Control', 'public, max-age=86400'); res.sendFile(require.resolve('exceljs/dist/exceljs.min.js')); });
app.get('/auth/pubkey', (req, res) => res.json({ jwk: PUB_JWK }));   // null = kirim kredensial lewat header Basic (HTTPS)
// index.html: nomor versi diambil dari package.json (satu-satunya tempat mengubah versi)
const SHORT_VER = APP_VERSION.replace(/\.0$/, '');
app.get(['/', '/index.html'], (req, res) => {
  try { const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8').replace(/__APP_VER__/g, SHORT_VER); res.setHeader('Cache-Control', 'no-store'); res.type('html').send(html); }
  catch (e) { res.status(500).send('index.html tidak ditemukan'); }
});
app.use(express.static(path.join(__dirname, 'public'), { etag: false, lastModified: false, setHeaders: (res, fp) => { if (fp.endsWith('.html') || fp.endsWith('.js')) res.setHeader('Cache-Control', 'no-store'); } }));

function normServer(s) {
  s = String(s || '').trim().replace(/\/+$/, '');
  if (!s) throw new Error('Alamat server kosong');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  if (!/^https?:\/\/[\w.-]+(:\d{1,5})?$/i.test(s)) throw new Error('Alamat server tidak valid: ' + s);
  // versi online: hanya domain Zahir (mencegah aplikasi dipakai sebagai proxy ke alamat lain). Atur lewat env ZAHIR_ALLOWED_HOSTS.
  if (IS_VERCEL || process.env.ZAHIR_ALLOWED_HOSTS) {
    const host = s.replace(/^https?:\/\//i, '').replace(/:\d+$/, '').toLowerCase();
    const allow = String(process.env.ZAHIR_ALLOWED_HOSTS || 'zahironline.com,zahirerp.com').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
    if (!/^https:/i.test(s) || !allow.some(d => host === d || host.endsWith('.' + d))) throw new Error('Versi online hanya bisa terhubung ke Zahir Online (https://…' + allow.join(' / …') + '). Untuk server lokal gunakan aplikasi versi desktop.');
  }
  return s;
}
function clientB64(v) {
  v = String(v || '').trim();
  if (!v) return DEFAULT_CLIENT_B64;
  return v.includes(':') ? Buffer.from(v).toString('base64') : v;
}
function explain(e, url) {
  const c = e.cause || e; const code = c.code || '';
  const host = (() => { try { return new URL(url).host; } catch { return url; } })();
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `Nama server ${host} tidak ditemukan (DNS). Periksa ejaan alamat server.`;
  if (code === 'ECONNREFUSED') return `Koneksi ke ${host} ditolak. Server mati, port salah, atau hanya bisa diakses dari jaringan internal/VPN.`;
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return `Koneksi ke ${host} time-out. Periksa firewall/VPN.`;
  if (/CERT|certificate|self.signed|SSL|TLS/i.test(code + ' ' + c.message)) return `Sertifikat HTTPS ${host} tidak dipercaya (self-signed). Jalankan dengan ZAHIR_INSECURE_TLS=1 atau pakai http://.`;
  if (code === 'ECONNRESET') return `Koneksi ke ${host} terputus (ECONNRESET). Kalau server memakai http, pastikan alamat ditulis http://, bukan https://.`;
  return `Tidak bisa menghubungi ${host}: ${c.message || e.message}${code ? ' (' + code + ')' : ''}`;
}
async function zfetch(url, headers = {}, method = 'GET', body) {
  let r;
  try {
    r = await fetch(url, {
    method,
    headers: { Accept: 'application/json', 'Content-Language': 'id', ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(Number(process.env.ZAHIR_TIMEOUT_MS) || 600000),
    });
  } catch (e) { throw new Error(explain(e, url)); }
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 2000) }; }
  return { status: r.status, json };
}

// 1) Login = GET /api/v2/me, Basic email:password + header client
app.post('/auth/login', async (req, res) => {
  try {
    const server = normServer(req.body.server);
    let password = '';
    if (req.body.password_enc) {
      try { password = decryptPassword(req.body.password_enc); }
      catch { return res.status(400).json({ error: 'Password terenkripsi tidak valid (server mungkin baru restart) — muat ulang halaman lalu login lagi' }); }
    } else if (req.get('authorization')?.startsWith('Basic ')) {
      // fallback browser tanpa WebCrypto (http non-localhost): kredensial dikirim sebagai Basic header
      const [u, ...p] = Buffer.from(req.get('authorization').slice(6), 'base64').toString('utf8').split(':');
      password = p.join(':'); if (!req.body.username) req.body.username = u;
    }
    if (!req.body.username || !password) return res.status(400).json({ error: 'Email dan password wajib diisi' });
    const headers = {
      Authorization: 'Basic ' + Buffer.from(`${req.body.username}:${password}`).toString('base64'),
      client: clientB64(req.body.client),
    };
    const r = await zfetch(server + '/api/v2/me', headers);
    if (!r.json?.access_token) {
      const msg = r.json?.error?.message || r.json?.message || r.json?.detail?.message || (r.status === 401 ? 'Email / password salah' : 'Token tidak ada di respons');
      return res.status(r.status === 200 ? 502 : r.status).json({ error: `Login gagal (HTTP ${r.status}): ${msg}` });
    }
    res.json({ server, me: r.json });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 2) Daftar database/perusahaan — coba beberapa endpoint berurutan
app.post('/auth/companies', async (req, res) => {
  try {
    const server = normServer(req.body.server);
    const token = req.body.token; if (!token) return res.status(401).json({ error: 'Belum login' });
    const headers = { Authorization: 'Bearer ' + token, client: clientB64(req.body.client) };
    const notes = [];
    // pencarian dicoba dari yang paling spesifik ke paling longgar: sebagian akun (anggota undangan / peran terbatas) kosong bila difilter status membership
    const QUERIES = ['?per_page=500&sort[company.name]=asc&company[membership][status][$nin]=INACTIVE', '?per_page=500&sort[company.name]=asc', '?per_page=500', ''];
    for (const ep of COMPANY_ENDPOINTS) {
      for (const q of QUERIES) {
        const r = await zfetch(server + ep + q, headers);
        const list = r.json?.results || r.json?.data || r.json?.companies || (Array.isArray(r.json) ? r.json : null);
        if (r.status === 200 && Array.isArray(list) && list.length) return res.json({ endpoint: ep, results: list });
        const keys = r.json && typeof r.json === 'object' ? Object.keys(r.json).slice(0, 6).join(',') : '';
        notes.push(`${ep}${q ? '?…' + (q.includes('$nin') ? 'status' : q.includes('sort') ? 'sort' : 'page') : ''}: HTTP ${r.status}${r.status === 200 ? ', 0 perusahaan' + (keys ? ' (field: ' + keys + ')' : '') : ''}`);
      }
    }
    res.json({ endpoint: null, results: [], notes });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 3) Detail satu perusahaan (GET /api/v2/user_companies/{id})
app.post('/auth/company', async (req, res) => {
  try {
    const server = normServer(req.body.server);
    const { token, id, endpoint } = req.body;
    if (!token) return res.status(401).json({ error: 'Belum login' });
    const headers = { Authorization: 'Bearer ' + token, client: clientB64(req.body.client) };
    const ep = (endpoint || '/api/v2/user_companies') + '/' + encodeURIComponent(id);
    const r = await zfetch(server + ep, headers);
    res.status(r.status).json(r.json);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 4) Proxy data: /zapi/<path>?<query> -> <x-zahir-base>/<path>?<query>
app.all('/zapi/*', async (req, res) => {
  try {
    const base = normServer(req.get('x-zahir-base'));
    const token = req.get('x-zahir-token'); if (!token) return res.status(401).json({ error: 'Belum login' });
    const headers = { Authorization: 'Bearer ' + token, client: clientB64(req.get('x-zahir-client')) };
    const company = req.get('x-zahir-company'); if (company) headers['X-Company-Id'] = company;
    // slug database (mis. namapt-pg.zahironline.com): dikirim sebagai header + query param
    const slug = (req.get('x-zahir-slug') || '').trim();
    let target = req.originalUrl.replace(/^\/zapi/, '');
    if (slug) {
      headers.slug = slug; headers['X-Slug'] = slug;
      if (!/[?&]slug=/.test(target)) target += (target.includes('?') ? '&' : '?') + 'slug=' + encodeURIComponent(slug);
    }
    const r = await zfetch(base + target, headers, req.method, ['POST', 'PUT', 'PATCH'].includes(req.method) ? req.body : undefined);
    res.status(r.status).json(r.json);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 5) Definisi custom query (SQL + peta field) untuk rekomendasi cara pengambilan data.
//    Dibaca dari API Zahir (daftar custom query -> /api/v3/custom_queries/<id>). Aplikasi tidak menyimpan custom query.
// Folder data yang bisa ditulis: DATA_ROOT env > folder exe (bila dibundel .exe) > folder aplikasi
const IS_PKG = !!process.pkg;
const IS_DESKTOP = process.env.ZI_DESKTOP === '1';   // dijalankan di dalam aplikasi desktop (Electron)
// Saat dibundel jadi satu .exe: pakai folder di samping exe bila sudah ada data/ di situ (mode portable),
// selain itu %LOCALAPPDATA%\ZahirInsight (Windows) atau ~/.zahir-insight — exe bisa diletakkan di mana saja.
function pickBaseDir() {
  if (process.env.DATA_ROOT) return process.env.DATA_ROOT;
  if (!IS_PKG) return __dirname;
  const beside = path.dirname(process.execPath);
  if (fs.existsSync(path.join(beside, 'data')) || fs.existsSync(path.join(beside, 'portable.txt'))) return beside;
  const home = process.platform === 'win32' ? (process.env.LOCALAPPDATA || process.env.APPDATA || require('os').homedir()) : require('os').homedir();
  return path.join(home, process.platform === 'win32' ? 'ZahirInsight' : '.zahir-insight');
}
const BASE_DIR = pickBaseDir();
// pengaturan lokal (port) — berkas biasa (bukan rahasia) di folder data
const SETTINGS_FILE = path.join(BASE_DIR, 'data', 'settings.json');
function loadSettings() { try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) || {}; } catch { return {}; } }
function saveSettings(o) { fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true }); fs.writeFileSync(SETTINGS_FILE, JSON.stringify(o, null, 2)); }
const PORT = Number(process.env.PORT) || Number(loadSettings().port) || 3300;

// ---- penyimpanan terenkripsi (AES-256-GCM): desain laporan di disk tidak bisa dibaca langsung ----
// Aktif otomatis pada build .exe; di mode pengembangan (node server.js) berkas disimpan JSON biasa. Paksa dengan DATA_ENCRYPT=1/0.
const ENC = process.env.DATA_ENCRYPT ? process.env.DATA_ENCRYPT !== '0' : (IS_PKG || IS_DESKTOP);
const ENC_KEY = crypto.createHash('sha256').update(process.env.DATA_KEY || ['z', 'ahir', '-ins', 'ight', '::', 'k', '7Q', 'p9', 'Lx', '!v2'].join('')).digest();
const ENC_MAGIC = Buffer.from('ZIE1');
function packJson(obj) {
  const txt = JSON.stringify(obj, null, ENC ? 0 : 2); if (!ENC) return Buffer.from(txt, 'utf8');
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const body = Buffer.concat([c.update(txt, 'utf8'), c.final()]); return Buffer.concat([ENC_MAGIC, iv, c.getAuthTag(), body]);
}
function unpackJson(buf) {
  if (buf.length > 32 && buf.subarray(0, 4).equals(ENC_MAGIC)) {
    const d = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, buf.subarray(4, 16)); d.setAuthTag(buf.subarray(16, 32));
    return JSON.parse(Buffer.concat([d.update(buf.subarray(32)), d.final()]).toString('utf8'));
  }
  return JSON.parse(buf.toString('utf8'));
}
// berkas: <nama>.dat (terenkripsi) atau <nama>.json (biasa / warisan). Baca mana yang ada; tulis sesuai mode ENC dan hapus pasangannya.
function readStore(base) { for (const ext of ['.dat', '.json']) { try { return unpackJson(fs.readFileSync(base + ext)); } catch {} } return null; }
function writeStore(base, obj) {
  fs.mkdirSync(path.dirname(base), { recursive: true });
  fs.writeFileSync(base + (ENC ? '.dat' : '.json'), packJson(obj));
  try { fs.unlinkSync(base + (ENC ? '.json' : '.dat')); } catch {}
}
function zahirHeaders(req) {
  const token = req.get('x-zahir-token'); if (!token) throw Object.assign(new Error('Belum login'), { status: 401 });
  const headers = { Authorization: 'Bearer ' + token, client: clientB64(req.get('x-zahir-client')) };
  const company = req.get('x-zahir-company'); if (company) headers['X-Company-Id'] = company;
  const slug = (req.get('x-zahir-slug') || '').trim(); if (slug) { headers.slug = slug; headers['X-Slug'] = slug; }
  return { headers, slug };
}
const listOfDefs = j => { const arr = Array.isArray(j) ? j : (j && (j.results || j.data || j.items)) || (j && (typeof j.query === 'string' || j.id) ? [j] : []); return Array.isArray(arr) ? arr : []; };
const sameName = (x, name) => x && String(x.name || x.nama || '').trim() === name;
const pickDef = (j, name) => listOfDefs(j).find(x => sameName(x, name) && typeof x.query === 'string');
// daftar custom query biasanya hanya memuat id+nama; definisinya (SQL) ada di /api/v3/custom_queries/<id>
const pickId = (j, name) => { const x = listOfDefs(j).find(x => sameName(x, name) && x.id != null); return x ? x.id : null; };
// ---- custom query bawaan (dibundel, hanya dibaca): bb_trx, bb_saldo_awal, buku_besar_faktur_invoice.
//      Saat database dibuka, yang belum ada otomatis dibuat di Zahir lewat API (POST custom_queries). ----
const CQ_BUNDLED_DIR = path.join(__dirname, 'custom_queries');
function bundledCq() { const out = []; try { for (const f of fs.readdirSync(CQ_BUNDLED_DIR)) if (f.endsWith('.json')) { try { const d = JSON.parse(fs.readFileSync(path.join(CQ_BUNDLED_DIR, f), 'utf8')); if (d && d.name && typeof d.query === 'string') out.push(d); } catch {} } } catch {} return out; }
async function zahirCqIndex(base, headers, sq) {
  let last = '';
  for (const ep of ['/api/v3/custom_queries?$per_page=1000', '/api/v2/custom_queries?$per_page=1000']) {
    try { const r = await zfetch(base + ep + sq, headers); if (r.status < 300) { const m = {}; for (const x of listOfDefs(r.json)) if (x && (x.name || x.nama)) m[String(x.name || x.nama).trim()] = x.id ?? true; return { ok: true, map: m }; } last = ep + ' → HTTP ' + r.status + ' ' + (r.json?.error?.message || r.json?.error?.detail?.message || ''); } catch (e) { last = ep + ' → ' + e.message; }
  }
  return { ok: false, map: {}, reason: last };
}
app.post('/cq/ensure', async (req, res) => {
  try {
    const base = normServer(req.get('x-zahir-base')); const { headers, slug } = zahirHeaders(req); const sq = slug ? '&slug=' + encodeURIComponent(slug) : '';
    const idx = await zahirCqIndex(base, headers, sq); if (!idx.ok) return res.json({ checked: false, results: [], reason: idx.reason || 'daftar custom query tidak terbaca dari API Zahir' });
    const out = [];
    for (const d of bundledCq()) {
      if (d.name in idx.map) {
        // versi lama bb_trx_valas belum membawa mata uang per baris (jurnalvc.currency_id) & kurs → diperbarui langsung lewat PUT /custom_queries/<id> (tanpa hapus)
        let status = 'ada';
        if (d.name === 'bb_trx_valas' && idx.map[d.name] !== true) {
          const id = encodeURIComponent(idx.map[d.name]); let stale = false;
          for (const ver of ['v3', 'v2']) {
            try { const r = await zfetch(`${base}/api/${ver}/custom_queries/${id}${sq ? '?' + sq.slice(1) : ''}`, headers); const x = r.status < 300 && r.json && (r.json.results || r.json.data || r.json); if (x && typeof x.query === 'string') { stale = !x.query.includes('nilaikurs'); break; } } catch {}
          }
          if (stale) {
            const body = { name: d.name, reason: d.reason || '', field: d.field || {}, query: d.query, ...(d.query_count ? { query_count: d.query_count } : {}) };
            let done = false, err = '';
            for (const ep of [`/api/v3/custom_queries/${id}`, `/api/v2/custom_queries/${id}`]) {
              try { const r = await zfetch(base + ep + (sq ? '?' + sq.slice(1) : ''), headers, 'PUT', body); if (r.status < 300) { done = true; break; } err = (r.json?.error?.detail?.message) || r.json?.error?.message || (typeof r.json?.error === 'string' ? r.json.error : '') || ('HTTP ' + r.status); } catch (e) { err = e.message; }
            }
            status = done ? 'diperbarui' : 'lama: PUT ditolak (' + err + ') — hapus custom query ini di Zahir lalu periksa ulang';
          }
        }
        out.push({ name: d.name, status }); continue;
      }
      const body = { name: d.name, reason: d.reason || '', field: d.field || {}, query: d.query, ...(d.query_count ? { query_count: d.query_count } : {}) };
      let done = false, err = '';
      for (const ep of ['/api/v3/custom_queries', '/api/v2/custom_queries']) {
        try { const r = await zfetch(base + ep + (sq ? '?' + sq.slice(1) : ''), headers, 'POST', body); if (r.status < 300) { done = true; break; } err = (r.json?.error?.detail?.message) || r.json?.error?.message || (typeof r.json?.error === 'string' ? r.json.error : '') || ('HTTP ' + r.status); } catch (e) { err = e.message; }
      }
      out.push({ name: d.name, status: done ? 'dibuat' : 'gagal: ' + err });
    }
    res.json({ checked: true, results: out });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
app.get('/cq/def/:name', async (req, res) => {
  const name = String(req.params.name || '').trim(); if (!/^[\w.-]+$/.test(name)) return res.status(400).json({ error: 'Nama custom query tidak valid' });
  const tried = [];
  try {
    const base = req.get('x-zahir-base') ? normServer(req.get('x-zahir-base')) : '';
    if (base) {
      const { headers, slug } = zahirHeaders(req); const sq = slug ? '&slug=' + encodeURIComponent(slug) : '';
      const n = encodeURIComponent(name);
      for (const ep of [`/api/v3/custom_queries?name=${n}&$per_page=50`, `/api/v3/custom_queries?name.$eq=${n}&$per_page=50`, `/api/v2/custom_queries?name=${n}&$per_page=50`, `/api/v3/custom_query?name=${n}`, `/api/v2/custom_query?name=${n}`, `/api/v3/custom_queries?$per_page=1000`, `/api/v2/custom_queries?$per_page=1000`]) {
        try {
          const r = await zfetch(base + ep + sq, headers); tried.push(ep + ' → ' + r.status); if (r.status >= 300) continue;
          let d = pickDef(r.json, name);
          if (!d) { const id = pickId(r.json, name); if (id != null) { const ver = ep.startsWith('/api/v2') ? 'v2' : 'v3'; const r2 = await zfetch(`${base}/api/${ver}/custom_queries/${encodeURIComponent(id)}?${sq.slice(1)}`, headers); tried.push(`/api/${ver}/custom_queries/${id} → ${r2.status}`); if (r2.status < 300) { const x = r2.json && (r2.json.results || r2.json.data || r2.json); if (x && typeof x.query === 'string') d = x; } } }
          if (d) return res.json({ source: 'zahir', name, query: d.query, field: d.field || d.fields || {}, reason: d.reason || '' });
        } catch (e) { tried.push(ep + ' → ' + e.message); }
      }
    }
  } catch (e) { if (e.status === 401) return res.status(401).json({ error: e.message }); tried.push(e.message); }
  res.status(404).json({ error: 'Custom query "' + name + '" tidak ditemukan di database Zahir ini. Buat dulu di Zahir Online (menu Custom Query) dengan nama itu, atau tempelkan SQL-nya di bawah untuk dianalisis saja.', tried });
});
// 6) Rekomendasi: aturan lokal (core.analyzeQuery) + opsional penjelasan dari model AI bila ANTHROPIC_API_KEY diset.
const AI_KEY = process.env.ANTHROPIC_API_KEY || ''; const AI_MODEL = process.env.AI_MODEL || 'claude-sonnet-5-5';
app.get('/ai/status', (req, res) => res.json({ llm: !!AI_KEY, model: AI_KEY ? AI_MODEL : null }));
app.post('/ai/recommend', async (req, res) => {
  if (!requireLogin(req, res)) return;
  const b = req.body || {}; const def = { name: b.name, query: String(b.query || '').slice(0, 60000), field: b.field || {}, reason: b.reason || '' };
  const rule = core.analyzeQuery(def, { mode: b.mode });
  if (!AI_KEY) return res.json({ ...rule, llm: null });
  try {
    const prompt = `Kamu membantu memilih "cara pengambilan data" untuk laporan yang menarik hasil custom query SQL Zahir Online lewat API berhalaman, dengan filter tanggal date.$gte/date.$lte. Pilihan: (1) once = satu query untuk seluruh periode; (2) monthly = periode dipecah per bulan, baris digabung apa adanya (untuk baris rinci/transaksi atau crosstab); (3) monthly_sum = dipecah per bulan lalu baris berkunci sama digabung dan kolom angkanya dijumlahkan (hanya sah untuk mutasi/omzet/qty, tidak untuk saldo, rata-rata, persentase, fungsi window).
Mode laporan: ${b.mode || 'table'}. Analisis aturan lokal menyarankan: ${rule.rec} (${rule.confidence}).
Peta field: ${JSON.stringify(def.field)}
SQL:
${def.query}

Jawab dalam bahasa Indonesia, JSON murni: {"rec":"once|monthly|monthly_sum","explanation":"maks 3 kalimat alasan dari struktur query","caution":"1 kalimat hal yang perlu dicek, atau kosong"}`;
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': AI_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: AI_MODEL, max_tokens: 400, messages: [{ role: 'user', content: prompt }] }) });
    const j = await r.json(); if (!r.ok) throw new Error(j?.error?.message || ('HTTP ' + r.status));
    const txt = (j.content || []).map(c => c.text || '').join(''); const m = txt.match(/\{[\s\S]*\}/);
    const out = m ? JSON.parse(m[0]) : { explanation: txt };
    res.json({ ...rule, llm: { model: AI_MODEL, rec: out.rec, explanation: out.explanation, caution: out.caution } });
  } catch (e) { res.json({ ...rule, llm: { error: e.message } }); }
});

// ---- desain laporan buatan user (disimpan di data/reports.json) ----
const DATA_DIR = path.join(BASE_DIR, 'data');
// REPORT_SCOPE=global  : satu daftar desain laporan untuk semua (dipasang di satu customer / on-premise)
// REPORT_SCOPE=company : desain dipisah per database/perusahaan Zahir (dihosting bersama untuk banyak customer)
const REPORT_SCOPE = (process.env.REPORT_SCOPE || 'company').toLowerCase() === 'global' ? 'global' : 'company';   // bawaan: per perusahaan
function rptBase(req) {
  if (REPORT_SCOPE === 'global') return path.join(DATA_DIR, 'reports');
  const key = String(req.get('x-zahir-slug') || req.get('x-zahir-company') || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '_').slice(0, 120);
  return path.join(DATA_DIR, 'reports.' + (key || 'default'));
}
function loadReports(req){
  const list = readStore(rptBase(req)); if (Array.isArray(list)) return list;
  // migrasi dari versi lama (satu reports.json untuk semua): perusahaan yang pertama kali dibuka mewarisi daftar lama
  if (REPORT_SCOPE === 'company') { const old = readStore(path.join(DATA_DIR, 'reports')); if (Array.isArray(old) && old.length) { writeStore(rptBase(req), old); return old; } }
  return [];
}
function saveReports(req, list){ writeStore(rptBase(req), list); }
function requireLogin(req, res){ if (!req.get('x-zahir-token')) { res.status(401).json({ error: 'Belum login' }); return false; } return true; }
app.get('/reports', (req, res) => { if (!requireLogin(req, res)) return; res.json(loadReports(req)); });
app.post('/reports', (req, res) => {
  if (!requireLogin(req, res)) return;
  const r = req.body || {};
  if (!r.title || !r.cq) return res.status(400).json({ error: 'Judul dan nama custom query wajib diisi' });
  r.cq = String(r.cq).trim().replace(/^.*custom_queries\//, '').replace(/[?#].*$/, '');
  if (!/^[\w.-]+$/.test(r.cq)) return res.status(400).json({ error: 'Nama custom query tidak valid: ' + r.cq });
  const list = loadReports(req);
  if (!r.id) r.id = 'u_' + Date.now().toString(36);
  r.custom = true; r.updated_at = new Date().toISOString();
  const i = list.findIndex(x => x.id === r.id); if (i >= 0) list[i] = r; else list.push(r);
  saveReports(req, list); res.json(r);
});
app.delete('/reports/:id', (req, res) => {
  if (!requireLogin(req, res)) return;
  const list = loadReports(req).filter(x => x.id !== req.params.id); saveReports(req, list); res.json({ ok: true });
});

// ---- ekspor Excel streaming di server (memori kecil berapa pun jumlah baris) ----
const os = require('os'); const ExcelJS = require('exceljs');
const EXPORTS = new Map();
const XW = require('./public/xlsxw.js'); const writeRow = XW.writeRow;
// sesi ekspor di memori server (mode lokal/desktop). Di Vercel Excel dibuat di browser (lihat exportXlsx di index.html).
function startExport(o) {
  const id = crypto.randomBytes(8).toString('hex'); const file = path.join(os.tmpdir(), `zlv-export-${id}.xlsx`);
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: file, useStyles: true, useSharedStrings: false });
  const ws = wb.addWorksheet('Laporan');
  const ex = Object.assign(XW.setupSheet(ws, o), { id, wb, file, fileName: o.fileName || 'laporan.xlsx', at: Date.now() });
  EXPORTS.set(id, ex); return ex;
}
app.post('/export/start', (req, res) => {
  if (!requireLogin(req, res)) return;
  const b = req.body || {};
  if (!Array.isArray(b.cols) || !b.cols.length) return res.status(400).json({ error: 'cols kosong' });
  res.json({ id: startExport(b).id });
});
app.post('/export/:id/rows', (req, res) => {
  const ex = EXPORTS.get(req.params.id); if (!ex) return res.status(404).json({ error: 'Sesi ekspor tidak ada' });
  const rows = req.body?.packed || req.body?.rows || [];
  for (const r of rows) writeRow(ex, r);
  ex.at = Date.now(); res.json({ rows: ex.rows });
});
app.post('/export/:id/finish', async (req, res) => {
  const ex = EXPORTS.get(req.params.id); if (!ex) return res.status(404).json({ error: 'Sesi ekspor tidak ada' });
  try { ex.ws.commit(); await ex.wb.commit(); ex.done = true; res.json({ url: `/export/${req.params.id}/download`, rows: ex.rows }); }
  catch (e) { EXPORTS.delete(req.params.id); res.status(500).json({ error: e.message }); }
});
app.get('/export/:id/download', (req, res) => {
  const ex = EXPORTS.get(req.params.id); if (!ex || !ex.done) return res.status(404).send('Tidak ada');
  res.download(ex.file, ex.fileName, () => { fs.unlink(ex.file, () => {}); EXPORTS.delete(req.params.id); });
});
setInterval(() => { for (const [id, ex] of EXPORTS) if (Date.now() - ex.at > 30 * 60 * 1000) { fs.unlink(ex.file, () => {}); EXPORTS.delete(id); } }, 60 * 1000).unref();


// ---- ekspor langsung: server menarik data dari Zahir, menyusun laporan (core.js yang sama dengan browser), menulis Excel streaming ----
const core = require('./public/core.js');
// ID mata uang USD: transaksi bermata uang ini tidak menampilkan blok nilai asli di Buku Besar Valas (lihat LedgerBuilder). Default = ID di core.js.
const USD_CURRENCY_ID = (process.env.USD_CURRENCY_ID || '').trim().toLowerCase() || core.DEFAULT_USD_CURRENCY_ID;
core.LedgerBuilder.usdCurrencyId = USD_CURRENCY_ID;
const JOBS = new Map();
const LEDGER_WIDTHS = { tanggal:11, tipe:7, referensi:14, kontak:24, deskripsi:48, dept:12, proyek:14, faktur_pajak:22, no_invoice:20, debit:16, kredit:16, saldo:18, kurs:11, debit_usd:16, kredit_usd:16, saldo_usd:18 };
// kolom buku besar untuk Excel; valas=true → kolom USD ikut + header 2 tingkat (label "DEBIT (USD)" → "DEBIT" di bawah judul kelompok)
function ledgerExportCols(report, valas) {
  const all = core.ledgerColsOf(true);
  const des = (report.cols || []).filter(c => all.includes(c.key) && (valas || !core.VALAS_COLS.includes(c.key)));
  const cols = des.length ? des.filter(c => c.show !== false).map(c => c.key) : core.ledgerColsOf(valas);
  const lab = Object.fromEntries(des.map(c => [c.key, c.label]));
  const labels = Object.fromEntries(cols.map(c => [c, lab[c] || core.LABELS[c] || c]));
  if (!valas || !cols.some(c => core.VALAS_COLS.includes(c))) return { cols, labels, groups: null };
  const groups = []; for (const c of cols) { const g = core.LEDGER_GROUP[c] || null; const last = groups[groups.length - 1]; if (last && g && last.label === g) last.span++; else groups.push({ label: g, span: 1 }); }
  for (const c of cols) if (core.LEDGER_GROUP[c]) labels[c] = String(labels[c]).replace(/\s*\((USD|IDR)\)\s*$/i, '');
  return { cols, labels, groups };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function runJob(job, b) {
  const { base, token, client, company, slug, ttypes, companyName, report, filters, monthly, fileName } = b;
  const headers = { Authorization: 'Bearer ' + token, client: clientB64(client) };
  if (company) headers['X-Company-Id'] = company;
  if (slug) { headers.slug = slug; headers['X-Slug'] = slug; }
  const server = normServer(base);
  const get = async (cq, params) => {
    const q = new URLSearchParams(params); if (slug) q.set('slug', slug);
    for (let i = 0; ; i++) {
      const r = await zfetch(`${server}/api/v3/custom_queries/${encodeURIComponent(cq)}?${q}`, headers);
      const err = r.json?.error?.detail?.message || r.json?.error?.message || (typeof r.json?.error === 'string' ? r.json.error : null);
      if (r.status < 400 && !err) return r.json;
      const msg = err || ('HTTP ' + r.status);
      if (i >= 5 || !/busy|too many|deadlock|timeout/i.test(msg)) throw new Error(msg);
      job.stage = 'Server sibuk, mencoba lagi…'; await sleep(1500 * (i + 1));
    }
  };
  const LF = core.localPredicate(filters && filters.local);   // filter 'di aplikasi' (kolom hasil dicocokkan dengan pilihan)
  // Minta kolom seperlunya saja ($select) bila server menghormatinya — dicek sekali per custom query dengan permintaan 1 baris
  const SEL = {};
  const probeSelect = async (cq, params) => {
    const cols = core.usedColumns(report, filters && filters.local); if (!cols || SEL[cq] !== undefined) return; SEL[cq] = null;
    for (const key of ['$select', 'select']) {
      try { const j = await get(cq, { ...params, $page: 1, $per_page: 1, [key]: cols.join(',') }); const row = (j.results || [])[0]; if (!row) return;
        if (core.selectHonored(row, cols)) { SEL[cq] = { [key]: cols.join(',') }; job.selectCols = cols.length; return; } } catch { }
    }
  };
  const fetchAll = async (cq, params, sink, count) => {
    let page = 1;
    while (true) {
      const j = await get(cq, { ...params, ...(SEL[cq] || {}), $page: page, $per_page: 10000 }); const raw = j.results || []; const rows = LF ? raw.filter(LF) : raw;
      for (const r of rows) sink(r); if (count) job.got += raw.length;
      const pages = j.page_context?.total_pages || 1; if (page >= pages || !rows.length) break; page++;
    }
  };
  const F = filters; const useDate = !!F.date; const d1 = F.date?.d1 || '', d2 = F.date?.d2 || '';
  const countRange = async (cq, c, a, b) => { const j = await get(cq, { ...F.base, ...c, ...(a ? { 'date.$gte': a, 'date.$lte': b } : {}), $page: 1, $per_page: 1 }); return Number(j.count) || 0; };
  // rencana pengambilan adaptif (sama dengan browser): tahun kosong dilewati, tahun kecil sekali tarik, tahun besar per bulan
  let jobs = [];
  const plan = async cq => { jobs = []; let expect = 0; job.stage = 'Merencanakan pengambilan data…';
    for (const c of F.combos) {
      if (!useDate || !monthly) { jobs.push({ ...F.base, ...c, ...(useDate ? { 'date.$gte': d1, 'date.$lte': d2 } : {}) }); continue; }
      const pl = await core.planChunks(d1, d2, (a, b) => countRange(cq, c, a, b), 10000); expect += pl.expect;
      for (const [a, b] of pl.chunks) jobs.push({ ...F.base, ...c, 'date.$gte': a, 'date.$lte': b }); }
    return expect; };
  const period = useDate ? `Periode : ${d1} s/d ${d2}` : '';
  const mode = report.mode;
  const ledgerCols = valas => ledgerExportCols(report, !!valas);
  // mode lama: custom query buku besar yang sudah jadi (dipakai bila bb_trx tidak tersedia di database ini)
  const runLegacy = async () => {
    if (!useDate) throw new Error('Buku besar memerlukan filter tanggal');
    const lcq = mode === 'legacy' ? report.cq : (report.legacyCq || report.cq);
    job.expect = await plan(lcq); job.total = jobs.length; job.done = 0; job.got = 0;
    const M = new core.LegacyMerger();
    for (const p of jobs) { job.stage = `Mengambil data bagian ${job.done + 1}/${job.total}…`; await fetchAll(lcq, p, r => M.add(r), true); job.done++; }
    job.stage = 'Menggabungkan & menulis Excel…';
    const { cols, labels } = ledgerCols(false);
    const ex = startExport({ kind: 'ledger', title: companyName, sub: report.title, period, cols, labels, numeric: core.LEDGER_NUM, widths: LEDGER_WIDTHS, ttypes, fileName });
    let i = 0; for (const r of M.gen(d1)) { writeRow(ex, r); if (++i % 5000 === 0) await sleep(0); }
    return ex;
  };
  if (mode === 'legacy') return runLegacy();
  if (mode === 'tb') {
    if (!useDate) throw new Error('Trial balance memerlukan filter tanggal');
    const cq = report.cq || report.cqSaldo; const TB = new core.TrialBalance();
    const SA = F.combos.flatMap(c => core.LedgerBuilder.saChunks(d1, { ...F.base, ...c }));
    const MU = F.combos.map(c => ({ ...F.base, ...c, 'date.$gte': d1, 'date.$lte': d2 }));
    job.total = SA.length + MU.length;
    for (const s of SA) { job.stage = 'Mengambil saldo awal…'; await fetchAll(cq, s.p, r => TB.addSa(r, s.ytd), true); job.done++; }
    for (const p of MU) { job.stage = 'Mengambil mutasi…'; await fetchAll(cq, p, r => TB.addMut(r), true); job.done++; }
    job.stage = 'Menulis Excel…';
    const L = core.tbLayout(report.cur || {}, report.cols);
    const ex = startExport({ kind: 'table', title: companyName, sub: report.title, period, cols: L.cols, labels: L.labels, numeric: L.numeric, widths: { kode_akun: 14, nama_akun: 38 }, ttypes, fileName, heads: L.heads, dec: L.dec });
    for (const r of TB.rows(core.tbRowOpts(b.tbOpt))) writeRow(ex, r);
    return ex;
  }
  if (mode === 'journal') {
    if (!useDate) throw new Error('Laporan jurnal memerlukan filter tanggal');
    job.expect = await plan(report.cq); job.total = jobs.length; const JB = new core.JournalBuilder();
    for (const p of jobs) { job.stage = `Mengambil jurnal bagian ${job.done + 1}/${job.total}…`; await fetchAll(report.cq, p, r => JB.add(r), true); job.done++; }
    job.stage = 'Menyusun jurnal & menulis Excel…';
    const L = core.jrLayout(report.cur || {}, report.cols); const W = { tipe: 16, nomor: 16, tanggal: 11, kontak: 26, deskripsi: 40, akun: 32, kode_akun: 14, dept: 14, proyek: 14 };
    const ex = startExport({ kind: 'table', title: companyName, sub: report.title, period, cols: L.cols, labels: L.labels, numeric: L.numeric, widths: Object.fromEntries(L.cols.map(c => [c, W[c] || 15])), ttypes, fileName, heads: L.heads, dec: L.dec });
    const fc = core.tbRowOpts(b.tbOpt).code;
    let i = 0; for (const r of JB.gen()) { if (r.kode_akun) r.kode_akun = fc(r.kode_akun); writeRow(ex, Object.assign({}, r, { __kind: r.__k === 'jh' ? 'bold' : r.__k === 'jb' ? 'tot' : 'trx' })); if (++i % 5000 === 0) await sleep(0); }
    return ex;
  }
  if (mode === 'ledger') {
    if (!useDate) throw new Error('Buku besar memerlukan filter tanggal');
    const cqTrx = report.custom ? report.cq : report.cqTrx, cqSaldo = report.cqSaldo;
    if (report.legacyCq) { try { await countRange(cqTrx, F.combos[0] || {}, d1, d1); await get(cqSaldo, { 'date.$lte': d1, $page: 1, $per_page: 1 }); } catch (e) { if (/not found|tidak ditemukan|404|custom query/i.test(e.message)) return runLegacy(); throw e; } }
    // saldo awal: potongan tanggal tidak tumpang tindih (sebelum tahun berjalan + tahun berjalan), tanpa filter kontak
    const SA = F.combos.flatMap(c => { const bb = { ...F.base, ...c }; delete bb.contact_id; return core.LedgerBuilder.saChunks(d1, bb); });
    job.expect = await plan(cqTrx); job.total = SA.length + jobs.length;
    const B = new core.LedgerBuilder(); B.accCur = (b.tbOpt && b.tbOpt.cur) || {}; B.curCode = (b.tbOpt && b.tbOpt.curCode) || {}; if (core.LedgerBuilder.usdCurrencyId) B.curCode[String(core.LedgerBuilder.usdCurrencyId).toLowerCase()] = 'USD';
    for (const s of SA) { job.stage = 'Mengambil saldo awal…'; await fetchAll(cqSaldo, s.p, r => B.addSa(r, s.ytd)); job.done++; }
    for (const p of jobs) { job.stage = `Mengambil transaksi bagian ${job.done + 1}/${job.total}…`; await fetchAll(cqTrx, p, r => B.addTrx(r), true); job.done++; }
    job.stage = 'Menyusun buku besar & menulis Excel…';
    const { cols, labels, groups } = ledgerCols(B.valas);
    const ex = startExport({ kind: 'ledger', title: companyName, sub: report.title, period, cols, labels, numeric: core.LEDGER_NUM, widths: LEDGER_WIDTHS, ttypes, fileName, groups });
    let i = 0; for (const r of B.gen(d1)) { writeRow(ex, r); if (++i % 5000 === 0) { job.got2 = i; await sleep(0); } }
    return ex;
  }
  if (mode === 'table') {
    const cfg = (report.cols && report.cols.length) ? report.cols.filter(c => c.show !== false) : null;
    const e1 = await plan(report.cq); if (monthly) job.expect = e1; job.total = jobs.length; await probeSelect(report.cq, jobs[0] || {});
    let ex = null; const buf = [];
    const flush = () => { if (!ex) { const cc = cfg || Object.keys(buf[0] || {}).map(k => ({ key: k, label: k.replace(/_/g, ' ').toUpperCase() })); const cols = cc.map(c => c.key); const labels = Object.fromEntries(cc.map(c => [c.key, c.label || c.key])); const numeric = cols.filter(k => !/(^|_)(id|kode|code|no|nomor|number|nik|npwp|tanggal|date|periode|bulan|tahun)($|_)/i.test(k) && buf.slice(0, 50).every(r => r[k] == null || (r[k] !== '' && typeof r[k] !== 'boolean' && !isNaN(typeof r[k] === 'string' ? r[k].replace(/,/g, '') : r[k]))) && buf.slice(0, 50).some(r => r[k] != null && r[k] !== '')); ex = startExport({ kind: 'table', title: companyName, sub: report.title, period, cols, labels, numeric, widths: {}, ttypes, fileName }); } for (const r of buf) writeRow(ex, r); buf.length = 0; };
    if (report.fetch === 'monthly_sum') {
      const S = new core.Summarizer(report.cols && report.cols.length ? report.cols : null);
      for (const p of jobs) { job.stage = `Mengambil data bagian ${job.done + 1}/${job.total}…`; await fetchAll(report.cq, p, r => S.add(r), true); job.done++; }
      job.stage = 'Menjumlahkan per kelompok & menulis Excel…'; for (const r of S.rows()) buf.push(r); flush(); return ex;
    }
    const gb = (report.groupBy || []);
    const probeEnc = async () => { const j = await get(report.cq, { ...jobs[0], $page: 1, $per_page: 50 }); const rs = j.results || []; return rs.length && Object.keys(rs[0]).some(k => rs.filter(r => core.BARIS_RE.test(String(r[k] ?? ''))).length > rs.length * 0.8); };
    if (gb.length || report.totRow || (cfg && cfg.some(c => /\.(kode|nama|tipe|lvl|sort)$/.test(c.key))) || await probeEnc()) {
      // dikelompokkan: perlu semua baris dulu (diurutkan per kelompok), lalu ditulis
      const all = []; for (const p of jobs) { job.stage = `Mengambil data bagian ${job.done + 1}/${job.total}…`; await fetchAll(report.cq, p, r => all.push(r), true); job.done++; }
      job.stage = 'Mengelompokkan & menulis Excel…';
      const cc = cfg || Object.keys(all[0] || {}).map(k => ({ key: k, label: k.replace(/_/g, ' ').toUpperCase() }));
      const CODE = /(^|_)(id|kode|code|no|nomor|number|nik|npwp|tanggal|date|periode|bulan|tahun)($|_)/i;
      let cols = cc.map(c => c.key); const labels = Object.fromEntries(cc.map(c => [c.key, c.label || c.key]));
      const isN = v => v != null && v !== '' && typeof v !== 'boolean' && !isNaN(typeof v === 'string' ? v.replace(/,/g, '') : v);
      core.expandJasper(all, cols);
      const numeric = cols.filter(k => !CODE.test(k) && !/\.(kode|nama|tipe|lvl|sort)$/.test(k) && all.slice(0, 50).every(r => r[k] == null || isN(r[k])) && all.slice(0, 50).some(r => isN(r[k])));
      const gbv = gb.filter(k => all[0] && k in all[0]); if (report.groupHide !== false) cols = cols.filter(c => !gbv.includes(c));
      const role = new Map(cc.map(c => [c.key, c.sum]));
      if (!core.expandJasper(all, cols)) { const JS = core.jasperSplit(all, cols, report.labKode, report.labAkun); cols = JS.cols; Object.assign(labels, JS.labels); }
      const sumCols = cols.filter(c => role.get(c) === true || (role.get(c) !== false && numeric.includes(c)));
      const counts = r => { for (const k in r) { const v = r[k]; if (typeof v === 'string' && v.length > 6 && core.BARIS_RE.test(v)) { const d = core.decodeBaris(v); return !d || d.tipe === 'A'; } } return true; };
      if (report.totRow && all.length && sumCols.length) { const t = { __tot: true }; for (const c of cols) t[c] = null;
        if (gbv.length && all.some(r => core.jasperTipe(r))) { const groups = new Map(); for (const r of all) { const k = gbv.map(g => String(r[g] ?? '')).join('\u0001'); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); } for (const c of sumCols) t[c] = 0; for (const list of groups.values()) { const x = core.totalOf(list, sumCols); for (const c of sumCols) t[c] += x[c]; } }
        else Object.assign(t, core.totalOf(all, sumCols));
        const first = cols.find(c => !sumCols.includes(c)); if (first) t[first] = 'Total'; all.push(t); }
      const outRows = gbv.length ? core.groupRows(all, gbv, cols, sumCols, { subtotal: report.groupSub !== false, labels, counts }) : all;
      const ex2 = startExport({ kind: 'table', grouped: gbv.length > 0, title: companyName, sub: report.title, period, cols, labels, numeric, widths: {}, ttypes, fileName });
      let i = 0; for (const r of outRows) { writeRow(ex2, r); if (++i % 5000 === 0) await sleep(0); }
      return ex2;
    }
    const tot = report.totRow ? { sums: null } : null;
    const addTot = r => { if (!tot) return; if (!tot.sums) { const keys = cfg ? cfg.map(c => c.key) : Object.keys(r); tot.keys = keys; tot.sumKeys = keys.filter(k => r[k] != null && r[k] !== '' && !isNaN(String(r[k]).replace(/,/g, '')) && !/(^|_)(id|kode|code|no|nomor|number|nik|npwp|tanggal|date|periode|bulan|tahun)($|_)/i.test(k)); tot.sums = Object.fromEntries(tot.sumKeys.map(k => [k, 0])); } for (const k of tot.sumKeys) tot.sums[k] += core.num(r[k]); };
    for (const p of jobs) { job.stage = `Mengambil data bagian ${job.done + 1}/${job.total}…`; await fetchAll(report.cq, p, r => { addTot(r); buf.push(r); if (buf.length >= 5000) flush(); }, true); job.done++; }
    if (tot && tot.sums) { const t = {}; for (const k of tot.keys) t[k] = null; Object.assign(t, tot.sums); const first = tot.keys.find(k => !tot.sumKeys.includes(k)); if (first) t[first] = 'Total'; buf.push(t); }
    if (buf.length || !ex) flush();
    return ex;
  }
  if (mode === 'crosstab') {
    const cfg = report.crosstab; const pv = new core.Pivot(cfg);
    const e2 = await plan(report.cq); if (monthly) job.expect = e2; job.total = jobs.length; await probeSelect(report.cq, jobs[0] || {});
    for (const p of jobs) { job.stage = `Mengambil data bagian ${job.done + 1}/${job.total}…`; await fetchAll(report.cq, p, r => pv.add(r), true); job.done++; }
    job.stage = 'Merangkum crosstab & menulis Excel…';
    const res = pv.finish(); const L = core.crosstabLayout(res, cfg);
    if (!res.encoded) { const lab = k => (report.cols || []).find(c => c.key === k)?.label || k.replace(/_/g, ' ').toUpperCase(); cfg.rows.forEach(k => L.labels[k] = lab(k)); }
    const ex = startExport({ kind: 'table', title: companyName, sub: report.title, period, cols: L.cols, labels: L.labels, numeric: [...L.numeric], widths: {}, ttypes, fileName });
    let i = 0; for (const r of res) { writeRow(ex, core.crosstabExportRow(r, res, cfg)); if (++i % 5000 === 0) await sleep(0); }
    return ex;
  }
  throw new Error('Mode laporan ini belum mendukung ekspor langsung');
}
app.post('/export/job', (req, res) => {
  if (!requireLogin(req, res)) return;
  const b = req.body || {}; if (!b.report || !b.filters) return res.status(400).json({ error: 'Permintaan tidak lengkap' });
  const id = crypto.randomBytes(8).toString('hex');
  const job = { id, got: 0, expect: 0, done: 0, total: 0, stage: 'Memulai…', url: null, error: null, at: Date.now() };
  JOBS.set(id, job);
  (async () => {
    try { const ex = await runJob(job, b); ex.ws.commit(); await ex.wb.commit(); ex.done = true; job.url = `/export/${ex.id}/download`; job.stage = 'Selesai'; }
    catch (e) { job.error = e.message; }
    job.at = Date.now();
  })();
  res.json({ id });
});
app.get('/export/job/:id', (req, res) => { const j = JOBS.get(req.params.id); if (!j) return res.status(404).json({ error: 'Job tidak ada' }); res.json(j); });
setInterval(() => { for (const [id, j] of JOBS) if (Date.now() - j.at > 60 * 60 * 1000 && (j.url || j.error)) JOBS.delete(id); }, 60 * 1000).unref();

if (IS_VERCEL) { module.exports = app; module.exports.app = app; return; }   // Vercel memanggil app sebagai handler (api/index.js)
const srv = app.listen(PORT, () => {
  console.log(`Zahir Insight v${APP_VERSION} berjalan di http://localhost:${PORT}  (desain laporan: ${REPORT_SCOPE === 'company' ? 'per perusahaan' : 'global'}, data: ${DATA_DIR})`);
  if (IS_PKG && process.env.OPEN_BROWSER !== '0') openBrowser();
});
const openBrowser = () => { if (process.platform === 'win32') { try { require('child_process').exec(`start "" "http://localhost:${PORT}"`); } catch {} } };
srv.on('error', async e => {
  if (e.code === 'EADDRINUSE' && IS_PKG) {
    // sudah ada Zahir Insight yang berjalan di port ini -> cukup buka browser, lalu keluar diam-diam
    try { const r = await fetch(`http://127.0.0.1:${PORT}/version`); const j = await r.json(); if (j && j.version) { openBrowser(); process.exit(0); } } catch {}
  }
  if (e.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} masih dipakai proses lain — kemungkinan server Zahir Insight versi lama masih berjalan.`);
    console.error('Hentikan dulu proses itu, lalu jalankan ulang:');
    console.error(process.platform === 'win32'
      ? `  Windows : netstat -ano | findstr :${PORT}   ->  taskkill /PID <pid> /F`
      : `  Linux/mac: lsof -i :${PORT}   ->  kill <pid>`);
    console.error(`Atau jalankan di port lain: PORT=3301 node server.js\n`);
  } else console.error('Server gagal dijalankan:', e.message);
  if (module.parent) { module.exports.error = e; return; }
  process.exit(1);
});
module.exports = { app, srv, PORT, APP_VERSION };
