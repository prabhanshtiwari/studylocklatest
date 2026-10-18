# Study Lock — Focus Extension + Social Learning Community

Study Lock is a Chrome Manifest V3 learning-focus extension plus an optional Node.js/Express/MongoDB social platform. Learners can focus on YouTube lessons, track local progress, and choose to connect their study summaries to the community leaderboard.

## Project layout

```text
study-lock/
├── manifest.json                 # Chrome extension
├── background.js                 # Session lifecycle and optional social sync
├── content.js                    # YouTube study overlay and click-to-start
├── newtab.html / .css / .js      # Study dashboard, planner, revision tools, social connection
├── popup.html / .css / .js       # Toolbar popup
├── tests/                        # Extension smoke tests
├── render.yaml                   # Render Blueprint for the API + portal
├── DEPLOY_RENDER.md              # Full Atlas + Render + email setup
└── server/
    ├── src/                      # Express API, Mongoose models, scoring and validation
    ├── public/                   # Social portal, privacy notice, community rules
    ├── tests/                    # Domain, API contract and static portal tests
    ├── package.json
    └── .env.example
```

## Chrome extension

**Current extension version: 2.4.0**

Features include native YouTube playback with a focus overlay; click-to-start on supported YouTube pages; video/playlist session selection; 1× playback and seeking enforcement attempts; unique watch coverage and qualifying playback estimates; end-and-close and resume; requested display wake lock; a custom new-tab dashboard; daily goals and history; study plans/reminders; notes/bookmarks; revision flashcards and self-assessment; accessibility preferences; JSON backup/restore; and optional Chrome Sync.

The extension keeps study data on the device by default. Connecting to the social backend is optional and requires the learner to enter the deployed API URL and sign in. Connected users can choose to sync study summaries to their community account. The leaderboard is opt-in by default.

## Social platform

The included Express/MongoDB backend and web portal provide:

- Account registration/login, email verification, password reset, token revocation on logout/password reset, and permanent account deletion.
- Profiles, privacy settings, leaderboard opt-in, daily anti-inflation caps, qualifying study stats, achievements, and weekly/monthly/all-time rankings.
- Learner discovery, friend requests, remove/block/unblock, friend-only messaging, and account/message/challenge reporting.
- Public/friend challenges with server-calculated progress for study minutes, lesson completions, and streak days.
- Moderator tools for reviewing reports, suspending accounts, deleting challenges, managing quizzes, and awarding quiz prizes.
- A responsive web portal with overview, leaderboards, discovery, friends, messages, challenges, profile/privacy settings, and data export.
- **Admin-built scheduled quizzes:** only admins can create/edit/publish quizzes. Add up to 100 custom questions per quiz, jump between question editors with the question navigator, set each question’s timer (5–600 seconds), choose question types, schedule registration/open/close times, set an overall attempt duration, and cap registrations.
- **Registered, one-question-at-a-time quiz flow:** learners register before the scheduled start, can begin only when the quiz opens, and see only the current question with a per-question countdown. The server controls question and overall deadlines, autosaves answers, skips timed-out questions, scores on the server, enforces one attempt per user, and caps registrations. The leaderboard stays hidden until the scheduled quiz end time.
- **Unique, deterministic ranks:** score descending, then shorter elapsed time, earlier final submission time, username A–Z, and stable user ID. The displayed rank is a unique row number (1, 2, 3…), so users never share a rank.
- **Admin user directory and winner management:** admins can search/paginate all accounts and open private profile detail covering friends, presence/activity estimates, verification/suspension status, quiz attempts, scores, ranks, copy warnings and awarded/confirmed prize history. Users can save a UPI ID on their own profile; it is schema-private and exposed only through admin-only endpoints. Admins can award/adjust prize records, but this records/marks prizes; it does **not** transfer money automatically or independently verify payment.
- **Quick Launch strip:** ten default site shortcuts (Google, YouTube, Gmail, Drive, Classroom, ChatGPT, GitHub, LeetCode, GeeksforGeeks, Khan Academy), each opens in a new tab. Users can add, edit, delete, and save up to ten HTTPS shortcuts per profile.
- **Profile contact number:** registration requires a phone number, but no SMS/phone verification is performed. Phone numbers are not shown publicly; quiz admin contact details are shown only from a published quiz’s finalized leaderboard.
- **Integrity and interaction safeguards:** common copy/cut/context-menu/keyboard-copy/print attempts in the quiz dialog trigger three warnings; the fourth recorded event disqualifies the attempt server-side. Browser restrictions are deterrence, not a guarantee against screenshots, external devices, developer tools, or all copying methods. Login and registration submissions are guarded against repeated clicks, message submissions disable while sending, incoming messages refresh every three seconds while a conversation is visible, and the portal displays a minimum two-second startup loader with bounded network requests. Quiz lists refresh periodically while open.

### Stack

- Node.js 20+ (Node 22 LTS recommended)
- Express 4, Helmet, CORS and `express-rate-limit`
- MongoDB Atlas Free (small early-access/beta workload)
- Mongoose 8
- JWT for API sessions, bcryptjs for password hashing
- HTTPS email API compatible with Resend for verification and reset messages

## Quick local API setup

```bash
cd server
cp .env.example .env
# Fill MONGODB_URI and a random 32+ character JWT_SECRET.
# Set NODE_ENV=development for local use and optionally configure the email API.
npm install
npm run check
npm test
npm start
```

Portal: `http://localhost:3000`  
Health: `http://localhost:3000/health`  
API summary: `http://localhost:3000/api/docs`

Without `MONGODB_URI`, local server boot can be used for static portal inspection only; database-backed API actions won't work. Production startup requires MongoDB and the email provider settings.

## Deployment

Follow **[DEPLOY_RENDER.md](DEPLOY_RENDER.md)** for step-by-step setup of MongoDB Atlas, email verification, Render Blueprint deployment, admin setup, connecting the extension, and the live verification checklist.

Important: Render Free services are useful for hobby projects, demos, and beta testing but Render's own documentation says not to use Free services for production applications. They sleep after 15 minutes idle and wake on the next request. Atlas Free is limited to 0.5 GB storage and limited throughput. Plan a paid/hardened deployment before expecting always-on availability or sustained public traffic. See [Render Free limits](https://render.com/docs/free) and [Atlas Free cluster limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/).

## Environment variables

See [`server/.env.example`](server/.env.example). At minimum, production needs:

- `MONGODB_URI`: private Atlas connection string, never client-side.
- `JWT_SECRET`: at least 32 random characters; generate in Render.
- `EMAIL_API_KEY` and `EMAIL_FROM`: API key and verified sender for email verification/password reset.
- `PUBLIC_APP_URL`: optional canonical HTTPS app origin; on Render the code falls back to `RENDER_EXTERNAL_URL` automatically.
- `ADMIN_EMAILS`: comma-separated email addresses that should receive moderator role at registration; set before those accounts are created.
- `ALLOW_EXTENSION_ORIGINS=true`: enable extension-origin requests. For a hardened published extension, restrict this rule to the known extension ID.
- `CORS_ORIGINS`: optional exact extra origins, comma-separated without trailing slashes.

## Tests and verification

Run these from the project root:

```bash
node --check background.js
node --check content.js
node --check newtab.js
node --check popup.js
node tests/background-smoke-test.cjs
cd server
npm run check
npm test
```

The included tests cover pure business rules, quiz scoring/ranks, timed question/registration/privacy contracts, study-event caps, portal DOM wiring, and mocked extension flows. The package has not been deployed to live Render/Atlas here, so real database, email delivery, payout, and production-browser flows remain unverified. The `server/package-lock.json` is aligned to API version `1.2.0`; run `npm ci` on a network-connected deployment environment before release. Treat this as a beta candidate, not a security-audited production service.

## Before opening to the public

1. Complete the support/controller contact in `server/public/privacy.html`.
2. Ensure the operator can respond to abuse reports and account deletion requests.
3. Deploy using the live steps, verify email flows, and run the two-account test checklist.
4. Run `npm ci` against the included `server/package-lock.json` from a network-connected development machine, and update the lock file whenever dependencies change.
5. Set data retention/backup policies and monitor Atlas storage. Study event records accumulate; the free cluster is not sized for large communities.
6. Review the privacy notice and community rules against your actual jurisdiction and data processing.
7. Do not describe watch time as proof of attention or comprehension; client-reported playback is only a signal and can be manipulated.

## Versioning

- Extension: `2.4.0`
- Social API/portal: `1.2.0` (question-by-question timed quizzes, pre-registration, admin user directory, private UPI field, and integrity warnings)
