const $ = id => document.getElementById(id);
const fmt = n => { n = Math.max(0, Math.floor(Number(n) || 0)); const h = Math.floor(n / 3600); const m = Math.floor((n % 3600) / 60); const s = n % 60; return h ? `${h}h ${m}m` : m ? `${m}m` : `${s}s`; };
const fmtClock = n => { n = Math.max(0, Math.floor(Number(n) || 0)); return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`; };
let dataState = { session: { active: false, videos: {} }, history: [], settings: {}, todayStudiedSeconds: 0 };
function localKey(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; }
function calcStreak(history, todaySeconds) {
  const days = new Set(history.filter(x => Number(x.watchedSeconds) > 0).map(x => x.dateKey));
  const today = new Date(); const todayKey = localKey(today);
  if (todaySeconds > 0) days.add(todayKey);
  let cursor = new Date(today); if (!days.has(localKey(cursor))) cursor.setDate(cursor.getDate()-1);
  let streak = 0;
  while (days.has(localKey(cursor))) { streak++; cursor.setDate(cursor.getDate()-1); if (streak > 3650) break; }
  return streak;
}
function getDailySeconds(history, key) { return history.filter(x => x.dateKey === key).reduce((n,x) => n + (Number(x.qualifyingPlaybackSeconds) || Number(x.watchedSeconds) || 0),0); }
function safeText(node, text) { node.textContent = String(text ?? ""); }
function renderChart(history, todaySeconds) {
  const chart = $("weekChart"); chart.textContent = "";
  const dates = [];
  for (let i=6; i>=0; i--) { const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-i); dates.push(d); }
  const keyToday = localKey(new Date());
  const values = dates.map(d => { const key = localKey(d); return key === keyToday ? Math.max(getDailySeconds(history,key), todaySeconds) : getDailySeconds(history,key); });
  const max = Math.max(3600, ...values);
  dates.forEach((d,i) => {
    const col = document.createElement("div"); col.className = "day-column";
    const value = document.createElement("span"); value.className = "day-value"; value.textContent = values[i] >= 3600 ? `${(values[i]/3600).toFixed(1)}h` : `${Math.round(values[i]/60)}m`;
    const track = document.createElement("div"); track.className = "bar-track"; track.title = `${d.toLocaleDateString()} · ${fmt(values[i])}`;
    const fill = document.createElement("i"); fill.style.height = `${Math.max(values[i] ? 4 : 0, Math.min(100, values[i]/max*100))}%`; track.append(fill);
    const day = document.createElement("span"); day.className = "day-label"; day.textContent = d.toLocaleDateString([], {weekday:"short"}).slice(0,2);
    col.append(value, track, day); chart.append(col);
  });
  safeText($("weekTotal"), `${Math.round(values.reduce((a,b)=>a+b,0)/60)} minutes this week`);
}
function renderHistory(history) {
  const list = $("historyList"); list.textContent = "";
  safeText($("historyCount"), `${history.length} REPORT${history.length === 1 ? "" : "S"}`);
  if (!history.length) { const empty = document.createElement("div"); empty.className = "empty-state"; empty.textContent = "Your completed and ended sessions will appear here."; list.append(empty); return; }
  history.slice(0,8).forEach(item => {
    const row = document.createElement("article"); row.className = "history-item";
    const main = document.createElement("div"); main.className = "history-main";
    const title = document.createElement("strong"); title.textContent = item.sourceTitle || (item.mode === "playlist" ? "YouTube playlist session" : "YouTube study session");
    const small = document.createElement("small");
    const date = item.startedAt ? new Date(item.startedAt).toLocaleString([], {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}) : item.dateKey;
    small.textContent = `${date} · ${item.mode === "playlist" ? "Playlist" : "Single video"} · ${item.completedVideos || 0} videos · ${(item.notes||[]).length} notes · ${(item.bookmarks||[]).length} bookmarks`;
    main.append(title,small);
    const metrics = document.createElement("div"); metrics.className = "history-metrics";
    const watched = document.createElement("div"); const strong = document.createElement("strong"); strong.textContent = fmt(item.watchedSeconds); const label = document.createElement("small"); label.textContent = "covered"; watched.append(strong,label);
    const status = document.createElement("span"); status.className = `completion-chip${item.completed ? "" : " ended"}`; status.textContent = item.completed ? "COMPLETED" : "ENDED";
    metrics.append(watched,status); row.append(main,metrics);
    const savedNotes = Array.isArray(item.notes) ? item.notes : [];
    const savedBookmarks = Array.isArray(item.bookmarks) ? item.bookmarks : [];
    if (savedNotes.length || savedBookmarks.length) {
      const details = document.createElement("details"); details.className = "history-artifacts";
      const summary = document.createElement("summary"); summary.textContent = `View ${savedNotes.length} notes and ${savedBookmarks.length} bookmarks`;
      const content = document.createElement("div"); content.className = "artifact-content";
      for (const note of savedNotes.slice(-20)) {
        const p = document.createElement("p"); const time = document.createElement("b"); time.textContent = `${fmtClock(note.timeSeconds)} · `; p.append(time, document.createTextNode(String(note.text || ""))); content.append(p);
      }
      for (const bookmark of savedBookmarks.slice(-20)) {
        const p = document.createElement("p"); const time = document.createElement("b"); time.textContent = `${fmtClock(bookmark.timeSeconds)} · `; p.append(time, document.createTextNode(String(bookmark.title || "Bookmark"))); content.append(p);
      }
      details.append(summary, content); row.append(details);
    }
    list.append(row);
  });
}
function render(data) {
  dataState = data;
  const session = data.session || { active:false, videos:{} };
  const active = Boolean(session.active);
  $("statusPill").classList.toggle("active", active);
  safeText($("statusText"), active ? "SESSION ACTIVE" : "READY TO FOCUS");
  $("activeNotice").hidden = !active;
  const canResume = !active && Boolean(session.endedAt) && !session.completed &&
    ((session.mode === "video" && Boolean(session.videoId)) || (session.mode === "playlist" && Boolean(session.playlistId)));
  $("resumeSavedNotice").hidden = !canResume;
  if (canResume) {
    const currentRecord = session.videos?.[session.currentVideoId || session.videoId] || {};
    const position = Number(currentRecord.lastPositionSeconds) || 0;
    safeText($("resumeSavedText"), `Progress is saved${position > 0 ? ` at ${fmtClock(position)}` : ""}. Continue without losing your covered watch time.`);
  }
  $("startButton").disabled = active;
  $("startButton").textContent = active ? "Session already active" : "Start learning session ↗";
  if (data.settings) {
    $("dailyGoalMinutes").value = data.settings.dailyGoalMinutes ?? 120;
    $("breakEnabled").checked = Boolean(data.settings.breakEnabled);
    $("breakEveryMinutes").value = data.settings.breakEveryMinutes ?? 50;
    $("breakLengthMinutes").value = data.settings.breakLengthMinutes ?? 5;
    $("redirectInactiveTabs").checked = data.settings.redirectInactiveTabs !== false;
    $("closeOtherTabs").checked = Boolean(data.settings.closeOtherTabs);
  }
  const today = Number(data.todayStudiedSeconds) || 0;
  const goal = Math.max(15, Number(data.settings?.dailyGoalMinutes) || 120);
  const pct = Math.min(100, Math.round(today/(goal*60)*100));
  safeText($("todayTime"), fmt(today)); safeText($("todayGoalText"), `of ${goal}m goal`); $("goalFill").style.width = `${pct}%`; safeText($("goalCaption"), `${pct}% of your daily target`);
  const todayKey = localKey(new Date()); const uniqueCoverageToday = (data.history||[]).filter(item=>item.dateKey===todayKey).reduce((n,item)=>n+(Number(item.watchedSeconds)||0),0) + (active && localKey(new Date(session.startedAt||Date.now()))===todayKey ? Number(session.knownWatchedSeconds)||0 : 0);
  safeText($("coverageToday"), fmt(uniqueCoverageToday));
  const streak = calcStreak(data.history || [], today); safeText($("streakCount"), `${streak} day${streak===1?"":"s"}`); safeText($("streakCaption"), streak ? "Keep the chain alive." : "Start your streak today.");
  const history = data.history || []; const allWatched = history.reduce((n,x)=>n+(Number(x.watchedSeconds)||0),0) + (active ? Number(session.knownWatchedSeconds)||0 : 0);
  safeText($("lifetimeTime"), allWatched >= 3600 ? `${(allWatched/3600).toFixed(1)}h` : `${Math.round(allWatched/60)}m`); safeText($("sessionsCount"), String(history.length));
  renderChart(history, today); renderHistory(history);
}
async function refresh() {
  try { const response = await chrome.runtime.sendMessage({ type: "GET_DASHBOARD" }); if (response?.ok) render(response); }
  catch { $("setupError").textContent = "Could not read dashboard data. Reload Study Lock at chrome://extensions."; }
}
$("youtubeUrl").addEventListener("input", () => { try { const url = new URL($("youtubeUrl").value.trim()); if (url.searchParams.get("list")) $("mode").value = "playlist"; } catch {} });
$("setupForm").addEventListener("submit", async e => {
  e.preventDefault(); $("setupError").textContent = "";
  if (dataState.session?.active) { $("setupError").textContent = "A study session is already active. End it before starting another."; return; }
  const url = $("youtubeUrl").value.trim(); const mode = $("mode").value; const closeOtherTabs = $("closeOtherTabs").checked;
  if (!url) { $("setupError").textContent = "Paste a YouTube video or playlist URL."; return; }
  if (closeOtherTabs && !confirm("This will close every other open Chrome tab. Save unsaved work first. Continue?")) return;
  const button = $("startButton"); button.disabled = true; button.textContent = "Opening your lesson…";
  try {
    const response = await chrome.runtime.sendMessage({ type: "START_SESSION", url, mode, closeOtherTabs });
    if (!response?.ok) throw new Error(response?.error || "Could not start the session.");
  } catch (err) { $("setupError").textContent = err?.message || "Could not start the session."; button.disabled = false; button.textContent = "Start learning session ↗"; }
});
$("resumeButton").addEventListener("click", async () => { await chrome.runtime.sendMessage({ type:"RESUME_SESSION" }); });
$("resumeSavedButton").addEventListener("click", async () => {
  const button = $("resumeSavedButton"); button.disabled = true; button.textContent = "Resuming lesson…"; $("setupError").textContent = "";
  try {
    const response = await chrome.runtime.sendMessage({ type:"RESUME_LAST_SESSION" });
    if (!response?.ok) throw new Error(response?.error || "Could not resume the saved lesson.");
    await refresh();
  } catch (error) { $("setupError").textContent = error?.message || "Could not resume the saved lesson."; }
  finally { button.disabled = false; button.textContent = "Resume lesson"; }
});
$("settingsForm").addEventListener("submit", async e => {
  e.preventDefault(); $("settingsStatus").textContent = "Saving…";
  const settings = {
    dailyGoalMinutes: Number($("dailyGoalMinutes").value), closeOtherTabs: $("closeOtherTabs").checked,
    breakEnabled: $("breakEnabled").checked, breakEveryMinutes: Number($("breakEveryMinutes").value),
    breakLengthMinutes: Number($("breakLengthMinutes").value), redirectInactiveTabs: $("redirectInactiveTabs").checked
  };
  try { const response = await chrome.runtime.sendMessage({ type:"SAVE_SETTINGS", settings }); if (!response?.ok) throw new Error(response?.error || "Could not save settings."); $("settingsStatus").textContent = "Preferences saved."; await refresh(); }
  catch (error) { $("settingsStatus").textContent = error?.message || "Could not save preferences."; }
});
$("exportButton").addEventListener("click", async () => {
  try {
    const response = await chrome.runtime.sendMessage({type:"GET_DASHBOARD"}); if (!response?.ok) throw new Error("Could not build report.");
    const report = { exportedAt:new Date().toISOString(), product:"Study Lock", version:chrome.runtime.getManifest().version, settings:response.settings, history:response.history, activeSession:response.session.active ? response.session : null, todayStudiedSeconds:response.todayStudiedSeconds };
    const blob = new Blob([JSON.stringify(report,null,2)],{type:"application/json"}); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href=url; a.download=`study-lock-report-${localKey(new Date())}.json`; document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  } catch (error) { $("settingsStatus").textContent = error?.message || "Report export failed."; }
});
chrome.storage.onChanged.addListener((changes,area) => { if(area === "local" && (changes.studyLockSession || changes.studyLockHistory || changes.studyLockSettings)) refresh(); });
function tickClock() { $("clock").textContent = new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}); }
tickClock(); setInterval(tickClock,1000); refresh();

// Advanced learning tools: plan reminders, active recall, searchable notes, backup/restore.
function sendMessage(message) { return chrome.runtime.sendMessage(message); }
function makeButton(label, className, onClick) {
  const button = document.createElement("button"); button.type = "button"; button.className = `button ${className || "quiet"}`; button.textContent = label; button.addEventListener("click", onClick); return button;
}
function renderPlans(plans) {
  const list = $("planList"); list.textContent = "";
  const week = $("planWeekSummary"); if (week) { week.textContent = ""; const byDay = new Map(); for (const plan of (plans || [])) { if (plan.completed || !Number(plan.dueAt) || Number(plan.dueAt) < Date.now() - 86400000) continue; const d = new Date(Number(plan.dueAt)); const key = localKey(d); const item = byDay.get(key) || { date: d, count: 0, minutes: 0 }; item.count++; item.minutes += Math.max(1, Number(plan.expectedMinutes) || 30); byDay.set(key, item); } const upcoming = [...byDay.values()].sort((a,b)=>a.date-b.date).slice(0,7); if (!upcoming.length) { const tip=document.createElement("p"); tip.className="tool-item-meta"; tip.textContent="Add a reminder date to see your upcoming weekly workload here."; week.append(tip); } else { const heading=document.createElement("div"); heading.className="tool-item-meta"; heading.textContent="Upcoming workload by day"; week.append(heading); for (const day of upcoming) { const row=document.createElement("div"); row.className="plan-day-row"; const label=document.createElement("span"); label.textContent=day.date.toLocaleDateString([], {weekday:"short",month:"short",day:"numeric"}); const bar=document.createElement("span"); bar.className="plan-day-bar"; const fill=document.createElement("i"); fill.style.width=`${Math.min(100, day.minutes/240*100)}%`; bar.append(fill); const total=document.createElement("b"); total.textContent=`${day.minutes}m · ${day.count}`; row.append(label,bar,total); week.append(row); } } }
  const ordered = [...(plans || [])].sort((a,b) => Number(a.completed)-Number(b.completed) || (Number(a.dueAt)||Number.MAX_SAFE_INTEGER) - (Number(b.dueAt)||Number.MAX_SAFE_INTEGER));
  if (!ordered.length) { const empty=document.createElement("div"); empty.className="empty-state"; empty.textContent="Your planned lessons will appear here."; list.append(empty); return; }
  ordered.forEach(plan => {
    const card=document.createElement("article"); card.className="tool-item";
    const head=document.createElement("div"); head.className="tool-item-head";
    const text=document.createElement("div"); text.style.minWidth="0";
    const title=document.createElement("div"); title.className="tool-item-title"; title.textContent=plan.title;
    const meta=document.createElement("div"); meta.className="tool-item-meta"; meta.textContent=`${plan.mode === "playlist" ? "Playlist" : "Single video"} · about ${Number(plan.expectedMinutes)||30} min${plan.dueAt ? ` · reminder ${new Date(plan.dueAt).toLocaleString()}` : " · no reminder set"}`;
    text.append(title,meta); const badge=document.createElement("span"); badge.className=`completion-chip ${plan.completed ? "done" : (plan.dueAt && plan.dueAt < Date.now() ? "due" : "")}`; badge.textContent=plan.completed?"DONE":(plan.dueAt && plan.dueAt < Date.now()?"DUE":"PLANNED"); head.append(text,badge); card.append(head);
    const actions=document.createElement("div"); actions.className="tool-actions";
    if(!plan.completed) actions.append(makeButton("Start studying","primary",async()=>{ const r=await sendMessage({type:"START_PLAN",id:plan.id}); if(!r?.ok) { $("planStatus").textContent=r?.error||"Could not start this plan."; } else { $("planStatus").textContent="Study plan started."; await refresh(); } }));
    if(!plan.completed && Number(plan.dueAt) > 0 && Number(plan.dueAt) < Date.now()) actions.append(makeButton("Move to tomorrow","quiet",async()=>{ const r=await sendMessage({type:"RESCHEDULE_PLAN",id:plan.id,dueAt:Date.now()+86400000}); if(!r?.ok){$("planStatus").textContent=r?.error||"Could not reschedule.";return;} $("planStatus").textContent="Overdue plan moved to tomorrow."; await refresh(); }));
    if(!plan.completed) actions.append(makeButton("Mark done","quiet",async()=>{ const r=await sendMessage({type:"COMPLETE_PLAN",id:plan.id}); if(r?.ok) await refresh(); }));
    actions.append(makeButton("Delete","quiet",async()=>{ if(!confirm(`Delete study plan “${plan.title}”?`)) return; const r=await sendMessage({type:"DELETE_PLAN",id:plan.id}); if(r?.ok) await refresh(); }));
    card.append(actions); list.append(card);
  });
}
function renderFlashcards(cards) {
  const list=$("flashcardList"); list.textContent="";
  const deck=cards||[]; const due=deck.filter(card=>Number(card.dueAt||0)<=Date.now());
  safeText($("flashcardDueCount"),`${due.length} DUE`);
  if(!deck.length){const empty=document.createElement("div");empty.className="empty-state";empty.textContent="Create a card to build your revision deck.";list.append(empty);return;}
  const view=[...due,...deck.filter(card=>!due.includes(card))].slice(0,12);
  view.forEach(card=>{
    const node=document.createElement("article");node.className="tool-item";
    const head=document.createElement("div");head.className="tool-item-head";const title=document.createElement("div");title.className="tool-item-title";title.textContent=card.question;
    const badge=document.createElement("span");badge.className=`completion-chip ${Number(card.dueAt||0)<=Date.now()?"due":"done"}`;badge.textContent=Number(card.dueAt||0)<=Date.now()?"DUE FOR REVIEW":`DUE ${new Date(card.dueAt).toLocaleDateString()}`;head.append(title,badge);node.append(head);
    const answer=document.createElement("div");answer.className="answer-box";answer.hidden=true;answer.textContent=card.answer;node.append(answer);
    const actions=document.createElement("div");actions.className="tool-actions";
    actions.append(makeButton("Show answer","quiet",()=>{answer.hidden=!answer.hidden;}));
    if(Number(card.dueAt||0)<=Date.now()){
      for(const [rating,label] of [["again","Again · 1 day"],["hard","Hard"],["good","Good"],["easy","Easy"]]) actions.append(makeButton(label,"quiet",async()=>{const r=await sendMessage({type:"REVIEW_FLASHCARD",id:card.id,rating});if(r?.ok)await refresh();else $("flashcardStatus").textContent=r?.error||"Could not save review.";}));
    }
    actions.append(makeButton("Delete","quiet",async()=>{if(!confirm("Delete this flashcard?"))return;const r=await sendMessage({type:"DELETE_FLASHCARD",id:card.id});if(r?.ok)await refresh();}));
    node.append(actions);list.append(node);
  });
  if(deck.length>view.length){const note=document.createElement("p");note.className="tool-item-meta";note.textContent=`Showing ${view.length} of ${deck.length} flashcards. Prioritizing cards due for review.`;list.append(note);}
}
function allSavedArtifacts() {
  const items=[]; const session=dataState.session||{};
  for(const item of (session.notes||[])) items.push({...item,kind:"note",reportId:session.sessionId||null,active:!!session.active});
  for(const item of (session.bookmarks||[])) items.push({...item,kind:"bookmark",reportId:session.sessionId||null,active:!!session.active});
  for(const report of (dataState.history||[])) {
    for(const item of (report.notes||[])) items.push({...item,kind:"note",reportId:report.id});
    for(const item of (report.bookmarks||[])) items.push({...item,kind:"bookmark",reportId:report.id});
  }
  const dedup=new Map(); for(const item of items) dedup.set(`${item.kind}:${item.id}`,item);
  return [...dedup.values()].sort((a,b)=>(Number(b.createdAt)||0)-(Number(a.createdAt)||0));
}
function renderNotesLibrary() {
  const list=$("notesLibrary"); list.textContent="";
  const q=String($("notesSearch")?.value||"").trim().toLowerCase();
  const items=allSavedArtifacts().filter(item=>`${item.title||""} ${item.text||""} ${item.timeSeconds||0} ${item.kind}`.toLowerCase().includes(q));
  if(!items.length){const empty=document.createElement("div");empty.className="empty-state";empty.textContent=q?"No notes or bookmarks match this search.":"Notes and bookmarks will appear after you save them during a lesson.";list.append(empty);return;}
  items.slice(0,100).forEach(item=>{
    const node=document.createElement("article");node.className="tool-item";
    const head=document.createElement("div");head.className="tool-item-head";
    const main=document.createElement("div");main.style.minWidth="0";
    const title=document.createElement("div");title.className="tool-item-title";title.textContent=`${item.kind==="note"?"NOTE":"BOOKMARK"} · ${item.title||"YouTube video"}`;
    const meta=document.createElement("div");meta.className="tool-item-meta";meta.textContent=`${fmtClock(item.timeSeconds)} · ${item.createdAt?new Date(item.createdAt).toLocaleString():"Saved item"}${item.active?" · current session":""}`;
    main.append(title,meta);head.append(main);node.append(head);
    if(item.text){const body=document.createElement("div");body.className="tool-item-body";body.textContent=item.text;node.append(body);}
    const actions=document.createElement("div");actions.className="tool-actions";
    actions.append(makeButton("Jump to moment","quiet",async()=>{try{const r=await sendMessage({type:"JUMP_TO_TIMESTAMP",videoId:item.videoId,timeSeconds:item.timeSeconds});if(!r?.ok)throw new Error(r?.error||"Could not open that moment.");}catch(error){$("backupStatus").textContent=error.message;}}));
    if(item.kind==="note") actions.append(makeButton("Edit","quiet",async()=>{const edited=prompt("Edit your note",item.text||"");if(edited===null)return;if(!edited.trim()){alert("A note cannot be empty. Use Delete to remove it.");return;}const r=await sendMessage({type:"MANAGE_ARTIFACT",kind:"note",action:"edit",id:item.id,text:edited});if(!r?.ok){alert(r?.error||"Could not edit note.");return;}await refresh();}));
    actions.append(makeButton("Delete","quiet",async()=>{if(!confirm(`Delete this ${item.kind}?`))return;const r=await sendMessage({type:"MANAGE_ARTIFACT",kind:item.kind,action:"delete",id:item.id});if(!r?.ok){alert(r?.error||"Could not delete saved item.");return;}await refresh();}));
    node.append(actions);list.append(node);
  });
}
function downloadBlob(contents,type,name) {
  const blob=new Blob([contents],{type});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function exportFullBackup() {
  const result=await sendMessage({type:"EXPORT_BACKUP"});if(!result?.ok)throw new Error(result?.error||"Could not build a backup.");
  downloadBlob(JSON.stringify(result.backup,null,2),"application/json",`study-lock-backup-${localKey(new Date())}.json`);
}
function applyAccessibility(settings={}) {
  document.body.dataset.fontSize=settings.fontScale||"normal";
  document.body.classList.toggle("reduce-motion",Boolean(settings.reduceMotion));
}

$("planUrl").addEventListener("input",()=>{try{const url=new URL($("planUrl").value.trim());if(url.pathname==="/playlist")$("planMode").value="playlist";}catch{}});
$("planForm").addEventListener("submit",async event=>{
  event.preventDefault();$("planStatus").textContent="Saving study plan…";
  const title=$("planTitle").value.trim(),url=$("planUrl").value.trim(),mode=$("planMode").value;
  const dueValue=$("planDueAt").value;const dueAt=dueValue?new Date(dueValue).getTime():0;
  try{const r=await sendMessage({type:"SAVE_PLAN",title,url,mode,dueAt,expectedMinutes:Number($("planMinutes").value)||30});if(!r?.ok)throw new Error(r?.error||"Could not save study plan.");$("planForm").reset();$("planMinutes").value="30";$("planStatus").textContent=r.syncWarning?`Plan saved locally. ${r.syncWarning}`:(dueAt?"Plan saved. Chrome will remind you at the scheduled time when notifications are permitted.":"Plan saved.");await refresh();}
  catch(error){$("planStatus").textContent=error?.message||"Could not save study plan.";}
});
$("flashcardForm").addEventListener("submit",async event=>{
  event.preventDefault();$("flashcardStatus").textContent="Saving flashcard…";
  try{const r=await sendMessage({type:"SAVE_FLASHCARD",question:$("flashQuestion").value,answer:$("flashAnswer").value});if(!r?.ok)throw new Error(r?.error||"Could not save card.");$("flashcardForm").reset();$("flashcardStatus").textContent=r.syncWarning?`Card saved locally. ${r.syncWarning}`:"Flashcard saved. It is now due for review.";await refresh();}
  catch(error){$("flashcardStatus").textContent=error?.message||"Could not save flashcard.";}
});
$("notesSearch").addEventListener("input",renderNotesLibrary);
$("clearNotesSearchButton").addEventListener("click",()=>{$("notesSearch").value="";renderNotesLibrary();});
$("exportNotesButton").addEventListener("click",()=>{
  const items=allSavedArtifacts();const lines=["# Study Lock — Notes and Bookmarks","",`Exported: ${new Date().toLocaleString()}`,"",...items.map(item=>`## ${item.kind==="note"?"Note":"Bookmark"}: ${item.title||"YouTube video"} (${fmtClock(item.timeSeconds)})\n\n${item.text||""}\n\nVideo ID: ${item.videoId||"unknown"}\n` )];
  downloadBlob(lines.join("\n"),"text/markdown",`study-lock-notes-${localKey(new Date())}.md`);
});
$("printNotesButton").addEventListener("click",()=>{
  const items=allSavedArtifacts();const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const rows=items.map(item=>`<article><h2>${escapeHtml(item.kind==="note"?"Note":"Bookmark")} · ${escapeHtml(item.title||"YouTube video")}</h2><p class="meta">${escapeHtml(fmtClock(item.timeSeconds))} · ${escapeHtml(item.createdAt?new Date(item.createdAt).toLocaleString():"Saved item")}</p><p>${escapeHtml(item.text||"").replace(/\n/g,"<br>")}</p></article>`).join("");
  const win=window.open("","_blank");if(!win){$("backupStatus").textContent="Allow pop-ups for Study Lock to print notes.";return;}
  win.document.open();win.document.write(`<!doctype html><html><head><title>Study Lock Notes</title><meta charset="utf-8"><style>body{font:15px/1.6 Arial,sans-serif;max-width:850px;margin:40px auto;padding:0 24px;color:#111}h1{font-size:28px}h2{font-size:17px;margin-bottom:2px}article{padding:14px 0;border-bottom:1px solid #ddd;break-inside:avoid}.meta{color:#555;font-size:12px} @media print{body{margin:0 auto}}</style></head><body><h1>Study Lock — Notes and Bookmarks</h1><p>Exported ${escapeHtml(new Date().toLocaleString())}</p>${rows||"<p>No notes or bookmarks have been saved yet.</p>"}<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250));<\/script></body></html>`);win.document.close();
});
$("syncNowButton").addEventListener("click",async()=>{try{$("backupStatus").textContent="Syncing saved data…";const r=await sendMessage({type:"SYNC_NOW"});if(!r?.ok)throw new Error(r?.error||"Sync failed.");$("backupStatus").textContent=r.message;}catch(error){$("backupStatus").textContent=error?.message||"Sync failed.";}});
$("backupButton").addEventListener("click",async()=>{try{$("backupStatus").textContent="Preparing backup…";await exportFullBackup();$("backupStatus").textContent="Backup downloaded.";}catch(error){$("backupStatus").textContent=error?.message||"Backup failed.";}});
$("restoreFile").addEventListener("change",async()=>{
  const file=$("restoreFile").files?.[0];if(!file)return;
  try{if(file.size>15*1024*1024)throw new Error("Backup file is too large (15 MB maximum).");const text=await file.text();const backup=JSON.parse(text);if(!confirm("Restore this Study Lock backup? Current local reports, plans, cards and preferences will be replaced. End any active session first."))return;const r=await sendMessage({type:"IMPORT_BACKUP",backup});if(!r?.ok)throw new Error(r?.error||"Restore failed.");$("backupStatus").textContent="Backup restored successfully.";await refresh();}
  catch(error){$("backupStatus").textContent=error?.message||"Could not restore backup.";}finally{$("restoreFile").value="";}
});
$("saveDisplayButton").addEventListener("click",async()=>{
  const current=dataState.settings||{};const settings={...current,fontScale:$("fontScale").value,reduceMotion:$("reduceMotion").checked,captionsDefault:$("captionsDefault").checked,syncEnabled:$("syncEnabled").checked};
  try{const r=await sendMessage({type:"SAVE_SETTINGS",settings});if(!r?.ok)throw new Error(r?.error||"Could not save preferences.");applyAccessibility(r.settings);$("displayStatus").textContent=r.syncWarning?`Preferences saved locally. ${r.syncWarning}`:"Display preferences saved.";await refresh();}catch(error){$("displayStatus").textContent=error?.message||"Could not save display preferences.";}
});

let quizDeck=[];let quizIndex=0;let quizRevealed=false;
function showQuizCard(){
  const panel=$("quizPanel");if(!quizDeck.length||quizIndex>=quizDeck.length){$("quizQuestion").textContent="Quiz complete — nice work.";$("quizProgress").textContent=`Finished ${quizDeck.length} card${quizDeck.length===1?"":"s"}.`;$("quizResponse").hidden=true;$("quizAnswer").hidden=true;$("revealQuizAnswer").hidden=true;$("quizAgain").hidden=true;$("quizKnown").hidden=true;$("quizStatus").textContent="Review cards marked Again to strengthen recall.";return;}
  const card=quizDeck[quizIndex];quizRevealed=false;$("quizProgress").textContent=`Question ${quizIndex+1} of ${quizDeck.length}`;$("quizQuestion").textContent=card.question;$("quizResponse").value="";$("quizResponse").hidden=false;$("quizAnswer").textContent=card.answer;$("quizAnswer").hidden=true;$("revealQuizAnswer").hidden=false;$("quizAgain").hidden=true;$("quizKnown").hidden=true;$("quizStatus").textContent="Write your answer, then reveal the model answer.";
}
$("startQuizButton").addEventListener("click",()=>{const cards=dataState.cards||[];if(!cards.length){$("flashcardStatus").textContent="Create at least one flashcard before starting a quiz.";return;}const due=cards.filter(c=>Number(c.dueAt||0)<=Date.now());const source=due.length?due:cards;quizDeck=[...source].sort(()=>Math.random()-.5).slice(0,5);quizIndex=0;$("quizPanel").hidden=false;showQuizCard();$("quizPanel").scrollIntoView({behavior:document.body.classList.contains("reduce-motion")?"auto":"smooth",block:"nearest"});});
$("revealQuizAnswer").addEventListener("click",()=>{if(!quizDeck[quizIndex])return;quizRevealed=true;$("quizAnswer").hidden=false;$("quizAgain").hidden=false;$("quizKnown").hidden=false;$("revealQuizAnswer").hidden=true;$("quizStatus").textContent="Self-assess honestly: choose Again if you struggled, or I knew it if you recalled it.";});
async function gradeQuizCard(rating){const card=quizDeck[quizIndex];if(!card)return;const r=await sendMessage({type:"REVIEW_FLASHCARD",id:card.id,rating});if(!r?.ok){$("quizStatus").textContent=r?.error||"Could not save card review.";return;}quizIndex++;await refresh();showQuizCard();}
$("quizAgain").addEventListener("click",()=>gradeQuizCard("again"));$("quizKnown").addEventListener("click",()=>gradeQuizCard("good"));$("closeQuiz").addEventListener("click",()=>{$("quizPanel").hidden=true;quizDeck=[];});

// Wrap the main renderer so the advanced sections update with storage state too.
const renderBase = render;
render = function(data) {
  renderBase(data);
  applyAccessibility(data.settings||{});
  if(data.settings){$("fontScale").value=data.settings.fontScale||"normal";$("reduceMotion").checked=Boolean(data.settings.reduceMotion);$("captionsDefault").checked=Boolean(data.settings.captionsDefault);$("syncEnabled").checked=Boolean(data.settings.syncEnabled);}
  renderPlans(data.plans||[]);renderFlashcards(data.cards||[]);renderNotesLibrary();
};
const refreshBase = refresh;
refresh = async function(){
  try{const response=await chrome.runtime.sendMessage({type:"GET_DASHBOARD"});if(response?.ok)render(response);}
  catch{$("setupError").textContent="Could not read dashboard data. Reload Study Lock at chrome://extensions.";}
};
// Include new stores in live dashboard refreshes.
chrome.storage.onChanged.addListener((changes,area)=>{if(area==="local"&&(changes.studyLockPlans||changes.studyLockFlashcards||changes.studyLockHistory||changes.studyLockSession))refresh();});


// Optional Study Lock Social integration. Credentials stay in this browser profile;
// remote activity is sent only after the user explicitly connects an account.
const SOCIAL_CONFIG_KEY = "studyLockSocialConfig";
let socialConfig = null;
function normalizeSocialBase(raw) {
  const u = new URL(String(raw || "").trim());
  if (u.username || u.password || u.search || u.hash) throw new Error("Enter only your service base URL, without credentials, query strings, or fragments.");
  const local = ["localhost", "127.0.0.1"].includes(u.hostname);
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) throw new Error("Use an HTTPS Render URL. HTTP is allowed only for localhost testing.");
  if (u.pathname !== "/" && u.pathname !== "") throw new Error("Enter the base URL only, without /api or other paths.");
  return u.origin;
}
async function loadSocialConfig() {
  try { const data = await chrome.storage.local.get(SOCIAL_CONFIG_KEY); socialConfig = data[SOCIAL_CONFIG_KEY] || null; } catch { socialConfig = null; }
  if (socialConfig?.apiBase) $("socialApiBase").value = socialConfig.apiBase;
  if (socialConfig?.token && socialConfig?.user) {
    $("socialConnectedState").hidden = false;
    safeText($("socialConnectedName"), socialConfig.user.displayName || "Connected");
    safeText($("socialConnectedUsername"), `@${socialConfig.user.username || "learner"} · Activity sync enabled`);
    $("socialLoginButton").textContent = "Reconnect account";
  } else {
    $("socialConnectedState").hidden = true;
    $("socialLoginButton").textContent = "Sign in & connect";
  }
}
async function socialApi(path, options = {}) {
  if (!socialConfig?.apiBase || !socialConfig?.token) throw new Error("Connect your Study Lock Social account first.");
  const headers = { "Accept": "application/json", ...(options.headers || {}), "Authorization": `Bearer ${socialConfig.token}` };
  if (options.body && typeof options.body !== "string") headers["Content-Type"] = "application/json";
  const response = await fetch(`${socialConfig.apiBase}${path}`, { ...options, headers, body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) { socialConfig.token = ""; await chrome.storage.local.set({ [SOCIAL_CONFIG_KEY]: socialConfig }); await loadSocialConfig(); }
    throw new Error(data.error || `Social service returned ${response.status}.`);
  }
  return data;
}
async function postSocialEvents(events) {
  let accepted = 0; let ignored = 0;
  for (let offset = 0; offset < events.length; offset += 50) {
    const result = await socialApi("/api/study-events", { method: "POST", body: { events: events.slice(offset, offset + 50) } });
    accepted += Number(result.accepted) || 0; ignored += (result.ignored || []).length;
  }
  return { accepted, ignored };
}
function splitSocialSeconds(total) { return Math.max(0, Math.ceil(Math.min(8 * 60 * 60, Number(total) || 0) / 120)); }
function buildSocialEventsFromReport(report) {
  const events = [];
  const sessionId = String(report.id || `history-${report.startedAt || Date.now()}`).replace(/[^A-Za-z0-9:_-]/g, "-").slice(0, 55);
  const qualifyingSeconds = Math.min(8 * 60 * 60, Math.max(0, report.qualifyingPlaybackSeconds !== undefined ? (Number(report.qualifyingPlaybackSeconds) || 0) : 0));
  const coverageSeconds = Math.min(8 * 60 * 60, Math.max(0, Number(report.watchedSeconds) || 0));
  const count = Math.max(1, Math.ceil(Math.max(qualifyingSeconds, coverageSeconds) / 120));
  for (let i = 0; i < count; i++) {
    events.push({ eventId: `backfill-${sessionId}-time-${i}`, sessionId, videoTitle: String(report.sourceTitle || "YouTube study session").slice(0, 180), qualifyingSeconds: Math.min(120, Math.max(0, qualifyingSeconds - i * 120)), coverageSeconds: Math.min(120, Math.max(0, coverageSeconds - i * 120)), completed: false, eventAt: Number(report.startedAt) || Date.now() });
  }
  const completed = Math.min(100, Math.max(0, Number(report.completedVideos) || (report.completed ? 1 : 0)));
  for (let i = 0; i < completed; i++) events.push({ eventId: `backfill-${sessionId}-lesson-${i}`, sessionId, videoTitle: String(report.sourceTitle || "Completed YouTube lesson").slice(0, 180), qualifyingSeconds: 0, coverageSeconds: 0, completed: true, eventAt: Number(report.endedAt || report.startedAt) || Date.now() });
  return events;
}
async function syncSavedReportsToSocial() {
  if (!socialConfig?.token) throw new Error("Sign in to Study Lock Social before syncing.");
  const response = await chrome.runtime.sendMessage({ type: "GET_DASHBOARD" });
  if (!response?.ok) throw new Error("Could not read local study reports.");
  const history = (response.history || []).filter(item => !item.socialSyncedAt && (Date.now() - (Number(item.endedAt) || 0)) <= 90 * 86400_000);
  if (!history.length) return { reports: 0, accepted: 0, ignored: 0 };
  let accepted = 0; let ignored = 0; let syncedReports = [];
  for (const report of history) {
    const events = buildSocialEventsFromReport(report);
    const outcome = await postSocialEvents(events); accepted += outcome.accepted; ignored += outcome.ignored; syncedReports.push(report.id);
  }
  await chrome.runtime.sendMessage({ type: "MARK_SOCIAL_REPORTS_SYNCED", ids: syncedReports, syncedAt: Date.now() });
  return { reports: syncedReports.length, accepted, ignored };
}
async function socialAuth(register = false) {
  const status = $("socialStatus"); status.textContent = "Connecting…";
  try {
    const apiBase = normalizeSocialBase($("socialApiBase").value);
    const password = $("socialPassword").value;
    if (register && !$("socialAcceptTerms").checked) throw new Error("Please accept the community rules and privacy notice before creating an account.");
    const path = register ? "/api/auth/register" : "/api/auth/login";
    const body = register ? {
      displayName: $("socialDisplayName").value.trim(), username: $("socialUsername").value.trim(),
      email: $("socialEmail").value.trim(), password,
      joinLeaderboard: $("socialJoinLeaderboard").checked,
      acceptTerms: $("socialAcceptTerms").checked
    } : { emailOrUsername: $("socialEmailOrUsername").value.trim(), password };
    const resp = await fetch(`${apiBase}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify(body) });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `Could not connect (${resp.status}).`);
    if (data.verificationRequired) { status.textContent = data.message || "Check your email to verify your account before signing in."; return; }
    if (!data.token || !data.user) throw new Error("The server did not return a session token. Check the API response and account verification.");
    socialConfig = { apiBase, token: data.token, user: data.user, connectedAt: Date.now() };
    await chrome.storage.local.set({ [SOCIAL_CONFIG_KEY]: socialConfig });
    await loadSocialConfig();
    status.textContent = `Connected as @${data.user.username}. Syncing recent study reports…`;
    try {
      const result = await syncSavedReportsToSocial();
      status.textContent = `Connected as @${data.user.username}. Synced ${result.reports} saved report(s); ${result.accepted} new activity event(s).`;
    } catch (syncError) { status.textContent = `Connected, but saved reports could not sync: ${syncError.message}`; }
    status.classList.add("success-message");
  } catch (error) { status.textContent = error.message || "Social sign-in failed."; }
}
$("socialLoginButton")?.addEventListener("click", () => socialAuth(false));
$("socialShowRegisterButton")?.addEventListener("click", () => { $("socialRegisterFields").hidden = false; $("socialRegisterActions").hidden = false; $("socialShowRegisterButton").hidden = true; $("socialLoginButton").hidden = true; });
$("socialCancelRegisterButton")?.addEventListener("click", () => { $("socialRegisterFields").hidden = true; $("socialRegisterActions").hidden = true; $("socialShowRegisterButton").hidden = false; $("socialLoginButton").hidden = false; });
$("socialRegisterButton")?.addEventListener("click", () => socialAuth(true));
$("socialOpenPortalButton")?.addEventListener("click", async () => {
  try { const base = normalizeSocialBase($("socialApiBase").value || socialConfig?.apiBase); await chrome.tabs.create({ url: base, active: true }); }
  catch (error) { $("socialStatus").textContent = error.message; }
});
$("socialSyncNowButton")?.addEventListener("click", async () => {
  const status = $("socialStatus"); status.textContent = "Syncing reports…";
  try { const result = await syncSavedReportsToSocial(); status.textContent = `Synced ${result.reports} report(s); ${result.accepted} new events, ${result.ignored} duplicates/ignored.`; }
  catch (error) { status.textContent = error.message; }
});
$("socialDisconnectButton")?.addEventListener("click", async () => {
  if (!confirm("Disconnect this browser from Study Lock Social? Your online account is not deleted.")) return;
  socialConfig = null; await chrome.storage.local.remove(SOCIAL_CONFIG_KEY); await loadSocialConfig(); $("socialStatus").textContent = "Disconnected. Local study data remains on this device.";
});
loadSocialConfig();
