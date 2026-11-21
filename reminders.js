// Scheduled reminders, saved in the app's data folder so they survive a restart.
const fs = require('fs');
class Reminders {
  constructor(file) { this.file = file || null; this.items = []; this.fired = new Set(); this.load(); }   // fired: sent to the screen, waiting for it to confirm
  load() {
    if (!this.file) return;
    try {
      const j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(j)) this.items = j.filter(r => r && typeof r.id === 'string' && typeof r.text === 'string' && Number.isFinite(r.at));
    } catch (e) {}
  }
  save() { if (this.file) try { fs.writeFileSync(this.file, JSON.stringify(this.items)); } catch (e) {} }
  list() { return this.items.filter(r => !this.fired.has(r.id)).sort((a, b) => a.at - b.at); }
  add(text, at) {
    text = String(text || '').trim().slice(0, 140); at = Number(at);
    if (!text || !Number.isFinite(at) || this.items.length >= 100) return null;
    const r = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, at: Math.round(at) };
    this.items.push(r); this.save(); return r;
  }
  del(id) { this.items = this.items.filter(r => r.id !== id); this.fired.delete(id); this.save(); return this.list(); }
  hasDue(now) { return this.items.some(r => r.at <= now && !this.fired.has(r.id)); }
  // due reminders are handed out once per session but stay saved until the screen confirms (del), so a crash or restart cannot lose one
  due(now) { const d = this.items.filter(r => r.at <= now && !this.fired.has(r.id)).sort((a, b) => a.at - b.at); d.forEach(r => this.fired.add(r.id)); return d; }
}
module.exports = Reminders;
