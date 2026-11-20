// Clipboard history with pin, delete and clear-all.
// Only pinned items are saved to disk (when the user pins them on purpose); everything else stays in memory.
const fs = require('fs');

class ClipStore {
  constructor(file) {
    this.file = file || null;
    this.items = [];          // { id, text, pinned }
    this.seq = 1;
    this.load();
  }
  load() {
    if (!this.file) return;
    try {
      const j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(j)) j.forEach(t => { if (typeof t === 'string' && t) this.items.push({ id: this.seq++, text: t.slice(0, 300), pinned: true }); });
    } catch (e) { /* no saved pins yet */ }
  }
  save() {
    if (!this.file) return;
    try { fs.writeFileSync(this.file, JSON.stringify(this.items.filter(i => i.pinned).map(i => i.text))); } catch (e) {}
  }
  add(text) {
    const i = this.items.findIndex(x => x.text === text);
    const it = i >= 0 ? this.items.splice(i, 1)[0] : { id: this.seq++, text, pinned: false };
    this.items.unshift(it);
    let unpinned = 0;
    this.items = this.items.filter(x => x.pinned || ++unpinned <= 20);
    return it;
  }
  find(id) { return this.items.find(x => x.id === id); }
  del(id) { this.items = this.items.filter(x => x.id !== id); this.save(); }
  pin(id) { const it = this.find(id); if (it) { it.pinned = !it.pinned; this.save(); } }
  clear() { this.items = this.items.filter(x => x.pinned); }      // like Windows: pinned items stay
  list() {
    const pinned = this.items.filter(i => i.pinned), rest = this.items.filter(i => !i.pinned);
    return [...pinned, ...rest].map(({ id, text, pinned }) => ({ id, text, pinned }));
  }
}
module.exports = ClipStore;
