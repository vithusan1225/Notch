// Installed apps (Start Menu shortcuts) and the user's saved app shortcuts.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

function walk(dir, depth, out) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth > 0) walk(p, depth - 1, out); }
    else if (/\.lnk$/i.test(e.name)) out.push(p);
  }
}

const SKIP = /(uninstall|readme|release notes|help|documentation|license|manual|website|support|what.?s new)/i;

function scanStartMenu(roots) {
  roots = roots || [
    path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  ];
  const files = [];
  roots.forEach(r => walk(r, 3, files));
  const seen = new Map();
  for (const f of files) {
    const name = path.basename(f, '.lnk');
    if (SKIP.test(name)) continue;
    const key = name.toLowerCase();
    if (!seen.has(key)) seen.set(key, { name, path: f });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

// Store (UWP) apps such as WhatsApp have no Start Menu shortcut file, so they come from PowerShell (apps.ps1).
const UWP = /^shell:AppsFolder\\[A-Za-z0-9._!\-]+$/;
function scanStoreApps() {
  return new Promise(resolve => {
    if (process.platform !== 'win32') return resolve([]);
    try {
      execFile('powershell.exe', ['-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'apps.ps1')],
        { windowsHide: true, timeout: 40000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }, (err, out) => {
          try {
            const list = JSON.parse(String(out || '').trim().split('\n').pop() || '[]');
            resolve((Array.isArray(list) ? list : []).filter(x => x && x.name && typeof x.id === 'string')
              .map(x => ({ name: String(x.name), path: 'shell:AppsFolder\\' + x.id, icon: typeof x.logo === 'string' && /\.png$/i.test(x.logo) ? x.logo : '' }))
              .filter(x => UWP.test(x.path)));
          } catch (e) { resolve([]); }
        });
    } catch (e) { resolve([]); }
  });
}
function mergeApps(a, b) {
  const seen = new Map();
  [...a, ...b].forEach(x => { const k = x.name.toLowerCase(); if (!seen.has(k)) seen.set(k, x); });
  return [...seen.values()].sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: 'base' }));
}

class AppStore {
  constructor(file) { this.file = file || null; this.items = []; this.load(); }
  load() {
    if (!this.file) return;
    try {
      const j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(j)) this.items = j.filter(a => a && typeof a.path === 'string' && typeof a.name === 'string');
    } catch (e) {}
  }
  save() { if (this.file) try { fs.writeFileSync(this.file, JSON.stringify(this.items)); } catch (e) {} }
  has(p) { return this.items.some(a => a.path.toLowerCase() === String(p).toLowerCase()); }
  add(app) { if (!this.has(app.path)) { const it = { name: app.name, path: app.path }; if (app.icon) it.icon = app.icon; this.items.push(it); this.save(); } return this.items; }
  remove(p) { this.items = this.items.filter(a => a.path !== p); this.save(); return this.items; }
  list() { return this.items.slice(); }
}
module.exports = { scanStartMenu, scanStoreApps, mergeApps, UWP, AppStore };
