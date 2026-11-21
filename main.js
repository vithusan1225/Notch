const { app, BrowserWindow, Tray, Menu, screen, ipcMain, clipboard, globalShortcut, nativeImage, dialog, shell } = require('electron');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const privacyLib = require('./privacy');
const ClipStore = require('./clipstore');
const Apps = require('./apps');
const Reminders = require('./reminders');

if (!app.requestSingleInstanceLock()) app.quit();

// The window is only as big as the notch while it is closed (so files can be dropped on it),
// and grows while it is open.
// The window never changes size or position any more (resizing a transparent window flashed old pixels for a moment).
// Instead it is always the open size, and while the notch is closed or showing a toast it ignores the mouse everywhere
// except on the pill itself, so the empty area around the notch does not block the apps behind it.
const SIZE = { open: { w: 560, h: 310 } };
const PILL = { rest: { w: 200, h: 34 }, toast: { w: 330, h: 50 }, alert: { w: 350, h: 86 } };
let win, tray, mode = 'rest';             // window size: rest | toast | open
let reminders;
let scale = 0.9;                     // size of the whole notch (1 = the original size); change it from the tray menu, Size
let onTop = true;                    // the pin: keep the notch above every other window
let last = '';
let clips, appStore;
const picked = new Set();            // files the user put on the shelf
const sysState = {};
let media = { none: true };
let privacy = { mic: [], cam: [], loc: [] }, privacyJson = '';
let installedCache = null, installedAt = 0;
const iconCache = new Map();
let quitting = false;
let sysPs = null, mediaPs = null, netPs = null;

const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };

/* ---------- window ---------- */
let ignoring = null;
function updateIgnore(p) {
  if (!win || win.isDestroyed()) return;
  let want = false;                                         // open / reminder screen: the whole window takes the mouse
  const pill = PILL[mode];
  if (pill) {
    const b = win.getBounds(), cx = b.x + b.width / 2, c = p || screen.getCursorScreenPoint();
    const pw = pill.w * scale, ph = pill.h * scale;
    const over = c.x >= cx - pw / 2 - 14 && c.x <= cx + pw / 2 + 14 && c.y >= b.y && c.y <= b.y + ph + 8;
    want = !over;                                           // closed: click-through, except right on the pill (so files can still be dropped on it)
  }
  if (want === ignoring) return;
  ignoring = want;
  try { win.setIgnoreMouseEvents(want, { forward: true }); } catch (e) {}
}
function place() {
  const d = screen.getPrimaryDisplay(), s = SIZE.open;
  win.setBounds({ x: Math.round(d.bounds.x + (d.bounds.width - s.w) / 2), y: d.bounds.y, width: s.w, height: s.h });
}
function keepOnTop() {
  if (!win || win.isDestroyed() || !win.isVisible() || !onTop) return;
  win.setAlwaysOnTop(true, 'screen-saver');
  win.moveTop();
}
function toggle() { if (win.isVisible()) win.hide(); else { win.showInactive(); keepOnTop(); } }
function buildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show or hide the notch', click: toggle },
    { label: 'Always on top', type: 'checkbox', checked: onTop, click: i => applyOnTop(i.checked, true) },
    { label: 'Start with Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: i => app.setLoginItemSettings({ openAtLogin: i.checked }) },
    { label: 'Size', submenu: [
      { label: 'Small', type: 'radio', checked: scale === 0.8, click: () => applyScale(0.8) },
      { label: 'Medium', type: 'radio', checked: scale === 0.9, click: () => applyScale(0.9) },
      { label: 'Normal', type: 'radio', checked: scale === 1, click: () => applyScale(1) }
    ] },
    { label: 'Test notifications', submenu: [
      { label: 'Charger connected', click: () => send('note-test', 'charging') },
      { label: 'Battery full', click: () => send('note-test', 'full') },
      { label: 'Charger removed', click: () => send('note-test', 'unplugged') },
      { label: 'Low battery (20%)', click: () => send('note-test', 'low') },
      { label: 'Very low battery (10%)', click: () => send('note-test', 'verylow') },
      { label: 'Critical battery (5%)', click: () => send('note-test', 'critical') },
      { label: 'Reminder', click: () => send('note-test', 'reminder') }
    ] },
    { type: 'separator' },
    { label: 'Quit Islet', click: () => app.quit() }
  ]));
}
function applyScale(s) {
  scale = s;
  if (win && !win.isDestroyed()) win.webContents.setZoomFactor(scale);
  try { fs.writeFileSync(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify({ onTop, scale })); } catch (e) {}
  ignoring = null; updateIgnore(); buildTrayMenu();
}
function applyOnTop(on, fromTray) {
  onTop = !!on;
  if (win && !win.isDestroyed()) {
    if (onTop) { win.setAlwaysOnTop(true, 'screen-saver'); win.moveTop(); } else win.setAlwaysOnTop(false);
  }
  try { fs.writeFileSync(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify({ onTop, scale })); } catch (e) {}
  if (fromTray) send('ontop', onTop);
  buildTrayMenu();
}
function createWindow() {
  win = new BrowserWindow({
    width: SIZE.open.w, height: SIZE.open.h,
    frame: false, transparent: true, resizable: false, movable: false,
    hasShadow: false, skipTaskbar: true, alwaysOnTop: onTop,
    focusable: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.setAlwaysOnTop(onTop, 'screen-saver');
  place();
  win.loadFile('index.html');
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(scale));
  win.once('ready-to-show', () => win.showInactive());
  screen.on('display-metrics-changed', place);
  setInterval(keepOnTop, 1500);
  // Chromium does not always send mouseleave (the window is not focusable and it resizes under the cursor),
  // so the real cursor position is sent to the page, which decides whether the cursor is still on the notch.
  setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    const p = screen.getCursorScreenPoint(), b = win.getBounds();
    send('cursor', { x: (p.x - b.x) / scale, y: (p.y - b.y) / scale });      // in the page's own (zoomed) units
    updateIgnore(p);
  }, 80);       // stay above full-screen windows, the taskbar and the Start menu (only while the pin is on)
}

/* ---------- PowerShell helpers (Windows only) ---------- */
function startHelper(script, onLine, onExit) {
  if (process.platform !== 'win32') return null;
  try {
    const p = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, script)], { windowsHide: true });
    let buf = '';
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) onLine(line); }
    });
    p.on('error', () => {});
    p.on('exit', () => { if (onExit) onExit(); });
    return p;
  } catch (e) { return null; }
}
// a helper that stops by accident is started again (a few times)
function runHelper(script, onLine, assign, tries = 0) {
  const p = startHelper(script, onLine, () => {
    if (!quitting && tries < 5) setTimeout(() => runHelper(script, onLine, assign, tries + 1), 1500);
  });
  assign(p);
  return p;
}
const write = (p, line) => { try { if (p && p.stdin.writable) p.stdin.write(line + '\n'); } catch (e) {} };

const SYS_KEYS = ['vol', 'bri', 'mic', 'wifi', 'bt', 'air', 'dark', 'night'];
function onSysLine(l) {
  const sp = l.indexOf(' '), k = sp < 0 ? l : l.slice(0, sp), v = sp < 0 ? '' : l.slice(sp + 1);
  if (k === 'err') sysState['err_' + v] = true;
  else if (SYS_KEYS.includes(k)) { sysState[k] = Number(v); delete sysState['err_' + k]; }
  send('sys', sysState);
}
let artKey = '', artData = '';
function onMediaLine(l) {
  try {
    const m = JSON.parse(l);
    if (m.none) { media = m; }
    else {
      if (m.key !== artKey) { artKey = m.key; artData = ''; }
      if (m.art) artData = m.art;
      media = Object.assign({}, m, { art: artData });
    }
    send('media', m);          // the cover is only sent when it changes; the notch keeps the last one for the same track
  } catch (e) {}
}
function onNetLine(l) {
  const sp = l.indexOf(' '), k = l.slice(0, sp);
  try { send('net', { k, v: JSON.parse(l.slice(sp + 1)) }); } catch (e) {}
}
function ensureNet() { if (!netPs) runHelper('net.ps1', onNetLine, p => { netPs = p; }); }

/* ---------- icons ---------- */
async function iconFor(p) {
  if (!p) return '';
  if (iconCache.has(p)) return iconCache.get(p);
  let url = '';
  try {
    let target = p;
    if (/\.lnk$/i.test(p)) { try { const t = shell.readShortcutLink(p).target; if (t && fs.existsSync(t)) target = t; } catch (e) {} }
    const img = await app.getFileIcon(target, { size: 'large' });
    url = img.isEmpty() ? '' : img.toDataURL();
  } catch (e) {}
  iconCache.set(p, url);
  return url;
}

/* ---------- app start ---------- */
app.whenReady().then(() => {
  const dataDir = app.getPath('userData');
  try { const s = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8')); if (typeof s.onTop === 'boolean') onTop = s.onTop; if (typeof s.scale === 'number' && s.scale >= 0.7 && s.scale <= 1.2) scale = s.scale; } catch (e) {}
  clips = new ClipStore(path.join(dataDir, 'pinned-clips.json'));
  appStore = new Apps.AppStore(path.join(dataDir, 'apps.json'));
  reminders = new Reminders(path.join(dataDir, 'reminders.json'));

  createWindow();

  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png')));
  tray.setToolTip('Islet');
  tray.on('click', toggle);
  buildTrayMenu();
  globalShortcut.register('Control+Alt+N', toggle);

  runHelper('system.ps1', onSysLine, p => { sysPs = p; write(p, 'get'); });
  runHelper('media.ps1', onMediaLine, p => { mediaPs = p; });

  if (process.platform === 'win32') {
    let busy = false;
    setInterval(async () => {
      if (busy) return; busy = true;
      try {
        const next = await privacyLib.readAll();
        const j = JSON.stringify(next);
        if (j !== privacyJson) { privacyJson = j; privacy = next; send('privacy', next); }
      } catch (e) {}
      busy = false;
    }, 1500);
  }

  // scheduled reminders: when one is due the notch opens its notification screen (it is shown again if it was hidden)
  setInterval(() => {
    if (!win || win.isDestroyed() || win.webContents.isLoading() || !reminders || !reminders.hasDue(Date.now())) return;
    const hidden = !win.isVisible();
    if (hidden) { win.showInactive(); keepOnTop(); }
    reminders.due(Date.now()).forEach(r => send('reminder', { id: r.id, text: r.text, at: r.at, wasHidden: hidden }));
  }, 1000);

  // clipboard history (clipboard.readText() can return text or a Promise depending on the Electron version)
  let polling = false;
  setInterval(async () => {
    if (polling) return; polling = true;
    try {
      const t = String((await clipboard.readText()) || '').trim().slice(0, 300);
      if (t && t !== last) { last = t; clips.add(t); send('clips', clips.list()); }
    } catch (e) {}
    polling = false;
  }, 700);
});

/* ---------- window ---------- */
ipcMain.handle('size', (_, m) => { mode = m === true ? 'open' : (m === 'toast' || m === 'alert') ? m : 'rest'; updateIgnore(); return true; });
ipcMain.handle('focusable', (_, on) => { win.setFocusable(!!on); if (on) win.focus(); return true; });
ipcMain.on('hide', () => win.hide());
ipcMain.handle('ontop-get', () => onTop);
ipcMain.on('ontop-set', (_, on) => applyOnTop(on, false));
ipcMain.on('dbg', (_, t) => { try { fs.appendFileSync(path.join(os.tmpdir(), 'islet-hover.log'), new Date().toISOString() + ' ' + String(t).slice(0, 300) + '\n'); } catch (e) {} });
ipcMain.handle('uptime', () => os.uptime());

/* ---------- clipboard ---------- */
ipcMain.handle('clips', () => clips.list());
ipcMain.on('clip-copy', async (_, id) => { const it = clips.find(id); if (it) { last = it.text; try { await clipboard.writeText(it.text); } catch (e) {} } });
ipcMain.on('clip-del', (_, id) => { clips.del(id); send('clips', clips.list()); });
ipcMain.on('clip-pin', (_, id) => { clips.pin(id); send('clips', clips.list()); });
ipcMain.on('clip-clear', () => { clips.clear(); send('clips', clips.list()); });


/* ---------- PC stats for the Widgets tab (only sampled while that tab is on screen) ---------- */
let statsTimer = null, statsLast = null, prevCpu = null, prevNet = null;
function cpuTimes() {
  return os.cpus().reduce((a, c) => { const t = c.times; a.idle += t.idle; a.total += t.user + t.nice + t.sys + t.idle + t.irq; return a; }, { idle: 0, total: 0 });
}
// total bytes received/sent by every network adapter (the numbers on the "Bytes" row of `netstat -e`, whatever the language)
function readNet() {
  return new Promise(resolve => {
    if (process.platform !== 'win32') return resolve(null);
    execFile('netstat', ['-e'], { windowsHide: true, timeout: 3000 }, (err, out) => {
      if (err) return resolve(null);
      const mm = /(\d{4,})\s+(\d{4,})\s*$/m.exec(String(out));
      resolve(mm ? { rx: Number(mm[1]), tx: Number(mm[2]), t: Date.now() } : null);
    });
  });
}
const wrap32 = d => (d < 0 ? d + 4294967296 : d);          // the counters are 32-bit on some Windows versions
async function sampleStats() {
  const c = cpuTimes();
  let cpu = 0;
  if (prevCpu) { const di = c.idle - prevCpu.idle, dt = c.total - prevCpu.total; cpu = dt > 0 ? Math.max(0, Math.min(100, Math.round((1 - di / dt) * 100))) : 0; }
  prevCpu = c;
  const memTotal = os.totalmem(), memUsed = memTotal - os.freemem();
  let disk = null;
  try {
    const root = process.platform === 'win32' ? (process.env.SystemDrive || 'C:') + '\\' : '/';
    const st = await fs.promises.statfs(root);
    disk = { total: st.blocks * st.bsize, free: st.bavail * st.bsize, name: process.platform === 'win32' ? (process.env.SystemDrive || 'C:') : '/' };
  } catch (e) {}
  let rxs = null, txs = null;
  const nw = await readNet();
  if (nw && prevNet && nw.t > prevNet.t) {
    const dt = (nw.t - prevNet.t) / 1000;
    rxs = Math.max(0, wrap32(nw.rx - prevNet.rx) / dt); txs = Math.max(0, wrap32(nw.tx - prevNet.tx) / dt);
  }
  if (nw) prevNet = nw;
  statsLast = { cpu, cores: os.cpus().length, memTotal, memUsed, disk, rxs, txs, t: Date.now() };
  send('stats', statsLast);
}
ipcMain.on('stats-watch', (_, on) => {
  clearInterval(statsTimer); statsTimer = null;
  if (on) { prevCpu = null; prevNet = null; sampleStats(); setTimeout(sampleStats, 600); statsTimer = setInterval(sampleStats, 1500); }
});
ipcMain.handle('stats-get', () => statsLast);

/* ---------- media, system controls, network ---------- */
ipcMain.handle('media-state', () => media);
ipcMain.on('media', (_, cmd, val) => {
  if (['toggle', 'next', 'prev', 'shuffle', 'repeat'].includes(cmd)) write(mediaPs, cmd);
  else if (cmd === 'seek' && Number.isFinite(val)) write(mediaPs, 'seek ' + Math.max(0, Math.round(val)));
  else if (cmd === 'select' && typeof val === 'string' && val) write(mediaPs, 'select ' + val.replace(/[\r\n]/g, '').slice(0, 300));
});
ipcMain.handle('sys-state', () => sysState);
ipcMain.on('sys', (_, cmd, val) => {
  if (SYS_KEYS.includes(cmd)) write(sysPs, cmd + ' ' + Math.max(0, Math.min(100, Math.round(Number(val) || 0))));
});
ipcMain.on('net', (_, cmd, arg) => {
  if (!['wifiscan', 'wifidisc', 'wificonn', 'btscan'].includes(cmd)) return;
  ensureNet();
  if (cmd === 'wificonn') {
    if (!arg || typeof arg.ssid !== 'string' || !arg.ssid) return;
    const j = { ssid: arg.ssid.slice(0, 64), pass: String(arg.pass || '').slice(0, 64), auth: String(arg.auth || '').slice(0, 40) };
    write(netPs, 'wificonn ' + Buffer.from(JSON.stringify(j), 'utf8').toString('base64'));
  } else write(netPs, cmd);
});
ipcMain.handle('privacy-state', () => privacy);
ipcMain.handle('icon', (_, p) => {
  if (typeof p !== 'string' || !p) return '';
  if (Apps.UWP.test(p)) {                                   // Store app: its logo picture from the scan or from the saved shortcut
    const hit = (installedCache || []).concat(appStore.list()).find(a => a.path === p && a.icon);
    try { return hit && /\.png$/i.test(hit.icon) && fs.existsSync(hit.icon) ? 'data:image/png;base64,' + fs.readFileSync(hit.icon).toString('base64') : ''; } catch (e) { return ''; }
  }
  return fs.existsSync(p) ? iconFor(p) : '';
});

/* ---------- files: shelf, drop in, drag out ---------- */
function addFiles(paths) {
  const out = [];
  for (const p of paths || []) {
    try { if (typeof p === 'string' && fs.statSync(p).isFile()) { picked.add(p); out.push({ path: p, name: path.basename(p) }); } } catch (e) {}
  }
  return out;
}
ipcMain.handle('pick-files', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] });
  return r.canceled ? [] : addFiles(r.filePaths);
});
ipcMain.handle('add-files', (_, paths) => addFiles(paths));
ipcMain.on('open-file', (_, p) => { if (picked.has(p)) shell.openPath(p); });
// dragging a shelf file out onto the desktop, a folder, a chat window...: the OS gets the real file (a copy, not a move)
ipcMain.on('drag-out', async (e, p) => {
  if (!picked.has(p) || !fs.existsSync(p)) return;
  const icon = await app.getFileIcon(p, { size: 'normal' }).catch(() => null);
  try { e.sender.startDrag({ file: p, icon: icon && !icon.isEmpty() ? icon : nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png')) }); } catch (err) {}
});

/* ---------- reminders ---------- */
ipcMain.handle('rem-list', () => reminders.list());
ipcMain.handle('rem-add', (_, r) => { if (r && typeof r.text === 'string') reminders.add(r.text, r.at); return reminders.list(); });
ipcMain.handle('rem-del', (_, id) => reminders.del(String(id)));

/* ---------- applications ---------- */
ipcMain.handle('apps-list', () => appStore.list());
ipcMain.handle('apps-installed', async () => {
  if (!installedCache || Date.now() - installedAt > 60000) {
    const shortcuts = Apps.scanStartMenu();
    installedCache = shortcuts; installedAt = Date.now();      // shortcuts are usable at once; Store apps are added when the scan ends
    installedCache = Apps.mergeApps(shortcuts, await Apps.scanStoreApps()); installedAt = Date.now();
  }
  return installedCache;
});
ipcMain.handle('apps-add', (_, a) => {
  if (a && typeof a.path === 'string' && Apps.UWP.test(a.path)) {
    const hit = (installedCache || []).find(x => x.path === a.path);            // trust our own scan, not what the page sends
    if (hit) appStore.add({ name: hit.name.slice(0, 80), path: hit.path, icon: hit.icon });
  } else if (a && typeof a.path === 'string' && fs.existsSync(a.path)) appStore.add({ name: String(a.name || path.basename(a.path)).slice(0, 80), path: a.path });
  return appStore.list();
});
ipcMain.handle('apps-browse', async () => {
  const r = await dialog.showOpenDialog({
    title: 'Choose an application',
    defaultPath: process.env.ProgramFiles || undefined,
    filters: [{ name: 'Applications and shortcuts', extensions: ['exe', 'lnk'] }],
    properties: ['openFile']
  });
  if (!r.canceled && r.filePaths[0]) appStore.add({ name: path.basename(r.filePaths[0]).replace(/\.(exe|lnk)$/i, ''), path: r.filePaths[0] });
  return appStore.list();
});
ipcMain.handle('apps-remove', (_, p) => appStore.remove(p));
ipcMain.on('apps-launch', (_, p) => {
  const ok = appStore.has(p) || (installedCache || []).some(a => a.path === p);
  if (!ok) return;
  if (Apps.UWP.test(p)) { try { spawn('explorer.exe', [p], { detached: true, stdio: 'ignore' }).unref(); } catch (e) {} }
  else shell.openPath(p);
});

app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  // closing a helper's input lets it put things back (screen colours) before it exits
  [sysPs, mediaPs, netPs].forEach(p => { try { if (p) { p.stdin.end(); setTimeout(() => { try { p.kill(); } catch (e) {} }, 1500); } } catch (e) {} });
});
app.on('window-all-closed', () => app.quit());
