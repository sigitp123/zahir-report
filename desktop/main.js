// Zahir Insight — aplikasi desktop (Electron): jendela sendiri + ikon tray, membungkus server yang sama dengan versi web/exe.
const { app, BrowserWindow, Tray, Menu, shell, dialog, nativeImage } = require('electron');
const path = require('path'); const net = require('net'); const fs = require('fs');
const dbg = m => { if (process.env.ZI_DEBUG_LOG) { try { fs.appendFileSync(process.env.ZI_DEBUG_LOG, new Date().toISOString() + ' ' + m + '\n'); } catch {} } };
dbg('main start, packaged=' + app.isPackaged);

if (!app.requestSingleInstanceLock()) { dbg('no single-instance lock -> quit'); app.quit(); }   // klik ikon lagi -> fokus ke jendela yang ada, bukan instance kedua
else {
  let win = null, tray = null, port = 0, quitting = false;
  // ikon disimpan di luar app.asar (asarUnpack) supaya bisa dibaca sebagai berkas biasa
  const ICON = path.join(__dirname, 'icons', process.platform === 'win32' ? 'icon.ico' : 'icon.png').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);

  // folder data: di samping exe bila ada portable.txt/data (mode portable), selain itu folder data pengguna (%APPDATA%\Zahir Insight)
  const exeDir = path.dirname(process.execPath);
  const portable = !app.isPackaged ? null : (fs.existsSync(path.join(exeDir, 'portable.txt')) || fs.existsSync(path.join(exeDir, 'data'))) ? exeDir : null;
  // Folder data pengguna dibuat TETAP (%APPDATA%\ZahirInsight) — tidak ikut berubah bila productName diganti; folder nama lama dipindahkan otomatis
  if (app.isPackaged) { try { const fixed = path.join(app.getPath('appData'), 'ZahirInsight');
    for (const old of ['Zahir Insight Desktop', 'Zahir Insight', 'zahir-insight']) { const o = path.join(app.getPath('appData'), old); if (!fs.existsSync(fixed) && fs.existsSync(path.join(o, 'data'))) { try { fs.renameSync(o, fixed); dbg('migrasi data dari ' + o); } catch (e) { dbg('migrasi gagal: ' + e.message); } break; } }
    app.setPath('userData', fixed); } catch (e) { dbg('setPath userData gagal: ' + e.message); } }
  const dataRoot = process.env.DATA_ROOT || portable || app.getPath('userData');

  const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

  async function startServer() {
    // coba port tetap 3300 dulu (supaya bisa dibuka juga dari browser biasa); kalau terpakai, ambil port bebas
    const busy = await new Promise(r => { const c = net.connect(3300, '127.0.0.1'); c.once('connect', () => { c.destroy(); r(true); }); c.once('error', () => r(false)); });
    let want = 3300; try { want = Number(JSON.parse(fs.readFileSync(path.join(dataRoot, 'data', 'settings.json'), 'utf8')).port) || 3300; } catch {}
    const busyWant = want === 3300 ? busy : await new Promise(r => { const c = net.connect(want, '127.0.0.1'); c.once('connect', () => { c.destroy(); r(true); }); c.once('error', () => r(false)); });
    port = busyWant ? await freePort() : want;
    process.env.PORT = String(port); process.env.ZI_DESKTOP = '1'; process.env.DATA_ROOT = dataRoot; process.env.OPEN_BROWSER = '0';
    if (!process.env.REPORT_SCOPE) process.env.REPORT_SCOPE = 'company';
    const srvMod = require(path.join(__dirname, '..', 'server.js'));
    srvMod.onRestart = () => { quitting = true; app.relaunch(); app.exit(0); };   // port diganti dari halaman login -> jalan ulang
    await new Promise((res, rej) => { if (srvMod.error) return rej(srvMod.error); srvMod.srv.once('listening', res); srvMod.srv.once('error', rej); if (srvMod.srv.listening) res(); });
  }

  function createWindow() {
    win = new BrowserWindow({ width: 1366, height: 820, minWidth: 900, minHeight: 600, show: false, title: 'Zahir Insight Desktop', icon: ICON, autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    win.loadURL(`http://127.0.0.1:${port}/`);
    win.once('ready-to-show', () => win.show());
    // tautan luar (mis. dokumentasi) dibuka di browser bawaan, bukan di dalam jendela
    win.webContents.setWindowOpenHandler(({ url }) => { if (!url.startsWith(`http://127.0.0.1:${port}`)) { shell.openExternal(url); return { action: 'deny' }; } return { action: 'allow' }; });
    // tutup jendela (✕) = aplikasi berhenti sepenuhnya (server ikut mati)
    win.on('closed', () => { win = null; quitting = true; app.quit(); });
  }
  function showWindow() { if (!win) createWindow(); else { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } }

  function createTray() {
    const img = nativeImage.createFromPath(ICON); tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
    tray.setToolTip('Zahir Insight');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Buka Zahir Insight', click: showWindow },
      { label: 'Buka di browser', click: () => shell.openExternal(`http://127.0.0.1:${port}/`) },
      { type: 'separator' },
      { label: `Versi ${app.getVersion()} · data: ${dataRoot}`, enabled: false },
      { type: 'separator' },
      { label: 'Keluar', click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on('click', showWindow); tray.on('double-click', showWindow);
  }

  app.on('second-instance', showWindow);
  app.on('window-all-closed', () => { quitting = true; app.quit(); });
  app.on('before-quit', () => { quitting = true; });
  process.on('uncaughtException', e => { try { fs.appendFileSync(path.join(dataRoot, 'error.log'), new Date().toISOString() + ' uncaught: ' + (e && e.stack || e) + '\n'); } catch {} });
  app.whenReady().then(async () => {
    dbg('ready; dataRoot=' + dataRoot);
    try { await startServer(); dbg('server up on ' + port); } catch (e) {
      const msg = 'Server tidak bisa dijalankan: ' + (e && e.stack || e); console.error(msg);
      try { fs.mkdirSync(dataRoot, { recursive: true }); fs.appendFileSync(path.join(dataRoot, 'error.log'), new Date().toISOString() + ' ' + msg + '\n'); } catch {}
      dialog.showErrorBox('Zahir Insight', msg); app.exit(1); return; }
    createTray(); dbg('tray ok'); createWindow(); dbg('window created');
  });
}
