(() => {
  if (window.top !== window) return;
  const KEY = "studyLockSession";
  const SETTINGS_KEY = "studyLockSettings";
  let session = null;
  let settings = { dailyGoalMinutes: 120, breakEnabled: false, breakEveryMinutes: 50, breakLengthMinutes: 5 };
  let isFocusTab = false;
  let currentVideoId = null;
  let lastSampleTime = null;
  let trustedPosition = 0;
  let watchedSegments = [];
  let qualifyingPlaybackSeconds = 0;
  let lastProgressSentAt = 0;
  let routeValue = location.href;
  let autoPlayAttemptedFor = "";
  let captionAppliedFor = "";
  let completionCheckStarted = false;
  let currentMedia = null;
  let programmaticSeekUntil = 0;
  let lastSessionSignature = "";
  let ui = null;
  let launchUi = null;
  let breakShownForSession = false;

  const seconds = value => Math.max(0, Number(value) || 0);
  function fmt(value) {
    const n = Math.floor(seconds(value)); const h = Math.floor(n / 3600); const m = Math.floor((n % 3600) / 60); const s = n % 60;
    return h ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  function videoIdFromHref(href) {
    try { const u = new URL(href, location.origin); return u.searchParams.get("v") || null; } catch { return null; }
  }
  function parseDuration(text) {
    const raw = String(text || "").trim();
    if (/^(\d{1,3}:)?\d{1,2}:\d{2}$/.test(raw)) return raw.split(":").map(Number).reduce((t, p) => t * 60 + p, 0);
    return 0;
  }
  function getCurrentVideoId() {
    try {
      const url = new URL(location.href);
      if (url.searchParams.get("v")) return url.searchParams.get("v");
      const parts = url.pathname.split("/").filter(Boolean);
      if (["shorts", "live", "embed"].includes(parts[0]) && parts[1]) return parts[1];
    } catch {}
    const link = document.querySelector('#movie_player .ytp-title-link[href*="watch?v="], .ytp-title-link[href*="watch?v="]');
    return link ? videoIdFromHref(link.href) : null;
  }
  function getVideo() { return document.querySelector("#movie_player video.html5-main-video") || document.querySelector("video.html5-main-video") || document.querySelector("ytd-player video"); }
  function getTitle() {
    const title = document.querySelector("h1.ytd-watch-metadata yt-formatted-string")?.textContent
      || document.querySelector("h1.title")?.textContent
      || document.querySelector("#movie_player .ytp-title-link")?.textContent
      || document.title.replace(/\s*-\s*YouTube\s*$/, "");
    return String(title || "YouTube video").trim().slice(0, 180);
  }
  function isAdPlaying() { return Boolean(document.querySelector("#movie_player.ad-showing, .html5-video-player.ad-showing, ytd-player.ad-showing")); }
  function mergeSegments(input) {
    const clean = (Array.isArray(input) ? input : []).map(pair => [seconds(pair?.[0]), seconds(pair?.[1])])
      .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a).sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const [a, b] of clean) {
      const last = out[out.length - 1];
      if (last && a <= last[1] + 0.35) last[1] = Math.max(last[1], b); else out.push([a, b]);
    }
    return out.slice(0, 2000);
  }
  function coveredSeconds(segments = watchedSegments) { return mergeSegments(segments).reduce((sum, pair) => sum + pair[1] - pair[0], 0); }
  function contiguousPrefix(segments = watchedSegments) {
    let edge = 0;
    for (const [a, b] of mergeSegments(segments)) {
      if (a <= edge + 0.35) edge = Math.max(edge, b); else break;
    }
    return edge;
  }
  function isAllowedPage() {
    if (!session?.active) return true;
    try {
      const url = new URL(location.href);
      if (url.hostname !== "www.youtube.com" && url.hostname !== "youtube.com" && !url.hostname.endsWith(".youtube.com")) return false;
      if (session.mode === "video") return url.pathname === "/watch" && url.searchParams.get("v") === session.videoId;
      if (url.pathname === "/playlist") return url.searchParams.get("list") === session.playlistId;
      return url.pathname === "/watch" && url.searchParams.get("list") === session.playlistId;
    } catch { return false; }
  }
  function send(type, payload = {}) { return chrome.runtime.sendMessage({ type, ...payload }).catch(() => null); }

  function removeLaunchPanel() {
    document.getElementById("study-lock-launch-panel")?.remove();
    launchUi = null;
  }
  function renderLaunchPanel() {
    if (session?.active) { removeLaunchPanel(); return; }
    let url;
    try { url = new URL(location.href); } catch { removeLaunchPanel(); return; }
    const playlistId = url.searchParams.get("list");
    const videoId = getCurrentVideoId();
    const playlistOnlyPage = url.pathname === "/playlist" && Boolean(playlistId);
    if (!videoId && !playlistId) { removeLaunchPanel(); return; }
    if (!launchUi || !document.contains(launchUi)) {
      removeLaunchPanel();
      const style = document.getElementById("study-lock-launch-style") || document.createElement("style");
      style.id = "study-lock-launch-style";
      style.textContent = `
        #study-lock-launch-panel{position:fixed;z-index:2147483000;right:18px;bottom:18px;width:min(350px,calc(100vw - 28px));box-sizing:border-box;background:#101923f7;color:#eef5fc;border:1px solid #3a4a5e;border-radius:16px;padding:16px;box-shadow:0 18px 55px #0008;font:13px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif}
        #study-lock-launch-panel *{box-sizing:border-box}#study-lock-launch-panel .sl-launch-brand{font-size:10px;letter-spacing:.16em;font-weight:900;color:#a9b5c7;margin-bottom:7px}
        #study-lock-launch-panel h3{font-size:17px;margin:0 0 6px;color:#fff}#study-lock-launch-panel p{margin:0 0 11px;color:#b8c5d6;font-size:11px;line-height:1.55}
        #study-lock-launch-panel .sl-launch-actions{display:flex;gap:8px;flex-wrap:wrap}#study-lock-launch-panel button{cursor:pointer;border-radius:9px;border:1px solid #3c4e61;background:#1b2939;color:#eff6ff;padding:9px 10px;font:700 11px system-ui,-apple-system,'Segoe UI',sans-serif}
        #study-lock-launch-panel button.primary{background:#a5f3cf;border-color:#a5f3cf;color:#10251d}#study-lock-launch-panel button:disabled{opacity:.55;cursor:wait}
        #study-lock-launch-panel .sl-launch-status{margin:9px 0 0;min-height:14px;color:#a5f3cf;font-size:10px}#study-lock-launch-panel .sl-launch-status.error{color:#fecaca}
      `;
      (document.head || document.documentElement).appendChild(style);
      launchUi = document.createElement("aside"); launchUi.id = "study-lock-launch-panel";
      launchUi.innerHTML = `
        <div class="sl-launch-brand">STUDY LOCK · FOCUSED LEARNING</div>
        <h3>Make this lesson count.</h3>
        <p id="slLaunchMotivation">Start studying now—skills create opportunities; procrastination delays your goals. Give this lesson your full attention.</p>
        <div class="sl-launch-actions"><button id="slLaunchVideo" class="primary" type="button">Study this video</button><button id="slLaunchPlaylist" type="button">Study this playlist</button></div>
        <p id="slLaunchStatus" class="sl-launch-status" aria-live="polite"></p>`;
      document.documentElement.appendChild(launchUi);
      const start = async mode => {
        const status = launchUi?.querySelector("#slLaunchStatus");
        const buttons = [...(launchUi?.querySelectorAll("button") || [])];
        buttons.forEach(button => { button.disabled = true; });
        if (status) { status.classList.remove("error"); status.textContent = "Starting your focused study session…"; }
        const response = await send("START_FROM_YOUTUBE", { mode });
        if (!response?.ok) {
          buttons.forEach(button => { button.disabled = false; });
          if (status) { status.classList.add("error"); status.textContent = response?.error || "Could not start the session. Try the Study Lock new tab."; }
          return;
        }
        session = response.session || session;
        removeLaunchPanel();
        syncState();
      };
      launchUi.querySelector("#slLaunchVideo").addEventListener("click", () => start("video"));
      launchUi.querySelector("#slLaunchPlaylist").addEventListener("click", () => start("playlist"));
    }
    const videoButton = launchUi.querySelector("#slLaunchVideo");
    const playlistButton = launchUi.querySelector("#slLaunchPlaylist");
    videoButton.hidden = !videoId;
    playlistButton.hidden = !playlistId;
    if (playlistOnlyPage) launchUi.querySelector("#slLaunchMotivation").textContent = "Take the playlist one lesson at a time. Every completed video is a step toward your goal.";
    else launchUi.querySelector("#slLaunchMotivation").textContent = "Start studying now—skills create opportunities; procrastination delays your goals. Give this lesson your full attention.";
  }

  // Start a study session when the learner chooses a lesson directly on YouTube.
  // We handle ordinary left-clicks only; modified clicks and middle-clicks retain
  // normal browser semantics. The background worker will start the session in
  // this tab, and native YouTube playback remains the player surface.
  let autoStartInFlight = false;
  document.addEventListener("click", async event => {
    if (!event.isTrusted || !event.cancelable || session?.active || autoStartInFlight || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (launchUi?.contains(event.target) || event.target?.closest?.("#study-lock-overlay, #study-lock-launch-panel")) return;
    const currentUrl = (() => { try { return new URL(location.href); } catch { return null; } })();
    if (!currentUrl) return;
    const playControl = event.target?.closest?.(".ytp-play-button, .ytp-large-play-button, .ytp-cued-thumbnail-overlay, button[aria-label^='Play']");
    const anchor = event.target?.closest?.("a[href]");
    let targetUrl = "";
    let mode = "video";
    if (anchor) {
      try {
        const candidate = new URL(anchor.href, location.origin);
        const host = candidate.hostname.toLowerCase();
        const isYouTube = host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be";
        const isVideo = candidate.searchParams.has("v") || /^\/(shorts|live)\//.test(candidate.pathname) || host === "youtu.be";
        const isPlaylist = candidate.pathname === "/playlist" && candidate.searchParams.has("list");
        if (isYouTube && (isVideo || isPlaylist)) {
          targetUrl = candidate.href;
          const currentList = currentUrl.searchParams.get("list");
          const candidateList = candidate.searchParams.get("list");
          mode = isPlaylist || (currentList && candidateList === currentList && document.querySelector("ytd-playlist-panel-renderer")) ? "playlist" : "video";
        }
      } catch {}
    }
    if (!targetUrl && playControl && (currentUrl.pathname === "/watch" || currentUrl.pathname === "/playlist")) {
      targetUrl = currentUrl.href;
      mode = currentUrl.pathname === "/playlist" || (currentUrl.searchParams.has("list") && document.querySelector("ytd-playlist-panel-renderer")) ? "playlist" : "video";
    }
    if (!targetUrl) return;
    // Preserve the native Play click when the selected video is already open.
    // The service worker now starts the session without reloading that URL.
    let samePlayerClick = false;
    if (playControl && currentUrl.pathname === "/watch") {
      try {
        const target = new URL(targetUrl, location.origin);
        samePlayerClick = target.searchParams.get("v") === currentUrl.searchParams.get("v");
      } catch {}
    }
    if (!samePlayerClick) { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); }
    autoStartInFlight = true;
    const response = await send("START_FROM_YOUTUBE", { mode, url: targetUrl });
    if (!response?.ok) {
      autoStartInFlight = false;
      if (launchUi) {
        const status = launchUi.querySelector("#slLaunchStatus");
        if (status) { status.classList.add("error"); status.textContent = response?.error || "Study Lock couldn't start. Opening the selected lesson normally."; }
      }
      // A same-page Play click has already been delivered to YouTube; do not
      // reload the lesson if session startup fails.
      if (!samePlayerClick) location.assign(targetUrl);
      return;
    }
    session = response.session || session;
    removeLaunchPanel();
    syncState();
  }, true);

  function installFocusStyles() {
    if (document.getElementById("study-lock-styles")) return;
    const style = document.createElement("style"); style.id = "study-lock-styles";
    style.textContent = `
      html.study-lock-focus, body.study-lock-focus { background:#080b11!important; overflow-x:hidden!important; }
      body.study-lock-focus ytd-masthead, body.study-lock-focus #masthead-container,
      body.study-lock-focus ytd-mini-guide-renderer, body.study-lock-focus #secondary,
      body.study-lock-focus #below, body.study-lock-focus #comments, body.study-lock-focus #related,
      body.study-lock-focus #chips, body.study-lock-focus ytd-watch-metadata,
      body.study-lock-focus #owner, body.study-lock-focus #actions, body.study-lock-focus #description-inline-expander,
      body.study-lock-focus #guide, body.study-lock-focus #guide-content, body.study-lock-focus #footer,
      body.study-lock-focus ytd-engagement-panel-section-list-renderer,
      body.study-lock-focus ytd-watch-next-secondary-results-renderer,
      body.study-lock-focus ytd-merch-shelf-renderer, body.study-lock-focus #panels,
      body.study-lock-focus #chat, body.study-lock-focus #ticket-shelf,
      body.study-lock-focus ytd-comments, body.study-lock-focus #masthead { display:none!important; }
      body.study-lock-focus ytd-app, body.study-lock-focus #content,
      body.study-lock-focus #page-manager, body.study-lock-focus ytd-watch-flexy,
      body.study-lock-focus #columns, body.study-lock-focus #primary { background:#080b11!important; max-width:none!important; width:100%!important; margin:0!important; padding:0!important; }
      body.study-lock-focus #player-container-outer, body.study-lock-focus #player-container-inner,
      body.study-lock-focus #player-full-bleed-container, body.study-lock-focus #full-bleed-container { max-width:none!important; width:100%!important; margin:0!important; }
      body.study-lock-focus .html5-video-player { position:fixed!important; top:30px!important; left:18px!important; width:calc(100vw - 390px)!important; height:calc(100vh - 60px)!important; max-width:none!important; max-height:none!important; aspect-ratio:auto!important; z-index:2147480000!important; }
      body.study-lock-focus .html5-video-container, body.study-lock-focus .html5-main-video { width:100%!important; height:100%!important; }
      body.study-lock-focus .html5-main-video { object-fit:contain!important; }
      body.study-lock-focus ytd-watch-flexy[theater] #player-container-outer { max-height:none!important; }
      #study-lock-overlay { position:fixed; z-index:2147483000; top:14px; right:14px; width:344px; max-height:calc(100vh - 28px); overflow:auto; box-sizing:border-box; color:#eff4fb; background:rgba(13,18,27,.97); border:1px solid rgba(148,163,184,.22); border-radius:18px; box-shadow:0 20px 70px #0009; font:14px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
      #study-lock-overlay * { box-sizing:border-box; }
      #study-lock-overlay button, #study-lock-overlay input, #study-lock-overlay textarea { font:inherit; }
      #study-lock-overlay button { cursor:pointer; }
      #study-lock-overlay .sl-top { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:15px 16px 12px; border-bottom:1px solid #283140; }
      #study-lock-overlay .sl-brand { font-size:11px; font-weight:900; letter-spacing:.17em; color:#9eabc0; }
      #study-lock-overlay .sl-state { border-radius:999px; padding:4px 8px; background:#163d31; color:#91f0c5; font-size:10px; font-weight:800; letter-spacing:.06em; }
      #study-lock-overlay .sl-content { padding:14px 16px 16px; }
      #study-lock-overlay .sl-title { font-size:16px; line-height:1.35; font-weight:750; margin:0 0 7px; color:#f8fafc; }
      #study-lock-overlay .sl-subtitle { color:#9ca9bc; font-size:11px; margin-bottom:14px; }
      #study-lock-overlay .sl-motivation { border:1px solid #6d4e25; background:#2a2115; color:#ffdda0; padding:9px 10px; border-radius:10px; font-size:11px; line-height:1.5; margin:0 0 12px; }
      #study-lock-overlay .sl-motivation[hidden] { display:none!important; }
      #study-lock-overlay .sl-progress-head { display:flex; align-items:end; justify-content:space-between; margin-bottom:7px; }
      #study-lock-overlay .sl-pct { font-size:26px; font-weight:800; letter-spacing:-.04em; }
      #study-lock-overlay .sl-small { color:#9ca9bc; font-size:10px; }
      #study-lock-overlay .sl-track { width:100%; height:6px; border-radius:20px; background:#263243; overflow:hidden; margin-bottom:13px; }
      #study-lock-overlay .sl-fill { height:100%; width:0%; border-radius:20px; background:linear-gradient(90deg,#48d6a0,#8ee7c7); transition:width .25s ease; }
      #study-lock-overlay .sl-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
      #study-lock-overlay .sl-stat { background:#171f2c; border:1px solid #293345; padding:9px 10px; border-radius:11px; min-width:0; }
      #study-lock-overlay .sl-stat span { display:block; color:#98a7bb; font-size:10px; margin-bottom:4px; }
      #study-lock-overlay .sl-stat strong { display:block; font-size:15px; font-weight:750; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      #study-lock-overlay .sl-btn-row { display:flex; gap:7px; margin-top:12px; }
      #study-lock-overlay .sl-btn { border:1px solid #344155; background:#1a2533; color:#eff5fc; border-radius:10px; padding:8px 10px; font-size:11px; font-weight:700; }
      #study-lock-overlay .sl-btn.primary { background:#a5f3cf; color:#10251d; border-color:#a5f3cf; }
      #study-lock-overlay .sl-btn.danger { color:#fecaca; border-color:#713f46; background:#321b22; }
      #study-lock-overlay .sl-section { margin-top:15px; padding-top:13px; border-top:1px solid #283140; }
      #study-lock-overlay .sl-section-title { font-size:11px; font-weight:800; letter-spacing:.03em; margin-bottom:8px; }
      #study-lock-overlay .sl-input, #study-lock-overlay .sl-textarea { width:100%; border:1px solid #354256; background:#0c121b; color:#f4f7fb; border-radius:9px; padding:9px 10px; outline:none; }
      #study-lock-overlay .sl-textarea { min-height:60px; resize:vertical; }
      #study-lock-overlay .sl-input:focus, #study-lock-overlay .sl-textarea:focus { border-color:#83e6bc; }
      #study-lock-overlay .sl-list { display:flex; flex-direction:column; gap:7px; }
      #study-lock-overlay .sl-list-item { border:1px solid #283445; border-radius:9px; background:#121a26; padding:8px; }
      #study-lock-overlay .sl-list-item strong { display:block; font-size:10px; color:#b6f4d6; margin-bottom:2px; }
      #study-lock-overlay .sl-list-item p { margin:0; font-size:11px; color:#d7e0ed; white-space:pre-wrap; overflow-wrap:anywhere; }
      #study-lock-overlay .sl-empty { font-size:11px; color:#7f8ba0; }
      #study-lock-overlay .sl-footnote { margin-top:12px; font-size:10px; color:#8492a7; }
      #study-lock-overlay .sl-toast { margin-top:8px; font-size:11px; color:#a5f3cf; min-height:16px; }
      #study-lock-overlay .sl-break { border:1px solid #a5f3cf; border-radius:10px; background:#132a22; color:#d4ffea; padding:11px; margin-top:10px; }
      #study-lock-overlay .sl-break[hidden] { display:none!important; }
      body.study-lock-focus #player-theater-container, body.study-lock-focus #player-container-outer { background:#080b11!important; }
      @media (max-width:900px) {
        body.study-lock-focus .html5-video-player { top:12px!important; left:12px!important; width:calc(100vw - 24px)!important; height:calc(100vh - 285px)!important; }
        #study-lock-overlay { left:12px; right:12px; top:auto; bottom:12px; width:auto; max-height:250px; border-radius:14px; }
        #study-lock-overlay .sl-content { padding:10px 12px; }
        #study-lock-overlay .sl-section { margin-top:9px; padding-top:8px; }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function createOverlay() {
    if (ui && document.contains(ui)) return ui;
    ui = document.createElement("aside"); ui.id = "study-lock-overlay";
    ui.innerHTML = `
      <div class="sl-top"><div><div class="sl-brand">STUDY LOCK</div><div class="sl-small">One lesson. One clear goal.</div></div><span class="sl-state" id="slState">FOCUS ON</span></div>
      <div class="sl-content">
        <div class="sl-title" id="slTitle">Your lesson</div><div class="sl-subtitle" id="slSubtitle">Tracking natural playback at 1× speed</div>
        <div class="sl-motivation" id="slMotivation" hidden>Start studying now—skills create opportunities; procrastination delays your goals. Give this lesson your full attention.</div>
        <div class="sl-progress-head"><div><div class="sl-small">WATCH COVERAGE</div><div class="sl-pct" id="slPercent">0%</div></div><div style="text-align:right"><div class="sl-small">TIME REMAINING</div><strong id="slRemaining">--:--</strong></div></div>
        <div class="sl-track"><div class="sl-fill" id="slFill"></div></div>
        <div class="sl-grid"><div class="sl-stat"><span>Watch coverage</span><strong id="slWatched">00:00</strong></div><div class="sl-stat"><span>Known lesson time</span><strong id="slTotal">--:--</strong></div><div class="sl-stat"><span>Session elapsed</span><strong id="slElapsed">00:00</strong></div><div class="sl-stat"><span>Expected finish</span><strong id="slFinish">--:--</strong></div><div class="sl-stat"><span>Daily target</span><strong id="slGoal">0 / 0 min</strong></div><div class="sl-stat"><span>Videos complete</span><strong id="slVideos">0 / 0</strong></div></div>
        <div class="sl-btn-row"><button class="sl-btn primary" id="slPause">Pause video</button><button class="sl-btn" id="slFullscreen">Fullscreen</button><button class="sl-btn" id="slCaptions">Toggle captions</button><button class="sl-btn" id="slBookmark">Bookmark</button></div>
        <div class="sl-break" id="slBreak" hidden><strong>Time for a reset</strong><p id="slBreakText" style="margin:4px 0 8px;font-size:11px"></p><button class="sl-btn primary" id="slBreakDone">Resume study</button><button class="sl-btn" id="slBreakSkip">Skip break</button></div>
        <div class="sl-section"><div class="sl-section-title">QUICK NOTE AT <span id="slNoteTime">00:00</span></div><textarea class="sl-textarea" id="slNoteInput" placeholder="Write the concept you want to remember…"></textarea><div class="sl-btn-row"><button class="sl-btn primary" id="slSaveNote">Save note</button><button class="sl-btn danger" id="slEnd">End session</button></div><div class="sl-toast" id="slToast" aria-live="polite"></div></div>
        <div class="sl-section"><div class="sl-section-title">RECENT NOTES</div><div id="slNotes" class="sl-list"><div class="sl-empty">Your saved notes will appear here.</div></div></div>
        <div class="sl-section"><div class="sl-section-title">BOOKMARKS</div><div id="slBookmarks" class="sl-list"><div class="sl-empty">Bookmark important timestamps as you study.</div></div></div>
        <div class="sl-footnote">Coverage is based on continuous playback, not just elapsed time. Keep this tab visible while studying.</div>
      </div>`;
    document.documentElement.appendChild(ui);
    ui.querySelector("#slPause").addEventListener("click", () => { const v = getVideo(); if (!v) return; if (v.paused) v.play().catch(() => {}); else v.pause(); });
    ui.querySelector("#slFullscreen").addEventListener("click", async () => { const target = document.querySelector("#movie_player") || getVideo(); try { if (target?.requestFullscreen) await target.requestFullscreen(); } catch { toast("Use the player’s fullscreen button if needed."); } });
    ui.querySelector("#slCaptions").addEventListener("click", () => { const button = document.querySelector(".ytp-subtitles-button"); if (button) { button.click(); toast("Caption preference toggled in YouTube."); } else toast("Captions are not available for this video."); });
    ui.querySelector("#slBookmark").addEventListener("click", async () => {
      const v = getVideo(); const id = currentVideoId; if (!id) return;
      const r = await send("ADD_BOOKMARK", { videoId: id, title: getTitle(), timeSeconds: seconds(v?.currentTime) });
      if (r?.ok) { session = r.session || session; renderOverlay(); toast(`Bookmark saved at ${fmt(v?.currentTime)}`); } else toast(r?.error || "Could not save bookmark.");
    });
    ui.querySelector("#slSaveNote").addEventListener("click", async () => {
      const text = ui.querySelector("#slNoteInput").value.trim(); if (!text) { toast("Write a note before saving."); return; }
      const v = getVideo(); const r = await send("SAVE_NOTE", { videoId: currentVideoId, title: getTitle(), timeSeconds: seconds(v?.currentTime), text });
      if (r?.ok) { session = r.session || session; ui.querySelector("#slNoteInput").value = ""; renderOverlay(); toast("Note saved to this study session."); } else toast(r?.error || "Could not save note.");
    });
    ui.querySelector("#slEnd").addEventListener("click", async () => {
      if (!confirm("End this study session? Your progress, notes, and bookmarks will be saved.")) return;
      const button = ui?.querySelector("#slEnd"); if (button) { button.disabled = true; button.textContent = "Ending session…"; }
      // Flush the most recent watch ranges before ending. The background
      // serializes writes so this progress update cannot race the end marker.
      await sendProgress(true);
      const r = await send("END_SESSION");
      if (r?.ok && r.session?.active === false) {
        session = r.session; settings = r.settings || settings; removeFocusMode();
        const notice = document.createElement("div");
        notice.setAttribute("role", "status");
        notice.textContent = "Study Lock session ended. Your progress and notes have been saved; normal browsing is restored.";
        notice.style.cssText = "position:fixed;z-index:2147483647;right:18px;top:18px;max-width:360px;padding:14px 18px;border-radius:12px;background:#12352c;color:#eafff6;font:600 14px/1.45 system-ui,sans-serif;box-shadow:0 8px 32px #0005";
        document.documentElement.appendChild(notice); setTimeout(() => notice.remove(), 6500);
      } else {
        if (button) { button.disabled = false; button.textContent = "End session"; }
        toast(r?.error || "Could not end the session. Use the extension menu or Alt+Shift+E to exit.");
      }
    });
    ui.querySelector("#slBreakDone").addEventListener("click", async () => { const v = getVideo(); const r = await send("BREAK_RESET"); if (r?.session) session = r.session; breakShownForSession = false; ui.querySelector("#slBreak").hidden = true; v?.play()?.catch(() => {}); renderOverlay(); });
    ui.querySelector("#slBreakSkip").addEventListener("click", async () => { const r = await send("BREAK_RESET"); if (r?.session) session = r.session; breakShownForSession = false; ui.querySelector("#slBreak").hidden = true; renderOverlay(); });
    return ui;
  }
  function removeFocusMode() {
    document.body?.classList.remove("study-lock-focus"); document.documentElement?.classList.remove("study-lock-focus");
    document.getElementById("study-lock-overlay")?.remove(); ui = null;
  }
  function toast(text) { if (ui) ui.querySelector("#slToast").textContent = text; }
  function getCurrentPosition() { return seconds(getVideo()?.currentTime); }
  function renderBreak() {
    if (!ui || !session?.active || !settings.breakEnabled) { if (ui) ui.querySelector("#slBreak").hidden = true; return; }
    const started = Number(session.currentBreakStartedAt) || Number(session.startedAt) || Date.now();
    const intervalSeconds = Number(settings.breakEveryMinutes || 50) * 60;
    const hasPlaybackBaseline = Number.isFinite(Number(session.currentBreakQualifyingBaseline));
    const playedSinceBreak = Math.max(0, (Number(session.qualifyingPlaybackSeconds) || 0) - (Number(session.currentBreakQualifyingBaseline) || 0));
    // New sessions schedule breaks by qualifying playback, not idle wall time.
    // Retain wall-clock behavior for older stored sessions without this field.
    const due = hasPlaybackBaseline ? playedSinceBreak >= intervalSeconds : (Date.now() - started) >= intervalSeconds * 1000;
    if (due || session.breakPrompted) {
      ui.querySelector("#slBreak").hidden = false;
      ui.querySelector("#slBreakText").textContent = `Take ${settings.breakLengthMinutes || 5} minutes away from the screen, then resume your lesson.`;
      if (!breakShownForSession) {
        breakShownForSession = true;
        try { getVideo()?.pause(); } catch {}
        if (!session.breakPrompted) { session.breakPrompted = true; send("BREAK_PROMPTED"); }
      }
    } else {
      ui.querySelector("#slBreak").hidden = true;
    }
  }
  function renderOverlay() {
    if (!session?.active || !isFocusTab || !isAllowedPage()) { removeFocusMode(); return; }
    installFocusStyles(); document.documentElement.classList.add("study-lock-focus"); document.body?.classList.add("study-lock-focus");
    const panel = createOverlay();
    const record = session.videos?.[currentVideoId] || {};
    const currentDuration = seconds(record.durationSeconds) || seconds(getVideo()?.duration);
    const currentCovered = Math.min(currentDuration || Infinity, coveredSeconds(watchedSegments));
    const videos = Object.entries(session.videos || {});
    let knownTotal = 0; let knownCovered = 0; let completedCount = 0;
    for (const [id, video] of videos) {
      const duration = seconds(video.durationSeconds) || (id === currentVideoId ? currentDuration : 0);
      const coveredForVideo = id === currentVideoId ? currentCovered : (Array.isArray(video.watchedSegments) ? coveredSeconds(video.watchedSegments) : seconds(video.watchedSeconds));
      knownTotal += duration;
      knownCovered += duration > 0 ? Math.min(duration, coveredForVideo) : coveredForVideo;
      if (video.completed) completedCount++;
    }
    if (!session.videos?.[currentVideoId] && currentDuration > 0) knownTotal += currentDuration;
    if (session.mode === "video") { knownTotal = currentDuration; knownCovered = currentCovered; }
    const remaining = Math.max(0, knownTotal - knownCovered);
    const pct = knownTotal > 0 ? Math.min(100, Math.round(knownCovered / knownTotal * 100)) : 0;
    const goal = Number(settings.dailyGoalMinutes) || 120;
    const historyToday = seconds(session.todayStudiedSeconds) || knownCovered;
    const title = getTitle();
    panel.querySelector("#slTitle").textContent = title;
    panel.querySelector("#slSubtitle").textContent = session.mode === "playlist" ? "Playlist session · native YouTube playback · 1×" : "Single lesson · native YouTube playback · 1×";
    panel.querySelector("#slMotivation").hidden = session.mode !== "video";
    panel.querySelector("#slPercent").textContent = `${pct}%`;
    panel.querySelector("#slFill").style.width = `${pct}%`;
    panel.querySelector("#slWatched").textContent = fmt(knownCovered);
    panel.querySelector("#slTotal").textContent = knownTotal > 0 ? fmt(knownTotal) : "Loading…";
    panel.querySelector("#slRemaining").textContent = knownTotal > 0 ? fmt(remaining) : "Loading…";
    panel.querySelector("#slElapsed").textContent = fmt((Date.now() - Number(session.startedAt || Date.now())) / 1000);
    panel.querySelector("#slFinish").textContent = knownTotal > 0 ? new Date(Date.now() + remaining * 1000).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }) : "Loading…";
    panel.querySelector("#slGoal").textContent = `${Math.floor(historyToday / 60)} / ${goal} min`;
    const todayGoalPct = Math.min(100, Math.round(historyToday / (goal * 60) * 100));
    panel.querySelector("#slGoal").title = `${todayGoalPct}% of today's study target`;
    const expectedVideos = session.mode === "video" ? 1 : Math.max(Number(session.knownPlaylistCount) || 0, videos.length);
    panel.querySelector("#slVideos").textContent = `${completedCount} / ${expectedVideos || 0}`;
    panel.querySelector("#slNoteTime").textContent = fmt(getCurrentPosition());
    panel.querySelector("#slPause").textContent = getVideo()?.paused ? "Resume video" : "Pause video";
    renderList("#slNotes", (session.notes || []).filter(n => n.videoId === currentVideoId).slice(-4).reverse(), "No notes for this lesson yet.", item => `${fmt(item.timeSeconds)} · ${new Date(item.createdAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}`, item => item.text);
    renderList("#slBookmarks", (session.bookmarks || []).filter(n => n.videoId === currentVideoId).slice(-4).reverse(), "No bookmarks for this lesson yet.", item => `Jump point · ${fmt(item.timeSeconds)}`, item => item.title || "Bookmark");
    renderBreak();
  }
  function renderList(selector, items, emptyText, getTitle, getBody) {
    const node = ui.querySelector(selector); node.textContent = "";
    if (!items.length) { const empty = document.createElement("div"); empty.className = "sl-empty"; empty.textContent = emptyText; node.append(empty); return; }
    for (const item of items) {
      const row = document.createElement("div"); row.className = "sl-list-item";
      const strong = document.createElement("strong"); strong.textContent = getTitle(item);
      const body = document.createElement("p"); body.textContent = getBody(item);
      row.append(strong, body); node.append(row);
    }
  }
  function sendProgress(force = false, completed = false, video = getVideo()) {
    if (!session?.active || !isFocusTab || !currentVideoId) return;
    const now = Date.now(); if (!force && now - lastProgressSentAt < 1800) return; lastProgressSentAt = now;
    const duration = Number(video?.duration) > 0 && Number.isFinite(video.duration) ? Number(video.duration) : Number(session.videos?.[currentVideoId]?.durationSeconds) || 0;
    const uniqueWatched = Math.min(duration || Number.MAX_SAFE_INTEGER, coveredSeconds());
    return send("PROGRESS", { videoId: currentVideoId, title: getTitle(), durationSeconds: duration, watchedSegments: watchedSegments, watchedSeconds: uniqueWatched, qualifyingPlaybackSeconds, currentTimeSeconds: seconds(video?.currentTime), isPlaying: Boolean(video && !video.paused && !video.ended && document.visibilityState === "visible" && document.hasFocus() && !isAdPlaying()), completed }).then(r => {
      if (r?.ok && r.session) { session = { ...r.session, todayStudiedSeconds: r.todayStudiedSeconds ?? session.todayStudiedSeconds }; renderOverlay(); }
      return r;
    });
  }
  function setPlaybackRate(video) { if (video && Math.abs(video.playbackRate - 1) > 0.001) { try { video.playbackRate = 1; } catch {} } }
  function seekBack(video, position) {
    if (!video || !Number.isFinite(position)) return;
    programmaticSeekUntil = Date.now() + 700;
    try { video.currentTime = Math.max(0, position); } catch {}
    trustedPosition = Math.max(0, position); lastSampleTime = trustedPosition;
  }
  function setVideoContext(video, id) {
    currentVideoId = id;
    const record = session?.videos?.[id] || {};
    watchedSegments = mergeSegments(record.watchedSegments || []);
    qualifyingPlaybackSeconds = Math.max(0, Number(record.qualifyingPlaybackSeconds) || 0);
    let safeStart = contiguousPrefix(watchedSegments);
    const savedPosition = seconds(record.lastPositionSeconds);
    // Prefer the last saved playback position when it is within the already
    // covered continuous prefix, while never resuming beyond covered content.
    if (savedPosition > 0 && savedPosition <= safeStart + 1.5) safeStart = Math.min(savedPosition, safeStart);
    if (record.completed && Number(record.durationSeconds) > 0) safeStart = 0;
    trustedPosition = safeStart;
    lastSampleTime = null;
    const cur = seconds(video.currentTime);
    if (Math.abs(cur - safeStart) > 1.5 && Number(video.readyState) >= 1) seekBack(video, safeStart);
    else { trustedPosition = cur; lastSampleTime = cur; }
    completionCheckStarted = false;
    sendProgress(true, Boolean(record.completed), video);
    renderOverlay();
  }
  function isAtNaturalEnd(video) {
    const duration = seconds(video?.duration);
    if (!duration) return false;
    const coverage = coveredSeconds();
    return Boolean(video?.ended && coverage >= Math.max(0, duration - 2.5));
  }
  function tryComplete(video) {
    if (!session?.active || !currentVideoId || isAdPlaying() || !isAtNaturalEnd(video)) return;
    const record = session.videos?.[currentVideoId] || {};
    if (session.mode === "video") { sendProgress(true, true, video).then(() => send("SESSION_COMPLETE")); return; }
    if (!record.completed) sendProgress(true, true, video);
    if (completionCheckStarted) return;
    completionCheckStarted = true;
    setTimeout(() => {
      const current = getVideo();
      const next = document.querySelector("#movie_player .ytp-next-button, .html5-video-player .ytp-next-button");
      const hasNext = Boolean(next && !next.disabled && next.getAttribute("aria-disabled") !== "true");
      if (session?.active && current?.ended && !hasNext) sendProgress(true, true, current).then(() => send("SESSION_COMPLETE"));
      completionCheckStarted = false;
    }, 6500);
  }
  function applyCaptionDefault(id) {
    if (!settings.captionsDefault || !id || captionAppliedFor === id) return;
    const button = document.querySelector(".ytp-subtitles-button");
    if (!button) return;
    if (button.getAttribute("aria-pressed") !== "true") { try { button.click(); } catch {} }
    captionAppliedFor = id;
  }
  function attachMediaListeners(video) {
    if (!video || video === currentMedia) return;
    currentMedia = video;
    video.addEventListener("ratechange", () => setPlaybackRate(video));
    video.addEventListener("seeking", () => {
      if (!session?.active || !isFocusTab || Date.now() < programmaticSeekUntil || isAdPlaying()) return;
      if (Math.abs(seconds(video.currentTime) - trustedPosition) > 1.5) seekBack(video, trustedPosition);
    });
    video.addEventListener("ended", () => tryComplete(video));
    video.addEventListener("loadedmetadata", () => {
      if (settings.captionsDefault) {
        const captionButton = document.querySelector(".ytp-subtitles-button");
        if (captionButton && captionButton.getAttribute("aria-pressed") !== "true") { try { captionButton.click(); } catch {} }
      }
    });
    video.addEventListener("play", () => { if (ui) ui.querySelector("#slPause").textContent = "Pause video"; });
    video.addEventListener("pause", () => { if (ui) ui.querySelector("#slPause").textContent = "Resume video"; });
  }
  function collectPlaylistDurations() {
    if (!session?.active || !isFocusTab || session.mode !== "playlist") return;
    const rows = document.querySelectorAll("ytd-playlist-panel-video-renderer, ytd-playlist-video-renderer");
    const items = []; const seen = new Set();
    for (const row of rows) {
      const link = row.querySelector('a[href*="watch?v="]'); if (!link) continue;
      const id = videoIdFromHref(link.href); if (!id || seen.has(id)) continue;
      seen.add(id);
      const durationEl = row.querySelector("ytd-thumbnail-overlay-time-status-renderer span, .badge-shape-wiz__text, #text.ytd-thumbnail-overlay-time-status-renderer");
      const durationSeconds = parseDuration(durationEl?.textContent || durationEl?.getAttribute("aria-label"));
      const title = row.querySelector("#video-title")?.getAttribute("title") || row.querySelector("#video-title")?.textContent || "YouTube video";
      if (durationSeconds > 0) items.push({ id, durationSeconds, title: String(title).trim().slice(0, 180) });
    }
    if (items.length) {
      const txt = document.querySelector("ytd-playlist-panel-renderer #header")?.innerText || document.querySelector("ytd-playlist-header-renderer")?.innerText || "";
      const count = Number((txt.match(/\b(\d{1,5})\s+videos?\b/i) || [])[1]) || items.length;
      send("DURATIONS_FOUND", { items, playlistCount: count });
    }
  }
  function attemptPlaylistStart() {
    if (!session?.active || session.mode !== "playlist" || autoPlayAttemptedFor === location.href || !location.pathname.startsWith("/playlist")) return;
    const play = document.querySelector('ytd-playlist-header-renderer #play-button a, ytd-playlist-header-renderer #play-button button, ytd-playlist-header-renderer button[aria-label*="Play all"], ytd-playlist-header-renderer a[aria-label*="Play all"], #play-button button');
    if (play) { autoPlayAttemptedFor = location.href; try { play.click(); } catch {} }
  }
  function maybeAutoplay(video, id) {
    if (!video || !id || video.ended || !video.paused || autoPlayAttemptedFor === id || isAdPlaying()) return;
    autoPlayAttemptedFor = id;
    const promise = video.play();
    if (promise && typeof promise.catch === "function") promise.catch(() => toast("Autoplay was blocked by Chrome. Press Play once in the YouTube player; Study Lock will track from there."));
  }

  function syncState() {
    send("GET_CONTENT_STATE").then(response => {
      if (!response?.ok) return;
      const newSession = response.session || { active: false, videos: {} };
      session = { ...newSession, todayStudiedSeconds: response.todayStudiedSeconds ?? newSession.todayStudiedSeconds }; settings = response.settings || settings; isFocusTab = Boolean(response.isFocusTab);
      const signature = `${session.active}:${isFocusTab}:${session.focusTabId}:${session.mode}:${session.videoId}:${session.playlistId}`;
      if (signature !== lastSessionSignature) {
        lastSessionSignature = signature;
        if (!session.active || !isFocusTab) removeFocusMode();
        else renderOverlay();
      }
      if (!session.active) { renderLaunchPanel(); return; }
      removeLaunchPanel();
      if (isFocusTab) {
        if (!isAllowedPage()) send("NAVIGATION_VIOLATION");
        else if (location.pathname === "/playlist") attemptPlaylistStart();
      }
    }).catch(() => {});
  }

  // The YouTube page is the actual player surface. This avoids the missing HTTP
  // Referer problem that can break an embed loaded directly from chrome-extension://.
  setInterval(() => {
    if (!session) { syncState(); return; }
    if (!session.active || !isFocusTab) return;
    if (!isAllowedPage()) { send("NAVIGATION_VIOLATION"); return; }
    if (location.href !== routeValue) { routeValue = location.href; currentVideoId = null; currentMedia = null; renderLaunchPanel(); }
    attemptPlaylistStart(); collectPlaylistDurations();
    const video = getVideo(); const id = getCurrentVideoId();
    if (video) attachMediaListeners(video);
    if (!video || !id) { renderOverlay(); return; }
    setPlaybackRate(video);
    if (id !== currentVideoId) { if (video.readyState < 1) return; setVideoContext(video, id); }
    applyCaptionDefault(id);
    maybeAutoplay(video, id);
    if (video.readyState < 2) { lastSampleTime = seconds(video.currentTime); return; }
    if (isAdPlaying()) { lastSampleTime = seconds(video.currentTime); trustedPosition = seconds(video.currentTime); return; }
    const now = seconds(video.currentTime); const duration = seconds(video.duration); const wallNow = Date.now();
    if (lastSampleTime === null) { lastSampleTime = now; trustedPosition = now; return; }
    const delta = now - lastSampleTime;
    const wallDelta = Math.max(0.2, (wallNow - (window.__studyLockLastSampleWall || wallNow - 1000)) / 1000);
    window.__studyLockLastSampleWall = wallNow;
    const canCount = !video.paused && !video.ended && !video.seeking && document.visibilityState === "visible" && document.hasFocus() && !document.hidden;
    if (canCount && delta > 0 && delta <= Math.max(2.4, wallDelta * 1.8 + 0.6)) {
      qualifyingPlaybackSeconds += Math.min(delta, Math.max(0.2, wallDelta * 1.8));
      watchedSegments = mergeSegments([...watchedSegments, [lastSampleTime, Math.min(duration || now, now)]]);
      trustedPosition = now;
    } else if (Math.abs(delta) > Math.max(1.7, wallDelta * 1.8 + 0.5) && !video.ended) {
      seekBack(video, trustedPosition);
      lastSampleTime = trustedPosition;
      renderOverlay();
      return;
    }
    lastSampleTime = seconds(video.currentTime);
    sendProgress(false, false, video);
    tryComplete(video);
    renderOverlay();
  }, 1000);

  // State refresh makes a newly active study tab authoritative, even when its page was already open in the background.
  syncState();
  setInterval(syncState, 2500);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[KEY]) { session = changes[KEY].newValue || { active: false, videos: {} }; if (!session.active) removeFocusMode(); }
    if (changes[SETTINGS_KEY]) settings = { ...settings, ...(changes[SETTINGS_KEY].newValue || {}) };
  });
  window.addEventListener("focus", syncState);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncState();
    else if (session?.active) { try { getVideo()?.pause(); } catch {} sendProgress(true); }
  });
  window.addEventListener("blur", () => { if (session?.active) { try { getVideo()?.pause(); } catch {} sendProgress(true); } });
  window.addEventListener("beforeunload", () => sendProgress(true));
})();
