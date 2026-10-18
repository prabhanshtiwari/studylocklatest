import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanText, normaliseUsername, normaliseEmail, parseYoutubeResource, computePoints, clampEventSeconds, MAX_DAILY_STUDY_SECONDS, applyDailyCaps } from '../src/domain.js';

test('normalizers trim and lowercase identities', () => {
  assert.equal(normaliseUsername('  Study_User '), 'study_user');
  assert.equal(normaliseEmail(' TEST@example.com '), 'test@example.com');
  assert.equal(cleanText(' hello\u0000 world ', 20), 'hello world');
});
test('only valid HTTPS YouTube video and playlist resources are accepted', () => {
  assert.deepEqual(parseYoutubeResource('https://www.youtube.com/watch?v=abcDEF_1234'), { type: 'video', resourceId: 'abcDEF_1234', videoId: 'abcDEF_1234' });
  assert.equal(parseYoutubeResource('https://www.youtube.com/watch?v=abcDEF_1234&list=PL1234567890').type, 'playlist');
  assert.equal(parseYoutubeResource('https://youtu.be/abcDEF_1234').videoId, 'abcDEF_1234');
  assert.equal(parseYoutubeResource('https://example.com/watch?v=abcDEF_1234'), null);
  assert.equal(parseYoutubeResource('http://youtube.com/watch?v=abcDEF_1234'), null);
  assert.equal(parseYoutubeResource('https://www.youtube.com/watch?v=bad'), null);
});
test('study event time, points and daily cap are bounded', () => {
  assert.equal(clampEventSeconds(500), 120);
  assert.equal(clampEventSeconds(-10), 0);
  assert.equal(computePoints({ qualifyingSeconds: 600, completedVideos: 2, activeDays: 3 }), 10 + 40 + 15);
  assert.equal(computePoints({ qualifyingSeconds: 10 * 3600 }), 600);
  assert.equal(computePoints({ qualifyingSeconds: MAX_DAILY_STUDY_SECONDS * 36501 }), (MAX_DAILY_STUDY_SECONDS * 36500) / 60);
  assert.ok(computePoints({ qualifyingSeconds: -100, completedVideos: -2, activeDays: -1 }) === 0);
});

test('daily anti-inflation caps are applied chronologically and per calendar day', () => {
  const events = [
    { eventAt: new Date('2026-01-01T23:59:00Z'), qualifyingSeconds: 120, completed: true },
    { eventAt: new Date('2026-01-01T00:00:00Z'), qualifyingSeconds: 120, completed: true },
    { eventAt: new Date('2026-01-02T00:00:00Z'), qualifyingSeconds: 120, completed: true }
  ];
  const result = applyDailyCaps(events);
  assert.equal(result.length, 3);
  assert.deepEqual(result.map(e => e.day), ['2026-01-01', '2026-01-01', '2026-01-02']);
  assert.equal(result.reduce((n, e) => n + e.acceptedSeconds, 0), 360);
  assert.equal(result.filter(e => e.acceptedCompletion).length, 3);
});

test('daily anti-inflation helper bounds excessive daily watch time and lesson completions', () => {
  const day = '2026-02-01';
  const events = Array.from({ length: 250 }, (_, i) => ({ eventAt: new Date(`${day}T${String(Math.floor(i / 30)).padStart(2,'0')}:${String(i % 60).padStart(2,'0')}:00Z`), qualifyingSeconds: 120, completed: true }));
  const result = applyDailyCaps(events);
  assert.equal(result.reduce((n, e) => n + e.acceptedSeconds, 0), MAX_DAILY_STUDY_SECONDS);
  assert.equal(result.filter(e => e.acceptedCompletion).length, 20);
});
