const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const n = $('#notch');
const fmt = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
const ic = { pause: '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>', play: '<path d="M7 4v16l13-8z"/>' };

/* ================= open / close =================
   The window is small while the notch is closed, so files can be dropped on it, and grows while it is open. */
let inside = false, winBig = false, closeT, shrinkT, holdUntil = 0;
const picking = () => !$('#picker').hidden;
const subOpen = () => !$('#sub').hidden;
const remTyping = () => n.dataset.t === 'cal' && !!document.activeElement && document.activeElement.id === 'rtext';
const hold = () => holdUntil > Date.now() || picking() || subOpen() || remTyping();
async function openNotch(tab) {
  clearTimeout(closeT); clearTimeout(shrinkT);
  if (n.dataset.s === 'toast') { clearTimeout(noteT); noteBusy = false; }       // hovering a battery toast opens the notch instead
  if (!winBig) { winBig = true; await window.islet.size(true); }
  n.dataset.s = 'open';
  if (tab) setTab(tab); else { movePill(); if (n.dataset.t === 'wid') window.islet.statsWatch(true); }
}
function closeNotch() {
  n.dataset.s = 'rest';
  window.islet.statsWatch(false);
  clearTimeout(shrinkT);
  shrinkT = setTimeout(() => { winBig = false; window.islet.size(false); }, 650);   // shrink after the closing animation
}
// opening and closing follow the real cursor position (below), not mouseenter/mouseleave: Chromium keeps a stale
// mouse position when the cursor leaves the non-focusable window and replays it as a fake mouseenter, which re-opened the notch
setInterval(() => { if (n.dataset.s === 'open' && !inside && !hold()) closeNotch(); }, 1000);
// the real cursor position (from the main process) is the truth; mouseenter/mouseleave can be missed.
// Checked on every tick (not only when the position changes), so nothing can keep the notch open once the cursor is away.
let outSince = 0, dbgAt = 0, opening = false;
window.islet.onCursor(c => {
  const r = n.getBoundingClientRect(), m = 6;
  inside = c.x >= r.left - m && c.x <= r.right + m && c.y >= r.top - m && c.y <= r.bottom + m;
  if (n.dataset.s === 'alert') { alertPaused = inside; return; }       // the reminder screen stays; hovering it pauses its countdown
  if (inside && n.dataset.s !== 'open' && !opening) { opening = true; openNotch().finally(() => { opening = false; }); }
  if (n.dataset.s !== 'open' || inside) { outSince = 0; return; }
  if (!outSince) outSince = Date.now();
  if (hold()) {                                           // why it is being kept open (written to %TEMP%\islet-hover.log)
    if (Date.now() - outSince > 5000 && Date.now() - dbgAt > 5000) {
      dbgAt = Date.now();
      window.islet.log('kept open: holdUntil=' + Math.max(0, holdUntil - Date.now()) + 'ms picker=' + picking() + ' sub=' + subOpen());
    }
    return;
  }
  if (Date.now() - outSince > 350) { outSince = 0; closeNotch(); }
});
$('#hide').onclick = () => window.islet.hide();

/* pin: when on, the notch stays above every other window; when off it behaves like a normal window */
let onTop = true;
function paintPin() {
  $('#pin').setAttribute('aria-pressed', onTop);
  const t = onTop ? 'Always on top: on (click to turn off)' : 'Always on top: off (click to turn on)';
  $('#pin').title = t; $('#pin').setAttribute('aria-label', t);
}
$('#pin').onclick = () => { onTop = !onTop; paintPin(); window.islet.setOnTop(onTop); };
window.islet.getOnTop().then(v => { onTop = v; paintPin(); });
window.islet.onOnTop(v => { onTop = v; paintPin(); });
paintPin();

/* ================= tabs ================= */
let tabswT;
function setTab(k) {
  { const order = $$('.tabs button').map(b => b.dataset.tab), prev = n.dataset.t, nx = document.querySelector('.pane[data-pane="' + k + '"]');
    if (nx) nx.style.setProperty('--dir', prev && prev !== k ? Math.sign(order.indexOf(k) - order.indexOf(prev)) : 0); }   // the new tab slides in from the side it sits on
  if (k !== 'cal' && remTyping()) { document.activeElement.blur(); window.islet.focusable(false); }
  $$('.tabs button').forEach(x => x.setAttribute('aria-selected', x.dataset.tab === k));
  $$('.pane').forEach(p => p.hidden = p.dataset.pane !== k);
  movePill();
  const cur = document.querySelector('.pane[data-pane="' + k + '"]');
  if (cur) { cur.classList.remove('enter'); void cur.offsetWidth; cur.classList.add('enter'); clearTimeout(cur._enT); cur._enT = setTimeout(() => cur.classList.remove('enter'), 1000); }   // its content rises in, item by item
  n.classList.add('tabsw'); clearTimeout(tabswT); tabswT = setTimeout(() => n.classList.remove('tabsw'), 380);
  n.dataset.t = k;
  fitNotch();
  if (k === 'apps') loadApps();
  if (k === 'wid') { widgets(); window.islet.getStats().then(onStats); }
  if (k === 'cal') openCal();
  window.islet.statsWatch(k === 'wid');                                      // CPU / memory / network are only measured while Widgets is showing
}
$$('.tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
// the highlight pill glides from tab to tab
function movePill() {
  const b = document.querySelector('.tabs button[aria-selected="true"]'), p = $('#tabpill');
  if (!b || !b.offsetWidth) return;
  p.style.width = b.offsetWidth + 'px'; p.style.transform = 'translateX(' + b.offsetLeft + 'px)';
}
movePill(); requestAnimationFrame(() => { movePill(); requestAnimationFrame(() => $('#tabpill').classList.add('go')); });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(movePill);
addEventListener('resize', movePill);

/* Controls and Files get exactly the height of their content (no empty strip at the bottom).
   Every other tab keeps the Media height, and scrolls when it has more than fits. */
function fitNotch() {
  const tab = n.dataset.t;
  if (tab !== 'ctrl' && tab !== 'files' && tab !== 'cal' && tab !== 'wid') { n.style.removeProperty('--oh'); return; }
  const pane = document.querySelector('.pane[data-pane="' + tab + '"]');
  if (!pane || pane.hidden) return;
  let bottom = 0;
  [...pane.children].forEach(c => {
    const cs = getComputedStyle(c);
    if (cs.position === 'absolute' || cs.display === 'none') return;                     // overlays (Wi-Fi list) do not count
    bottom = Math.max(bottom, c.offsetTop + c.offsetHeight);
  });
  const need = pane.offsetTop + bottom + (tab === 'ctrl' ? 18 : tab === 'cal' || tab === 'wid' ? 14 : 10);                      // room under the content (Controls gets more, its tiles sit near the rounded corners)
  n.style.setProperty('--oh', Math.round(Math.min(Math.max(need, 150), tab === 'files' ? 214 : tab === 'cal' ? 270 : tab === 'wid' ? 260 : 230)) + 'px');
}
let fitRaf = 0;
new MutationObserver(() => { cancelAnimationFrame(fitRaf); fitRaf = requestAnimationFrame(fitNotch); })
  .observe(document.querySelector('.Lo'), { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'style'], characterData: true });

/* ================= closed notch: time, battery, privacy dots ================= */
function clockTick() {
  const d = new Date();
  const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  $('#rt').textContent = t; $('#clk').textContent = t;
  $('#dt').textContent = d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  $('#wmon').textContent = d.toLocaleDateString([], { month: 'short' }).toUpperCase();
  $('#wday').textContent = d.getDate();
  $('#wwk').textContent = d.toLocaleDateString([], { weekday: 'long' });
}
setInterval(() => {                                                      // the thin bar under the time fills once a minute
  const f = $('#secf'), s = new Date().getSeconds();
  if (s === 0) { f.style.transition = 'none'; f.style.width = '0%'; void f.offsetWidth; }
  f.style.transition = 'width 1s linear'; f.style.width = ((s + 1) / 60 * 100) + '%';
}, 1000);
$('#wdate').onclick = () => setTab('cal');
clockTick(); setInterval(clockTick, 5000);
let batNow = { charging: false, pct: 100 };
const spanOf = sec => {                                  // 7500 s -> "2 h 5 min"; unknown (Infinity / 0) -> ''
  if (!Number.isFinite(sec) || sec <= 0) return '';
  const m = Math.round(sec / 60), h = Math.floor(m / 60);
  return h ? h + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : Math.max(1, m) + ' min';
};
const LOW_STEPS = [[20, 'low'], [10, 'verylow'], [5, 'critical']];   // announced once each while discharging
if (navigator.getBattery) navigator.getBattery().then(b => {
  const show = () => {
    const pct = Math.round(b.level * 100);
    batNow = { charging: b.charging, pct };
    $('#rb').textContent = pct + '%'; $('#bat').textContent = pct + '%';
    $('#bst').textContent = b.charging ? 'Charging' : (spanOf(b.dischargingTime) ? spanOf(b.dischargingTime) + ' left' : 'On battery');
    setRing('bat', pct, 101);
    { const card = document.querySelector('[data-w="bat"]'), c = b.charging ? ['#34d399', '#a3e635'] : pct <= 10 ? ['#ff453a', '#ff2d78'] : pct <= 20 ? ['#fbbf24', '#f59e0b'] : ['#34d399', '#22d3ee'];
      card.style.setProperty('--wc', c[0]); card.style.setProperty('--wc2', c[1]); }
    $('#bfill').setAttribute('width', String(Math.max(1, 12 * b.level)));
    $('#bfill').style.color = b.charging ? '#30d158' : (pct <= 10 ? '#ff453a' : pct <= 20 ? '#fbbf24' : '');
    document.documentElement.dataset.bat = !b.charging && pct <= 10 ? 'verylow' : '';
  };
  show();
  let wasCharging = b.charging, fullShown = b.charging && b.level >= 0.995;       // nothing is announced for the state the app starts in
  const said = new Set(); LOW_STEPS.forEach(([t]) => { if (Math.round(b.level * 100) <= t) said.add(t); });
  const watchLow = () => {
    const pct = Math.round(b.level * 100);
    if (b.charging) { said.clear(); return; }
    LOW_STEPS.forEach(([t]) => { if (pct > t + 3) said.delete(t); });             // charged back up a little: it can warn again next time
    const hit = LOW_STEPS.filter(([t]) => pct <= t && !said.has(t));
    if (!hit.length) return;
    hit.forEach(([t]) => said.add(t));                                            // a jump from 22% to 9% announces only the worst one
    const [t, kind] = hit[hit.length - 1];
    pushNote({ kind, pct, left: b.dischargingTime });
  };
  b.addEventListener('chargingchange', () => {
    show();
    const pct = Math.round(b.level * 100);
    if (b.charging && !wasCharging) {
      said.clear();
      if (b.level >= 0.995) { fullShown = true; pushNote({ kind: 'full', pct }); } else pushNote({ kind: 'charging', pct, left: b.chargingTime });
    } else if (!b.charging && wasCharging) {
      if (b.level >= 0.995 && !fullShown) { fullShown = true; pushNote({ kind: 'full', pct }); }   // some laptops stop "charging" at 100%
      else if (fullShown || b.level < 0.995) pushNote({ kind: 'unplugged', pct, left: b.dischargingTime });
      watchLow();
    }
    if (!b.charging && b.level < 0.995) fullShown = false;
    wasCharging = b.charging;
  });
  b.addEventListener('levelchange', () => {
    show();
    if (b.charging && b.level >= 0.995 && !fullShown) { fullShown = true; pushNote({ kind: 'full', pct: 100 }); }
    if (b.level < 0.97) fullShown = false;
    watchLow();
  });
}); else { $('#rb').textContent = ''; $('#bat').textContent = 'n/a'; $('#bst').textContent = 'No battery'; }
const kinds = { mic: 'Microphone', cam: 'Camera', loc: 'Location' };
function applyPrivacy(p) {
  if (!p) return;
  Object.keys(kinds).forEach(k => $('#pd-' + k).classList.toggle('on', !!(p[k] && p[k].length)));
}
window.islet.getPrivacy().then(applyPrivacy); window.islet.onPrivacy(applyPrivacy);

/* ================= widgets ================= */
/* ===== PC widgets ===== */
function setRing(key, pct, hotAt) {
  const ring = document.getElementById('r-' + key); if (!ring) return;
  ring.style.strokeDasharray = Math.max(0.01, Math.min(100, pct)) + ' 100';
  const card = document.querySelector('[data-w="' + key + '"]'); if (card && hotAt) card.classList.toggle('hot', pct >= hotAt);
}
function countTo(el, to, fmt) {                                   // numbers roll to their new value instead of jumping
  const from = el._v == null ? 0 : el._v; el._v = to; cancelAnimationFrame(el._raf);
  if (Math.abs(to - from) < 0.5) { el.textContent = fmt(to); return; }
  const t0 = performance.now(), dur = 650;
  const step = now => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(from + (to - from) * e); if (k < 1) el._raf = requestAnimationFrame(step); };
  el._raf = requestAnimationFrame(step);
}
const rate = v => v == null ? '--' : v >= 1048576 ? (v / 1048576).toFixed(1) + ' MB/s' : v >= 1024 ? Math.round(v / 1024) + ' KB/s' : Math.round(v) + ' B/s';
const GB = 1073741824, netHist = [];
function onStats(s) {
  if (!s) return;
  countTo($('#cpuV'), s.cpu, v => Math.round(v) + '%'); setRing('cpu', s.cpu, 85); $('#cpuS').textContent = s.cores + (s.cores === 1 ? ' core' : ' cores');
  const mp = s.memTotal ? s.memUsed / s.memTotal * 100 : 0;
  countTo($('#memV'), mp, v => Math.round(v) + '%'); setRing('mem', mp, 88); $('#memS').textContent = (s.memUsed / GB).toFixed(1) + ' / ' + Math.round(s.memTotal / GB) + ' GB';
  if (s.disk && s.disk.total) {
    const dp = (s.disk.total - s.disk.free) / s.disk.total * 100;
    countTo($('#diskV'), dp, v => Math.round(v) + '%'); setRing('disk', dp, 92); $('#diskS').textContent = s.disk.name + ' ' + Math.round(s.disk.free / GB) + ' GB free';
  } else { $('#diskV').textContent = '--'; $('#diskS').textContent = 'No disk info'; }
  $('#netD').textContent = rate(s.rxs); $('#netU').textContent = rate(s.txs);
  if (s.rxs != null) {
    netHist.push(s.rxs); if (netHist.length > 24) netHist.shift();
    const max = Math.max(1024, ...netHist), step = 96 / 23, off = 24 - netHist.length;
    $('#sparkD').setAttribute('points', netHist.map((v, i) => ((off + i) * step).toFixed(1) + ',' + (15 - v / max * 14).toFixed(1)).join(' '));
  }
}
window.islet.onStats(onStats);

function widgets() {
  window.islet.uptime().then(s => {
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), d = Math.floor(h / 24);
    $('#up').textContent = d ? d + 'd ' + (h % 24) + 'h' : h ? h + 'h ' + m + 'm' : m + 'm';
  });
}
widgets(); setInterval(widgets, 30000);

/* ================= media ================= */
let media = null, artKey = '', iconFor = '';
let base = { pos: 0, at: 0, playing: false }, guardUntil = 0, drag = null;
const dur = () => media && media.dur > 0 && media.dur < 86400 ? media.dur : 0;
const rebase = (pos, playing) => { base = { pos, at: Date.now(), playing }; };
function localPos() {
  if (!media) return 0;
  const p = base.pos + (base.playing ? (Date.now() - base.at) / 1000 : 0);
  return dur() ? Math.min(p, dur()) : p;
}
let hasArt = false, iconUrl = '';
function paintCover() {
  const c = $('.cover');
  c.classList.toggle('has-art', hasArt);
  c.classList.toggle('big-icon', !hasArt && !!iconUrl);
}
const setArt = url => { if (url) { const c = $('.cover'); c.classList.remove('swapart'); void c.offsetWidth; c.classList.add('swapart'); } hasArt = !!url; $('#art').style.backgroundImage = url ? 'url("' + url + '")' : ''; paintCover(); };
async function setIcon(exe) {                       // the source app's icon, and nothing else, in the corner of the banner
  if (exe === iconFor) return;
  iconFor = exe;
  const url = exe ? await window.islet.icon(exe) : '';
  if (iconFor === exe) { iconUrl = url || ''; $('#appicon').hidden = !url; $('#bigicon').hidden = !url; if (url) { $('#appicon').src = url; $('#bigicon').src = url; } paintCover(); }
}
function paintMedia() {
  const has = !!media, playing = has && base.playing;
  $('#mt').textContent = has ? (media.title || 'Unknown title') : 'Nothing playing';
  $('#ma').textContent = has ? (media.artist || (playing ? 'Playing' : 'Paused')) : 'Play something on your PC';
  ['#prev', '#play', '#next'].forEach(id => $(id).disabled = !has);
  if (has) { $('#prev').disabled = media.canPrev === false; $('#next').disabled = media.canNext === false; }   // a video in a browser has no next/previous: grey them out instead of pressing a key that would reach another app
  const sh = has && media.shuffle === true, rp = has ? (media.repeat || 'None') : 'None';
  $('#shuf').disabled = !has || !media.canShuffle; $('#shuf').classList.toggle('on', sh); $('#shuf').setAttribute('aria-pressed', sh);
  $('#rep').disabled = !has || !media.canRepeat; $('#rep').classList.toggle('on', rp !== 'None'); $('#rep').setAttribute('aria-pressed', rp !== 'None');
  $('#rep1').style.display = rp === 'Track' ? '' : 'none';
  $('#shuf').title = sh ? 'Shuffle: on' : 'Shuffle: off';
  $('#rep').title = rp === 'Track' ? 'Repeat: this song' : rp === 'List' ? 'Repeat: all' : 'Repeat: off';
  $('#pi').innerHTML = playing ? ic.pause : ic.play;
  $('#play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  $('#art').classList.toggle('idle', !playing);
  $('#mini').classList.toggle('on', playing);
  $('#w1').classList.toggle('paused', !playing);
  $('#seek').classList.toggle('off', !canSeek());
  $('#seek').classList.toggle('live', has && !dur() && playing);
  tickProgress();
}
function tickProgress() {
  const has = !!media, d = dur(), p = drag ? drag.frac * d : localPos();
  $('#tn').textContent = fmt(has ? p : 0);
  $('#td').textContent = has ? (d ? fmt(d) : 'Live') : fmt(0);
  const pct = d ? Math.min(100, p / d * 100) : 0;
  $('#pb').style.width = pct + '%'; $('#knob').style.left = pct + '%';
}
/* switch source: shown only when two or more apps have media open; the chosen one plays, the others are paused */
const swIcons = new Map();
let swSig = '';
const APP_NAMES = { msedge: 'Edge', edge: 'Edge', chrome: 'Chrome', brave: 'Brave', firefox: 'Firefox', opera: 'Opera', vivaldi: 'Vivaldi', spotify: 'Spotify', vlc: 'VLC', zunemusic: 'Media Player', zunevideo: 'Movies & TV', 'microsoft.media.player': 'Media Player', potplayermini64: 'PotPlayer', potplayermini: 'PotPlayer', wmplayer: 'Windows Media Player' };
const appName = x => {
  if ((x.id || '').startsWith('win:') && x.artist) return x.artist;
  const raw = (x.exe || x.id || '').split(/[\\/!]/).pop().replace(/\.exe$/i, '').replace(/_.*$/, '');
  const k = raw.toLowerCase(), last = raw.split('.').pop().toLowerCase();
  if (APP_NAMES[k]) return APP_NAMES[k];
  if (APP_NAMES[last]) return APP_NAMES[last];
  return last ? last.charAt(0).toUpperCase() + last.slice(1) : 'App';
};
function swIcon(exe, img) {
  if (!exe) return;
  if (swIcons.has(exe)) { if (swIcons.get(exe)) img.src = swIcons.get(exe); return; }
  window.islet.icon(exe).then(u => { swIcons.set(exe, u || ''); if (u) img.src = u; });
}
function paintSessions() {
  const list = media && media.sessions && media.sessions.length > 1 ? media.sessions : [];
  $('#sw').hidden = !list.length; $('#mright').classList.toggle('multi', !!list.length);
  if (!list.length) { $('#swlist').hidden = true; swSig = ''; return; }
  const sig = JSON.stringify(list.map(x => [x.id, x.title, x.playing])) + media.sid;
  if (sig === swSig) return;
  swSig = sig;
  const box = $('#swlist'); box.textContent = '';
  list.forEach(x => {
    const b = document.createElement('button'); b.className = 'swrow'; b.setAttribute('aria-current', x.id === media.sid);
    const img = document.createElement('img'); img.alt = ''; swIcon(x.exe, img);
    const t = document.createElement('span'); t.className = 'st';
    const bt = document.createElement('b'); bt.textContent = x.title || appName(x);
    const sm = document.createElement('small'); sm.textContent = appName(x) + (x.artist && !(x.id || '').startsWith('win:') ? ' \u00b7 ' + x.artist : '');
    t.append(bt, sm); b.append(img, t);
    if (x.playing) { const d = document.createElement('i'); d.className = 'pd'; b.appendChild(d); }
    b.onclick = e => { e.stopPropagation(); window.islet.media('select', x.id); box.hidden = true; };
    box.appendChild(b);
  });
}
$('#sw').onclick = e => { e.stopPropagation(); const box = $('#swlist'); box.hidden = !box.hidden; if (!box.hidden) swSig = ''; paintSessions(); };
function setMedia(m) {
  const prevKey = media && media.key;
  media = m && !m.none ? m : null;
  if (!media) { base.playing = false; artKey = ''; setArt(''); paintMedia(); setIcon(''); paintSessions(); return; }
  if (media.key !== artKey) { artKey = media.key; setArt(''); }
  if (media.art) setArt(media.art);
  // we keep our own running clock and only jump when the track changed, the user seeked, or the player disagrees by more than 3 seconds
  const guarded = guardUntil > Date.now(), playing = guarded ? base.playing : media.playing;
  if (media.key !== prevKey || Math.abs(media.pos - localPos()) > 3 || (!guarded && base.playing !== media.playing)) rebase(media.pos, playing);
  else base.playing = playing;
  if (modeGuard > Date.now()) { media.shuffle = modeOv.shuffle; media.repeat = modeOv.repeat; }     // right after a click keep what was clicked
  paintMedia(); setIcon(media.exe || ''); paintSessions();
}
let modeGuard = 0, modeOv = { shuffle: false, repeat: 'None' };
window.islet.getMedia().then(setMedia); window.islet.onMedia(setMedia);
setInterval(tickProgress, 250);                       // keeps the bar moving between updates
const guard = () => { guardUntil = Date.now() + 1500; };   // right after a click, ignore an old status from the player

$('#play').onclick = () => {                           // the button reacts at once, the player confirms a moment later
  if (!media) return;
  rebase(localPos(), !base.playing); guard(); paintMedia();
  window.islet.media('toggle');
};
$('#shuf').onclick = () => {
  if (!media || !media.canShuffle) return;
  media.shuffle = !(media.shuffle === true); modeOv = { shuffle: media.shuffle, repeat: media.repeat || 'None' }; modeGuard = Date.now() + 1800;
  paintMedia(); window.islet.media('shuffle');
};
$('#rep').onclick = () => {
  if (!media || !media.canRepeat) return;
  media.repeat = { None: 'List', List: 'Track', Track: 'None' }[media.repeat || 'None'] || 'List';
  modeOv = { shuffle: media.shuffle === true, repeat: media.repeat }; modeGuard = Date.now() + 1800;
  paintMedia(); window.islet.media('repeat');
};
$('#prev').onclick = () => window.islet.media('prev');
$('#next').onclick = () => window.islet.media('next');

/* click or drag the progress bar to jump to a point in the track */
const seekEl = $('#seek');
const canSeek = () => !!media && dur() > 0 && media.canSeek !== false;
const fracOf = e => { const r = seekEl.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
seekEl.addEventListener('pointerdown', e => {
  if (!canSeek()) return;
  seekEl.setPointerCapture(e.pointerId); seekEl.classList.add('drag'); drag = { frac: fracOf(e) }; tickProgress();
});
seekEl.addEventListener('pointermove', e => { if (drag) { drag.frac = fracOf(e); tickProgress(); } });
seekEl.addEventListener('pointerup', () => {
  if (!drag) return;
  const sec = drag.frac * dur(); drag = null; seekEl.classList.remove('drag');
  rebase(sec, base.playing); guard(); tickProgress();
  window.islet.media('seek', sec);
});
seekEl.addEventListener('pointercancel', () => { drag = null; seekEl.classList.remove('drag'); });
paintMedia();

/* ================= clipboard ================= */
let csT, clipList = [], seenClips = null, pinFlash = '';
function clipStat() {
  const c = $('#cstat'), pinned = clipList.filter(i => i.pinned).length, n = clipList.length;
  c.innerHTML = n + (n === 1 ? ' item' : ' items') + (pinned ? ' \u00b7 <em>' + pinned + ' pinned</em>' : '');
}
function copied() { const c = $('#cstat'); c.classList.add('on'); c.textContent = 'Copied'; clearTimeout(csT); csT = setTimeout(() => { c.classList.remove('on'); clipStat(); }, 1400); }
const svg = d => '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
const PIN = svg('<path d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3z"/>'), DEL = svg('<path d="M6 6l12 12M18 6L6 18"/>');
function renderClips(list) {
  clipList = list || [];
  const p = $('#clips'); p.innerHTML = '';
  $('#cclear').disabled = !clipList.some(i => !i.pinned);
  if (!$('#cstat').classList.contains('on')) clipStat();
  if (!clipList.length) { p.innerHTML = '<p>Copy some text and it shows up here.</p>'; return; }
  const firstRender = seenClips === null; if (firstRender) seenClips = new Set();
  clipList.forEach((it, i) => {
    const row = document.createElement('div'); row.className = 'crow' + (it.pinned ? ' pinned' : '');
    row.style.setProperty('--i', i);
    if (!seenClips.has(it.id) && !firstRender) row.classList.add('new');                   // a freshly copied item slides in and flashes
    seenClips.add(it.id);
    if (it.id === pinFlash) { row.classList.add('pinflash'); pinFlash = ''; }
    const t = document.createElement('button'); t.className = 'ctext'; t.textContent = it.text; t.title = it.text;
    t.onclick = () => { window.islet.clipCopy(it.id); copied(); };
    const pin = document.createElement('button'); pin.className = 'cact cpin'; pin.innerHTML = PIN;
    pin.title = it.pinned ? 'Unpin' : 'Pin to the top'; pin.setAttribute('aria-label', pin.title);
    pin.onclick = () => { pinFlash = it.id; window.islet.clipPin(it.id); };
    const del = document.createElement('button'); del.className = 'cact cdel'; del.innerHTML = DEL;
    del.title = 'Delete'; del.setAttribute('aria-label', 'Delete this item');
    del.onclick = () => { row.classList.add('out'); setTimeout(() => window.islet.clipDel(it.id), 200); };
    row.append(t, pin, del); p.appendChild(row);
  });
}
$('#cclear').onclick = () => window.islet.clipClear();
window.islet.getClips().then(renderClips); window.islet.onClips(renderClips);

/* ================= files: drop in, drag out ================= */
let shelf = [], seenFiles = new Set();
const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
const fileIcons = new Map();
function fileIcon(p, img) {
  if (fileIcons.has(p)) { const u = fileIcons.get(p); if (u) img.src = u; else img.style.visibility = 'hidden'; return; }
  window.islet.icon(p).then(u => { fileIcons.set(p, u || ''); if (u) img.src = u; else img.style.visibility = 'hidden'; });
}
function renderShelf() {
  const l = $('#fl'); l.innerHTML = '';
  shelf.forEach((f, i) => {
    const it = document.createElement('div'); it.className = 'fitem' + (seenFiles.has(f.path) ? '' : ' new'); seenFiles.add(f.path); it.style.setProperty('--i', i); it.draggable = true; it.title = f.path;
    const img = document.createElement('img'); img.alt = ''; fileIcon(f.path, img);
    const em = document.createElement('em'); em.textContent = f.name; em.onclick = () => window.islet.openFile(f.path);
    const x = document.createElement('button'); x.textContent = '\u00d7'; x.setAttribute('aria-label', 'Remove from the shelf'); x.onclick = () => { it.classList.add('out'); setTimeout(() => { shelf = shelf.filter(y => y !== f); seenFiles.delete(f.path); renderShelf(); }, 190); };
    // dragging out: hand the real file to Windows so it can be dropped on the desktop, a folder or another app
    it.addEventListener('dragstart', e => { e.preventDefault(); holdUntil = Date.now() + 10000; window.islet.dragOut(f.path); });
    it.append(img, em, x); l.appendChild(it);
  });
  $('#fstat').textContent = shelf.length ? shelf.length + (shelf.length > 1 ? ' files' : ' file') + ' on the shelf' : 'Nothing on the shelf';
  $('#drop').classList.toggle('compact', shelf.length > 0);
}
function addToShelf(list) {
  let added = false;
  (list || []).forEach(f => { if (!shelf.some(y => y.path === f.path)) { shelf.push(f); added = true; } });
  renderShelf();
  if (added) { const d = $('#drop'); d.classList.remove('got'); void d.offsetWidth; d.classList.add('got'); setTimeout(() => d.classList.remove('got'), 600); }   // a little pop when files land
}
const pickFiles = async () => addToShelf(await window.islet.pickFiles());
$('#drop').onclick = pickFiles;
$('#drop').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickFiles(); } };
let dragLeaveT;
['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => {
  if (!hasFiles(e)) return;
  e.preventDefault(); clearTimeout(dragLeaveT); holdUntil = Date.now() + 4000;
  if (n.dataset.s !== 'open' || n.dataset.t !== 'files') openNotch('files');
  $('#drop').classList.add('on');
}));
document.addEventListener('dragleave', e => {
  if (e.relatedTarget) return;
  $('#drop').classList.remove('on'); clearTimeout(dragLeaveT); dragLeaveT = setTimeout(() => { holdUntil = 0; }, 800);
});
document.addEventListener('drop', async e => {
  e.preventDefault(); $('#drop').classList.remove('on');
  if (!hasFiles(e)) return;
  const paths = [...e.dataTransfer.files].map(f => { try { return window.islet.pathFor(f); } catch (err) { return ''; } }).filter(Boolean);
  addToShelf(await window.islet.addFiles(paths));
  holdUntil = Date.now() + 1500;
});
renderShelf();

/* ================= controls ================= */
const fill = el => el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min) * 100) + '%');
let muted = false, sendT = {}, warn = '';
const send = (cmd, val) => { clearTimeout(sendT[cmd]); sendT[cmd] = setTimeout(() => window.islet.sys(cmd, val), 60); };
$('#vs').oninput = e => { $('#vo').textContent = e.target.value; fill(e.target); send('vol', e.target.value); };
$('#bs').oninput = e => { $('#bo').textContent = e.target.value; fill(e.target); send('bri', e.target.value); };
const tile = k => $('.tile[data-k="' + k + '"]');
function paintTile(k, on, sub) {
  const t = tile(k); if (!t) return;
  t.dataset.on = !!on; t.querySelector('.tmain').setAttribute('aria-pressed', !!on); t.querySelector('small').textContent = sub;
}
function paintMic() { paintTile('mic', !muted, muted ? 'Muted' : 'On'); }
const flip = k => { const on = tile(k).dataset.on !== 'true'; paintTile(k, on, on ? 'On' : 'Off'); window.islet.sys(k, on ? 1 : 0); };
['wifi', 'bt', 'dark', 'night'].forEach(k => { tile(k).querySelector('.tmain').onclick = () => flip(k); });
tile('air').querySelector('.tmain').onclick = () => {
  const on = tile('air').dataset.on !== 'true';
  paintTile('air', on, on ? 'On' : 'Off');
  if (on) { paintTile('wifi', false, 'Off'); paintTile('bt', false, 'Off'); }
  window.islet.sys('air', on ? 1 : 0);
};
tile('mic').querySelector('.tmain').onclick = () => { muted = !muted; paintMic(); window.islet.sys('mic', muted ? 1 : 0); };
function applySys(s) {
  if (s.vol != null) { $('#vs').value = s.vol; $('#vo').textContent = s.vol; }
  if (s.bri != null) { $('#bs').value = s.bri; $('#bo').textContent = s.bri; }
  if (s.mic != null) { muted = !!s.mic; paintMic(); }
  [['wifi'], ['bt'], ['dark'], ['air'], ['night']].forEach(([k]) => {
    if (s[k] != null) paintTile(k, s[k] === 1, s[k] === 1 ? 'On' : 'Off');
    const bad = !!s['err_' + k] && s[k] == null, t = tile(k);
    if (bad) t.setAttribute('disabled-tile', ''); else t.removeAttribute('disabled-tile');
  });
  $('#bs').disabled = !!s.err_bri && s.bri == null;
  $('#brow').style.opacity = $('#bs').disabled ? .4 : 1;
  $('#vs').disabled = !!s.err_vol && s.vol == null;
  const names = { vol: 'volume', bri: 'brightness', mic: 'microphone', wifi: 'Wi-Fi', bt: 'Bluetooth', air: 'Airplane mode', dark: 'Dark Style', night: 'Night Light' };
  const bad = Object.keys(names).filter(k => s['err_' + k] && s[k] == null).map(k => names[k]);
  warn = bad.length ? 'Not available on this PC: ' + bad.join(', ') : '';
  $('#warn').textContent = warn;
  fill($('#vs')); fill($('#bs'));
}
fill($('#vs')); fill($('#bs'));
window.islet.getSys().then(applySys); window.islet.onSys(applySys);

/* Wi-Fi networks and Bluetooth devices, inside the Controls tab */
let subKind = null, wifiSel = null;
function openSub(kind) {
  subKind = kind; wifiSel = null; $('#sub').hidden = false; $('#spass').hidden = true; $('#smsg').textContent = '';
  $('#stitle').textContent = kind === 'wifi' ? 'Wi-Fi networks' : 'Bluetooth devices';
  $('#slist').innerHTML = '<p>Looking...</p>';
  window.islet.net(kind === 'wifi' ? 'wifiscan' : 'btscan');
}
async function closeSub() { $('#sub').hidden = true; subKind = null; wifiSel = null; await window.islet.focusable(false); }
$('#sback').onclick = closeSub;
$('#srefresh').onclick = () => { $('#slist').innerHTML = '<p>Looking...</p>'; window.islet.net(subKind === 'wifi' ? 'wifiscan' : 'btscan'); };
$$('[data-sub]').forEach(b => b.onclick = e => { e.stopPropagation(); openSub(b.dataset.sub); });
window.islet.onNet(m => {
  if (m.k === 'netmsg') { $('#smsg').textContent = m.v || ''; return; }
  if (m.k === 'wifilist' && subKind === 'wifi') renderWifi(m.v);
  if (m.k === 'btlist' && subKind === 'bt') renderBt(m.v);
});
function srow(name, meta, cur) {
  const r = document.createElement('div'); r.className = 'srow' + (cur ? ' cur' : '');
  const a = document.createElement('span'); a.className = 'sname'; a.textContent = name; a.title = name;
  const b = document.createElement('span'); b.className = 'smeta'; b.textContent = meta;
  r.append(a, b); return r;
}
function renderWifi(list) {
  const box = $('#slist'); box.innerHTML = '';
  if (!list.length) { box.innerHTML = '<p>No networks found. Switch Wi-Fi on first.</p>'; return; }
  list.forEach(n => {
    const r = srow(n.ssid, [n.secured ? 'Secured' : 'Open', n.signal ? n.signal + '%' : ''].filter(Boolean).join(' \u00b7 '), n.connected);
    const b = document.createElement('button'); b.className = 'tbtn';
    if (n.connected) { b.textContent = 'Disconnect'; b.onclick = () => { $('#smsg').textContent = 'Disconnecting...'; window.islet.net('wifidisc'); }; }
    else { b.textContent = 'Connect'; b.onclick = () => joinWifi(n); }
    r.appendChild(b); box.appendChild(r);
  });
}
function joinWifi(n) {
  if (n.secured && !n.saved) {                          // a new secured network needs its password; typing needs keyboard focus for a moment
    wifiSel = n; $('#spass').hidden = false; $('#spw').value = ''; $('#smsg').textContent = 'Password for ' + n.ssid;
    window.islet.focusable(true).then(() => $('#spw').focus());
    return;
  }
  $('#spass').hidden = true; window.islet.net('wificonn', { ssid: n.ssid, auth: n.auth });
}
$('#sjoin').onclick = () => {
  const pass = $('#spw').value;
  if (!wifiSel || !pass) return;
  window.islet.net('wificonn', { ssid: wifiSel.ssid, pass, auth: wifiSel.auth });
  $('#spass').hidden = true; $('#spw').value = ''; wifiSel = null; window.islet.focusable(false);
};
$('#spw').addEventListener('keydown', e => { if (e.key === 'Enter') $('#sjoin').click(); });
function renderBt(list) {
  const box = $('#slist'); box.innerHTML = '';
  if (!list.length) { box.innerHTML = '<p>No paired devices found. Switch Bluetooth on first.</p>'; return; }
  list.forEach(d => box.appendChild(srow(d.name || 'Unknown device', d.connected ? 'Connected' : 'Paired', d.connected)));
  const p = document.createElement('p'); p.textContent = 'Windows does not let apps connect or pair devices; do that from the device.'; box.appendChild(p);
}

/* ================= applications ================= */
let apps = [], installed = null;
const letter = name => { const d = document.createElement('div'); d.className = 'aph'; d.textContent = (name || '?').trim().charAt(0).toUpperCase(); return d; };
function iconNode(path, name) {
  const img = document.createElement('img'); img.alt = '';
  const ph = letter(name);
  window.islet.icon(path).then(u => { if (u) { img.src = u; ph.replaceWith(img); } });
  return ph;
}
// the picker can hold hundreds of apps: an icon is only fetched when its row scrolls into view
const io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { io.unobserve(en.target); if (en.target._load) en.target._load(); } }), { root: $('#plist'), rootMargin: '80px' });
function iconNodeLazy(path, name) {
  const ph = letter(name);
  ph._load = () => window.islet.icon(path).then(u => { if (u) { const img = document.createElement('img'); img.alt = ''; img.src = u; ph.replaceWith(img); } });
  io.observe(ph); return ph;
}
function renderApps() {
  const g = $('#agrid'); g.innerHTML = '';
  apps.forEach((a, i) => {
    const t = document.createElement('div'); t.className = 'atile'; t.style.setProperty('--i', i); t.setAttribute('role', 'button'); t.tabIndex = 0; t.title = a.name;
    t.onclick = () => window.islet.appsLaunch(a.path);
    t.onkeydown = e => { if (e.key === 'Enter') window.islet.appsLaunch(a.path); };
    const lab = document.createElement('span'); lab.textContent = a.name;
    const rm = document.createElement('button'); rm.className = 'arm'; rm.textContent = '\u00d7'; rm.title = 'Remove this shortcut'; rm.setAttribute('aria-label', 'Remove ' + a.name);
    rm.onclick = async e => { e.stopPropagation(); apps = await window.islet.appsRemove(a.path); renderApps(); };
    t.append(iconNode(a.path, a.name), lab, rm); g.appendChild(t);
  });
  const add = document.createElement('div'); add.className = 'atile add'; add.title = 'Add an application';
  add.setAttribute('role', 'button'); add.tabIndex = 0; add.setAttribute('aria-label', 'Add an application');
  const ph = document.createElement('div'); ph.className = 'aph';
  ph.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
  const lab = document.createElement('span'); lab.textContent = 'Add';
  add.append(ph, lab); add.onclick = openPicker; add.onkeydown = e => { if (e.key === 'Enter') openPicker(); }; g.appendChild(add);
}
async function loadApps() { apps = await window.islet.appsList(); renderApps(); }

async function openPicker() {
  $('#picker').hidden = false; $('#psearch').value = '';
  await window.islet.focusable(true); $('#psearch').focus();       // the notch normally never takes keyboard focus; it does while you type a search
  if (!installed) { $('#plist').innerHTML = '<p>Looking for installed apps...</p>'; installed = await window.islet.appsInstalled(); }
  renderPicker();
}
async function closePicker() { $('#picker').hidden = true; await window.islet.focusable(false); }
function renderPicker() {
  const q = $('#psearch').value.trim().toLowerCase();
  const list = (installed || []).filter(a => !q || a.name.toLowerCase().includes(q));
  const box = $('#plist'); box.innerHTML = '';
  if (!list.length) { box.innerHTML = '<p>' + (installed && installed.length ? 'No app matches that.' : 'No installed apps found here. Use Browse to pick one.') + '</p>'; return; }
  io.disconnect();
  list.forEach(a => {
    const added = apps.some(x => x.path.toLowerCase() === a.path.toLowerCase());
    const r = document.createElement('button'); r.className = 'prow' + (added ? ' added' : '');
    const nm = document.createElement('span'); nm.textContent = a.name + (added ? '  (added)' : '');
    r.append(iconNodeLazy(a.path, a.name), nm);
    if (!added) r.onclick = async () => { apps = await window.islet.appsAdd(a); renderApps(); renderPicker(); };
    box.appendChild(r);
  });
}
$('#psearch').oninput = renderPicker;
$('#pclose').onclick = closePicker;
$('#pbrowse').onclick = async () => { apps = await window.islet.appsBrowse(); renderApps(); renderPicker(); };



/* ================= notifications: battery toasts and the reminder screen =================
   A battery toast is a small, short pill. A reminder expands the notch into its full notification screen.
   Both remember what the notch was doing and go back to it, and they wait in a queue so they never overlap. */
const noteQ = [];
let noteBusy = false, noteT, alertCur = null, alertIv, alertLeft = 0, alertTotal = 1, alertPaused = false, prevS = { s: 'rest', t: 'music' };
const bolt = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg>';
const check = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function pushNote(note) {
  note.born = Date.now();
  if (note.kind === 'reminder') noteQ.splice(noteQ.filter(x => x.kind === 'reminder').length, 0, note);   // reminders first, in order
  else noteQ.push(note);
  runNotes();
}
function runNotes() {
  for (let i = noteQ.length - 1; i >= 0; i--) if (noteQ[i].kind !== 'reminder' && Date.now() - noteQ[i].born > 15000) noteQ.splice(i, 1);   // an old battery toast is no longer news
  if (noteBusy || !noteQ.length) return;
  const i = noteQ.findIndex(x => x.kind === 'reminder' || n.dataset.s === 'rest');   // battery toasts wait while the notch is open
  if (i < 0) return;
  const note = noteQ.splice(i, 1)[0];
  noteBusy = true;
  (note.kind === 'reminder' ? showAlert(note) : showToast(note)).catch(() => { noteBusy = false; });
}
setInterval(runNotes, 500);

const plug = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/></svg>';
const warnIc = '<svg width="14"  height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4 2.8 20h18.4zM12 10v5M12 17.6v.1"/></svg>';
// what each battery notification says: icon, title, second line, how long it stays
const TOASTS = {
  charging: { ic: bolt, t: 'Charging', s: n2 => 'Charger connected' + (spanOf(n2.left) ? ' \u00b7 full in ' + spanOf(n2.left) : ''), ms: 3800 },
  full: { ic: check, t: 'Fully charged', s: () => 'You can unplug the charger', ms: 4500 },
  unplugged: { ic: plug, t: 'On battery', s: n2 => 'Charger removed' + (spanOf(n2.left) ? ' \u00b7 ' + spanOf(n2.left) + ' left' : ''), ms: 3800 },
  low: { ic: warnIc, t: 'Low battery', s: n2 => 'Plug in your charger soon' + (spanOf(n2.left) ? ' \u00b7 ' + spanOf(n2.left) + ' left' : ''), ms: 5500 },
  verylow: { ic: warnIc, t: 'Battery very low', s: () => 'Plug in your charger now', ms: 6500 },
  critical: { ic: warnIc, t: 'Battery critical', s: () => 'Plug in now to avoid shutting down', ms: 8000 }
};
async function showToast(note) {
  const d = TOASTS[note.kind] || TOASTS.charging;
  if (/^(low|verylow|critical)$/.test(note.kind) && batNow.charging) { noteBusy = false; return; }   // plugged in meanwhile: the warning is outdated
  const pct = note.pct != null ? note.pct : 100;
  const lt = $('#Lt'); lt.dataset.k = note.kind;
  $('#tic').innerHTML = d.ic;
  $('#tt').textContent = d.t;
  $('#tsub').textContent = d.s(note);
  $('#tpct').textContent = pct + '%';
  $('#tbarf').style.width = '0%';
  clearTimeout(shrinkT);
  await window.islet.size('toast'); winBig = false;
  n.dataset.s = 'toast';
  requestAnimationFrame(() => requestAnimationFrame(() => { $('#tbarf').style.width = Math.max(2, pct) + '%'; }));   // the level bar fills up
  noteT = setTimeout(() => {                                  // back to the previous state (the closed notch)
    if (n.dataset.s === 'toast') closeNotch();
    noteBusy = false; setTimeout(runNotes, 700);
  }, d.ms);
}

const clockOf = ms => {
  const d = new Date(ms), t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  return d.toDateString() === new Date().toDateString() ? t : d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ', ' + t;
};
async function showAlert(note) {
  alertCur = note; prevS = { s: n.dataset.s === 'toast' ? 'rest' : n.dataset.s, t: n.dataset.t };
  if (note.id) window.islet.remDel(note.id).then(syncRem).catch(() => {});                 // shown now: only then is it removed from the saved list
  const waiting = noteQ.filter(x => x.kind === 'reminder').length;
  $('.alab').textContent = waiting ? 'Reminder \u00b7 ' + waiting + ' more' : 'Reminder';
  const len = note.text.length;
  $('#amsg').firstElementChild.textContent = note.text; $('#amsg').title = note.text;
  $('#atime').textContent = clockOf(note.at);
  clearTimeout(shrinkT); clearTimeout(closeT); clearTimeout(noteT);
  if (prevS.s !== 'open') { await window.islet.size('alert'); winBig = false; }          // small like the battery toast; if the notch is already open the window is already big
  n.dataset.s = 'alert';
  alertTotal = alertLeft = Math.min(30000, Math.max(9000, 6000 + len * 120));       // long enough to read, longer for a longer message
  if (waiting) alertTotal = alertLeft = Math.min(alertTotal, 7000);                  // several are waiting (missed ones): do not make the next ones queue for long
  $('#abarf').classList.remove('low');
  alertPaused = inside;
  $('#abarf').style.width = '100%';
  clearInterval(alertIv);
  alertIv = setInterval(() => {
    const w = noteQ.filter(x => x.kind === 'reminder').length;                         // others may arrive while this one is on screen
    const lab = w ? 'Reminder \u00b7 ' + w + ' more' : 'Reminder';
    if ($('.alab').textContent !== lab) $('.alab').textContent = lab;
    if (w && alertTotal > 7000) { alertTotal = 7000; alertLeft = Math.min(alertLeft, 7000); }
    if (!alertPaused) alertLeft -= 100;
    $('#abarf').style.width = Math.max(0, alertLeft / alertTotal * 100) + '%';
    $('#abarf').classList.toggle('low', alertLeft / alertTotal < 0.25);
    if (alertLeft <= 0) endAlert(false);
  }, 100);
}
function endAlert(snooze) {
  if (!alertCur) return;
  clearInterval(alertIv);
  const note = alertCur; alertCur = null;
  if (snooze) window.islet.remAdd({ text: note.text, at: Date.now() + 5 * 60000 }).then(syncRem).catch(() => {});
  if (prevS.s === 'open') { winBig = true; n.dataset.s = 'open'; }                // it was open: stay open (it closes by itself if the cursor is away)
  else closeNotch();                                           // it was closed: shrink back smoothly
  if (note.wasHidden && !noteQ.some(x => x.kind === 'reminder')) setTimeout(() => window.islet.hide(), 800);
  noteBusy = false; setTimeout(runNotes, 800);
}
$('#adone').onclick = () => endAlert(false);
$('#asnooze').onclick = () => endAlert(true);
window.islet.onReminder(r => pushNote({ kind: 'reminder', id: r.id, text: r.text, at: r.at, wasHidden: r.wasHidden }));
window.islet.onNoteTest(k => {
  if (k === 'reminder') pushNote({ kind: 'reminder', text: 'Team stand-up starts in 5 minutes', at: Date.now() });
  else pushNote({ kind: k, pct: { full: 100, low: 20, verylow: 10, critical: 5, unplugged: 87 }[k] || 63, left: k === 'unplugged' ? 11400 : k === 'low' ? 2700 : k === 'charging' ? 4500 : NaN });
});

/* ================= calendar tab: pick a day, see its reminders, add a new one ================= */
let remChip = 0, remItems = [], remDate = new Date(), calY = 0, calM = 0;
const pad2 = v => String(v).padStart(2, '0');
const hhmm = ms => { const d = new Date(ms); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
const dayStart = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function renderCal(dir, pop) {
  const today = dayStart(new Date()), first = new Date(calY, calM, 1);
  $('#cmonth').textContent = first.toLocaleDateString([], { month: 'long', year: 'numeric' });
  $('#cprev').disabled = calY === today.getFullYear() && calM <= today.getMonth();      // nothing can be set in the past
  const g = $('#cgrid'); g.innerHTML = '';
  if (dir) { g.classList.remove('sl', 'sr'); void g.offsetWidth; g.classList.add(dir > 0 ? 'sl' : 'sr'); const m = $('#cmonth'); m.classList.remove('swap'); void m.offsetWidth; m.classList.add('swap'); }   // the month slides in from the side it came from
  const lead = (first.getDay() + 6) % 7, days = new Date(calY, calM + 1, 0).getDate();
  for (let i = 0; i < lead; i++) g.appendChild(document.createElement('i'));
  for (let d = 1; d <= days; d++) {
    const day = new Date(calY, calM, d), b = document.createElement('button');
    b.className = 'cd'; b.textContent = d; b.disabled = day < today;
    if (sameDay(day, today)) b.classList.add('today');
    if (sameDay(day, remDate)) { b.classList.add('sel'); if (pop) b.classList.add('pop'); }
    if (remItems.some(x => sameDay(new Date(x.at), day))) b.classList.add('has');        // a dot marks days that already have a reminder
    b.onclick = () => { remDate = day; remChip = 0; paintDate(); renderCal(0, true); renderDay(); };
    g.appendChild(b);
  }
}
function paintDate() {
  const d = remDate, t = sameDay(d, new Date()) ? 'Today, ' : '';
  $('#rday').textContent = t + d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}
let freshKey = '';
function renderDay() {                                                                   // the reminders of the chosen day
  const box = $('#rlist'); box.innerHTML = '';
  const list = remItems.filter(x => sameDay(new Date(x.at), remDate));
  $('#rcount').textContent = list.length ? list.length + (list.length > 1 ? ' reminders' : ' reminder') : '';
  if (!list.length) { box.innerHTML = '<p>Nothing planned for this day.</p>'; return; }
  list.forEach((x, i) => {
    const row = document.createElement('div'); row.className = 'rrow'; row.style.setProperty('--i', i);
    if (freshKey === x.text + '|' + x.at) { row.classList.add('fresh'); freshKey = ''; }
    const tm = document.createElement('time'); tm.textContent = clockOf(x.at).replace(/^.*, /, '');
    const tx = document.createElement('span'); tx.textContent = x.text; tx.title = x.text;
    const del = document.createElement('button'); del.textContent = '\u00d7'; del.setAttribute('aria-label', 'Delete this reminder');
    del.onclick = async () => { row.classList.add('out'); await new Promise(res => setTimeout(res, 220)); renderRem(await window.islet.remDel(x.id)); };
    row.append(tm, tx, del); box.appendChild(row);
  });
}
function renderRem(list) { remItems = list; renderCal(); renderDay(); }
function syncRem(list) { remItems = list; if (calY && n.dataset.t === 'cal') { renderCal(); renderDay(); } }   // keep the calendar right when a reminder fires or is snoozed
async function openCal() {
  const t = Date.now() + 10 * 60000;
  remChip = 0; remDate = dayStart(t); calY = remDate.getFullYear(); calM = remDate.getMonth();
  { const d = new Date(t); setTime(d.getHours(), d.getMinutes()); } $('#rmsg').textContent = '';
  paintDate(); renderCal(); renderDay();
  renderRem(await window.islet.remList());
}

/* custom time picker: works with the mouse alone (the notch window cannot take the keyboard until a field is clicked) */
let tH = 9, tMi = 0, tSel = 'm';
function paintTime(flash) {
  const h12 = tH % 12 || 12, ap = tH < 12 ? 'AM' : 'PM';
  const set = (id, v) => { const e = $(id); if (e.textContent !== v) { e.textContent = v; if (flash) { e.classList.remove('tick'); void e.offsetWidth; e.classList.add('tick'); } } };
  set('#th', String(h12)); set('#tmin', pad2(tMi)); set('#tap', ap);
  $('#rtime').value = pad2(tH) + ':' + pad2(tMi);
  $$('.tseg button').forEach(b => b.classList.toggle('on', b.dataset.u === tSel));
}
function setTime(h, m) { tH = ((h % 24) + 24) % 24; tMi = ((m % 60) + 60) % 60; paintTime(); }
function stepTime(dir) {
  if (tSel === 'h') tH = (tH + dir + 24) % 24;
  else if (tSel === 'm') { const t = (tH * 60 + tMi + dir + 1440) % 1440; tH = Math.floor(t / 60); tMi = t % 60; }
  else tH = (tH + 12) % 24;
  remChip = 0; $('#rmsg').textContent = ''; paintTime(true);
}
$$('.tseg button').forEach(b => b.onclick = () => { if (b.dataset.u === 'p') { tSel = 'p'; stepTime(1); } else { tSel = b.dataset.u; paintTime(); } });
let holdT = 0, holdI = 0;
const holdStop = () => { clearTimeout(holdT); clearInterval(holdI); };
[['#tmn', -1], ['#tpl', 1]].forEach(([id, dir]) => {
  const b = $(id);
  b.addEventListener('pointerdown', e => { e.preventDefault(); stepTime(dir); holdStop(); holdT = setTimeout(() => { holdI = setInterval(() => stepTime(dir), 80); }, 380); });   // hold to repeat
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, holdStop));
});
$('#tpick').addEventListener('wheel', e => { e.preventDefault(); stepTime(e.deltaY < 0 ? 1 : -1); }, { passive: false });

let adding = false;
async function addRemind() {
  if (adding) return;                                                                    // Enter and the button together must not add it twice
  const text = $('#rtext').value.trim();
  if (!text) { $('#rmsg').textContent = 'Type what to remind you about.'; shake($('#rtext')); $('#rtext').focus(); return; }
  const v = $('#rtime').value;
  if (!/^\d\d:\d\d$/.test(v)) { $('#rmsg').textContent = 'Pick a time.'; shake($('#tpick')); return; }
  const d = new Date(remDate); d.setHours(+v.slice(0, 2), +v.slice(3), 0, 0);
  let at = d.getTime();
  if (remChip && hhmm(remChip) === v && sameDay(new Date(remChip), remDate)) at = remChip;   // a quick button keeps its exact moment
  if (at <= Date.now()) { $('#rmsg').textContent = 'That time has already passed.'; shake($('#tpick')); return; }
  adding = true;
  try {
    freshKey = text.slice(0, 140) + '|' + Math.round(at);
    renderRem(await window.islet.remAdd({ text, at }));
    $('#rtext').value = ''; remChip = 0;
    $('#rmsg').textContent = 'Set for ' + clockOf(at);
    const bt = $('#radd'); bt.textContent = 'Added \u2713'; bt.classList.add('ok');
    setTimeout(() => { bt.textContent = 'Add reminder'; bt.classList.remove('ok'); }, 1300);
  } finally { adding = false; }
}
function shake(el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
// The notch window is not focusable (so it never steals focus from your other apps). Clicking the name field makes it
// focusable first, then focuses the field; it goes back to non-focusable when you are done typing.
$('#rtext').addEventListener('pointerdown', async e => {
  const el = e.currentTarget;                                  // (currentTarget is gone after the await)
  if (document.hasFocus() && document.activeElement === el) return;
  e.preventDefault();
  await window.islet.focusable(true);
  el.focus();
});
$('#rtext').addEventListener('focus', () => window.islet.focusable(true));
$('#rtext').addEventListener('blur', () => setTimeout(() => { if (!remTyping()) window.islet.focusable(false); }, 150));
$('#radd').onclick = addRemind;
$('#rtext').addEventListener('keydown', e => { if (e.key === 'Enter') addRemind(); });
$('#cprev').onclick = () => { calM--; if (calM < 0) { calM = 11; calY--; } renderCal(-1); };
$('#cnext').onclick = () => { calM++; if (calM > 11) { calM = 0; calY++; } renderCal(1); };
$$('.rchips [data-m]').forEach(b => b.onclick = () => {
  remChip = Date.now() + (+b.dataset.m) * 60000; remDate = dayStart(remChip); calY = remDate.getFullYear(); calM = remDate.getMonth();
  { const d = new Date(remChip); setTime(d.getHours(), d.getMinutes()); } paintDate(); renderCal(); renderDay();
});
