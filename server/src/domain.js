export const USERNAME_RE = /^[a-zA-Z0-9_]{3,24}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const VIDEO_ID_RE = /^[A-Za-z0-9_-]{6,20}$/;
export const MAX_DAILY_STUDY_SECONDS = 8 * 60 * 60;

export function cleanText(value, max = 200) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
}

export function normaliseUsername(value) {
  return cleanText(value, 24).toLowerCase();
}

export function normaliseEmail(value) {
  return cleanText(value, 254).toLowerCase();
}

export function parseYoutubeResource(raw) {
  let url;
  try { url = new URL(String(raw)); } catch { return null; }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  const allowed = ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be"];
  if (!allowed.includes(host)) return null;
  const list = url.searchParams.get("list");
  const videoId = host.endsWith("youtu.be")
    ? url.pathname.split("/").filter(Boolean)[0]
    : url.searchParams.get("v");
  if (list && /^[A-Za-z0-9_-]{8,100}$/.test(list)) return { type: "playlist", resourceId: list, videoId: VIDEO_ID_RE.test(videoId || "") ? videoId : null };
  if (VIDEO_ID_RE.test(videoId || "")) return { type: "video", resourceId: videoId, videoId };
  return null;
}

export function computePoints({ qualifyingSeconds = 0, completedVideos = 0, activeDays = 0 } = {}) {
  const seconds = Math.max(0, Math.min(MAX_DAILY_STUDY_SECONDS * 36500, Math.floor(Number(qualifyingSeconds) || 0)));
  const lessons = Math.max(0, Math.min(1000000, Math.floor(Number(completedVideos) || 0)));
  const days = Math.max(0, Math.min(36500, Math.floor(Number(activeDays) || 0)));
  return Math.floor(seconds / 60) + lessons * 20 + days * 5;
}

export function clampEventSeconds(value) {
  return Math.max(0, Math.min(120, Math.floor(Number(value) || 0)));
}

/** Apply per-user/day anti-inflation limits to stored study events. Input events
 * are never mutated; oldest events consume the daily allowance first. */
export function applyDailyCaps(inputEvents = [], { maxStudySeconds = MAX_DAILY_STUDY_SECONDS, maxCompletedLessons = 20 } = {}) {
  const ordered = [...inputEvents].sort((a, b) => new Date(a.eventAt || 0).getTime() - new Date(b.eventAt || 0).getTime());
  const secondsByDay = new Map();
  const completionsByDay = new Map();
  return ordered.map(event => {
    const date = new Date(event.eventAt || 0);
    const day = Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : 'unknown';
    const used = secondsByDay.get(day) || 0;
    const requested = Math.max(0, Math.min(120, Math.floor(Number(event.qualifyingSeconds) || 0)));
    const acceptedSeconds = Math.max(0, Math.min(requested, maxStudySeconds - used));
    secondsByDay.set(day, used + acceptedSeconds);
    const completions = completionsByDay.get(day) || 0;
    const acceptedCompletion = Boolean(event.completed) && completions < maxCompletedLessons;
    if (acceptedCompletion) completionsByDay.set(day, completions + 1);
    return { ...event, day, acceptedSeconds, acceptedCompletion };
  });
}
