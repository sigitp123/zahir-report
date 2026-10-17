/* Zahir Insight — inti penyusunan laporan.
   Dipakai bersama oleh browser (preview) dan server (ekspor langsung), jadi hasilnya selalu sama.
   Semua fungsi murni: tidak menyentuh DOM / jaringan. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const num = v => Number(String(v ?? '').replace(/,/g, '')) || 0;
  // format 1,234.50 (sama dengan toLocaleString en-US, tapi ±10x lebih cepat untuk ratusan ribu baris)
  const fmt = n => { if (!(Math.abs(n) >= 0.005)) return '0'; const s = Math.abs(n).toFixed(2); const dot = s.length - 3; let i = s.slice(0, dot), out = ''; while (i.length > 3) { out = ',' + i.slice(-3) + out; i = i.slice(0, -3); } return (n < 0 ? '-' : '') + i + out + s.slice(dot); };
  const appendAll = (dst, src) => { for (let i = 0; i < src.length; i++) dst.push(src[i]); return dst; };
  function monthChunks(d1, d2) {
    const out = []; let a = new Date(d1 + 'T00:00:00'); const end = new Date(d2 + 'T00:00:00');
    while (a <= end) { const b = new Date(a.getFullYear(), a.getMonth() + 1, 0); out.push([ymd(a), ymd(b < end ? b : end)]); a = new Date(a.getFullYear(), a.getMonth() + 1, 1); }
    return out;
  }
  function yearChunks(d1, d2) {
    const out = []; let y = +d1.slice(0, 4); const y2 = +d2.slice(0, 4);
    for (; y <= y2; y++) { const a = y === +d1.slice(0, 4) ? d1 : `${y}-01-01`, b = y === y2 ? d2 : `${y}-12-31`; out.push([a, b]); }
    return out;
  }
  // Rencana potongan tanggal: hitung per tahun; tahun kosong dilewati, tahun ≤ perPage ditarik sekali, tahun besar dipecah per bulan.
  // count(a,b) → jumlah baris pada rentang itu (satu permintaan ringan). Mengembalikan {chunks:[[a,b],...], expect}
  async function planChunks(d1, d2, count, perPage) {
    const chunks = []; let expect = 0;
    for (const [a, b] of yearChunks(d1, d2)) {
      const c = await count(a, b); expect += c; if (!c) continue;
      if (c <= perPage) chunks.push([a, b]); else for (const m of monthChunks(a, b)) chunks.push(m);
    }
    return { chunks, expect };
  }
  const prevDay = d1 => { const p = new Date(d1 + 'T00:00:00'); p.setDate(p.getDate() - 1); return ymd(p); };

  /* ---------- buku besar ---------- */
  const KREDIT_SIDE = new Set(['2', '3', '4', '8']);
  const LABELS = { tanggal: 'TANGGAL', tipe: 'TIPE', referensi: 'REFERENSI', kontak: 'KONTAK', deskripsi: 'DESKRIPSI', dept: 'DEPT', proyek: 'PROYEK', faktur_pajak: 'NO FAKTUR PAJAK', no_invoice: 'NO INVOICE', debit: 'DEBIT', kredit: 'KREDIT', saldo: 'SALDO',
    kurs: 'KURS', debit_usd: 'DEBIT (USD)', kredit_usd: 'KREDIT (USD)', saldo_usd: 'SALDO (USD)' };
  // kolom buku besar biasa (IDR)
  const COLS = ['tanggal', 'tipe', 'referensi', 'kontak', 'deskripsi', 'dept', 'proyek', 'faktur_pajak', 'no_invoice', 'debit', 'kredit', 'saldo'];
  // buku besar valas: nilai asli transaksi (jurnalvc.debit_a / kredit_a) + kurs, diletakkan sebelum kolom IDR
  const VALAS_COLS = ['kurs', 'debit_usd', 'kredit_usd', 'saldo_usd'];
  // ID mata uang USD (currency_id transaksi). Transaksi bermata uang ini TIDAK menampilkan blok nilai asli (KURS, DEBIT/KREDIT/SALDO bertanda USD) —
  // sama dengan aturan di JRXML General Ledger Advance. Bisa diganti: env USD_CURRENCY_ID (server) → dikirim ke browser lewat /version.
  const DEFAULT_USD_CURRENCY_ID = 'fdbc942a-81dc-42f3-8f77-0774358dc084';
  const ledgerColsOf = valas => valas ? [...COLS.slice(0, 9), ...VALAS_COLS, ...COLS.slice(9)] : COLS.slice();
  const LEDGER_NUM = ['debit', 'kredit', 'saldo', ...VALAS_COLS];
  // judul kelompok header 2 tingkat (kolom tanpa kelompok memakai rowspan)
  const LEDGER_GROUP = { debit_usd: 'NILAI USD', kredit_usd: 'NILAI USD', saldo_usd: 'NILAI USD', debit: 'NILAI IDR', kredit: 'NILAI IDR', saldo: 'NILAI IDR' };
  function rowKind(r) {
    if (r.tanggal == null && r.kode_akun && r.tipe === r.kode_akun) return 'title';
    if (r.tanggal === 'TANGGAL') return 'head';
    if (r.proyek === 'Total :' || r.proyek === 'Mutasi :') return 'tot';
    if (r.tipe === 'Saldo Awal' && r.tanggal) return 'sa';
    if (r.tanggal == null && r.tipe == null && r.referensi == null) return 'blank';
    return 'trx';
  }
  // Susun buku besar dari transaksi mentah (bb_trx) + saldo awal (bb_saldo_awal).
  // Baris ditambahkan satu per satu begitu tiba dari server, jadi tidak ada salinan data mentah yang menumpuk.
  class LedgerBuilder {
    constructor() { this.acc = new Map(); this.n = 0; this.valas = false; }
    _get(r) { let g = this.acc.get(r.kode_akun); if (!g) { g = { kode: r.kode_akun, nama: r.nama_akun, kls: String(r.noklasifikasi ?? ''), sa: 0, saA: 0, trx: [] }; this.acc.set(r.kode_akun, g); } if (!this.valas && ('debit_a' in r || 'kredit_a' in r)) this.valas = true; return g; }
    _sgn(g, d, k) { return KREDIT_SIDE.has(g.kls) ? (num(k) - num(d)) : (num(d) - num(k)); }
    // saldo awal dari dua potongan yang TIDAK tumpang tindih: sebelum tahun berjalan (ytd=false) + sejak 1 Januari s/d sehari sebelum periode (ytd=true).
    // Akun neraca (klasifikasi < 4) = jumlah keduanya; akun laba-rugi (>= 4) hanya potongan tahun berjalan. Dijumlahkan (bukan ditimpa) agar beberapa kombinasi filter ikut terakumulasi.
    addSa(r, ytd) { const g = this._get(r); const pl = parseInt(g.kls, 10) >= 4; if (pl && !ytd) return; g.sa += this._sgn(g, r.debit, r.kredit); g.saA += this._sgn(g, r.debit_a, r.kredit_a); }
    // Potongan permintaan saldo awal untuk periode mulai d1: [{p:{date...}, ytd}] — potongan tahun berjalan dilewati bila d1 = 1 Januari
    static saChunks(d1, base) {
      const prev = prevDay(d1), y = d1.slice(0, 4), jan1 = `${y}-01-01`, out = [{ p: { ...base, 'date.$lte': `${+y - 1}-12-31` }, ytd: false }];
      if (prev >= jan1) out.push({ p: { ...base, 'date.$gte': jan1, 'date.$lte': prev }, ytd: true });
      return out;
    }
    addTrx(r) { this._get(r).trx.push(r); this.n++; }
    // Hasil per akun dipanggil lewat emit(row) agar bisa langsung ditulis (Excel) atau ditampung (preview)
    build(d1, emit) { const out = emit ? null : []; const push = emit || (r => out.push(r)); for (const r of this.gen(d1)) push(r); return out; }
    // generator: baris dihasilkan satu per satu (server bisa menyela untuk melayani permintaan lain)
    *gen(d1) {
      const prevStr = prevDay(d1); const V = this.valas; const usdId = String(LedgerBuilder.usdCurrencyId || '').toLowerCase();
      const keys = ledgerColsOf(V); const empty = { kode_akun: null, nama_akun: null }; for (const c of keys) empty[c] = null;
      const head = Object.fromEntries(keys.map(c => [c, LABELS[c]]));
      const base = (g, extra) => Object.assign({}, empty, { kode_akun: g.kode, nama_akun: g.nama }, extra);
      // kurs = nilai besar / nilai kecil pada baris yang sama (Rupiah per USD), berlaku baik mata uang dasar IDR maupun USD;
      // kosong bila salah satunya 0 (mis. jurnal revaluasi) atau keduanya sama (akun dalam mata uang dasar)
      const kurs = (d, k, da, ka) => { const x = Math.abs(d) + Math.abs(k), y = Math.abs(da) + Math.abs(ka); if (x < 0.005 || y < 0.005 || Math.abs(x - y) < 0.005) return null; return fmt(Math.max(x, y) / Math.min(x, y)); };
      for (const k of [...this.acc.keys()].sort()) {
        const g = this.acc.get(k); if (!g.trx.length && Math.abs(g.sa) < 0.005 && Math.abs(g.saA) < 0.005) { this.acc.delete(k); continue; }
        const cmp = (x, y) => { x = String(x ?? ''); y = String(y ?? ''); return x < y ? -1 : x > y ? 1 : 0; };
        g.trx.sort((a, b) => cmp(a.tanggal, b.tanggal) || cmp(a.referensi, b.referensi) || cmp(a.jurnal_id, b.jurnal_id));
        yield (base(g, { tipe: g.kode, referensi: g.nama }));
        yield (base(g, head));
        yield (base(g, Object.assign({ tanggal: prevStr, tipe: 'Saldo Awal', debit: '0', kredit: '0', saldo: fmt(g.sa) }, V ? { debit_usd: '0', kredit_usd: '0', saldo_usd: fmt(g.saA) } : {})));
        let run = g.sa, totD = 0, totK = 0, runA = g.saA, totDA = 0, totKA = 0;
        for (const r of g.trx) {
          const d = num(r.debit), kk = num(r.kredit); totD += d; totK += kk; run += this._sgn(g, d, kk);
          const row = { tanggal: String(r.tanggal).slice(0, 10), tipe: r.tipe, referensi: r.referensi, kontak: r.kontak, deskripsi: r.deskripsi, dept: r.dept, proyek: r.proyek, faktur_pajak: r.faktur_pajak, no_invoice: r.no_invoice, debit: fmt(d), kredit: fmt(kk), saldo: fmt(run) };
          if (V) {
            const da = num(r.debit_a), ka = num(r.kredit_a); totDA += da; totKA += ka; runA += this._sgn(g, da, ka);
            // transaksi bermata uang USD: kolom nilai asli dikosongkan; saldo berjalan tetap dihitung agar baris berikutnya benar
            if (usdId && String(r.mata_uang_id ?? '').toLowerCase() === usdId) { row.kurs = null; row.debit_usd = null; row.kredit_usd = null; row.saldo_usd = null; }
            else { row.kurs = kurs(d, kk, da, ka); row.debit_usd = fmt(da); row.kredit_usd = fmt(ka); row.saldo_usd = fmt(runA); }
          }
          yield (base(g, row));
        }
        // baris total: saldo awal & akhir IDR di kolom deskripsi (seperti biasa); buku besar valas juga mengisi kolom SALDO di baris Saldo Akhir
        yield (base(g, Object.assign({ tipe: 'Saldo Awal', deskripsi: fmt(g.sa), proyek: 'Total :', debit: fmt(totD), kredit: fmt(totK) }, V ? { debit_usd: fmt(totDA), kredit_usd: fmt(totKA) } : {})));
        yield (base(g, Object.assign({ tipe: 'Saldo Akhir', deskripsi: fmt(run), proyek: 'Mutasi :', debit: fmt(run - g.sa) }, V ? { debit_usd: fmt(runA - g.saA), saldo_usd: fmt(runA), saldo: fmt(run) } : {})));
        yield (base(g, {}));
        g.trx = null; this.acc.delete(k);   // lepaskan data mentah akun ini
      }
      }

  }
  LedgerBuilder.usdCurrencyId = DEFAULT_USD_CURRENCY_ID;   // bisa ditimpa server/browser (lihat /version)
  /* ---------- trial balance (neraca saldo) dua mata uang ----------
     Sumber: custom query akumulasi per akun (bb_saldo_awal_valas): debit/kredit = mata uang dasar, debit_a/kredit_a = mata uang akun.
     Saldo awal: akun neraca (klasifikasi < 4) sejak awal; akun laba-rugi (>= 4) sejak 1 Januari tahun periode.
     Laba-rugi tahun-tahun sebelumnya yang belum ditutup dikumpulkan ke satu baris tersendiri agar total debit = kredit. */
  const TB_PARTS = ['bd', 'bk', 'md', 'mk', 'net', 'ed', 'ek'];
  const TB_SUB = { bd: 'DEBIT', bk: 'KREDIT', md: 'DEBIT', mk: 'KREDIT', net: 'NET MUTATION', ed: 'DEBIT', ek: 'KREDIT' };
  const TB_SEC = { bd: 'B', bk: 'B', md: 'M', mk: 'M', net: 'N', ed: 'E', ek: 'E' };
  const TB_SECNAME = { B: 'Beginning Balance', M: 'Mutation', E: 'Ending Balance' };
  // semua kolom trial balance (untuk desainer): a = mata uang akun (debit_a/kredit_a), b = mata uang dasar (debit/kredit)
  function tbFields(o) {
    o = o || {}; const cur = { a: o.curA || 'IDR', b: o.curB || 'USD' }; const sec = { B: o.secB || TB_SECNAME.B, M: o.secM || TB_SECNAME.M, E: o.secE || TB_SECNAME.E, N: '' };
    return [{ key: 'kode_akun', label: 'Account Code', desc: 'Kode akun' }, { key: 'nama_akun', label: 'DESKRIPSI', desc: 'Nama akun' },
      ...['a', 'b'].flatMap(p => TB_PARTS.map(k => ({ key: p + '_' + k, label: TB_SUB[k], desc: `${cur[p]} · ${k === 'net' ? 'Net mutation' : sec[TB_SEC[k]] + ' · ' + TB_SUB[k].toLowerCase()}` })))];
  }
  // tata letak: kolom tampil (cfg = desain [{key,label,show}], urutan tetap), label, desimal, header 3 tingkat
  function tbLayout(o, cfg) {
    o = o || {}; const curA = o.curA || 'IDR', curB = o.curB || 'USD';
    const all = tbFields(o); const m = new Map((cfg || []).map(c => [c.key, c]));
    const show = all.filter(f => !m.has(f.key) || m.get(f.key).show !== false).map(f => f.key);
    const labels = Object.fromEntries(all.map(f => [f.key, (m.get(f.key) && m.get(f.key).label) || f.label]));
    const dec = {}; for (const f of all) if (/^[ab]_/.test(f.key)) dec[f.key] = f.key[0] === 'a' ? (o.decA ?? 0) : (o.decB ?? 2);
    const sec = { B: o.secB || TB_SECNAME.B, M: o.secM || TB_SECNAME.M, E: o.secE || TB_SECNAME.E };
    const vis = new Set(show); const h0 = [], h1 = [], h2 = [];
    for (const k of ['kode_akun', 'nama_akun']) if (vis.has(k)) h0.push({ label: labels[k], rowspan: 3, key: k });
    for (const [p, cur] of [['a', curA], ['b', curB]]) {
      const ks = TB_PARTS.map(k => p + '_' + k).filter(k => vis.has(k)); if (!ks.length) continue;
      h0.push({ label: cur, colspan: ks.length });
      for (const S of ['B', 'M', 'N', 'E']) {
        const sk = ks.filter(k => TB_SEC[k.slice(2)] === S); if (!sk.length) continue;
        if (S === 'N') h1.push({ label: labels[sk[0]], rowspan: 2, key: sk[0] });
        else { h1.push({ label: sec[S], colspan: sk.length }); for (const k of sk) h2.push({ label: labels[k], key: k }); }
      }
    }
    const heads = [h0, h1, h2].filter(r => r.length);
    // urutan kolom = urutan header (kode, nama, A…, B…)
    const cols = [...['kode_akun', 'nama_akun'].filter(k => vis.has(k)), ...['a', 'b'].flatMap(p => ['bd', 'bk', 'md', 'mk', 'net', 'ed', 'ek'].map(k => p + '_' + k).filter(k => vis.has(k)))];
    // kolom NET berada di tengah (rowspan) sedangkan baris ke-3 hanya memuat debit/kredit — urutan cols sudah sama dengan urutan sel header
    return { cols, labels, dec, heads, numeric: cols.filter(c => /^[ab]_/.test(c)), allNumeric: all.filter(f => /^[ab]_/.test(f.key)).map(f => f.key) };
  }

  /* ---------- jurnal per transaksi (Jurnal - All Transaction) ----------
     Sumber: custom query jurnal_all_trx (satu baris per baris jurnal). Per transaksi: baris kepala (tipe, nomor, tanggal,
     kontak, deskripsi, dept, proyek), baris akun, lalu baris "Balance" (jumlah debit/kredit kedua mata uang). */
  const JR_FIELDS = [['tipe', 'Type'], ['nomor', '#Transaction'], ['tanggal', 'Date'], ['kontak', 'Business Partner'], ['deskripsi', 'Description'],
    ['akun', 'Account'], ['kode_akun', 'Account code'], ['dept', 'DEPT'], ['b_debit', 'DEBIT'], ['b_kredit', 'KREDIT'], ['a_debit', 'DEBIT'], ['a_kredit', 'KREDIT'], ['proyek', 'KODE PROJEK']];
  function jrFields(o) {
    o = o || {}; const cur = { a: o.curA || 'IDR', b: o.curB || 'USD' };
    const desc = { tipe: 'Jenis transaksi', nomor: 'Nomor transaksi', tanggal: 'Tanggal', kontak: 'Kontak', deskripsi: 'Keterangan transaksi', akun: 'Nama akun (baris akun) / "Balance"', kode_akun: 'Kode akun', dept: 'Kepala: nama dept · baris: kode dept', proyek: 'Kode proyek (baris kepala)' };
    return JR_FIELDS.map(([k, l]) => ({ key: k, label: l, desc: /^[ab]_/.test(k) ? `${cur[k[0]]} · ${k.endsWith('debit') ? 'debit' : 'kredit'}` : desc[k] }));
  }
  // header 2 tingkat dari kolom tampil: kolom angka bertetangga dengan mata uang sama digabung di bawah judul mata uang
  function jrLayout(o, cfg) {
    o = o || {}; const cur = { a: o.curA || 'IDR', b: o.curB || 'USD' };
    const all = jrFields(o); const m = new Map((cfg || []).map(c => [c.key, c]));
    const order = cfg && cfg.length ? [...cfg.map(c => c.key).filter(k => all.some(f => f.key === k)), ...all.map(f => f.key).filter(k => !m.has(k))] : all.map(f => f.key);
    const cols = order.filter(k => !m.has(k) || m.get(k).show !== false);
    const labels = Object.fromEntries(all.map(f => [f.key, (m.get(f.key) && m.get(f.key).label) || f.label]));
    const dec = {}; for (const c of cols) if (/^[ab]_/.test(c)) dec[c] = c[0] === 'a' ? (o.decA ?? 0) : (o.decB ?? 2);
    const grp = c => /^[ab]_/.test(c) ? c[0] : null; const h0 = [], h1 = [];
    for (let i = 0; i < cols.length;) { const g = grp(cols[i]);
      if (!g) { h0.push({ label: labels[cols[i]], rowspan: 2, key: cols[i] }); i++; continue; }
      let j = i; while (j < cols.length && grp(cols[j]) === g) { h1.push({ label: labels[cols[j]], key: cols[j] }); j++; }
      h0.push({ label: cur[g], colspan: j - i }); i = j; }
    return { cols, labels, dec, heads: h1.length ? [h0, h1] : [h0.map(h => ({ ...h, rowspan: 1 }))], numeric: cols.filter(c => /^[ab]_/.test(c)) };
  }
  const typeName = t => String(t ?? '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  class JournalBuilder {
    constructor() { this.trx = new Map(); this.n = 0; }
    add(r) { const k = r.trx_id != null ? String(r.trx_id) : `${r.tipe}|${r.nomor}|${String(r.tanggal).slice(0, 10)}`;
      let t = this.trx.get(k); if (!t) { t = { h: r, lines: [] }; this.trx.set(k, t); } t.lines.push(r); this.n++; }
    *gen(ttypes) {
      const cmp = (x, y) => { x = String(x ?? ''); y = String(y ?? ''); return x < y ? -1 : x > y ? 1 : 0; };
      const list = [...this.trx.values()].sort((a, b) => cmp(String(a.h.tanggal).slice(0, 10), String(b.h.tanggal).slice(0, 10)) || smartSort(a.h.nomor ?? '', b.h.nomor ?? '') || cmp(a.h.trx_id, b.h.trx_id));
      for (const t of list) {
        const h = t.h; t.lines.sort((a, b) => (Number(a.jurnal_id) || 0) - (Number(b.jurnal_id) || 0));
        yield { __k: 'jh', tipe: (ttypes && ttypes[h.tipe]) || typeName(h.tipe), nomor: h.nomor, tanggal: String(h.tanggal ?? '').slice(0, 10), kontak: h.kontak, deskripsi: h.deskripsi, dept: h.dept_nama || '', proyek: h.proyek_kode || '' };
        const s = { bd: 0, bk: 0, ad: 0, ak: 0 };
        for (const l of t.lines) { const bd = num(l.debit), bk = num(l.kredit), ad = num(l.debit_a), ak = num(l.kredit_a); s.bd += bd; s.bk += bk; s.ad += ad; s.ak += ak;
          yield { __k: 'jd', akun: l.nama_akun, kode_akun: l.kode_akun, dept: l.dept_kode || '', b_debit: bd, b_kredit: bk, a_debit: ad, a_kredit: ak }; }
        yield { __k: 'jb', akun: 'Balance', b_debit: s.bd, b_kredit: s.bk, a_debit: s.ad, a_kredit: s.ak };
        t.lines = null;
      }
      this.trx.clear();
    }
    build(ttypes) { const out = []; for (const r of this.gen(ttypes)) out.push(r); return out; }
  }
  class TrialBalance {
    // Seperti trial balance Zahir: akun laba-rugi (klasifikasi >= 4) mulai periode dengan saldo awal 0;
    // akumulasinya sebelum periode dipindah ke akun Laba Berjalan (tahun berjalan) dan Laba Ditahan (tahun-tahun sebelumnya).
    constructor() { this.acc = new Map(); this.re = { a: 0, b: 0 }; this.cy = { a: 0, b: 0 }; }
    _get(r) { let g = this.acc.get(r.kode_akun); if (!g) { g = { kode: r.kode_akun, nama: r.nama_akun, kls: String(r.noklasifikasi ?? ''), sa: { a: 0, b: 0 }, md: { a: 0, b: 0 }, mk: { a: 0, b: 0 } }; this.acc.set(r.kode_akun, g); } return g; }
    // r = baris akumulasi saldo awal; ytd sama artinya dengan LedgerBuilder.saChunks
    addSa(r, ytd) {
      const nb = num(r.debit) - num(r.kredit), na = num(r.debit_a) - num(r.kredit_a);
      const pl = parseInt(String(r.noklasifikasi ?? ''), 10) >= 4;
      if (pl) { const t = ytd ? this.cy : this.re; t.b += nb; t.a += na; this._get(r); return; }   // akun L/R tetap terdaftar (bisa punya mutasi)
      const g = this._get(r); g.sa.b += nb; g.sa.a += na;
    }
    addMut(r) { const g = this._get(r); g.md.b += num(r.debit); g.mk.b += num(r.kredit); g.md.a += num(r.debit_a); g.mk.a += num(r.kredit_a); }
    // net mutation mengikuti sisi normal akun (kewajiban/modal/pendapatan: kredit − debit), sama dengan Zahir
    static row(g, code) {
      const o = { kode_akun: code || g.kode, nama_akun: g.nama }; const r2 = v => Math.round(v * 100) / 100 || 0; const pos = v => v > 0.004 ? r2(v) : 0, neg = v => v < -0.004 ? r2(-v) : 0;
      const ks = KREDIT_SIDE.has(g.kls);
      for (const p of ['a', 'b']) { const dk = g.md[p] - g.mk[p], end = g.sa[p] + dk;
        o[p + '_bd'] = pos(g.sa[p]); o[p + '_bk'] = neg(g.sa[p]); o[p + '_md'] = r2(g.md[p]); o[p + '_mk'] = r2(g.mk[p]); o[p + '_net'] = r2(ks ? -dk : dk); o[p + '_ed'] = pos(end); o[p + '_ek'] = neg(end); }
      return o;
    }
    // opt: { cy:{kode,nama}, re:{kode,nama} akun Laba Berjalan / Laba Ditahan bila ditemukan di daftar akun;
    //        code(kodeMentah) → kode tampilan (mis. 111300002 → 1113-00-002) }
    rows(opt) {
      opt = opt || {}; const z = v => Math.abs(v) < 0.005;
      const put = (t, acc, nama) => { if (z(t.a) && z(t.b)) return;
        const nz = c => String(c ?? '').replace(/[^0-9a-z]/gi, '').toLowerCase();
        // akun yang sudah ada di hasil query dengan kode sama (tanpa tanda baca) dipakai; tanpa akun: baris tersendiri di akhir
        const kode = acc && acc.kode ? ([...this.acc.keys()].find(k => nz(k) === nz(acc.kode)) || acc.kode) : '\uffff' + nama;
        const g = this._get({ kode_akun: kode, nama_akun: (acc && acc.nama) || nama, noklasifikasi: '3' }); g.sa.a += t.a; g.sa.b += t.b; };
      put(this.re, opt.re, 'Laba Ditahan (laba-rugi tahun-tahun sebelumnya)');
      put(this.cy, opt.cy, 'Laba Berjalan');
      const out = []; const tot = {}; for (const c of tbLayout().allNumeric) tot[c] = 0;
      for (const k of [...this.acc.keys()].sort(smartSort)) {
        const g = this.acc.get(k); if (['a', 'b'].every(p => z(g.sa[p]) && z(g.md[p]) && z(g.mk[p]))) continue;
        const kode = k.startsWith('\uffff') ? '' : (opt.code ? opt.code(g.kode) : g.kode);
        const r = TrialBalance.row(g, kode); out.push(r);
        // total dari nilai belum dibulatkan (seperti Zahir); hanya mata uang dasar (b_) — kolom a_ berisi campuran IDR & USD
        const ks = KREDIT_SIDE.has(g.kls), dk = g.md.b - g.mk.b, end = g.sa.b + dk;
        tot.b_bd += Math.max(g.sa.b, 0); tot.b_bk += Math.max(-g.sa.b, 0); tot.b_md += g.md.b; tot.b_mk += g.mk.b; tot.b_net += ks ? -dk : dk; tot.b_ed += Math.max(end, 0); tot.b_ek += Math.max(-end, 0);
      }
      if (out.length) { const t = { kode_akun: '', nama_akun: 'TOTAL', __tot: true }; for (const c of tbLayout().allNumeric) if (c.startsWith('b_')) t[c] = Math.round(tot[c] * 100) / 100 || 0; out.push(t); }
      return out;
    }
  }
  // cari akun Laba Berjalan / Laba Ditahan di daftar akun (dari API) + peta kode mentah → kode berformat
  function tbAccountOpts(accounts) {
    const norm = c => String(c ?? '').replace(/[^0-9a-z]/gi, '').toLowerCase();
    const list = (accounts || []).filter(a => a && a.code != null);
    const find = re => { const a = list.find(x => re.test(String(x.name || ''))); return a ? { kode: norm(a.code), nama: a.name, code: a.code } : null; };
    const cy = find(/laba\s*(tahun\s*)?berjalan|current\s*(year\s*)?earning/i), re = find(/laba\s*ditahan|retained\s*earning/i);
    const map = {}; for (const a of list) map[norm(a.code)] = String(a.code);
    return { cy, re, codes: map };
  }
  // opsi rows() dari hasil tbAccountOpts; kode akun dari query dicocokkan tanpa tanda baca
  function tbRowOpts(o) {
    o = o || {}; const norm = c => String(c ?? '').replace(/[^0-9a-z]/gi, '').toLowerCase(); const codes = o.codes || {};
    // kunci akun = kode mentah dari query; akun L/B dan L/D dicari dengan kode mentah yang sama (tanpa tanda baca)
    return { cy: o.cy ? { kode: o.cy.kode, nama: o.cy.nama } : null, re: o.re ? { kode: o.re.kode, nama: o.re.nama } : null, code: k => codes[norm(k)] || k, norm };
  }
  // Mode lama (custom query buku besar yang sudah jadi, mis. buku_besar_faktur_invoice): baris datang per potongan tanggal,
  // dikelompokkan per akun begitu tiba, lalu digabung menjadi satu buku besar utuh
  class LegacyMerger {
    constructor() { this.acc = new Map(); this.n = 0; }
    add(r) {
      const k = r.kode_akun; let g = this.acc.get(k); if (!g) { g = { title: null, head: null, sa: null, trx: [] }; this.acc.set(k, g); }
      const kind = rowKind(r);
      if (kind === 'title' && !g.title) g.title = r; else if (kind === 'head' && !g.head) g.head = r;
      else if (kind === 'sa' && !g.sa) g.sa = r;
      else if (kind === 'trx') { g.trx.push(r); this.n++; }
    }
    *gen(d1) {
      for (const k of [...this.acc.keys()].sort()) {
        const g = this.acc.get(k); if (!g.title) { this.acc.delete(k); continue; }
        const blank = Object.fromEntries(Object.keys(g.title).map(c => [c, null])); blank.kode_akun = g.title.kode_akun; blank.nama_akun = g.title.nama_akun;
        const sa = num(g.sa && g.sa.saldo); let totD = 0, totK = 0; for (const r of g.trx) { totD += num(r.debit); totK += num(r.kredit); }
        const akhir = g.trx.length ? num(g.trx[g.trx.length - 1].saldo) : sa;
        yield g.title; if (g.head) yield g.head; if (g.sa) yield Object.assign({}, g.sa, { tanggal: prevDay(d1) });
        for (const r of g.trx) yield r;
        yield Object.assign({}, blank, { tipe: 'Saldo Awal', deskripsi: fmt(sa), proyek: 'Total :', debit: fmt(totD), kredit: fmt(totK) });
        yield Object.assign({}, blank, { tipe: 'Saldo Akhir', deskripsi: fmt(akhir), proyek: 'Mutasi :', debit: fmt(akhir - sa) });
        yield Object.assign({}, blank);
        g.trx = null; this.acc.delete(k);
      }
    }
    build(d1) { const out = []; for (const r of this.gen(d1)) out.push(r); return out; }
  }
  function mergeChunks(chunks, d1) {
    const acc = new Map();
    for (const rows of chunks) for (const r of rows) {
      const k = r.kode_akun; let g = acc.get(k); if (!g) { g = { title: null, head: null, sa: null, trx: [] }; acc.set(k, g); }
      const kind = rowKind(r);
      if (kind === 'title' && !g.title) g.title = r; else if (kind === 'head' && !g.head) g.head = r;
      else if (kind === 'sa' && !g.sa) g.sa = Object.assign({}, r, { tanggal: prevDay(d1) });
      else if (kind === 'trx') g.trx.push(r);
    }
    const out = [];
    for (const k of [...acc.keys()].sort()) {
      const g = acc.get(k); if (!g.title) continue;
      const blank = Object.fromEntries(Object.keys(g.title).map(c => [c, null])); blank.kode_akun = g.title.kode_akun; blank.nama_akun = g.title.nama_akun;
      const sa = num(g.sa && g.sa.saldo), totD = g.trx.reduce((a, r) => a + num(r.debit), 0), totK = g.trx.reduce((a, r) => a + num(r.kredit), 0);
      const akhir = g.trx.length ? num(g.trx[g.trx.length - 1].saldo) : sa;
      out.push(g.title); if (g.head) out.push(g.head); if (g.sa) out.push(g.sa); appendAll(out, g.trx);
      out.push(Object.assign({}, blank, { tipe: 'Saldo Awal', deskripsi: fmt(sa), proyek: 'Total :', debit: fmt(totD), kredit: fmt(totK) }));
      out.push(Object.assign({}, blank, { tipe: 'Saldo Akhir', deskripsi: fmt(akhir), proyek: 'Mutasi :', debit: fmt(akhir - sa) }));
      out.push(Object.assign({}, blank));
    }
    return out;
  }

  /* ---------- ringkasan: potongan bulan dijumlahkan per kelompok ---------- */
  // Kolom kunci = kolom non-angka (nama, kode, kategori); kolom angka dijumlahkan. cols: [{key, sum:true|false|undefined}]
  const looksNumeric = v => v != null && v !== '' && typeof v !== 'boolean' && !isNaN(String(v).replace(/,/g, ''));
  const codeLike = k => /(^|_)(id|kode|code|no|nomor|number|nik|npwp|tanggal|date|periode|bulan|tahun)($|_)/i.test(k);
  class Summarizer {
    constructor(cols) { this.cols = cols || null; this.groups = new Map(); this.n = 0; this.sumKeys = null; this.keyKeys = null; }
    _init(r) {
      const keys = this.cols ? this.cols.map(c => c.key) : Object.keys(r);
      const cfg = new Map((this.cols || []).map(c => [c.key, c]));
      this.sumKeys = keys.filter(k => { const c = cfg.get(k); if (c && c.sum != null) return !!c.sum; return looksNumeric(r[k]) && !codeLike(k); });
      this.keyKeys = keys.filter(k => !this.sumKeys.includes(k));
    }
    add(r) {
      if (!this.sumKeys) this._init(r);
      const key = this.keyKeys.map(k => String(r[k] ?? '')).join('\u0001');
      let g = this.groups.get(key); if (!g) { g = {}; for (const k of this.keyKeys) g[k] = r[k]; for (const k of this.sumKeys) g[k] = 0; this.groups.set(key, g); }
      for (const k of this.sumKeys) g[k] += num(r[k]);
      this.n++;
    }
    rows() { const out = [...this.groups.values()]; this.groups = new Map(); return out; }
  }

  // baris berformat Jasper: tipe baris (H/A/T/G) dari field mana pun; null bila bukan format Jasper
  function jasperTipe(r) { if (r.__dec) return r.__dec.tipe; for (const k in r) { const v = r[k]; if (typeof v === 'string' && v.length > 6 && BARIS_RE.test(v)) { const d = decodeBaris(v); return d ? d.tipe : null; } } return null; }
  // total untuk kumpulan baris berformat Jasper: laporan Jasper (laba rugi/neraca) memuat satu set baris per kombinasi
  // dimensi (departemen × proyek × cost code …), masing-masing diakhiri baris G (Laba (Rugi) Bersih). Total yang benar =
  // jumlah baris G terakhir dari tiap kombinasi — bukan jumlah baris akun (pendapatan & beban sama-sama positif).
  // Kombinasi ditentukan dari semua field baris selain field Jasper, kolom turunan, dan kolom angka yang dijumlahkan.
  function totalOf(rows, sumCols) {
    const t = Object.fromEntries(sumCols.map(c => [c, 0])); let hasJ = false;
    const jField = r => { for (const k in r) { const v = r[k]; if (typeof v === 'string' && v.length > 6 && BARIS_RE.test(v)) return k; } return null; };
    const parts = new Map();   // kombinasi → {lastG, aSum}
    // field dimensi = semua field selain field Jasper, kolom turunan, kolom angka, dan kolom "tipe baris" (nilainya hanya H/A/T/G)
    const sample = rows.filter(r => !r.__tot && !(r.__kind && r.__kind !== 'row')).slice(0, 500); const jf0 = sample.length ? jField(sample[0]) : null;
    const dimKeys = sample.length ? Object.keys(sample[0]).filter(k => k !== jf0 && !k.startsWith('__') && !k.includes('.') && !sumCols.includes(k) && !sample.every(r => r[k] == null || /^[HATG]$/.test(String(r[k])))) : [];
    for (const r of rows) {
      if (r.__tot || (r.__kind && r.__kind !== 'row')) continue;
      const jf = jField(r); const tp = jf ? (decodeBaris(r[jf]) || {}).tipe : null;
      if (!tp) { for (const c of sumCols) t[c] += num(r[c]); continue; }
      hasJ = true;
      const key = dimKeys.map(k => k + '=' + String(r[k] ?? '')).join('|');
      let p = parts.get(key); if (!p) { p = { lastG: null, aSum: Object.fromEntries(sumCols.map(c => [c, 0])) }; parts.set(key, p); }
      if (tp === 'G') p.lastG = r; else if (tp === 'A') for (const c of sumCols) p.aSum[c] += num(r[c]);
    }
    for (const p of parts.values()) for (const c of sumCols) t[c] += p.lastG ? num(p.lastG[c]) : p.aSum[c];
    return t;
  }

  /* ---------- pengelompokan tabel: judul kelompok → header → isi → subtotal, bertingkat ---------- */
  // rows: data; groupBy: [key,...]; cols: kolom tampil; sumCols: kolom yang dijumlahkan; opts {subtotal, labels}
  // keluaran: daris tampilan dengan __kind: 'gtitle' | 'ghead' | 'trx' | 'gtot' | 'blank' | 'tot'
  function groupRows(rows, groupBy, cols, sumCols, opts) {
    opts = opts || {}; const labels = opts.labels || {}; const out = []; const n = groupBy.length;
    const str = v => String(v ?? '');
    const idx = rows.map((r, i) => i).filter(i => !rows[i].__tot);
    idx.sort((a, b) => { for (const k of groupBy) { const x = str(rows[a][k]), y = str(rows[b][k]); if (x !== y) return x.localeCompare(y, 'id', { numeric: true }); } return a - b; });
    const grand = rows.find(r => r.__tot) || null;
    const sums = () => Object.fromEntries(sumCols.map(c => [c, 0]));
    const stack = [];   // per tingkat: {val, sums, rows}
    const close = (level) => { while (stack.length > level) { const g = stack.pop(); const lv = stack.length;
      if (opts.subtotal !== false && sumCols.length) { const t = { __kind: 'gtot', __lvl: lv, __label: 'Total ' + (labels[groupBy[lv]] || groupBy[lv]) + ' ' + g.val }; for (const c of cols) if (!(c in t)) t[c] = null; Object.assign(t, totalOf(g.rows, sumCols)); out.push(t); }
      if (lv === 0) out.push({ __kind: 'blank' }); } };
    for (const i of idx) {
      const r = rows[i];
      let lv = 0; while (lv < stack.length && stack[lv].val === str(r[groupBy[lv]])) lv++;
      close(lv);
      while (stack.length < n) { const L = stack.length; const val = str(r[groupBy[L]]); stack.push({ val, sums: sums(), rows: [] });
        out.push({ __kind: 'gtitle', __lvl: L, __label: (labels[groupBy[L]] ? labels[groupBy[L]] + ' : ' : '') + (val || '(kosong)') });
        if (L === n - 1) out.push({ __kind: 'ghead' }); }
      out.push(r); for (const g of stack) g.rows.push(r);
    }
    close(0);
    if (grand) out.push(grand);
    return out;
  }

  /* ---------- kolom turunan dari field berformat Jasper: <field>.kode / .nama / .tipe / .lvl / .sort ---------- */
  const JASPER_PARTS = { kode: 'Kode', nama: 'Nama', tipe: 'Tipe (H/A/T/G)', lvl: 'Level', sort: 'Kunci urut' };
  // mengisi r['<field>.<bagian>'] untuk setiap kolom turunan yang dipakai; r.__dec diisi dari field Jasper pertama (untuk indentasi/tebal)
  function expandJasper(rows, cols) {
    const parts = cols.filter(c => /\.(kode|nama|tipe|lvl|sort)$/.test(c)).map(c => { const i = c.lastIndexOf('.'); return { col: c, base: c.slice(0, i), part: c.slice(i + 1) }; });
    if (!parts.length) return false;
    const bases = [...new Set(parts.map(p => p.base))];
    for (const r of rows) {
      if ((r.__kind && r.__kind !== 'row') || r.__tot) continue;   // baris total: label sudah diisi di kolom pertama
      for (const b of bases) { const d = decodeBaris(r[b]); if (!r.__dec && d) r.__dec = d;
        for (const p of parts) if (p.base === b) r[p.col] = r.__tot ? (p.part === 'kode' ? 'Total' : '') : !d ? (p.part === 'nama' ? (r[b] ?? '') : '') : p.part === 'kode' ? (d.tipe === 'A' ? d.kode : '') : p.part === 'nama' ? d.label : p.part === 'tipe' ? d.tipe : p.part === 'lvl' ? d.lvl : d.sort; }
    }
    return true;
  }

  /* ---------- tabel: pecah field berformat Jasper menjadi kolom KODE + NAMA ---------- */
  // Mengubah rows di tempat (menambah __kode, __label, __dec) dan mengembalikan kolom pengganti. encKey = field yang berformat Jasper (atau null)
  function jasperSplit(rows, cols, labKode, labAkun) {
    const sample = rows.slice(0, 200).filter(r => !r.__tot);
    const encKey = cols.find(k => sample.length && sample.filter(r => BARIS_RE.test(String(r[k] ?? ''))).length > sample.length * 0.8) || null;
    if (!encKey) return { cols, labels: {}, encKey: null };
    for (const r of rows) { const d = decodeBaris(r[encKey]); r.__dec = d; r.__kode = d && d.tipe === 'A' ? d.kode : (r.__tot ? 'Total' : ''); r.__label = d ? d.label : (r.__tot ? '' : (r[encKey] ?? '')); }
    const out = []; for (const c of cols) { if (c === encKey) out.push('__kode', '__label'); else out.push(c); }
    return { cols: out, labels: { __kode: labKode || 'KODE', __label: labAkun || 'AKUN' }, encKey };
  }

  /* ---------- crosstab ---------- */
  const SEP = ' / ';
  function smartSort(a, b) { const na = Number(a), nb = Number(b); if (!isNaN(na) && !isNaN(nb) && a !== '' && b !== '') return na - nb; return String(a).localeCompare(String(b), 'id', { numeric: true }); }
  // format "baris" ala Jasper: sort_key|tipe|lvl|label|kode  (H=header, A=akun, T=total, G=grand total)
  const BARIS_RE = /^([^|]*)\|([HATG])\|(\d+)\|([^|]*)\|(.*)$/;
  function decodeBaris(v) { const m = BARIS_RE.exec(String(v ?? '')); if (!m) return null; return { sort: m[1], tipe: m[2], lvl: +m[3], label: m[4].replace(/\u00a0/g, ' ').trim(), kode: m[5].replace(/\u00a0/g, ' ').trim() }; }
  // Rangkuman crosstab bertahap: add(row) berkali-kali, lalu finish(). Memori hanya sebesar jumlah sel hasil, bukan jumlah baris mentah.
  class Pivot {
    constructor(cfg) { this.cfg = cfg; this.cells = new Map(); this.colSet = new Map(); this.rowMeta = new Map(); this.n = 0; this.encHits = cfg.rows.map(() => 0); }
    add(r) {
      const cfg = this.cfg; const clean = v => String(v ?? '').replace(/T\d\d:\d\d:\d\d.*$/, '');
      const vals = cfg.rows.map(k => r[k] ?? ''); vals.forEach((v, i) => { if (BARIS_RE.test(String(v))) this.encHits[i]++; });
      const a = vals.join(SEP), parts = cfg.cols.map(k => clean(r[k])), b = parts.join('\u0001');
      if (!this.colSet.has(b)) this.colSet.set(b, parts);
      if (!this.rowMeta.has(a)) this.rowMeta.set(a, { vals });
      const key = a + '\u0002' + b; let c = this.cells.get(key); if (!c) { c = { sum: 0, n: 0, min: Infinity, max: -Infinity }; this.cells.set(key, c); }
      const v = num(r[cfg.value]); c.sum += v; c.n++; if (v < c.min) c.min = v; if (v > c.max) c.max = v; this.n++;
    }
    finish() {
      const cfg = this.cfg, cells = this.cells, rowMeta = this.rowMeta;
      // field baris ala Jasper boleh di field mana pun; field baris lain diabaikan karena sudah terwakili
      const ei = this.n ? this.encHits.findIndex(h => h > this.n * 0.8) : -1; const encField = ei >= 0 ? cfg.rows[ei] : null; const encoded = !!encField;
      for (const m of rowMeta.values()) m.dec = encoded ? decodeBaris(m.vals[ei]) : null;
      const agg = c => !c ? null : cfg.agg === 'count' ? c.n : cfg.agg === 'avg' ? (c.n ? c.sum / c.n : 0) : cfg.agg === 'min' ? c.min : cfg.agg === 'max' ? c.max : c.sum;
      const cmpParts = (x, y) => { for (let i = 0; i < x.length; i++) { const d = smartSort(x[i], y[i]); if (d) return d; } return 0; };
      const leaves = [...this.colSet.entries()].sort((x, y) => cmpParts(x[1], y[1]));
      const colDefs = []; const depth = cfg.cols.length;
      const emit = (list, level, prefix) => {
        if (level === depth - 1) { for (const [k, parts] of list) colDefs.push({ id: k, parts, kind: 'leaf' }); return; }
        let i = 0; while (i < list.length) {
          const g = list[i][1][level]; let j = i; while (j < list.length && list[j][1][level] === g) j++; const grp = list.slice(i, j);
          emit(grp, level + 1, [...prefix, g]);
          if (cfg.totGroup !== false) colDefs.push({ id: '\u0003' + [...prefix, g].join('\u0001'), parts: [...prefix, g], kind: 'sub', level, members: grp.map(x => x[0]) });
          i = j;
        }
      };
      emit(leaves, 0, []);
      const rowKeys = [...rowMeta.keys()].sort(encoded ? (x, y) => { const sx = (rowMeta.get(x).dec || {}).sort ?? x, sy = (rowMeta.get(y).dec || {}).sort ?? y; return sx < sy ? -1 : sx > sy ? 1 : 0; } : smartSort);
      const out = []; const colTot = {}; let grand = 0;
      for (const a of rowKeys) {
        const meta = rowMeta.get(a); const o = { __kind: 'row', __dec: meta.dec }; cfg.rows.forEach((k, i) => o[k] = meta.vals[i]); let t = 0;
        const leafVal = {}; for (const [b] of leaves) { const v = agg(cells.get(a + '\u0002' + b)); leafVal[b] = v; if (v != null) { t += v; colTot[b] = (colTot[b] || 0) + v; } }
        for (const d of colDefs) { if (d.kind === 'leaf') o['c:' + d.id] = leafVal[d.id]; else { let sv = null; for (const m of d.members) { if (leafVal[m] != null) sv = (sv || 0) + leafVal[m]; } o['c:' + d.id] = sv; } }
        o.__total = t; grand += t; out.push(o);
      }
      if (cfg.totCol !== false && out.length && !encoded) { const o = { __kind: 'tot' }; cfg.rows.forEach((k, i) => o[k] = i === 0 ? 'Total' : ''); for (const d of colDefs) { if (d.kind === 'leaf') o['c:' + d.id] = colTot[d.id] ?? 0; else o['c:' + d.id] = d.members.reduce((s, m) => s + (colTot[m] || 0), 0); } o.__total = grand; out.push(o); }
      out.colDefs = colDefs; out.encoded = encoded; out.encField = encField; return out;
    }
  }
  function pivot(rows, cfg) { const p = new Pivot(cfg); for (const r of rows) p.add(r); return p.finish(); }
  // Susunan kolom crosstab untuk tampilan / Excel
  function crosstabLayout(res, cfg) {
    const enc = res.encoded, colDefs = res.colDefs || [];
    const rowCols = enc ? ['__kode', '__label'] : cfg.rows;
    const cols = [...rowCols, ...colDefs.map(d => 'c:' + d.id), ...(cfg.totRow !== false ? ['__total'] : [])];
    const labels = {}; if (enc) { labels.__kode = cfg.labKode || 'KODE'; labels.__label = cfg.labAkun || 'AKUN'; }
    for (const d of colDefs) labels['c:' + d.id] = d.kind === 'leaf' ? d.parts.map(x => x || '(kosong)').join(' / ') : 'Total ' + d.parts[d.parts.length - 1];
    labels.__total = 'TOTAL';
    const numeric = new Set(cols.filter(c => c.startsWith('c:') || c === '__total'));
    return { rowCols, cols, labels, numeric };
  }
  // Baris crosstab siap ekspor (kode/label sudah didekode)
  const crosstabExportRow = (r, res, cfg) => enc(r, res, cfg);
  function enc(r, res, cfg) { if (!res.encoded) return r; const d = r.__dec; return Object.assign({}, r, { __kode: d && d.tipe === 'A' ? d.kode : '', __label: d ? ' '.repeat(d.lvl * 3) + d.label : r[res.encField || cfg.rows[0]] }); }

  // ---- Rekomendasi cara pengambilan data dari struktur custom query (aturan/heuristik, berjalan lokal) ----
  const SUM_NAME = /^(debit|kredit|credit|saldo|nilai|jumlah|total|amount|qty|quantity|qty_|mutasi|omzet|penjualan|pembelian|hpp|laba|rugi|biaya|beban|pendapatan|nominal|harga|subtotal|dpp|ppn|pajak|value|balance|bal_)/i;
  function analyzeQuery(def, opts) {
    opts = opts || {}; def = def || {};
    const sqlRaw = String(def.query || def.sql || '');
    const sql = sqlRaw.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ').toLowerCase();
    // kueri utama: isi tanda kurung (CTE, subquery, argumen fungsi) dibuang supaya GROUP BY/SUM di dalam CTE pencarian tidak ikut terhitung
    let tl = '', depth = 0; for (const ch of sql) { if (ch === '(') { depth++; if (depth === 1) tl += '('; } else if (ch === ')') { depth = Math.max(0, depth - 1); if (depth === 0) tl += ')'; } else if (depth === 0) tl += ch; }
    const mi = tl.search(/\bselect\b/); const main = mi >= 0 ? tl.slice(mi) : tl;
    const fields = def.field && typeof def.field === 'object' ? Object.keys(def.field) : [];
    const fl = fields.map(f => f.toLowerCase());
    const t = {};
    t.hasDate = fl.includes('date') || /\{andwhere\}|:date_from|:date_to|\{date_from\}|\$date/.test(sql);
    t.andWhere = (sql.match(/\{andwhere\}/g) || []).length;
    t.jasper = fl.includes('baris') || /\|\|\s*'\|'\s*\|\|/.test(sql) || /'\|[hatg]\|'/.test(sql);
    t.groupBy = /\bgroup by\b/.test(main);
    t.agg = t.groupBy || /\b(sum|count|avg|min|max)\s*\(/.test(main);
    t.window = /\bover\s*\(/.test(sql);
    // window yang bergantung urutan periode (saldo berjalan): SUM/LAG/LEAD ... OVER (... ORDER BY ...). ROW_NUMBER per dokumen tidak masalah.
    t.runWin = /\b(sum|avg|count|lag|lead|first_value|last_value)\s*\([^()]*\)\s*over\s*\([^)]*order by/.test(sql);
    t.avgRatio = /\bavg\s*\(/.test(main) || /\bcount\s*\(\s*distinct\b/.test(main) || /nullif\s*\([^)]*\)\s*\*?\s*100|\*\s*100(\.0)?\s*\/|\/\s*nullif\s*\(/.test(sql);
    t.pctField = fl.filter(f => /persen|percent|pct|rasio|ratio/.test(f));
    t.opening = /saldo[_ ]?awal|opening|beginning|awal_|_awal\b|saldo_akhir|saldo akhir|closing/.test(sql + ' ' + String(def.name || '').toLowerCase()) || fl.some(f => /awal|akhir|opening|closing|balance/.test(f));
    t.balanceSheet = /neraca|balance sheet|posisi keuangan|\bbs_|trial balance|neraca saldo/.test(sql) || /neraca/.test(String(def.name || def.reason || '').toLowerCase());
    t.running = /running|berjalan|kumulatif|cumulative/.test(sql) || t.runWin;
    t.distinct = /\bselect distinct\b/.test(main) && !t.agg;
    t.limit = /\blimit\s+\d+/.test(sql) || /\bfetch first\b/.test(sql);
    t.minus = /\bexcept\b|\bminus\b|\bintersect\b/.test(sql);
    t.beforeStart = /<\s*:date_from|<\s*\{date_from\}|<\s*\$date_from|< date_from|tanggal\s*<\s*/.test(sql) && t.andWhere === 0 ? false : /saldo[_ ]?awal.*<|<.*date_from/.test(sql);
    t.union = /\bunion\b/.test(sql);
    t.sumFields = fields.filter(f => SUM_NAME.test(f) && !/_id$|^id$|kode|code|no_|nomor/i.test(f));
    t.keyFields = fields.filter(f => !t.sumFields.includes(f));
    const mode = opts.mode || 'table';
    const reasons = [], notes = []; let rec, conf = 'tinggi';
    const nonAdditive = t.opening || t.balanceSheet || t.running || (t.agg && (t.avgRatio || t.pctField.length));
    if (!t.hasDate) {
      rec = 'once'; reasons.push('Tidak ada field `date` di peta field dan tidak ada penanda filter tanggal ({andWhere}) di query, jadi periode tidak bisa dipecah per bulan — pemecahan hanya berlaku bila ada filter tanggal.');
      if (!fields.length && !sqlRaw) { conf = 'rendah'; notes.push('Definisi query tidak terbaca; rekomendasi hanya berdasarkan nama. Tempelkan SQL-nya agar analisis lebih tepat.'); }
      else notes.push('Kalau datanya sangat besar, tambahkan kolom tanggal ke peta field dengan nama `date` (mis. "date": "g.tanggal") supaya bisa dipecah per bulan.');
    } else if (nonAdditive) {
      rec = 'once';
      if (t.opening) reasons.push('Query menghitung saldo awal / saldo akhir (ditemukan kata saldo_awal/awal/akhir/opening/closing). Saldo bukan nilai yang boleh dijumlahkan antar bulan — kalau dipecah, saldo awal tiap bulan akan terhitung berulang.');
      if (t.balanceSheet) reasons.push('Query bercorak neraca / posisi keuangan: nilainya adalah posisi pada tanggal, bukan mutasi periode.');
      if (t.running) reasons.push('Ada saldo berjalan / fungsi window yang diurutkan sepanjang periode (SUM/LAG … OVER (ORDER BY …)) — hasilnya bergantung urutan seluruh periode, jadi harus dihitung dalam satu kali jalan.');
      if (t.agg && (t.avgRatio || t.pctField.length)) reasons.push('Query merangkum dengan rata-rata, COUNT DISTINCT, atau persentase/rasio' + (t.pctField.length ? ' (' + t.pctField.join(', ') + ')' : '') + ' — nilai seperti ini tidak sah bila dijumlahkan dari potongan per bulan.');
      if (t.jasper) notes.push('Format baris Jasper (sort_key|tipe|lvl|nama|kode) tetap bisa dipecah kode/nama menjadi kolom di tabel Kolom.');
      notes.push('Bila satu kali tarik terlalu berat untuk server (time-out), persempit periode atau filter, bukan mengubah cara pengambilan.');
    } else if (t.agg) {
      rec = mode === 'crosstab' ? 'monthly' : 'monthly_sum';
      reasons.push('Query sudah merangkum (SUM/COUNT + GROUP BY) tanpa saldo awal, window, atau rasio — nilainya mutasi periode yang sah dijumlahkan: hasil Jan+Feb+… sama dengan hasil satu tarikan Jan–Des.');
      if (mode === 'crosstab') reasons.push('Untuk crosstab cukup "Per bulan — digabung": crosstab sendiri yang menjumlahkan per sel.');
      else reasons.push('"Per bulan — dijumlahkan" menarik tiap bulan (ringan untuk server) lalu menggabungkan baris berkunci sama dan menjumlahkan kolom angkanya di sini.');
      if (t.jasper) notes.push('Baris Jasper (laba rugi, dsb.): kunci gabungnya kolom baris + dimensi (departemen/proyek/cost code); baris H/T/G ikut dijumlahkan sehingga subtotal tetap benar.');
      if (t.sumFields.length) notes.push('Kolom yang terdeteksi untuk dijumlahkan: ' + t.sumFields.join(', ') + '. Kolom lainnya jadi kunci. Periksa/ubah perannya di tabel Kolom (tampil saat mode ini dipilih).');
      else notes.push('Tidak ada nama kolom yang jelas-jelas angka; peran kunci/jumlahkan dideteksi dari isi data — periksa di tabel Kolom.');
      notes.push('Kalau datanya kecil (ratusan baris), "Sekaligus" juga cukup dan hasilnya sama.');
      conf = t.jasper || t.sumFields.length ? 'tinggi' : 'sedang';
    } else {
      rec = 'monthly';
      reasons.push('Query mengeluarkan baris rinci (tanpa GROUP BY/SUM) dengan filter tanggal — setiap baris berdiri sendiri sehingga aman ditarik per bulan lalu digabung apa adanya, dan jauh lebih ringan untuk data besar.');
      if (mode === 'crosstab') reasons.push('Crosstab merangkum sendiri per sel, jadi baris rinci per bulan langsung bisa dipakai.');
      if (t.window) notes.push('Fungsi window yang ada (mis. ROW_NUMBER per dokumen) tidak melintasi bulan, jadi aman.');
      if (t.pctField.length) notes.push('Kolom persentase (' + t.pctField.join(', ') + ') jangan dijumlahkan di total/subtotal — atur perannya di tabel Kolom bila perlu.');
      if (t.distinct) { conf = 'sedang'; notes.push('Ada SELECT DISTINCT: baris yang sama bisa muncul di dua bulan berbeda. Kalau itu masalah, pakai "Sekaligus" atau "Per bulan — dijumlahkan" dengan semua kolom sebagai kunci.'); }
    }
    if (t.limit) notes.push('Query memakai LIMIT/FETCH FIRST: bila dipecah, batas baris berlaku per bulan, bukan per periode. Hilangkan LIMIT atau pilih "Sekaligus".');
    if (t.minus) notes.push('Ada EXCEPT/INTERSECT: hasil per bulan bisa berbeda dengan hasil satu periode. Lebih aman "Sekaligus".');
    if (t.hasDate && t.andWhere > 1 && !nonAdditive) notes.push('{andWhere} dipakai di ' + t.andWhere + ' tempat — pastikan semua potongan tanggal memakai filter yang sama.');
    const label = { once: 'Sekaligus — satu query untuk seluruh periode', monthly: 'Per bulan — dipecah lalu digabung', monthly_sum: 'Per bulan — dipecah lalu dijumlahkan per kelompok' }[rec];
    return { rec, label, confidence: conf, reasons, notes, traits: t };
  }

  // ---- filter "di aplikasi": mencocokkan kolom hasil query dengan pilihan user (untuk query yang tidak punya parameter itu) ----
  // local: [{col, type:'single'|'multi'|'range'|'text', values:[{id,code,name}], from, to, text}]
  // Kolom yang benar-benar dipakai laporan (hanya mode table/crosstab dengan kolom terdesain); null = perlu semua kolom.
  // Dipakai untuk meminta kolom seperlunya ke server ($select) sehingga data yang dikirim lebih kecil.
  function usedColumns(report, local) {
    if (!report) return null; const s = new Set();
    if (report.mode === 'crosstab') { const x = report.crosstab || {}; if (!(x.rows || []).length || !x.value) return null; [...x.rows, ...(x.cols || []), x.value].forEach(k => k && s.add(k)); }
    else if (report.mode === 'table') { const cols = report.cols || []; if (!cols.length) return null; cols.forEach(c => s.add(c.key)); (report.groupBy || []).forEach(k => s.add(k)); }
    else return null;
    for (const f of (local || [])) if (f && f.col) s.add(f.col);
    const out = [...s].filter(k => typeof k === 'string' && k.trim());
    if (!out.length || out.some(k => /[.\s]/.test(k))) return null;   // kolom turunan (mis. "akun.kode") → butuh baris utuh
    return out;
  }
  // Apakah server benar-benar menghormati pemilihan kolom: baris contoh hanya berisi kolom yang diminta
  function selectHonored(row, cols) { if (!row || typeof row !== 'object') return false; const ks = Object.keys(row); return ks.length > 0 && ks.every(k => cols.includes(k)); }
  function localPredicate(local) {
    if (!Array.isArray(local) || !local.length) return null;
    const norm = v => String(v == null ? '' : v).trim().toLowerCase();
    const isNum = v => v !== '' && !isNaN(Number(v));
    const tests = local.map(f => {
      const col = f.col;
      if (f.type === 'text') { const t = norm(f.text); return t ? r => norm(r[col]).includes(t) : null; }
      if (f.type === 'range') {
        const a = norm(f.from), b = norm(f.to); if (!a && !b) return null;
        const na = isNum(a), nb = isNum(b);
        return r => { const v = norm(r[col]); if (v === '') return false; const nv = isNum(v);
          if (a && (na && nv ? Number(v) < Number(a) : v < a)) return false;
          if (b && (nb && nv ? Number(v) > Number(b) : v > b)) return false; return true; };
      }
      const vals = (f.values || []).map(x => ({ id: norm(x.id), code: norm(x.code), name: norm(x.name), both: norm((x.code || '') + ' ' + (x.name || '')) })).filter(x => x.id || x.code || x.name);
      if (!vals.length) return null;
      return r => { const v = norm(r[col]); if (v === '') return false; return vals.some(x => v === x.id || (x.code && v === x.code) || (x.name && v === x.name) || v === x.both); };
    }).filter(Boolean);
    if (!tests.length) return null;
    return r => { for (let i = 0; i < tests.length; i++) if (!tests[i](r)) return false; return true; };
  }

  return { analyzeQuery, localPredicate, usedColumns, selectHonored, ymd, num, fmt, appendAll, monthChunks, yearChunks, planChunks, prevDay, KREDIT_SIDE, TrialBalance, DEFAULT_USD_CURRENCY_ID, tbLayout, tbFields, jrFields, jrLayout, JournalBuilder, tbAccountOpts, tbRowOpts, LABELS, COLS, VALAS_COLS, ledgerColsOf, LEDGER_NUM, LEDGER_GROUP, rowKind, LedgerBuilder, LegacyMerger, mergeChunks, SEP, smartSort, BARIS_RE, decodeBaris, Pivot, pivot, Summarizer, groupRows, totalOf, jasperTipe, jasperSplit, expandJasper, JASPER_PARTS, crosstabLayout, crosstabExportRow };
});
