import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const frontend = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const manifest = await readFile(new URL('../../manifest.json', import.meta.url), 'utf8');

test('social API route contract contains core product routes and safeguards', () => {
  for (const route of [
    "/api/auth/register", "/api/auth/login", "/api/auth/logout", "/api/auth/verify", "/api/auth/forgot-password",
    "/api/me/stats", "/api/leaderboard", "/api/friends/requests", "/api/conversations/:userId/messages",
    "/api/challenges", "/api/reports", "/api/admin/reports", "/api/admin/quizzes", "/api/quizzes/:id/start",
    "/api/quizzes/:id/attempt", "/api/quizzes/:id/submit", "/api/quizzes/:id/leaderboard",
    "/api/admin/quizzes/:quizId/attempts/:attemptId/profile", "/api/admin/quizzes/:quizId/attempts/:attemptId/prize",
    "/api/quizzes/:id/prize/confirm", "/api/admin/challenges/:id"
  ]) assert.ok(appSource.includes(route), `Missing API route reference: ${route}`);
  assert.match(appSource, /async function computeChallengeProgress/);
  assert.match(appSource, /async function refreshChallengeProgress/);
  assert.match(appSource, /applyDailyCaps/);
  assert.match(appSource, /Buffer\.byteLength\(password, 'utf8'\) > 72/);
});

test('quiz business rules are enforced server-side', () => {
  assert.match(appSource, /normalizeQuizQuestions/);
  assert.match(appSource, /single_choice.*multiple_choice.*true_false.*short_answer/);
  assert.match(appSource, /quizDeadline/);
  assert.match(appSource, /participantIds.*maxParticipants/);
  assert.match(appSource, /quiz already has registered participants or attempts.*locked to preserve result integrity/i);
  assert.match(appSource, /participant contact details are available to admins only from a published, finalized quiz leaderboard/i);
  assert.match(appSource, /Ranks are unique.*score descending.*time taken ascending/s);
  assert.match(appSource, /prizeReceived/);
  assert.match(appSource, /phoneNumber.*not verified/i);
});

test('portal literal DOM references exist in HTML', () => {
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  const refs = new Set([...frontend.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]));
  const missing = [...refs].filter(id => !ids.has(id));
  assert.deepEqual(missing, []);
  assert.match(html, /community-rules\.html/);
  assert.match(html, /privacy\.html/);
  assert.match(html, /id="view-quizzes"/);
  assert.match(html, /name="phoneNumber"[^>]*required/);
  assert.match(html, /id="quickLinksList"/);
  assert.match(html, /id="quizLeaderboardList"/);
  assert.match(html, /id="quizWarningCount"/);
  assert.match(frontend, /DEFAULT_QUICK_LINKS/);
  assert.match(frontend, /target="_blank" rel="noopener noreferrer"/);
});

test('extension social integration is optional and manifest grants backend hosts', () => {
  const parsed = JSON.parse(manifest);
  assert.equal(parsed.manifest_version, 3);
  assert.ok(parsed.host_permissions.some(x => x === 'https://*.onrender.com/*'));
  assert.match(frontend, /localStorage/);
  assert.match(frontend, /\/api\/auth\/register/);
});
