# Study Lock 2.4.0 + Social API — Test Report

Date: 2026-10-17

## Changes verified in this revision

- Wired the quiz-leaderboard close control to hide the panel and return focus to the quiz list.
- Added immediate optimistic feedback for challenge joining, with rollback on API failure and background reconciliation of dashboard/challenge counts.
- Added quiz-start fullscreen gating, a blocking resume-fullscreen overlay, separate copy and fullscreen/focus warning counters, and server-side disqualification on the fourth violation in either category. The quiz remains locked if its question timer advances while fullscreen is absent, and answer autosave resumes when fullscreen is restored.
- Added in-memory GET response caching, in-flight GET deduplication, hidden-view prefetching, and freshness-aware navigation to reduce perceived tab delay without persisting private profile data across sessions.
- Cleared quiz/admin dialogs and private panel content on sign-out, and guarded selected asynchronous profile/leaderboard/admin responses against writing stale session data into the UI.

The browser Fullscreen API remains a best-effort client control, not a tamper-proof anti-cheat boundary: browser/OS behavior and scripted API calls can bypass client checks, and screenshots or external recording cannot be reliably blocked by a normal web page. Unsupported browsers are prevented from starting the quiz.

## Checks that passed in this environment

### JavaScript syntax and configuration

- `node --check background.js`
- `node --check content.js`
- `node --check newtab.js`
- `node --check popup.js`
- `node --check server/src/app.js`
- `node --check server/src/domain.js`
- `node --check server/src/quiz-domain.js`
- `node --check server/src/models.js`
- `node --check server/src/server.js`
- `node --check server/public/app.js`
- Parsed `manifest.json` and `server/package.json` as JSON.
- Verified project source and JSON manifests; `unzip -t` on the packaged release ZIP passed with no compressed-data errors.

### Automated Node tests

`cd server && node --test tests/*.test.js` passed **17/17 tests**:

- Identity normalization and control-character cleaning.
- Accepts only supported HTTPS YouTube video/playlist URLs.
- Bounds study event time, computed points, and daily anti-inflation caps.
- Applies daily limits chronologically across calendar days.
- Enforces maximum accepted daily playback seconds and lesson-completion count.
- Checks social API route contracts and critical safeguards.
- Checks quiz API route contracts, question types, scheduled registration, atomic participant caps, one-question payload privacy, per-question timing, atomic fourth-copy-violation disqualification, private UPI field behavior, admin-only profile/prize routes, portal click protection, and unique ranks.
- Checks social portal DOM IDs against JavaScript references and confirms quiz/phone/quick-link UI presence.
- Checks optional extension integration and API host permissions.
- Checks server-side scoring for single-choice, multiple-choice, true/false, and accepted short answers; multi-choice uses all-or-nothing scoring.
- Checks scheduled registration and atomic participant caps, one-question payload privacy, per-question time limits, fourth-violation disqualification, private UPI selection, and new portal interactions.
- Checks deterministic leaderboard ordering and unique sequential ranks when scores and timings tie.

### Extension mocked regression test

`node tests/background-smoke-test.cjs` passed for the mocked Chrome API flows:

- Dashboard state; plan reminders, rescheduling, launch, completion, and deletion.
- Flashcard create/review/delete; notes and bookmarks edit/delete.
- YouTube click-to-start without a forced reload of an already playing native page.
- Watch-range merge, duration clamping, qualifying time and break baseline.
- Timestamp jump, end-and-close, unfinished-session resume.
- Backup/restore and Chrome Sync chunk export.

## What has not been verified live

This environment could not reliably reach the npm registry (`EAI_AGAIN`/install timeout), and the managed Chromium environment blocks loading the unpacked extension and accessing URLs by browser policy. Therefore:

- `npm ci --ignore-scripts --no-audit --no-fund` could not complete because registry access failed with `EAI_AGAIN`. The project’s existing `server/package-lock.json` is included in the release ZIP (its root package version is aligned to `1.2.0`); no `node_modules` directory is included.
- The Express API was not launched with real dependencies and a real MongoDB Atlas database in this environment. MongoDB update-pipeline behavior, concurrent requests, and UI polling therefore still need staging integration tests.
- Registration/login/email verification, password reset, friend requests, messaging, challenges, leaderboard aggregation, moderation, browser CORS, and production Render health checks have **not** been integration-tested against live MongoDB/Render/email services.
- Native YouTube playback, playlist completion, tab enforcement, notifications, Chrome Sync across devices, wake lock, and fullscreen still need end-to-end testing in the target Chrome installation.

## Quiz implementation notes

- Quiz creation/edit/delete is admin-only. Once anyone registers or attempts a quiz, edits and deletion are locked to protect the scheduled test and preserve participant history; publishing visibility cannot be turned off after registration. Each quiz allows 1–100 questions with server validation, 1–100 points per question, and per-question time limits of 5–600 seconds.
- Registration must happen before the scheduled start; seat limits are enforced atomically when registering. A user can have only one attempt per quiz.
- Both per-question deadlines and the overall attempt/quiz deadline are enforced by the API. Only the current question is sent to a participant; answers are autosaved, timed-out questions are skipped, scores are calculated on the server, and an interval sweeps expired attempts while the service is awake. Requests also trigger a finalization sweep, so an idle/sleeping service finalizes on its next request after waking.
- Final results/leaderboard are unavailable before the fixed quiz end time. Rankings use unique sequential positions; correct answers are not sent to learners before results.
- Admins can view contact details and award prizes only through a completed, published quiz leaderboard. A cash prize is listed publicly only after the participant confirms receipt. The app does not automate transfers or independently verify receipt.
- The open conversation refreshes every three seconds while the Messages view is visible and the tab is in the foreground; this is short-interval polling, not a websocket push channel. Phone numbers are required at registration and profile edits but are not verified. They are not included in public user payloads. UPI is schema-private and exposed only to admin-authorized profile endpoints. Presence uses recent authenticated heartbeat as an estimate, not an authoritative live browser/session count.
- Quick links are per-user, capped at ten, reject non-HTTPS URLs and embedded URL credentials, and open in a separate tab.

## Release status

This is a deployable **beta candidate**, not a certified or fully verified production release. Before inviting real users, install dependencies from the included lock file on a network-connected machine, run the tests, deploy a staging service, and execute the two-account checklist in `DEPLOY_RENDER.md`. Configure an actual verified email sender, a real support/controller contact in `server/public/privacy.html`, backups/retention, and moderator coverage first.

Do not claim that client-reported playback proves attention or comprehension. Render Free is intended for hobby/testing rather than production use; Atlas Free has a 0.5 GB storage ceiling and other quotas. Review the current official plans before launch.
