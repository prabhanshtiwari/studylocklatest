# Deploy Study Lock Social to Render + MongoDB Atlas

This guide deploys the API and social community portal. The Chrome extension remains an unpacked extension until you package/publish it through the Chrome Web Store.

> **Free-tier warning:** Render explicitly positions Free web services for hobby/testing and says not to use them for production applications. Free services spin down after 15 minutes idle; the first request after sleep can take about a minute. Atlas Free clusters have 0.5 GB storage and throughput limits. This setup is suitable for an early-access/beta launch, not guaranteed always-on production service. See the official docs linked at the end.

## 1. Prepare the repository

1. Extract the project ZIP to a permanent folder.
2. Create a GitHub repository (private is fine) and push the entire project directory. Ensure `.env` files and secrets are not committed; `.gitignore` blocks them.
3. Before a public launch, replace the placeholder text in `server/public/privacy.html` with the operator/controller identity and support email. Arrange someone to respond to reports and abuse complaints.

Recommended local checks, from the project root:

```bash
node --version     # use Node 20 LTS or newer; Node 22 LTS recommended
node --check background.js
node --check content.js
cd server
npm install
npm run check
npm test
```

After `npm install`, commit the generated `server/package-lock.json` for reproducible deployments. It is not pre-generated in this delivery because the package registry was unreachable in the build environment.

## 2. Create a free MongoDB Atlas database

1. Sign in to MongoDB Atlas and create a project.
2. Create a **Free** cluster in a region reasonably close to your Render region.
3. Under Database Access, create a dedicated database user. Use a unique, strong password and grant only the privileges required for the `studylock` database where Atlas permits it.
4. Under Network Access, allow connections from Render. Free Render services do not have a dedicated static outbound IP by default, so a common beta setup allows `0.0.0.0/0`; if you do this, protect the database with a strong database-user password, TLS, and least privilege. Do not reuse this password anywhere else. Use static outbound IPs/network isolation on a suitable paid plan if you need tighter network allowlisting.
5. Copy the application's **Drivers** connection string. Replace the placeholders with your database username/password and set the database name to `studylock`. URL-encode special characters in the username/password. It will resemble:

```text
mongodb+srv://DB_USER:URL_ENCODED_PASSWORD@cluster-host/studylock?retryWrites=true&w=majority
```

Do not put this connection string in client-side extension code, GitHub, or public issue reports.

## 3. Configure email delivery

Production account registration requires email verification, so set up an HTTPS email API provider. The server defaults to a Resend-compatible endpoint (`https://api.resend.com/emails`).

1. Create an account with your chosen email API provider.
2. Verify a sender domain/address per that provider's instructions.
3. Create an API key with the minimum sending scope available.
4. Keep the API key private. Never put it in the Chrome extension or any browser JavaScript.

`EMAIL_FROM` must be the exact verified sender format accepted by your provider, for example `Study Lock <no-reply@your-domain.example>` after you control and verify that domain. A placeholder sender won't work.

## 4. Deploy the Render service

1. In Render, choose **New → Blueprint** and connect the repository containing `render.yaml`.
2. Render should detect the `study-lock-social` service. Review the Blueprint and create it.
3. Fill the requested secrets/environment variables:

| Variable | Value |
|---|---|
| `MONGODB_URI` | The Atlas connection string from step 2 |
| `EMAIL_API_KEY` | Your email API key |
| `EMAIL_FROM` | Your provider's verified sender |
| `ADMIN_EMAILS` | The moderator/owner email, lower-case; set it before creating that account |
| `JWT_SECRET` | Let Render generate a secret; keep it at least 32 characters |
| `PUBLIC_APP_URL` | Optional. The code automatically uses Render's `RENDER_EXTERNAL_URL`; set this only if you need a canonical custom domain |
| `CORS_ORIGINS` | Optional comma-separated exact extra browser origins, no trailing slash |

4. Deploy and inspect logs. A successful startup should log `Connected to MongoDB.` and `Study Lock Social listening on ...`.
5. Open `https://YOUR-SERVICE.onrender.com/health`. Confirm it returns HTTP 200 and JSON with `"ok":true` and `"database":"connected"`. If it does not, do not invite users yet; fix the Atlas URI/network access or Render environment variables.
6. Open `/api/docs` to view the API route summary, then `/` for the community portal.

### Admin account

Set `ADMIN_EMAILS` before the first account registration using that email. The account is granted moderator role at registration, but it still needs email verification in production. Keep `ADMIN_EMAILS` tightly controlled; anyone who can set a Render environment variable with an arbitrary email can grant themselves moderator privileges.

### Custom domains

If you later add a custom domain, set `PUBLIC_APP_URL` to its canonical HTTPS origin, and add that exact origin to `CORS_ORIGINS` if the portal is hosted separately. Update the extension's configured API base URL accordingly.

## 5. Connect the Chrome extension

1. Open `chrome://extensions`, enable Developer mode, and load the project folder unpacked (the folder containing `manifest.json`).
2. Open the Study Lock new-tab dashboard. Find the optional **Study Lock Community / Social** section.
3. Paste your full Render service URL, e.g. `https://your-service.onrender.com` (no API path), and create an account. The API URL must be HTTPS for non-local deployments.
4. Check the account email and follow the verification link.
5. Sign in to the community portal, then sign in/connect through the extension if needed. Opt into the leaderboard explicitly in your profile privacy settings.
6. Complete a short public YouTube video and use **Sync saved sessions**. Then verify `/api/leaderboard` and the portal show the qualifying activity. The extension only uploads study-event summaries after you choose to connect; local session data remains in the extension unless you connect/sync it.

**Note:** the extension can keep an API token in Chrome local storage for the connected account. Disconnect to remove it from the extension. Use a strong unique password. Don't share the extension's Chrome profile with other people.

## 6. Test the live deployment before sharing widely

Use two test accounts and private/incognito windows only for manual comparison (the extension new-tab replacement may not work in Incognito unless explicitly enabled).

- Register account A and B; verify both emails and log in.
- Confirm new accounts are **not** on the leaderboard until they opt in.
- From A, search B and send a request; from B, accept it.
- Send a message; confirm non-friends cannot access that conversation. Block one account and verify the conversation stops working.
- Join a public challenge, sync qualifying study events, and confirm progress is calculated by the server.
- Report a user/challenge and check that a moderator account can see and update the report.
- Reset a password, log in with the new password, and verify that old authentication tokens are rejected after password reset if token-version invalidation is enabled in the deployed build.
- Test account deletion on a disposable account.
- Review Render logs and Atlas storage/op counter during the test.

## 7. Troubleshooting

- **Deploy fails before listening:** check logs for missing `MONGODB_URI`, `JWT_SECRET`, `EMAIL_API_KEY`, `EMAIL_FROM`, or a connection timeout.
- **Health is 503 / database disconnected:** check Atlas network access, username/password URL encoding, cluster state, and database user permissions.
- **Verification email isn't sent:** check `EMAIL_API_KEY`, `EMAIL_FROM`, sender verification, provider dashboard, and outbound API access. This app sends via HTTPS API rather than SMTP.
- **Extension CORS error:** use the exact Render HTTPS URL as API base; for a separately hosted frontend, add its exact origin to `CORS_ORIGINS`. The server explicitly permits Chrome extension origins when `ALLOW_EXTENSION_ORIGINS=true`; for a published extension, consider restricting that rule to a known ID in a hardened release.
- **Render first load is slow:** free web services sleep after 15 minutes without inbound traffic and wake on the next request. This is expected on the Free plan.
- **MongoDB quota reached:** review study event volume and old records; Atlas Free storage is only 0.5 GB. Plan retention, aggregation, monitoring, and a paid tier before scaling.

## Official references

- [Render Free services and limitations](https://render.com/docs/free)
- [Render Blueprints](https://render.com/docs/blueprint-spec)
- [Render environment variables](https://render.com/docs/configure-environment-variables)
- [MongoDB Atlas Free cluster limitations](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/)
- [MongoDB Atlas connection troubleshooting](https://www.mongodb.com/docs/atlas/troubleshoot-connection/)
- [Resend API documentation](https://resend.com/docs/api-reference/emails/send-email)

## Release gate

Do not advertise this as a hardened, large-scale production service until you have run the live checks above, generated and committed `server/package-lock.json`, configured rate-limit monitoring and backups/data retention, supplied a real privacy/support contact, and arranged active moderation. Free Render is appropriate for beta testing; it is not an always-on production SLA.
