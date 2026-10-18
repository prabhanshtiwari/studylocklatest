const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const events = {};
const event = name => ({ addListener(fn) { (events[name] ||= []).push(fn); } });
const store = {};
const synced = {};
const tabs = new Map();
let nextTabId = 10;
let alarms = new Map();
const tabUpdates = [];
function area(storage, areaName) {
  return {
    async get(keys) {
      if (keys == null) return { ...storage };
      if (typeof keys === 'string') return { [keys]: structuredClone(storage[keys]) };
      if (Array.isArray(keys)) return Object.fromEntries(keys.map(k => [k, structuredClone(storage[k])]));
      if (typeof keys === 'object') return Object.fromEntries(Object.entries(keys).map(([k,v]) => [k, storage[k] === undefined ? v : structuredClone(storage[k])]));
      return {};
    },
    async set(obj) {
      const changes = {};
      for (const [key, value] of Object.entries(obj)) { changes[key] = { oldValue: storage[key], newValue: value }; storage[key] = structuredClone(value); }
      for (const fn of events['storage.onChanged'] || []) fn(changes, areaName);
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys]; const changes = {};
      for (const key of list) { if (key in storage) { changes[key] = { oldValue: storage[key], newValue: undefined }; delete storage[key]; } }
      for (const fn of events['storage.onChanged'] || []) fn(changes, areaName);
    }
  };
}
const localArea = area(store, 'local');
const syncArea = area(synced, 'sync');
const chrome = {
  runtime: {
    onInstalled: event('runtime.onInstalled'), onStartup: event('runtime.onStartup'), onMessage: event('runtime.onMessage'),
    getURL(path = '') { return `chrome-extension://test/${path}`; },
    getManifest() { return { version: '2.2.0' }; }
  },
  commands: { onCommand: event('commands.onCommand') },
  storage: { local: localArea, sync: syncArea, onChanged: event('storage.onChanged') },
  power: { requestKeepAwake() {}, releaseKeepAwake() {} },
  alarms: { onAlarm: event('alarms.onAlarm'), async create(name, info) { alarms.set(name, info); }, async clear(name) { return alarms.delete(name); } },
  notifications: { async create() {} },
  tabs: {
    onActivated: event('tabs.onActivated'), onCreated: event('tabs.onCreated'), onUpdated: event('tabs.onUpdated'), onRemoved: event('tabs.onRemoved'),
    async create(opts = {}) { const tab = { id: nextTabId++, windowId: opts.windowId ?? 1, url: opts.url || 'about:blank', active: Boolean(opts.active) }; tabs.set(tab.id, tab); return { ...tab }; },
    async update(id, opts = {}) { const tab = tabs.get(id); if (!tab) throw new Error('tab missing'); tabUpdates.push({ id, opts: { ...opts } }); Object.assign(tab, opts); return { ...tab }; },
    async get(id) { const tab = tabs.get(id); if (!tab) throw new Error('tab missing'); return { ...tab }; },
    async remove(ids) { for (const id of (Array.isArray(ids) ? ids : [ids])) { const tab = tabs.get(id); if (tab) { tabs.delete(id); for (const fn of events['tabs.onRemoved'] || []) await fn(id, { windowId: tab.windowId, isWindowClosing: false }); } } },
    async query(query = {}) { return [...tabs.values()].filter(t => query.windowId == null || t.windowId === query.windowId).map(t => ({ ...t })); }
  },
  windows: { WINDOW_ID_NONE: -1, onFocusChanged: event('windows.onFocusChanged') }
};
const sandbox = { chrome, console, URL, URLSearchParams, Date, Math, JSON, Number, String, Boolean, Array, Object, Promise, Set, Map, TextEncoder, TextDecoder, Uint8Array, btoa, atob, structuredClone, setTimeout, clearTimeout };
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '..', 'background.js'), 'utf8'), sandbox, { filename: 'background.js' });
async function message(data, sender = {}) {
  return new Promise((resolve, reject) => {
    const listener = (events['runtime.onMessage'] || [])[0];
    if (!listener) return reject(new Error('No message handler registered'));
    const returned = listener(data, sender, resolve);
    if (returned !== true) setTimeout(() => resolve({ ok: false, error: 'No asynchronous response.' }), 100);
  });
}
(async () => {
  for (const fn of events['runtime.onInstalled'] || []) await fn();
  tabs.set(1, { id: 1, windowId: 1, url: 'https://www.youtube.com/', active: true });

  let result = await message({ type: 'GET_DASHBOARD' }, { url: 'chrome-extension://test/newtab.html' });
  assert.equal(result.ok, true); assert.deepEqual(result.plans, []); assert.deepEqual(result.cards, []);

  result = await message({ type: 'SAVE_PLAN', title: 'Test lesson', url: 'https://www.youtube.com/watch?v=abcdefghijk', mode: 'video', expectedMinutes: 20, dueAt: Date.now() + 120000 }, { url: 'chrome-extension://test/newtab.html' });
  assert.equal(result.ok, true); assert.equal(result.plan.mode, 'video'); assert.ok(alarms.has(`study-plan-${result.plan.id}`));
  const planId = result.plan.id;
  result = await message({ type: 'RESCHEDULE_PLAN', id: planId, dueAt: Date.now() + 3600000 }, { url: 'chrome-extension://test/newtab.html' });
  assert.equal(result.ok, true); assert.ok(result.plans.find(p => p.id === planId).dueAt > Date.now()); assert.ok(alarms.has(`study-plan-${planId}`));
  result = await message({ type: 'SAVE_PLAN', title: 'Delete plan smoke test', url: 'https://www.youtube.com/watch?v=abcdefghijk', mode: 'video', expectedMinutes: 5, dueAt: Date.now() + 180000 }, { url: 'chrome-extension://test/newtab.html' });
  const deletePlanId = result.plan.id;
  result = await message({ type: 'DELETE_PLAN', id: deletePlanId }, { url: 'chrome-extension://test/newtab.html' });
  assert.equal(result.ok, true); assert.ok(!result.plans.find(p => p.id === deletePlanId)); assert.ok(!alarms.has(`study-plan-${deletePlanId}`));
  result = await message({ type: 'SAVE_FLASHCARD', question: 'What is a stack?', answer: 'A LIFO data structure.' }, { url: 'chrome-extension://test/newtab.html' });
  assert.equal(result.ok, true); const cardId = result.card.id;
  result = await message({ type: 'REVIEW_FLASHCARD', id: cardId, rating: 'good' }, { url: 'chrome-extension://test/newtab.html' });
  assert.equal(result.ok, true); assert.equal(result.card.intervalDays, 4);
  result = await message({ type: 'SAVE_FLASHCARD', question: 'Delete me?', answer: 'Deletion test.' }, { url: 'chrome-extension://test/newtab.html' });
  const deleteCardId = result.card.id;
  result = await message({ type: 'DELETE_FLASHCARD', id: deleteCardId }, { url: 'chrome-extension://test/newtab.html' });
  assert.equal(result.ok, true); assert.ok(!result.cards.find(card => card.id === deleteCardId));

  result = await message({ type: 'START_FROM_YOUTUBE', mode: 'video', url: 'https://www.youtube.com/watch?v=abcdefghijk' }, { tab: { id: 1, windowId: 1, url: 'https://www.youtube.com/' }, url: 'https://www.youtube.com/' });
  assert.equal(result.ok, true); assert.equal(result.session.active, true); assert.equal(result.session.focusTabId, 1);
  result = await message({ type: 'PROGRESS', videoId: 'abcdefghijk', title: 'Test video', durationSeconds: 100, watchedSegments: [[0, 3], [2, 5]], currentTimeSeconds: 5, qualifyingPlaybackSeconds: 5, isPlaying: true }, { tab: { id: 1, windowId: 1, url: 'https://www.youtube.com/watch?v=abcdefghijk' } });
  assert.equal(result.ok, true); assert.equal(result.session.knownWatchedSeconds, 5); assert.equal(result.session.qualifyingPlaybackSeconds, 5);
  result = await message({ type: 'BREAK_RESET' }, { tab: { id: 1, windowId: 1, url: 'https://www.youtube.com/watch?v=abcdefghijk' } });
  assert.equal(result.ok, true); assert.equal(result.session.currentBreakQualifyingBaseline, 5);
  result = await message({ type: 'SAVE_NOTE', videoId: 'abcdefghijk', timeSeconds: 5, text: 'Key idea' }, { tab: { id: 1, windowId: 1, url: 'https://www.youtube.com/watch?v=abcdefghijk' } });
  assert.equal(result.ok, true); const noteId = result.item.id;
  result = await message({ type: 'MANAGE_ARTIFACT', kind: 'note', action: 'edit', id: noteId, text: 'Edited key idea' }, { url: 'chrome-extension://test/newtab.html' });
  assert.equal(result.ok, true); assert.equal(result.session.notes[0].text, 'Edited key idea');
  result = await message({ type: 'ADD_BOOKMARK', videoId: 'abcdefghijk', title: 'Test video', timeSeconds: 7 }, { tab: { id: 1, windowId: 1, url: 'https://www.youtube.com/watch?v=abcdefghijk' } });
  assert.equal(result.ok, true); const bookmarkId = result.item.id;
  result = await message({ type: 'MANAGE_ARTIFACT', kind: 'bookmark', action: 'delete', id: bookmarkId }, { url: 'chrome-extension://test/newtab.html' });
  assert.equal(result.ok, true); assert.ok(!result.session.bookmarks.find(item => item.id === bookmarkId));
  result = await message({ type: 'JUMP_TO_TIMESTAMP', videoId: 'abcdefghijk', timeSeconds: 5 }, { url: 'chrome-extension://test/newtab.html' });
  assert.equal(result.ok, true); assert.match(tabs.get(1).url, /t=5s/);

  result = await message({ type: 'END_SESSION' }, { url: 'chrome-extension://test/popup.html' });
  assert.equal(result.ok, true); assert.equal(result.session.active, false); assert.equal(tabs.has(1), false); assert.ok([...tabs.values()].some(t => t.url.includes('newtab.html')));
  result = await message({ type: 'RESUME_LAST_SESSION' }, { url: 'chrome-extension://test/newtab.html', tab: [...tabs.values()].find(t => t.url.includes('newtab.html')) });
  assert.equal(result.ok, true); assert.equal(result.session.active, true); assert.equal(result.session.videos.abcdefghijk.lastPositionSeconds, 5);
  result = await message({ type: 'END_SESSION' }, { url: 'chrome-extension://test/popup.html' });
  assert.equal(result.ok, true); assert.equal(result.session.active, false);
  result = await message({ type: 'EXPORT_BACKUP' }, { url: 'chrome-extension://test/newtab.html' });
  assert.equal(result.ok, true); assert.equal(result.backup.product, 'Study Lock'); assert.ok(Array.isArray(result.backup.plans));
  result = await message({ type: 'COMPLETE_PLAN', id: planId }, { url: 'chrome-extension://test/newtab.html' });
  assert.equal(result.ok, true); assert.ok(result.plans.find(p => p.id === planId).completed);
  result = await message({ type: 'SAVE_SETTINGS', settings: { syncEnabled: true } }, { url: 'chrome-extension://test/newtab.html' });
  assert.equal(result.ok, true); assert.ok(synced.studyLockSyncMeta); assert.ok(Object.keys(synced).some(key => /^studyLockSyncChunk\d+$/.test(key)));

  // A saved plan can be launched directly from a dashboard tab.
  result = await message({ type: 'SAVE_PLAN', title: 'Plan launch smoke test', url: 'https://www.youtube.com/watch?v=mnopqrstuvw', mode: 'video', expectedMinutes: 10, dueAt: Date.now() + 60000 }, { url: 'chrome-extension://test/newtab.html' });
  assert.equal(result.ok, true); const launchPlanId = result.plan.id;
  tabs.set(9, { id: 9, windowId: 1, url: 'chrome-extension://test/newtab.html', active: true });
  result = await message({ type: 'START_PLAN', id: launchPlanId }, { tab: { id: 9, windowId: 1, url: 'chrome-extension://test/newtab.html' }, url: 'chrome-extension://test/newtab.html' });
  assert.equal(result.ok, true); assert.equal(result.session.active, true); assert.match(tabs.get(9).url, /watch\?v=mnopqrstuvw/);
  result = await message({ type: 'END_SESSION' }, { url: 'chrome-extension://test/popup.html' });
  assert.equal(result.ok, true); assert.equal(result.session.active, false); assert.equal(tabs.has(9), false);

  // When Play is clicked on an already-open watch page, starting a session must
  // not reload that page and interrupt the native YouTube player.
  tabs.set(2, { id: 2, windowId: 1, url: 'https://www.youtube.com/watch?v=zyxwvutsrqpo', active: true });
  tabUpdates.length = 0;
  result = await message({ type: 'START_FROM_YOUTUBE', mode: 'video', url: 'https://www.youtube.com/watch?v=zyxwvutsrqpo' }, { tab: { id: 2, windowId: 1, url: 'https://www.youtube.com/watch?v=zyxwvutsrqpo' }, url: 'https://www.youtube.com/watch?v=zyxwvutsrqpo' });
  assert.equal(result.ok, true); assert.equal(result.session.focusTabId, 2);
  assert.ok(tabUpdates.length > 0); assert.ok(tabUpdates.every(update => !Object.hasOwn(update.opts, 'url')));
  result = await message({ type: 'END_SESSION' }, { url: 'chrome-extension://test/popup.html' });
  assert.equal(result.ok, true); assert.equal(result.session.active, false); assert.equal(tabs.has(2), false);
  const backupResult = await message({ type: 'EXPORT_BACKUP' }, { url: 'chrome-extension://test/newtab.html' });
  assert.equal(backupResult.ok, true); assert.equal(backupResult.backup.product, 'Study Lock');
  result = await message({ type: 'IMPORT_BACKUP', backup: backupResult.backup }, { url: 'chrome-extension://test/newtab.html' });
  assert.equal(result.ok, true); assert.ok(Array.isArray(result.plans)); assert.ok(Array.isArray(result.cards));

  console.log('PASS: dashboard state, plan reminders/reschedule/launch/completion/delete, flashcards/review/delete, notes/bookmarks edit/delete, click-to-start and no-reload play path, progress/coverage, break baseline, timestamp jump, end/close, resume, backup/restore, Chrome Sync chunk export.');
})().catch(error => { console.error(error); process.exitCode = 1; });
