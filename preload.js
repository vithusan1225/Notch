const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('islet', {
  size: open => ipcRenderer.invoke('size', open),
  focusable: on => ipcRenderer.invoke('focusable', on),
  hide: () => ipcRenderer.send('hide'),
  getOnTop: () => ipcRenderer.invoke('ontop-get'),
  setOnTop: on => ipcRenderer.send('ontop-set', on),
  onOnTop: cb => ipcRenderer.on('ontop', (_, v) => cb(v)),
  log: t => ipcRenderer.send('dbg', String(t)),
  onCursor: cb => ipcRenderer.on('cursor', (_, v) => cb(v)),
  uptime: () => ipcRenderer.invoke('uptime'),
  icon: p => ipcRenderer.invoke('icon', p),

  getClips: () => ipcRenderer.invoke('clips'),
  onClips: cb => ipcRenderer.on('clips', (_, v) => cb(v)),
  clipCopy: id => ipcRenderer.send('clip-copy', id),
  clipDel: id => ipcRenderer.send('clip-del', id),
  clipPin: id => ipcRenderer.send('clip-pin', id),
  clipClear: () => ipcRenderer.send('clip-clear'),

  getMedia: () => ipcRenderer.invoke('media-state'),
  onMedia: cb => ipcRenderer.on('media', (_, v) => cb(v)),
  media: (cmd, val) => ipcRenderer.send('media', cmd, val),

  sys: (cmd, val) => ipcRenderer.send('sys', cmd, val),
  getSys: () => ipcRenderer.invoke('sys-state'),
  onSys: cb => ipcRenderer.on('sys', (_, v) => cb(v)),
  net: (cmd, arg) => ipcRenderer.send('net', cmd, arg),
  onNet: cb => ipcRenderer.on('net', (_, v) => cb(v)),
  getPrivacy: () => ipcRenderer.invoke('privacy-state'),
  onPrivacy: cb => ipcRenderer.on('privacy', (_, v) => cb(v)),

  pickFiles: () => ipcRenderer.invoke('pick-files'),
  addFiles: paths => ipcRenderer.invoke('add-files', paths),
  pathFor: file => webUtils.getPathForFile(file),
  openFile: p => ipcRenderer.send('open-file', p),
  dragOut: p => ipcRenderer.send('drag-out', p),

  remList: () => ipcRenderer.invoke('rem-list'),
  remAdd: r => ipcRenderer.invoke('rem-add', r),
  remDel: id => ipcRenderer.invoke('rem-del', id),
  onReminder: cb => ipcRenderer.on('reminder', (_, v) => cb(v)),
  onNoteTest: cb => ipcRenderer.on('note-test', (_, v) => cb(v)),
  statsWatch: on => ipcRenderer.send('stats-watch', !!on),
  getStats: () => ipcRenderer.invoke('stats-get'),
  onStats: cb => ipcRenderer.on('stats', (_, v) => cb(v)),

  appsList: () => ipcRenderer.invoke('apps-list'),
  appsInstalled: () => ipcRenderer.invoke('apps-installed'),
  appsAdd: a => ipcRenderer.invoke('apps-add', a),
  appsBrowse: () => ipcRenderer.invoke('apps-browse'),
  appsRemove: p => ipcRenderer.invoke('apps-remove', p),
  appsLaunch: p => ipcRenderer.send('apps-launch', p)
});
