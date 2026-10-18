const SESSION_KEY = "studyLockSession";
const HISTORY_KEY = "studyLockHistory";
const SETTINGS_KEY = "studyLockSettings";
const PLANS_KEY = "studyLockPlans";
const CARDS_KEY = "studyLockFlashcards";
const DEFAULT_SETTINGS = {
  dailyGoalMinutes: 120,
  closeOtherTabs: true,
  breakEnabled: false,
  breakEveryMinutes: 50,
  breakLengthMinutes: 5,
  redirectInactiveTabs: true,
  fontScale: "normal",
  reduceMotion: false,
  captionsDefault: false,
  syncEnabled: false
};

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get([SESSION_KEY, HISTORY_KEY, SETTINGS_KEY]);
  if (!existing[SESSION_KEY]) await chrome.storage.local.set({ [SESSION_KEY]: { active: false, completed: false, videos: {} } });
  if (!Array.isArray(existing[HISTORY_KEY])) await chrome.storage.local.set({ [HISTORY_KEY]: [] });
  if (!existing[SETTINGS_KEY]) await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  if (!Array.isArray(existing[PLANS_KEY])) await chrome.storage.local.set({ [PLANS_KEY]: [] });
  if (!Array.isArray(existing[CARDS_KEY])) await chrome.storage.local.set({ [CARDS_KEY]: [] });
});

async function getSession() {
  const data = await chrome.storage.local.get(SESSION_KEY);
  return data[SESSION_KEY] || { active: false, completed: false, videos: {} };
}
// Serialize session writes and prevent an in-flight PROGRESS message from
// resurrecting a session after END_SESSION has already persisted endedAt.
let sessionWriteChain = Promise.resolve();
async function saveSession(session, options = {}) {
  const snapshot = JSON.parse(JSON.stringify(session));
  const allowResume = options.allowResume === true;
  const task = sessionWriteChain.then(async () => {
    const stored = await chrome.storage.local.get(SESSION_KEY);
    const current = stored[SESSION_KEY];
    if (!allowResume && current && current.active === false && current.endedAt &&
        current.startedAt === snapshot.startedAt && !snapshot.endedAt) {
      // This write was based on an older active-session snapshot. Never allow
      // it to overwrite the completed/ended state.
      return current;
    }
    await chrome.storage.local.set({ [SESSION_KEY]: snapshot });
    return snapshot;
  });
  sessionWriteChain = task.catch(() => {});
  return task;
}
async function getSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) };
}
async function getHistory() {
  const data = await chrome.storage.local.get(HISTORY_KEY);
  return Array.isArray(data[HISTORY_KEY]) ? data[HISTORY_KEY] : [];
}
async function getPlans() {
  const data = await chrome.storage.local.get(PLANS_KEY);
  return Array.isArray(data[PLANS_KEY]) ? data[PLANS_KEY] : [];
}
async function getCards() {
  const data = await chrome.storage.local.get(CARDS_KEY);
  return Array.isArray(data[CARDS_KEY]) ? data[CARDS_KEY] : [];
}
function safeVideoUrl(raw, mode) {
  const inferred = mode || (() => { try { return new URL(raw).pathname === "/playlist" ? "playlist" : "video"; } catch { return "video"; } })();
  return parseInput(raw, inferred).startUrl;
}
function safeReminderAlarm(plan) {
  if (!plan || !plan.id || !Number.isFinite(Number(plan.dueAt))) return;
  try {
    const when = Number(plan.dueAt);
    if (plan.completed) { if (chrome.alarms?.clear) chrome.alarms.clear(`study-plan-${plan.id}`); return; }
    if (when > Date.now() && chrome.alarms?.create) chrome.alarms.create(`study-plan-${plan.id}`, { when });
    else if (chrome.alarms?.clear) chrome.alarms.clear(`study-plan-${plan.id}`);
  } catch (error) { console.warn("Study Lock could not schedule a plan reminder", error); }
}
let applyingSyncSnapshot = false;
async function syncDataToChrome() {
  const settings = await getSettings();
  if (!settings.syncEnabled || applyingSyncSnapshot || !chrome.storage.sync) return { ok: true, skipped: true };
  try {
    const [history, plans, cards, session] = await Promise.all([getHistory(), getPlans(), getCards(), getSession()]);
    const savedSession = !session.active && session.endedAt ? session : null;
    const snapshot = { product: "Study Lock", schemaVersion: 1, updatedAt: Date.now(), settings, history, plans, cards, savedSession };
    const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
    const encoded = btoa(binary);
    const chunkSize = 6000;
    const chunks = [];
    for (let i = 0; i < encoded.length; i += chunkSize) chunks.push(encoded.slice(i, i + chunkSize));
    if (chunks.length > 12) return { ok: false, warning: "Chrome Sync's storage quota is too small for this data. Use Download backup to preserve everything." };
    const old = await chrome.storage.sync.get(null);
    const output = {};
    chunks.forEach((chunk, index) => output[`studyLockSyncChunk${index}`] = chunk);
    output.studyLockSyncMeta = { count: chunks.length, updatedAt: snapshot.updatedAt, schemaVersion: 1 };
    await chrome.storage.sync.set(output);
    const stale = Object.keys(old || {}).filter(key => /^studyLockSyncChunk\d+$/.test(key) && Number(key.replace("studyLockSyncChunk", "")) >= chunks.length);
    if (stale.length) await chrome.storage.sync.remove(stale);
    return { ok: true, updatedAt: snapshot.updatedAt };
  } catch (error) {
    console.warn("Study Lock Chrome Sync failed", error);
    return { ok: false, warning: "Chrome Sync failed or reached its quota. Download a backup to preserve your data." };
  }
}
async function applySyncedSnapshot() {
  if (!chrome.storage.sync || applyingSyncSnapshot) return;
  const all = await chrome.storage.sync.get(null);
  const meta = all.studyLockSyncMeta;
  if (!meta || !Number.isInteger(meta.count) || meta.count < 1 || meta.count > 12) return;
  let encoded = "";
  for (let i = 0; i < meta.count; i++) {
    const chunk = all[`studyLockSyncChunk${i}`];
    if (typeof chunk !== "string") return;
    encoded += chunk;
  }
  try {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const snapshot = JSON.parse(new TextDecoder().decode(bytes));
    if (snapshot.product !== "Study Lock" || snapshot.schemaVersion !== 1 || !snapshot.settings || !Array.isArray(snapshot.history) || !Array.isArray(snapshot.plans) || !Array.isArray(snapshot.cards)) return;
    const local = await chrome.storage.local.get([SETTINGS_KEY, HISTORY_KEY, PLANS_KEY, CARDS_KEY, SESSION_KEY]);
    const localMetaTime = Number(local[SETTINGS_KEY]?.lastSyncUpdatedAt) || 0;
    if (Number(snapshot.updatedAt) <= localMetaTime) return;
    applyingSyncSnapshot = true;
    const settings = { ...DEFAULT_SETTINGS, ...snapshot.settings, lastSyncUpdatedAt: Number(snapshot.updatedAt) };
    await chrome.storage.local.set({
      [SETTINGS_KEY]: settings,
      [HISTORY_KEY]: snapshot.history.slice(0, 200),
      [PLANS_KEY]: snapshot.plans.slice(0, 200),
      [CARDS_KEY]: snapshot.cards.slice(0, 1000),
      ...(snapshot.savedSession && !local[SESSION_KEY]?.active ? { [SESSION_KEY]: snapshot.savedSession } : {})
    });
    for (const plan of snapshot.plans) safeReminderAlarm(plan);
  } catch (error) {
    console.warn("Study Lock could not apply Chrome Sync data", error);
  } finally { applyingSyncSnapshot = false; }
}
function parseVideoId(url) {
  const host = url.hostname.toLowerCase();
  if (host === "youtu.be" || host.endsWith(".youtu.be")) return url.pathname.split("/").filter(Boolean)[0] || null;
  const v = url.searchParams.get("v");
  if (v) return v;
  const parts = url.pathname.split("/").filter(Boolean);
  if (["shorts", "embed", "live"].includes(parts[0])) return parts[1] || null;
  return null;
}
function parseInput(raw, mode) {
  let url;
  try { url = new URL(String(raw || "").trim()); } catch { throw new Error("Paste a complete YouTube video or playlist URL."); }
  const host = url.hostname.toLowerCase();
  if (!(host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be" || host.endsWith(".youtu.be")) || !["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only YouTube video and playlist links are supported.");
  }
  const videoId = parseVideoId(url);
  const playlistId = url.searchParams.get("list");
  const idPattern = /^[A-Za-z0-9_-]{6,}$/;
  if (mode === "video") {
    if (!videoId || !idPattern.test(videoId)) throw new Error("That URL does not contain a recognizable video ID. For a playlist, choose Playlist mode.");
    return { mode: "video", videoId, playlistId: null, startUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, sourceTitle: "Selected YouTube video" };
  }
  if (!playlistId || !idPattern.test(playlistId)) throw new Error("That URL does not contain a playlist ID. Paste a YouTube playlist URL.");
  const startUrl = videoId && idPattern.test(videoId)
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&list=${encodeURIComponent(playlistId)}`
    : `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;
  return { mode: "playlist", videoId: videoId && idPattern.test(videoId) ? videoId : null, playlistId, startUrl, sourceTitle: "Selected YouTube playlist" };
}
function isDashboardUrl(rawUrl) {
  if (!rawUrl) return false;
  const expected = chrome.runtime.getURL("newtab.html");
  return rawUrl === expected || rawUrl.startsWith(`${expected}#`) || rawUrl.startsWith(`${expected}?`);
}
function isPendingNewTabUrl(rawUrl) {
  return !rawUrl || rawUrl === "chrome://newtab/" || rawUrl === "chrome://newtab" || rawUrl === "about:blank";
}
function isEmergencyBrowserPage(rawUrl) {
  // Never redirect Chrome's extension manager/settings away. These pages are
  // the recovery path if a focus session or its in-page button becomes stuck.
  return /^chrome:\/\/(extensions|settings|help)(\/|$)/i.test(String(rawUrl || ""));
}
function hostIsYouTube(url) { return url.hostname === "youtube.com" || url.hostname.endsWith(".youtube.com"); }
function isAllowedUrl(rawUrl, session) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || !hostIsYouTube(url)) return false;
    if (url.pathname === "/playlist" && session.mode === "playlist") return url.searchParams.get("list") === session.playlistId;
    if (url.pathname !== "/watch") return false;
    if (session.mode === "video") return url.searchParams.get("v") === session.videoId;
    return url.searchParams.get("list") === session.playlistId && (!session.videoId || Boolean(url.searchParams.get("v")));
  } catch { return false; }
}
function currentStudyUrl(session) {
  let id = session.mode === "video" ? session.videoId : (session.currentVideoId || session.videoId);
  if (session.mode === "playlist" && session.videos?.[id]?.completed) {
    const nextIncomplete = (session.playlistOrder || []).find(videoId => !session.videos?.[videoId]?.completed);
    if (nextIncomplete) id = nextIncomplete;
  }
  const record = session.videos?.[id] || {};
  if (session.mode === "video") {
    const params = new URLSearchParams({ v: session.videoId });
    const position = Math.floor(Number(record.lastPositionSeconds) || 0);
    if (position > 2 && !record.completed) params.set("t", String(position));
    return `https://www.youtube.com/watch?${params.toString()}`;
  }
  const list = encodeURIComponent(session.playlistId);
  if (!id) return `https://www.youtube.com/playlist?list=${list}`;
  const params = new URLSearchParams({ v: id, list: session.playlistId });
  const position = Math.floor(Number(record.lastPositionSeconds) || 0);
  if (position > 2 && !record.completed) params.set("t", String(position));
  return `https://www.youtube.com/watch?${params.toString()}`;
}
async function keepAwake(enabled) {
  try { if (enabled) chrome.power.requestKeepAwake("display"); else chrome.power.releaseKeepAwake(); } catch (error) { console.warn("Study Lock power request failed", error); }
}
function mergeSegments(input) {
  const clean = (Array.isArray(input) ? input : [])
    .map(pair => [Math.max(0, Number(pair?.[0]) || 0), Math.max(0, Number(pair?.[1]) || 0)])
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [start, end] of clean) {
    const last = out[out.length - 1];
    if (last && start <= last[1] + 0.35) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out.slice(0, 2000);
}
function segmentSeconds(segments) { return mergeSegments(segments).reduce((n, [a, b]) => n + (b - a), 0); }
function recalcTotals(session) {
  const videos = Object.values(session.videos || {});
  session.knownTotalSeconds = videos.reduce((n, video) => n + Math.max(0, Number(video.durationSeconds) || 0), 0);
  session.knownWatchedSeconds = videos.reduce((n, video) => {
    const dur = Math.max(0, Number(video.durationSeconds) || 0);
    const watched = Array.isArray(video.watchedSegments) ? segmentSeconds(video.watchedSegments) : (Number(video.watchedSeconds) || 0);
    return n + (dur ? Math.min(dur, watched) : watched);
  }, 0);
  session.knownRemainingSeconds = videos.reduce((n, video) => {
    const duration = Math.max(0, Number(video.durationSeconds) || 0);
    const watched = Array.isArray(video.watchedSegments) ? segmentSeconds(video.watchedSegments) : (Number(video.watchedSeconds) || 0);
    return n + (duration ? Math.max(0, duration - Math.min(duration, watched)) : 0);
  }, 0);
  session.completedVideoCount = videos.filter(video => video.completed).length;
  session.knownVideoCount = videos.length;
  session.qualifyingPlaybackSeconds = videos.reduce((n, video) => n + Math.max(0, Number(video.qualifyingPlaybackSeconds) || 0), 0);
}
function localDateKey(time = Date.now()) {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function historyDurationToday(history, session) {
  const today = localDateKey();
  let seconds = history.reduce((sum, item) => sum + (item.dateKey === today ? (Number(item.qualifyingPlaybackSeconds) || Number(item.watchedSeconds) || 0) : 0), 0);
  if (session?.active && localDateKey(session.startedAt || Date.now()) === today) seconds += Number(session.qualifyingPlaybackSeconds) || 0;
  return seconds;
}
async function dashboardData() {
  const [session, history, settings, plans, cards] = await Promise.all([getSession(), getHistory(), getSettings(), getPlans(), getCards()]);
  recalcTotals(session);
  return { session, history, settings, plans, cards, todayStudiedSeconds: historyDurationToday(history, session) };
}
async function startSession(message, sender) {
  const prior = await getSession();
  if (prior.active) throw new Error("A focus session is already running. End it before starting another.");
  const parsed = parseInput(message.url, message.mode || "video");
  const settings = await getSettings();
  let tab = null;
  const fromYouTubeTab = Boolean(message.fromYouTube && sender?.tab?.id != null && (() => {
    try { const source = new URL(sender.tab.url || ""); return source.protocol === "https:" && hostIsYouTube(source); } catch { return false; }
  })());
  if (fromYouTubeTab) {
    // Start directly in the YouTube tab the user selected, instead of opening a duplicate tab.
    tab = sender.tab;
    try { await chrome.tabs.update(tab.id, { active: true }); } catch {}
  } else if (sender?.tab?.id != null && isDashboardUrl(sender.tab.url || "")) {
    tab = sender.tab;
    try { await chrome.tabs.update(tab.id, { active: true }); } catch {}
  } else {
    tab = await chrome.tabs.create({ url: "about:blank", active: true });
  }
  const startedAt = Date.now();
  const session = {
    active: true, completed: false, mode: parsed.mode,
    videoId: parsed.videoId, currentVideoId: parsed.videoId, playlistId: parsed.playlistId,
    startUrl: parsed.startUrl, sourceTitle: parsed.sourceTitle,
    focusTabId: tab.id, focusWindowId: tab.windowId,
    sessionId: `session-${startedAt}-${Math.random().toString(36).slice(2, 7)}`,
    startedAt, activeSegmentStartedAt: startedAt, activeElapsedSeconds: 0, endedAt: null,
    closeOtherTabs: message.closeOtherTabs ?? settings.closeOtherTabs, planId: message.planId || null,
    videos: {}, notes: [], bookmarks: [], currentBreakStartedAt: startedAt, currentBreakQualifyingBaseline: 0,
    lastProgressAt: startedAt, breakPrompted: false
  };
  await saveSession(session);
  await keepAwake(true);
  // When a learner clicks Play on the video already open in this YouTube tab,
  // do not reload the page: let that same native player continue playing.
  const alreadyAtSelectedLesson = fromYouTubeTab && (() => {
    try {
      const current = new URL(sender.tab.url || "");
      if (current.protocol !== "https:") return false;
      const currentVideoId = parseVideoId(current);
      if (parsed.mode === "video") return current.pathname === "/watch" && currentVideoId === parsed.videoId;
      return current.searchParams.get("list") === parsed.playlistId &&
        (parsed.videoId ? currentVideoId === parsed.videoId : current.pathname === "/playlist");
    } catch { return false; }
  })();
  if (!alreadyAtSelectedLesson) {
    try { await chrome.tabs.update(tab.id, { url: parsed.startUrl, active: true }); }
    catch (error) { await saveSession({ ...session, active: false }); await keepAwake(false); throw new Error("Could not open the selected YouTube lesson. Check that Chrome can open YouTube."); }
  } else {
    try { await chrome.tabs.update(tab.id, { active: true }); } catch {}
  }
  if (session.closeOtherTabs) {
    try {
      const tabs = await chrome.tabs.query({});
      const ids = tabs.map(t => t.id).filter(id => Number.isInteger(id) && id !== tab.id);
      if (ids.length) await chrome.tabs.remove(ids);
    } catch (error) { console.warn("Study Lock could not close every other tab", error); }
  }
  return { ok: true, session };
}

const SOCIAL_CONFIG_KEY = "studyLockSocialConfig";
async function getSocialConfig() {
  const data = await chrome.storage.local.get(SOCIAL_CONFIG_KEY);
  const config = data[SOCIAL_CONFIG_KEY];
  if (!config?.token || !config?.apiBase) return null;
  try {
    const url = new URL(config.apiBase);
    const local = ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
    return { ...config, apiBase: url.origin };
  } catch { return null; }
}
function socialEventChunks(session) {
  const events = [];
  const sessionId = String(session.sessionId || `session-${session.startedAt || Date.now()}`).replace(/[^A-Za-z0-9:_-]/g, "-").slice(0, 45);
  const records = Object.entries(session.videos || {});
  for (const [videoId, record] of records) {
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) continue;
    const qualifying = Math.max(0, Math.min(8 * 60 * 60, Math.floor(Number(record.qualifyingPlaybackSeconds) || 0)));
    const coverage = Math.max(0, Math.min(8 * 60 * 60, Math.floor(Number(record.watchedSeconds) || 0)));
    const chunks = Math.ceil(Math.max(qualifying, coverage) / 120);
    for (let i = 0; i < chunks; i++) {
      events.push({
        eventId: `sl-${sessionId}-${videoId}-time-${i}`,
        sessionId, videoId, videoTitle: String(record.title || "YouTube lesson").slice(0, 180),
        qualifyingSeconds: Math.min(120, Math.max(0, qualifying - i * 120)),
        coverageSeconds: Math.min(120, Math.max(0, coverage - i * 120)), completed: false,
        eventAt: Number(record.lastSeenAt) || Number(session.startedAt) || Date.now()
      });
    }
    if (record.completed) events.push({
      eventId: `sl-${sessionId}-${videoId}-complete`, sessionId, videoId,
      videoTitle: String(record.title || "Completed YouTube lesson").slice(0, 180),
      qualifyingSeconds: 0, coverageSeconds: 0, completed: true,
      eventAt: Number(record.lastSeenAt) || Number(session.endedAt) || Date.now()
    });
  }
  return events;
}
async function sendSocialEvents(events) {
  if (!events.length) return { accepted: 0, ignored: 0 };
  const config = await getSocialConfig();
  if (!config) return { skipped: true };
  let accepted = 0, ignored = 0;
  for (let i = 0; i < events.length; i += 50) {
    const response = await fetch(`${config.apiBase}/api/study-events`, {
      method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json", "Authorization": `Bearer ${config.token}` },
      body: JSON.stringify({ events: events.slice(i, i + 50) }), signal: AbortSignal.timeout(5000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Social activity upload failed (${response.status}).`);
    accepted += Number(data.accepted) || 0; ignored += (data.ignored || []).length;
  }
  return { accepted, ignored };
}
async function syncEndedSessionToSocial(session, historyEntry) {
  try {
    const result = await sendSocialEvents(socialEventChunks(session));
    if (result.skipped) return { ok: true, skipped: true };
    return { ok: true, ...result };
  } catch (error) {
    console.warn("Study Lock Social activity sync failed:", error);
    return { ok: false, error: String(error?.message || "Sync failed").slice(0, 300) };
  }
}

async function finishSession(completed, reason = null) {
  const session = await getSession();
  if (!session.active) {
    // Idempotent recovery: pressing End twice must still release any stale
    // keep-awake request and return the saved state.
    await keepAwake(false);
    return { ok: true, session };
  }
  recalcTotals(session);
  const endedAt = Date.now();
  const segmentStart = Number(session.activeSegmentStartedAt) || Number(session.startedAt) || endedAt;
  const segmentElapsed = Math.max(0, Math.floor((endedAt - segmentStart) / 1000));
  session.activeElapsedSeconds = Math.max(0, Number(session.activeElapsedSeconds) || 0) + segmentElapsed;
  session.activeSegmentStartedAt = null;
  session.active = false;
  session.completed = Boolean(completed);
  session.endedAt = endedAt;
  session.endReason = reason || (completed ? "completed" : "ended-by-user");
  await saveSession(session);
  await keepAwake(false);
  const history = await getHistory();
  const durationSeconds = Math.max(0, Math.floor(Number(session.activeElapsedSeconds) || 0));
  const entry = {
    id: session.sessionId || `session-${session.startedAt}`, dateKey: localDateKey(session.startedAt),
    mode: session.mode, sourceTitle: session.sourceTitle || "YouTube study session",
    startedAt: session.startedAt, endedAt: session.endedAt, durationSeconds,
    watchedSeconds: Math.floor(Number(session.knownWatchedSeconds) || 0),
    qualifyingPlaybackSeconds: Math.floor(Number(session.qualifyingPlaybackSeconds) || 0),
    totalSeconds: Math.floor(Number(session.knownTotalSeconds) || 0),
    completedVideos: Number(session.completedVideoCount) || 0,
    trackedVideos: Number(session.knownVideoCount) || 0,
    completed: Boolean(completed), endReason: session.endReason,
    notes: Array.isArray(session.notes) ? session.notes.slice(-500) : [],
    bookmarks: Array.isArray(session.bookmarks) ? session.bookmarks.slice(-500) : []
  };
  let newHistory = [entry, ...history.filter(item => item.id !== entry.id)].slice(0, 200);
  await chrome.storage.local.set({ [HISTORY_KEY]: newHistory });
  const socialSync = await syncEndedSessionToSocial(session, entry);
  if (socialSync.ok && !socialSync.skipped) {
    newHistory = newHistory.map(item => item.id === entry.id ? { ...item, socialSyncedAt: Date.now(), socialSyncResult: { accepted: socialSync.accepted, ignored: socialSync.ignored } } : item);
    await chrome.storage.local.set({ [HISTORY_KEY]: newHistory });
  } else if (!socialSync.ok) {
    newHistory = newHistory.map(item => item.id === entry.id ? { ...item, socialSyncError: socialSync.error } : item);
    await chrome.storage.local.set({ [HISTORY_KEY]: newHistory });
  }
  if (completed && session.planId) {
    const plans = await getPlans();
    const updatedPlans = plans.map(plan => plan.id === session.planId ? { ...plan, completed: true, completedAt: endedAt } : plan);
    await chrome.storage.local.set({ [PLANS_KEY]: updatedPlans });
    try { await chrome.alarms?.clear(`study-plan-${session.planId}`); } catch {}
  }
  await syncDataToChrome();
  return { ok: true, session, history: newHistory };
}
async function endSessionAndCloseLesson(reason = "ended-by-user") {
  const before = await getSession();
  const lessonTabId = before.active && Number.isInteger(before.focusTabId) ? before.focusTabId : null;
  const lessonWindowId = Number.isInteger(before.focusWindowId) ? before.focusWindowId : undefined;
  const result = await finishSession(false, reason);
  if (!before.active || lessonTabId === null) return result;

  // Replace the lesson tab with the Study Lock dashboard first, then close the tab
  // that was playing the lecture. This also avoids closing the entire window when
  // the lecture was the only remaining tab.
  let dashboardTab = null;
  try {
    const createOptions = { url: chrome.runtime.getURL("newtab.html"), active: true };
    if (lessonWindowId !== undefined) createOptions.windowId = lessonWindowId;
    dashboardTab = await chrome.tabs.create(createOptions);
  } catch (error) {
    console.warn("Study Lock could not open the post-session dashboard", error);
  }
  try { await chrome.tabs.remove(lessonTabId); }
  catch (error) { console.warn("Study Lock could not close the lecture tab", error); }
  return { ...result, dashboardTabId: dashboardTab?.id ?? null };
}
async function resumeLastSession(sender) {
  const prior = await getSession();
  if (prior.active) throw new Error("A study session is already active.");
  if (!prior.endedAt || prior.completed || !prior.mode) throw new Error("There is no unfinished session to resume.");
  if (prior.mode === "video" && !prior.videoId) throw new Error("The saved video link is missing. Start a new session instead.");
  if (prior.mode === "playlist" && !prior.playlistId) throw new Error("The saved playlist link is missing. Start a new session instead.");

  const now = Date.now();
  let tab = null;
  if (sender?.tab?.id != null && isDashboardUrl(sender.tab.url || "")) {
    tab = sender.tab;
  } else {
    tab = await chrome.tabs.create({ url: "about:blank", active: true });
  }
  const resumed = {
    ...prior, active: true, completed: false, endedAt: null, endReason: null,
    focusTabId: tab.id, focusWindowId: tab.windowId,
    activeSegmentStartedAt: now, currentBreakStartedAt: now, currentBreakQualifyingBaseline: Math.max(0, Number(prior.qualifyingPlaybackSeconds) || 0), lastProgressAt: now,
    breakPrompted: false, resumedAt: now
  };
  await saveSession(resumed, { allowResume: true });
  await keepAwake(true);
  try {
    await chrome.tabs.update(tab.id, { url: currentStudyUrl(resumed), active: true });
  } catch (error) {
    await saveSession(prior, { allowResume: true });
    await keepAwake(false);
    throw new Error("Could not reopen the saved lesson. Check that Chrome can open YouTube.");
  }

  // Remove the previous ended report while this continuation is active; when the
  // user ends or completes it, the same report ID is written again with combined progress.
  const history = await getHistory();
  const reportId = prior.sessionId || `session-${prior.startedAt}`;
  await chrome.storage.local.set({ [HISTORY_KEY]: history.filter(item => item.id !== reportId) });
  if (resumed.closeOtherTabs) {
    try {
      const tabs = await chrome.tabs.query({});
      const ids = tabs.map(item => item.id).filter(id => Number.isInteger(id) && id !== tab.id);
      if (ids.length) await chrome.tabs.remove(ids);
    } catch (error) { console.warn("Study Lock could not close tabs while resuming", error); }
  }
  return { ok: true, session: resumed };
}
async function redirectTabToStudy(tabId, _session, activate = true) {
  if (!Number.isInteger(tabId)) return;
  // Re-read immediately before redirecting. A tab event may have started just
  // before the user ended the session; stale event snapshots must not keep
  // forcing the user back into the lesson after the session has ended.
  const latest = await getSession();
  if (!latest.active) return;
  const url = currentStudyUrl(latest);
  try {
    const stillActive = await getSession();
    if (!stillActive.active) return;
    await chrome.tabs.update(tabId, { url, active: Boolean(activate) });
  } catch (error) { console.warn("Study Lock could not redirect tab to the active lesson", error); }
}
async function focusTab(tab) {
  if (!tab || !Number.isInteger(tab.id)) return;
  const session = await getSession();
  if (!session.active) return;
  if (session.focusTabId !== tab.id) {
    session.focusTabId = tab.id;
    session.focusWindowId = tab.windowId;
    await saveSession(session);
  }
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message?.type === "GET_STATUS" || message?.type === "GET_DASHBOARD" || message?.type === "GET_CONTENT_STATE") {
        const data = await dashboardData();
        sendResponse({ ok: true, ...data, isFocusTab: sender.tab?.id === data.session.focusTabId }); return;
      }
      if (message?.type === "START_SESSION") { sendResponse(await startSession(message, sender)); return; }
      if (message?.type === "START_FROM_YOUTUBE") {
        if (!sender?.tab?.url) throw new Error("Open a YouTube video or playlist first.");
        const targetUrl = String(message.url || sender.tab.url);
        const inferredMode = message.mode || (() => { try { return new URL(targetUrl).pathname === "/playlist" ? "playlist" : "video"; } catch { return "video"; } })();
        sendResponse(await startSession({ url: targetUrl, mode: inferredMode, closeOtherTabs: false, fromYouTube: true, planId: message.planId || null }, sender)); return;
      }
      if (message?.type === "END_SESSION") { sendResponse(await endSessionAndCloseLesson("ended-by-user")); return; }
      if (message?.type === "RESUME_LAST_SESSION") { sendResponse(await resumeLastSession(sender)); return; }
      if (message?.type === "RESUME_SESSION") {
        const session = await getSession();
        if (!session.active) { sendResponse({ ok: false, error: "There is no active session." }); return; }
        if (Number.isInteger(sender.tab?.id)) {
          session.focusTabId = sender.tab.id; session.focusWindowId = sender.tab.windowId; await saveSession(session);
          await redirectTabToStudy(sender.tab.id, session, true);
        } else await redirectTabToStudy(session.focusTabId, session, true);
        sendResponse({ ok: true, session }); return;
      }
      if (message?.type === "SESSION_COMPLETE") {
        const session = await getSession();
        if (session.active && sender.tab?.id === session.focusTabId) sendResponse(await finishSession(true, "completed"));
        else sendResponse({ ok: false, ignored: true });
        return;
      }
      if (message?.type === "PROGRESS") {
        const session = await getSession();
        if (!session.active || sender.tab?.id !== session.focusTabId) { sendResponse({ ok: false, ignored: true }); return; }
        const id = String(message.videoId || "");
        if (!/^[A-Za-z0-9_-]{6,}$/.test(id)) { sendResponse({ ok: false, error: "Invalid video ID." }); return; }
        const duration = Number(message.durationSeconds);
        const prev = session.videos[id] || {};
        const incoming = Array.isArray(message.watchedSegments) ? message.watchedSegments : (prev.watchedSegments || []);
        const effectiveDuration = Number.isFinite(duration) && duration > 0 && duration < 24 * 60 * 60 ? duration : (Number(prev.durationSeconds) || 0);
        const mergedSegments = mergeSegments([...(prev.watchedSegments || []), ...incoming]);
        // Clamp persisted coverage to the known media duration so malformed or stale ranges
        // can never create impossible coverage when duration metadata becomes available.
        const segments = effectiveDuration > 0
          ? mergedSegments.map(([start, end]) => [Math.min(effectiveDuration, start), Math.min(effectiveDuration, end)]).filter(([start, end]) => end > start)
          : mergedSegments;
        const watchedSeconds = Math.min(effectiveDuration || Number.MAX_SAFE_INTEGER, segmentSeconds(segments));
        session.videos[id] = {
          ...prev,
          title: String(message.title || prev.title || "YouTube video").trim().slice(0, 180),
          durationSeconds: effectiveDuration,
          watchedSegments: segments,
          watchedSeconds,
          lastPositionSeconds: Math.max(0, Number(message.currentTimeSeconds) || 0),
          isPlaying: Boolean(message.isPlaying), lastSeenAt: Date.now(),
          completed: Boolean(prev.completed || message.completed),
          qualifyingPlaybackSeconds: Math.max(Number(prev.qualifyingPlaybackSeconds) || 0, Math.max(0, Number(message.qualifyingPlaybackSeconds) || 0))
        };
        session.currentVideoId = id;
        session.currentTitle = session.videos[id].title;
        if (session.mode === "video") session.sourceTitle = session.videos[id].title;
        session.lastPositionSeconds = session.videos[id].lastPositionSeconds;
        session.lastProgressAt = Date.now();
        if (message.completed) session.videos[id].completed = true;
        recalcTotals(session);
        await saveSession(session);
        const history = await getHistory();
        sendResponse({ ok: true, session, todayStudiedSeconds: historyDurationToday(history, session) }); return;
      }
      if (message?.type === "DURATIONS_FOUND") {
        const session = await getSession();
        if (!session.active || sender.tab?.id !== session.focusTabId || session.mode !== "playlist") { sendResponse({ ok: false, ignored: true }); return; }
        for (const item of (Array.isArray(message.items) ? message.items : [])) {
          const id = String(item.id || ""); const dur = Number(item.durationSeconds);
          if (!/^[A-Za-z0-9_-]{6,}$/.test(id) || !Number.isFinite(dur) || dur <= 0 || dur > 86400) continue;
          const priorVideo = session.videos[id] || {};
          session.videos[id] = { ...priorVideo, title: String(item.title || priorVideo.title || "YouTube video").slice(0, 180), durationSeconds: dur, watchedSegments: mergeSegments(priorVideo.watchedSegments || []), watchedSeconds: Number(priorVideo.watchedSeconds) || 0, completed: Boolean(priorVideo.completed) };
        }
        const discoveredOrder = (Array.isArray(message.items) ? message.items : []).map(item => String(item.id || "")).filter(id => /^[A-Za-z0-9_-]{6,}$/.test(id));
        if (discoveredOrder.length) {
          const mergedOrder = [...(session.playlistOrder || []), ...discoveredOrder];
          session.playlistOrder = [...new Set(mergedOrder)];
        }
        session.knownPlaylistCount = Math.max(Number(session.knownPlaylistCount) || 0, Number(message.playlistCount) || 0);
        recalcTotals(session); await saveSession(session); sendResponse({ ok: true, session }); return;
      }
      if (message?.type === "SAVE_NOTE" || message?.type === "ADD_BOOKMARK") {
        const session = await getSession();
        if (!session.active || sender.tab?.id !== session.focusTabId) { sendResponse({ ok: false, error: "Notes can only be saved in the active study tab." }); return; }
        const id = String(message.videoId || session.currentVideoId || "");
        const video = session.videos?.[id] || {};
        const item = {
          id: `${message.type === "SAVE_NOTE" ? "note" : "bookmark"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          videoId: id, title: String(message.title || video.title || "YouTube video").slice(0, 180),
          timeSeconds: Math.max(0, Number(message.timeSeconds) || Number(video.lastPositionSeconds) || 0),
          createdAt: Date.now(), text: String(message.text || "").trim().slice(0, 2000)
        };
        if (message.type === "SAVE_NOTE") {
          if (!item.text) { sendResponse({ ok: false, error: "Write a note first." }); return; }
          session.notes ||= []; session.notes.push(item); session.notes = session.notes.slice(-500);
        } else {
          session.bookmarks ||= []; session.bookmarks.push(item); session.bookmarks = session.bookmarks.slice(-500);
        }
        await saveSession(session); sendResponse({ ok: true, item, session }); return;
      }
      if (message?.type === "DELETE_NOTE") {
        const session = await getSession();
        if (!session.active || sender.tab?.id !== session.focusTabId) { sendResponse({ ok: false, error: "No active study session." }); return; }
        session.notes = (session.notes || []).filter(note => note.id !== message.id); await saveSession(session); sendResponse({ ok: true, session }); return;
      }
      if (message?.type === "SAVE_SETTINGS") {
        const old = await getSettings();
        const requested = message.settings || {};
        const settings = {
          dailyGoalMinutes: Math.max(15, Math.min(1440, Number(requested.dailyGoalMinutes) || old.dailyGoalMinutes)),
          closeOtherTabs: typeof requested.closeOtherTabs === "boolean" ? requested.closeOtherTabs : old.closeOtherTabs,
          breakEnabled: typeof requested.breakEnabled === "boolean" ? requested.breakEnabled : old.breakEnabled,
          breakEveryMinutes: Math.max(15, Math.min(240, Number(requested.breakEveryMinutes) || old.breakEveryMinutes)),
          breakLengthMinutes: Math.max(1, Math.min(30, Number(requested.breakLengthMinutes) || old.breakLengthMinutes)),
          redirectInactiveTabs: typeof requested.redirectInactiveTabs === "boolean" ? requested.redirectInactiveTabs : old.redirectInactiveTabs,
          fontScale: ["normal", "large", "x-large"].includes(requested.fontScale) ? requested.fontScale : (old.fontScale || "normal"),
          reduceMotion: typeof requested.reduceMotion === "boolean" ? requested.reduceMotion : Boolean(old.reduceMotion),
          captionsDefault: typeof requested.captionsDefault === "boolean" ? requested.captionsDefault : Boolean(old.captionsDefault),
          syncEnabled: typeof requested.syncEnabled === "boolean" ? requested.syncEnabled : Boolean(old.syncEnabled)
        };
        await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
        const syncResult = await syncDataToChrome();
        sendResponse({ ok: true, settings, syncWarning: syncResult.warning || null }); return;
      }
      if (message?.type === "SAVE_PLAN") {
        const title = String(message.title || "").trim().slice(0, 180);
        const planMode = ["video", "playlist"].includes(message.mode) ? message.mode : undefined;
        const url = safeVideoUrl(String(message.url || ""), planMode);
        if (!title) throw new Error("Give this study plan a title.");
        const dueAt = Number(message.dueAt) || 0;
        if (dueAt && dueAt < Date.now() - 60000) throw new Error("Choose a future reminder time.");
        const plans = await getPlans();
        const item = { id: String(message.id || `plan-${Date.now()}-${Math.random().toString(36).slice(2,8)}`), title, url, mode: planMode || (new URL(url).pathname === "/playlist" ? "playlist" : "video"), dueAt, expectedMinutes: Math.max(1, Math.min(1440, Number(message.expectedMinutes) || 30)), completed: false, createdAt: Date.now() };
        const next = [item, ...plans.filter(p => p.id !== item.id)].slice(0, 200);
        await chrome.storage.local.set({ [PLANS_KEY]: next }); safeReminderAlarm(item);
        const syncResult = await syncDataToChrome();
        sendResponse({ ok: true, plan: item, plans: next, syncWarning: syncResult.warning || null }); return;
      }
      if (message?.type === "RESCHEDULE_PLAN") {
        const dueAt = Number(message.dueAt) || 0;
        if (dueAt <= Date.now()) throw new Error("Choose a future reminder time.");
        const plans = await getPlans(); const prior = plans.find(plan => plan.id === message.id && !plan.completed);
        if (!prior) throw new Error("That study plan is no longer available.");
        const next = plans.map(plan => plan.id === message.id ? { ...plan, dueAt, rescheduledAt: Date.now() } : plan);
        await chrome.storage.local.set({ [PLANS_KEY]: next }); safeReminderAlarm(next.find(plan => plan.id === message.id));
        const syncResult = await syncDataToChrome();
        sendResponse({ ok: true, plans: next, syncWarning: syncResult.warning || null }); return;
      }
      if (message?.type === "DELETE_PLAN" || message?.type === "COMPLETE_PLAN") {
        const plans = await getPlans();
        const next = message.type === "DELETE_PLAN" ? plans.filter(p => p.id !== message.id) : plans.map(p => p.id === message.id ? { ...p, completed: true, completedAt: Date.now() } : p);
        await chrome.storage.local.set({ [PLANS_KEY]: next });
        try { await chrome.alarms?.clear(`study-plan-${message.id}`); } catch {}
        const syncResult = await syncDataToChrome();
        sendResponse({ ok: true, plans: next, syncWarning: syncResult.warning || null }); return;
      }
      if (message?.type === "START_PLAN") {
        const plans = await getPlans(); const plan = plans.find(p => p.id === message.id && !p.completed);
        if (!plan) throw new Error("That study plan is no longer available.");
        sendResponse(await startSession({ url: plan.url, mode: plan.mode, closeOtherTabs: false, planId: plan.id }, sender)); return;
      }
      if (message?.type === "SAVE_FLASHCARD") {
        const question = String(message.question || "").trim().slice(0, 1000);
        const answer = String(message.answer || "").trim().slice(0, 2000);
        if (!question || !answer) throw new Error("Add both a question and an answer.");
        const cards = await getCards();
        const card = { id: String(message.id || `card-${Date.now()}-${Math.random().toString(36).slice(2,8)}`), question, answer, createdAt: Date.now(), dueAt: Date.now(), intervalDays: 0, repetitions: 0, lastReviewedAt: null, lastRating: null };
        const next = [card, ...cards.filter(c => c.id !== card.id)].slice(0, 1000);
        await chrome.storage.local.set({ [CARDS_KEY]: next }); const syncResult = await syncDataToChrome(); sendResponse({ ok: true, card, cards: next, syncWarning: syncResult.warning || null }); return;
      }
      if (message?.type === "DELETE_FLASHCARD") {
        const cards = (await getCards()).filter(card => card.id !== message.id);
        await chrome.storage.local.set({ [CARDS_KEY]: cards }); const syncResult = await syncDataToChrome(); sendResponse({ ok: true, cards, syncWarning: syncResult.warning || null }); return;
      }
      if (message?.type === "REVIEW_FLASHCARD") {
        const cards = await getCards();
        const rating = ["again", "hard", "good", "easy"].includes(message.rating) ? message.rating : "good";
        const card = cards.find(item => item.id === message.id);
        if (!card) throw new Error("Flashcard not found.");
        const intervals = { again: 1, hard: 2, good: 4, easy: 7 };
        const scale = { again: 1, hard: 1.4, good: 2, easy: 2.8 };
        const oldInterval = Math.max(0, Number(card.intervalDays) || 0);
        const intervalDays = rating === "again" ? 1 : (oldInterval ? Math.max(1, Math.round(oldInterval * scale[rating] + (rating === "easy" ? 1 : 0))) : intervals[rating]);
        const updated = { ...card, intervalDays: Math.min(180, intervalDays || intervals[rating]), repetitions: rating === "again" ? 0 : (Number(card.repetitions) || 0) + 1, lastReviewedAt: Date.now(), lastRating: rating, dueAt: Date.now() + intervalDays * 86400000 };
        const next = cards.map(item => item.id === card.id ? updated : item);
        await chrome.storage.local.set({ [CARDS_KEY]: next }); const syncResult = await syncDataToChrome(); sendResponse({ ok: true, card: updated, cards: next, syncWarning: syncResult.warning || null }); return;
      }
      if (message?.type === "MANAGE_ARTIFACT") {
        const action = message.action === "delete" ? "delete" : "edit";
        const kind = message.kind === "bookmark" ? "bookmarks" : "notes";
        const id = String(message.id || "");
        const fromExtension = String(sender.url || "").startsWith(chrome.runtime.getURL(""));
        const session = await getSession(); const history = await getHistory();
        if (!fromExtension && (!session.active || sender.tab?.id !== session.focusTabId)) throw new Error("Manage saved notes from the Study Lock dashboard.");
        let found = false;
        const modify = item => {
          if (item.id !== id) return item;
          found = true;
          if (action === "delete") return null;
          if (kind === "notes") return { ...item, text: String(message.text || "").trim().slice(0, 2000) };
          return { ...item, title: String(message.text || item.title || "Bookmark").trim().slice(0, 180) };
        };
        session[kind] = (Array.isArray(session[kind]) ? session[kind] : []).map(modify).filter(Boolean);
        for (const report of history) report[kind] = (Array.isArray(report[kind]) ? report[kind] : []).map(modify).filter(Boolean);
        if (!found) throw new Error("That saved item could not be found.");
        await saveSession(session, { allowResume: true }); await chrome.storage.local.set({ [HISTORY_KEY]: history });
        const syncResult = await syncDataToChrome();
        sendResponse({ ok: true, session, history, syncWarning: syncResult.warning || null }); return;
      }
      if (message?.type === "JUMP_TO_TIMESTAMP") {
        const videoId = String(message.videoId || "");
        if (!/^[A-Za-z0-9_-]{6,}$/.test(videoId)) throw new Error("Invalid saved video reference.");
        const position = Math.max(0, Math.floor(Number(message.timeSeconds) || 0));
        const session = await getSession(); let targetUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${position}s`;
        if (session.active) {
          const known = session.mode === "video" ? session.videoId === videoId : Boolean(session.playlistId && (session.videos?.[videoId] || (session.playlistOrder || []).includes(videoId)));
          if (!known) throw new Error("This video is outside the active study session. End the session before opening it.");
          targetUrl += session.mode === "playlist" ? `&list=${encodeURIComponent(session.playlistId)}` : "";
          await chrome.tabs.update(session.focusTabId, { url: targetUrl, active: true });
        } else {
          await chrome.tabs.create({ url: targetUrl, active: true });
        }
        sendResponse({ ok: true }); return;
      }
      if (message?.type === "SYNC_NOW") {
        const settings = await getSettings();
        if (!settings.syncEnabled) throw new Error("Enable Chrome Sync in Backup and display preferences first.");
        const result = await syncDataToChrome();
        if (!result.ok) throw new Error(result.warning || "Chrome Sync failed.");
        sendResponse({ ok: true, message: "Your saved plans, flashcards, reports and preferences were sent to Chrome Sync." }); return;
      }
      if (message?.type === "MARK_SOCIAL_REPORTS_SYNCED") {
        const ids = new Set((Array.isArray(message.ids) ? message.ids : []).map(String).slice(0, 200));
        const history = await getHistory();
        const updated = history.map(item => ids.has(String(item.id)) ? { ...item, socialSyncedAt: Number(message.syncedAt) || Date.now(), socialSyncError: null } : item);
        await chrome.storage.local.set({ [HISTORY_KEY]: updated });
        sendResponse({ ok: true, updated: ids.size }); return;
      }
      if (message?.type === "EXPORT_BACKUP") {
        const [settings, history, plans, cards, savedSession] = await Promise.all([getSettings(), getHistory(), getPlans(), getCards(), getSession()]);
        const resumableSession = !savedSession.active && savedSession.endedAt ? savedSession : null;
        sendResponse({ ok: true, backup: { product: "Study Lock", version: chrome.runtime.getManifest().version, exportedAt: new Date().toISOString(), settings, history, plans, cards, savedSession: resumableSession } }); return;
      }
      if (message?.type === "IMPORT_BACKUP") {
        const backup = message.backup;
        if (!backup || backup.product !== "Study Lock" || !Array.isArray(backup.history) || !Array.isArray(backup.plans) || !Array.isArray(backup.cards) || !backup.settings || typeof backup.settings !== "object") throw new Error("This is not a valid Study Lock backup.");
        const session = await getSession(); if (session.active) throw new Error("End the active session before restoring a backup.");
        const settings = { ...DEFAULT_SETTINGS, ...backup.settings };
        settings.dailyGoalMinutes = Math.max(15, Math.min(1440, Number(settings.dailyGoalMinutes) || 120));
        settings.fontScale = ["normal", "large", "x-large"].includes(settings.fontScale) ? settings.fontScale : "normal";
        settings.syncEnabled = Boolean(settings.syncEnabled); settings.reduceMotion = Boolean(settings.reduceMotion); settings.captionsDefault = Boolean(settings.captionsDefault);
        const history = backup.history.filter(item => item && typeof item === "object").slice(0, 200);
        const plans = backup.plans.filter(item => item && typeof item.title === "string" && typeof item.url === "string").slice(0, 200);
        const cards = backup.cards.filter(item => item && typeof item.question === "string" && typeof item.answer === "string").slice(0, 1000);
        const restoredSession = backup.savedSession && typeof backup.savedSession === "object" && backup.savedSession.endedAt && !backup.savedSession.active &&
          ((backup.savedSession.mode === "video" && /^[A-Za-z0-9_-]{6,}$/.test(String(backup.savedSession.videoId || ""))) || (backup.savedSession.mode === "playlist" && /^[A-Za-z0-9_-]{6,}$/.test(String(backup.savedSession.playlistId || ""))))
          ? { ...backup.savedSession, active: false, focusTabId: null, focusWindowId: null } : null;
        await chrome.storage.local.set({ [SETTINGS_KEY]: settings, [HISTORY_KEY]: history, [PLANS_KEY]: plans, [CARDS_KEY]: cards, ...(restoredSession ? { [SESSION_KEY]: restoredSession } : {}) });
        for (const plan of plans) safeReminderAlarm(plan);
        const syncResult = await syncDataToChrome();
        sendResponse({ ok: true, settings, history, plans, cards, session: restoredSession, syncWarning: syncResult.warning || null }); return;
      }
      if (message?.type === "BREAK_PROMPTED") {
        const session = await getSession();
        if (session.active && sender.tab?.id === session.focusTabId) {
          session.breakPrompted = true; await saveSession(session); sendResponse({ ok: true, session });
        } else sendResponse({ ok: false, ignored: true });
        return;
      }
      if (message?.type === "BREAK_RESET") {
        const session = await getSession();
        if (session.active && sender.tab?.id === session.focusTabId) {
          recalcTotals(session);
          session.currentBreakStartedAt = Date.now();
          session.currentBreakQualifyingBaseline = Math.max(0, Number(session.qualifyingPlaybackSeconds) || 0);
          session.breakPrompted = false;
          await saveSession(session); sendResponse({ ok: true, session });
        } else sendResponse({ ok: false, ignored: true });
        return;
      }
      if (message?.type === "NAVIGATION_VIOLATION") {
        const session = await getSession();
        if (session.active && Number.isInteger(sender.tab?.id)) await redirectTabToStudy(sender.tab.id, session, true);
        sendResponse({ ok: true }); return;
      }
      sendResponse({ ok: false, error: "Unknown message." });
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || "Unexpected Study Lock error." });
    }
  })();
  return true;
});

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  const session = await getSession(); if (!session.active) return;
  let tab; try { tab = await chrome.tabs.get(tabId); } catch { return; }
  const url = tab.url || "";
  if (isEmergencyBrowserPage(url)) return;
  if (isDashboardUrl(url) || isPendingNewTabUrl(url) || !isAllowedUrl(url, session)) {
    if (isPendingNewTabUrl(url)) return;
    await focusTab(tab); await redirectTabToStudy(tabId, { ...session, focusTabId: tabId }, true); return;
  }
  await focusTab(tab);
  await keepAwake(true);
});
chrome.windows.onFocusChanged.addListener(async windowId => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  const session = await getSession(); if (!session.active) return;
  const tabs = await chrome.tabs.query({ active: true, windowId }); const tab = tabs[0]; if (!tab) return;
  if (isEmergencyBrowserPage(tab.url || "") || isPendingNewTabUrl(tab.url || "")) return;
  if (isDashboardUrl(tab.url || "") || !isAllowedUrl(tab.url || "", session)) {
    await focusTab(tab); await redirectTabToStudy(tab.id, { ...session, focusTabId: tab.id }, true); return;
  }
  await focusTab(tab);
});
chrome.tabs.onCreated.addListener(async tab => {
  const session = await getSession();
  if (!session.active) return;
  const url = tab.url || "";
  if (isEmergencyBrowserPage(url) || isPendingNewTabUrl(url) || isDashboardUrl(url)) return;
  if (!isAllowedUrl(url, session)) {
    const settings = await getSettings();
    if (settings.redirectInactiveTabs !== false || tab.active) await redirectTabToStudy(tab.id, session, Boolean(tab.active));
  }
});
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const session = await getSession(); if (!session.active) return;
  const candidate = changeInfo.url || tab.url || "";
  if (isEmergencyBrowserPage(candidate) || isPendingNewTabUrl(candidate)) return;
  if (isDashboardUrl(candidate)) { await redirectTabToStudy(tabId, session, Boolean(tab.active)); return; }
  if (isAllowedUrl(candidate, session)) {
    if (tab.active && session.focusTabId !== tabId) await focusTab(tab);
    return;
  }
  if (changeInfo.url || changeInfo.status === "loading") {
    const settings = await getSettings();
    if (settings.redirectInactiveTabs !== false || tab.active) await redirectTabToStudy(tabId, session, Boolean(tab.active));
  }
});
chrome.tabs.onRemoved.addListener(async tabId => {
  const session = await getSession(); if (!session.active || tabId !== session.focusTabId) return;
  let tabs = []; try { tabs = await chrome.tabs.query({}); } catch {}
  const latest = await getSession();
  if (!latest.active || latest.focusTabId !== tabId) return;
  if (!tabs.length) { await finishSession(false, "browser-closed"); return; }
  const existing = tabs.find(tab => isAllowedUrl(tab.url || "", latest));
  if (existing) {
    latest.focusTabId = existing.id; latest.focusWindowId = existing.windowId; await saveSession(latest);
    try { await chrome.tabs.update(existing.id, { active: true }); } catch {}
  } else {
    const beforeCreate = await getSession();
    if (!beforeCreate.active || beforeCreate.focusTabId !== tabId) return;
    const fresh = await chrome.tabs.create({ url: currentStudyUrl(beforeCreate), active: true });
    const afterCreate = await getSession();
    if (!afterCreate.active) { try { await chrome.tabs.remove(fresh.id); } catch {} return; }
    afterCreate.focusTabId = fresh.id; afterCreate.focusWindowId = fresh.windowId; await saveSession(afterCreate);
  }
});
// Recovery shortcut works even if the in-page End button is inaccessible.
// Chrome > Extensions > Keyboard shortcuts can be used to change this binding.
chrome.commands?.onCommand?.addListener(async command => {
  if (command === "end-study-session") {
    try { await endSessionAndCloseLesson("ended-by-keyboard-shortcut"); }
    catch (error) { console.error("Study Lock could not end the session", error); }
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const session = await getSession(); if (!session.active) return;
  const tabs = await chrome.tabs.query({});
  const match = tabs.find(tab => isAllowedUrl(tab.url || "", session));
  if (match) {
    session.focusTabId = match.id; session.focusWindowId = match.windowId; await saveSession(session);
    try { await chrome.tabs.update(match.id, { active: true }); } catch {}
  } else {
    const tab = await chrome.tabs.create({ url: currentStudyUrl(session), active: true });
    session.focusTabId = tab.id; session.focusWindowId = tab.windowId; await saveSession(session);
  }
  await keepAwake(true);
});

chrome.alarms?.onAlarm?.addListener(async alarm => {
  if (!String(alarm.name || "").startsWith("study-plan-")) return;
  const planId = alarm.name.slice("study-plan-".length);
  const plan = (await getPlans()).find(item => item.id === planId && !item.completed);
  if (!plan) return;
  try { await chrome.notifications?.create(`study-reminder-${planId}`, { type: "basic", iconUrl: "icon128.png", title: "Study Lock reminder", message: `Time to study: ${plan.title}`, priority: 1 }); } catch (error) { console.warn("Study Lock reminder notification failed", error); }
});

chrome.runtime.onStartup.addListener(async () => {
  for (const plan of await getPlans()) safeReminderAlarm(plan);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.studyLockSyncMeta?.newValue && !applyingSyncSnapshot) applySyncedSnapshot();
});
