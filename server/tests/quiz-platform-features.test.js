import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const frontend = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
const models = await readFile(new URL('../src/models.js', import.meta.url), 'utf8');

test('scheduled registration is separate from starting, and capacity is enforced atomically', () => {
  assert.match(appSource, /app\.post\('\/api\/quizzes\/:id\/register'/);
  assert.match(appSource, /Registration closes when the quiz starts/);
  assert.match(appSource, /startsAt: \{ \$gt: now \}/);
  assert.match(appSource, /\$expr: \{ \$lt:/);
  assert.ok(appSource.includes("'$participantIds'") && appSource.includes("'$maxParticipants'"), 'atomic capacity query uses the participant count and cap');
  assert.match(appSource, /Register for this quiz before its scheduled start time/);
  assert.match(appSource, /participantIds: \{ \$size: 0 \}/);
  assert.match(appSource, /A quiz with registered participants or attempts cannot be deleted/);
});

test('participant attempt payload contains one question and never exposes correct answers', () => {
  const match = appSource.match(/function safeQuizQuestion\(quiz, index\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'safeQuizQuestion serializer exists');
  assert.match(match[0], /timeLimitSeconds/);
  assert.doesNotMatch(match[0], /correctAnswers/);
  assert.match(appSource, /questionDeadlineAt/);
  assert.match(appSource, /advanceExpiredQuestions/);
  assert.match(appSource, /req\.body\.saveOnly === true/);
});

test('per-question time limits and fourth copy violation are represented in the data model and server', () => {
  assert.match(models, /status: \{ type: String, enum: \['in_progress', 'submitted', 'timed_out', 'disqualified'\]/);
  assert.match(models, /timeLimitSeconds: \{ type: Number, default: 30, min: 5, max: 600 \}/);
  assert.match(models, /upiId: \{ type: String, trim: true, maxlength: 120, default: '', select: false \}/);
  assert.match(appSource, /app\.post\('\/api\/quizzes\/:id\/attempt\/violation'/);
  assert.match(appSource, /fullscreen confirmation is required before starting a quiz/i);
  assert.match(appSource, /fullscreen confirmation is required to save or submit answers/i);
  assert.match(appSource, /fullscreen confirmation is required to submit this quiz/i);
  assert.match(appSource, /\$gte: \[nextWarnings, 4\]/);
  assert.match(appSource, /copyWarnings: nextWarnings/);
  assert.match(appSource, /fullscreenViolations: nextWarnings/);
  assert.match(appSource, /'fullscreen_exit', 'focus_lost'/);
  assert.match(appSource, /status: \{ \$cond: \[fourthViolation, 'disqualified'/);
  assert.match(appSource, /disqualificationReason/);
  assert.match(appSource, /status: \{ \$in: \['submitted', 'timed_out'\] \}/);
});

test('UPI is schema-private and returned publicly only for the authenticated user; admin endpoints are protected', () => {
  assert.match(models, /upiId: \{ type: String, trim: true, maxlength: 120, default: '', select: false \}/);
  assert.match(appSource, /upiId: isSelf \? \(user\.upiId \|\| ''\) : undefined/);
  assert.match(appSource, /app\.get\('\/api\/admin\/users', auth, requireAdmin/);
  assert.match(appSource, /app\.get\('\/api\/admin\/users\/:id', auth, requireAdmin/);
  assert.match(appSource, /prizeReceiptConfirmedAmount/);
  assert.match(appSource, /friends: friends\.map/);
  assert.match(appSource, /fullscreenViolations: Number\(a\.fullscreenViolations \|\| 0\)/);
  assert.match(appSource, /blockedUsers: blockedUsers\.map/);
  assert.match(appSource, /select\('\+email \+upiId'\)/);
});

test('portal has question editor navigation, private UPI field, loader and click protection', () => {
  for (const id of ['startupLoader', 'questionEditorNav', 'questionTimer', 'adminUsersList', 'publicProfileDialogTitle', 'quizWarningCount']) {
    assert.match(html, new RegExp(`id="${id}"`), `HTML is missing ${id}`);
  }
  assert.match(html, /name="upiId"/);
  assert.match(html, /UPI ID is visible to administrators only/);
  assert.match(frontend, /if\(authSubmitting\)return/);
  assert.match(frontend, /setButtonBusy\(btn,true,'Signing in…'\)/);
  assert.match(frontend, /setButtonBusy\(btn,true,'Creating account…'\)/);
  assert.match(frontend, /setButtonBusy\(btn,true,'Sending…'\)/);
  assert.match(frontend, /setInterval\(\(\)=>\{if\(!\$\('view-messages'\)\.hidden&&selectedConversation&&!document\.hidden\)loadMessages\(\{quiet:true\}\);\},3000\)/);
  assert.match(frontend, /messageLoadsInFlight\.has\(conversationId\)/);
  assert.match(frontend, /q\.participantCount>0\).*Quiz questions and schedule lock after registration/);
  assert.match(frontend, /2000-\(Date\.now\(\)-started\)/);
  assert.match(frontend, /data-goto-question/);
  assert.match(css, /\.question-editor-nav/);
  assert.match(html, /id="quizFullscreenGate"/);
  assert.match(html, /id="quizFullscreenWarningCount"/);
  assert.match(frontend, /requestFullscreen/);
  assert.match(frontend, /closeQuizLeaderboard/);
  assert.match(frontend, /quizLeaderboardRequestSequence\+\+; \$\('quizLeaderboardPanel'\)\.hidden=true/);
  assert.match(frontend, /apiCacheGeneration\+\+;[\s\S]*apiRequestsInFlight\.clear\(\)/);
  assert.match(frontend, /isCurrentViewRequest\('challenges',requestId\)/);
  assert.match(frontend, /viewNeedsRefresh/);
  assert.match(frontend, /data-optimistic-joined/);
  assert.match(frontend, /if\(currentFullscreenElement\(\)\)hideFullscreenGate\(\);else showFullscreenGate/);
  assert.match(frontend, /scheduleQuizAutosave\(\);toast\('Fullscreen restored/);
  assert.match(frontend, /prefetchAppViews/);
  assert.match(frontend, /apiRequestsInFlight/);
});
