// Finds which apps are using the microphone, camera or location right now.
// Windows records this in the registry (Settings > Privacy): an app that is using a device
// has a start time and a stop time of 0.
const path = require('path');
const { execFile } = require('child_process');

const CONSENT = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\';
const KINDS = { mic: 'microphone', cam: 'webcam', loc: 'location' };

function parseConsent(out) {
  const apps = [];
  let cur = null;
  for (const raw of String(out).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('HKEY_')) { cur = { key: line, start: 0n, stop: 0n }; apps.push(cur); continue; }
    const m = cur && line.match(/^(LastUsedTimeStart|LastUsedTimeStop)\s+REG_QWORD\s+0x([0-9a-fA-F]+)/);
    if (m) cur[m[1] === 'LastUsedTimeStart' ? 'start' : 'stop'] = BigInt('0x' + m[2]);
  }
  const names = apps.filter(a => a.start > 0n && a.stop === 0n).map(a => {
    const tail = a.key.split('\\').pop();
    return tail.includes('#') ? path.win32.basename(tail.replace(/#/g, '\\')) : tail.split('_')[0];
  });
  return [...new Set(names)];
}

function query(sub) {
  return new Promise(res => execFile('reg', ['query', CONSENT + sub, '/s'],
    { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, out) => res(err ? '' : out)));
}

async function readAll() {
  const result = {};
  for (const [k, sub] of Object.entries(KINDS)) result[k] = parseConsent(await query(sub));
  return result;
}

module.exports = { parseConsent, readAll };
