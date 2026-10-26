/* Zahir Insight — penulis Excel bersama (server: WorkbookWriter streaming, browser: Workbook biasa di memori).
   setupSheet(ws, opsi) menulis judul + header dan mengembalikan konteks; writeRow(ctx, baris) menulis satu baris. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.XLSXW = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
const HEAD_FILL = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF0E7FB8' } };
const SA_FILL   = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFEEF5F9' } };
const TOT_FILL  = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFDBE9F3' } };
const NUMFMT = '#,##0.00;-#,##0.00;0';
const toNum = v => { if (v == null || v === '') return null; const n = Number(String(v).replace(/,/g, '')); return isNaN(n) ? null : n; };
const rowKind = r => { if (r.tanggal == null && r.kode_akun && r.tipe === r.kode_akun) return 'title'; if (r.tanggal === 'TANGGAL') return 'head'; if (r.proyek === 'Total :' || r.proyek === 'Mutasi :') return 'tot'; if (r.tipe === 'Saldo Awal' && r.tanggal) return 'sa'; if (r.tanggal == null && r.tipe == null && r.referensi == null) return 'blank'; return 'trx'; };
const GRP_FILL = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF063E5C' } };
// heads (opsional): header bertingkat [[{label, colspan, rowspan}], ...] — sel digabung sesuai span (dipakai trial balance)
function writeHeads(ws, heads, ncol) {
  const taken = new Set(); const rows = []; const merges = []; const grp = new Set();   // grp: kolom judul kelompok (mata uang) di baris pertama
  heads.forEach((hr, ri) => { const vals = new Array(ncol).fill(''); let c = 0;
    for (const h of hr) { while (taken.has(ri + ':' + c)) c++; const cs = h.colspan || 1, rs = h.rowspan || 1; vals[c] = h.label; if (ri === 0 && !h.key && !h.flat) for (let b = 0; b < cs; b++) grp.add(c + b);
      for (let a = 0; a < rs; a++) for (let b = 0; b < cs; b++) taken.add((ri + a) + ':' + (c + b));
      if (cs > 1 || rs > 1) merges.push([ri, c + 1, ri + rs - 1, c + cs]); c += cs; }
    rows.push(vals); });
  const added = rows.map((v, ri) => { const r = ws.addRow(v); for (let c = 1; c <= ncol; c++) { const cell = r.getCell(c); cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = ri === 0 && grp.has(c - 1) ? GRP_FILL : HEAD_FILL; cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; } return r; });
  const first = added[0].number;   // nomor baris sebenarnya, diketahui setelah baris ditambahkan
  for (const [r1, c1, r2, c2] of merges) ws.mergeCells(first + r1, c1, first + r2, c2);   // gabung sebelum commit (writer streaming)
  added.forEach(r => r.commit());
}
  function setupSheet(ws, { kind, grouped, title, sub, period, cols, labels, numeric, widths, ttypes, groups, heads, dec }) {
  ws.columns = cols.map(c => ({ key: c, width: (widths && widths[c]) || 14 }));
  const line = (v, font, color) => { const r = ws.addRow([v]); r.getCell(1).font = font; r.commit(); };
  line(title || '', { bold: true, size: 14 }); line(sub || '', { bold: true, size: 12, color: { argb: 'FF0E7FB8' } });
  if (period) line(period, { color: { argb: 'FFC62828' } }); ws.addRow([]).commit();
  const numSet = new Set(numeric || []);
  // groups (buku besar valas): [{label, span}] → baris judul kelompok (NILAI USD / NILAI IDR) di atas baris label, sel digabung
  const G = Array.isArray(groups) && groups.length && groups.reduce((a, g) => a + (g.span || 1), 0) === cols.length ? groups : null;
  const white = { bold: true, color: { argb: 'FFFFFFFF' } };
  const headRow = () => {
    if (G) {
      const top = ws.addRow(cols.map(() => '')); const rn = top.number; let i = 1;
      for (const g of G) { const sp = g.span || 1; const cell = top.getCell(i); cell.value = g.label || labels[cols[i - 1]] || cols[i - 1];
        for (let j = i; j < i + sp; j++) { const c = top.getCell(j); c.font = white; c.fill = g.label ? GRP_FILL : HEAD_FILL; c.alignment = { horizontal: 'center', vertical: 'middle' }; }
        i += sp; }
      const r = ws.addRow(cols.map(c => labels[c] || c));
      r.eachCell((cell, n) => { cell.font = white; cell.fill = HEAD_FILL; cell.alignment = { horizontal: numSet.has(cols[n - 1]) ? 'right' : 'left', vertical: 'middle' }; });
      // gabungkan sebelum commit (writer streaming tidak bisa mengubah baris yang sudah di-commit): kelompok → horizontal; kolom tanpa kelompok → vertikal (2 baris)
      i = 1; for (const g of G) { const sp = g.span || 1; if (g.label && sp > 1) ws.mergeCells(rn, i, rn, i + sp - 1); if (!g.label) for (let j = i; j < i + sp; j++) ws.mergeCells(rn, j, rn + 1, j); i += sp; }
      top.commit(); r.commit();
      return;
    }
    const r = ws.addRow(cols.map(c => labels[c] || c)); r.eachCell(cell => { cell.font = white; cell.fill = HEAD_FILL; }); r.commit(); };
  if (Array.isArray(heads) && heads.length) writeHeads(ws, heads, cols.length);
  else if (kind !== 'ledger' && !grouped) headRow();
  // format angka per kolom (jumlah desimal), bawaan NUMFMT
  const fmtOf = c => dec && dec[c] != null ? (dec[c] > 0 ? '#,##0.' + '0'.repeat(dec[c]) + ';-#,##0.' + '0'.repeat(dec[c]) + ';"-"' : '#,##0;-#,##0;"-"') : NUMFMT;
  return { ws, kind, cols, labels, numSet, fmtOf, ttypes: ttypes || {}, headRow, rows: 0 };
  }
// satu baris laporan → Excel. r = objek baris (kind dihitung) atau format ringkas [kind, ...nilai]
function writeRow(ex, r) {
  const { ws, cols, numSet, kind, ttypes } = ex;
  let k, vals;
  let glabel = null, glvl = 0;
  if (Array.isArray(r)) { k = r[0]; if (k === 'title') vals = { kode_akun: r[1], nama_akun: r[2] }; else if (k === 'gtitle') { glabel = r[1]; glvl = r[2] || 0; vals = {}; } else if (k === 'gtot') { glabel = r[1]; vals = {}; cols.forEach((c, i) => vals[c] = r[i + 2]); } else { vals = {}; cols.forEach((c, i) => vals[c] = r[i + 1]); } }
  else { k = kind === 'ledger' ? rowKind(r) : (r.__kind || (r.__tot ? 'tot' : 'trx')); vals = r; glabel = r.__label; glvl = r.__lvl || 0; }
  if (kind !== 'ledger') {
    if (k === 'gtitle') { const row = ws.addRow([' '.repeat(glvl * 3) + glabel]); row.getCell(1).font = { bold: true, color: { argb: 'FF0E7FB8' }, size: 11 }; row.commit(); ex.rows++; return; }
    if (k === 'ghead') { ex.headRow(); ex.rows++; return; }
    if (k === 'blank') { ws.addRow([]).commit(); ex.rows++; return; }
    if (k === 'bold') { const row = ws.addRow(cols.map(c => numSet.has(c) ? toNum(vals[c]) : (vals[c] ?? ''))); cols.forEach((c, i) => { const cell = row.getCell(i + 1); cell.font = { bold: true }; cell.fill = SA_FILL; if (numSet.has(c)) cell.numFmt = ex.fmtOf(c); }); row.commit(); ex.rows++; return; }
    if (k === 'gtot' || k === 'tot') { const first = cols.find(c => !numSet.has(c)); const hasText = cols.some(c => c !== first && !numSet.has(c) && vals[c] != null && vals[c] !== ''); const row = ws.addRow(cols.map(c => c === first ? (glabel || vals[c] || (hasText ? '' : 'Total')) : numSet.has(c) ? toNum(vals[c]) : ((c === '__label' || c === '__kode' || /\.(kode|nama|tipe|lvl|sort)$/.test(c)) ? '' : (vals[c] ?? '')))); cols.forEach((c, i) => { const cell = row.getCell(i + 1); if (numSet.has(c)) cell.numFmt = ex.fmtOf(c); cell.fill = TOT_FILL; cell.font = { bold: true }; }); row.commit(); ex.rows++; return; }
  }
  if (kind === 'ledger') {
    if (k === 'title') { const row = ws.addRow([`${vals.kode_akun}  ·  ${vals.nama_akun}`]); row.getCell(1).font = { bold: true, color: { argb: 'FF0E7FB8' }, size: 11 }; row.commit(); return; }
    if (k === 'head') { ex.headRow(); return; }
    if (k === 'blank') { ws.addRow([]).commit(); return; }
    const row = ws.addRow(cols.map(c => { let v = vals[c]; if (c === 'tipe' && k === 'trx') v = ttypes[v] || v; return numSet.has(c) ? toNum(v) : (v ?? ''); }));
    cols.forEach((c, i) => { const cell = row.getCell(i + 1); if (numSet.has(c)) cell.numFmt = NUMFMT; if (k === 'sa') cell.fill = SA_FILL; if (k === 'tot') { cell.fill = TOT_FILL; cell.font = { bold: true }; } });
    row.commit();
  } else {
    const row = ws.addRow(cols.map(c => numSet.has(c) ? toNum(vals[c]) : (vals[c] ?? '')));
    cols.forEach((c, i) => { if (numSet.has(c)) row.getCell(i + 1).numFmt = ex.fmtOf(c); }); row.commit();
  }
  ex.rows++;
}
  return { setupSheet, writeRow, writeHeads, rowKind, toNum };
});
