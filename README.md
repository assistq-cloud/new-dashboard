# ASSISTQ Growth Platform v8.1

ASSISTQ by SonQAI Technologies — lead capture, AI conversation intelligence, UTM attribution, lead scoring, SEO audit, Search Console, GA4 and weekly reporting.

## Run locally

1. Install Node.js LTS.
2. Copy `.env.example` to `.env`.
3. Set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `WEBHOOK_SECRET`.
4. For Google integrations, set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
5. Run `npm install`.
6. Run `npm start`.
7. Open `http://localhost:8787`.

Read `SETUP_FOR_CLIENT.md` for the complete setup process.

## Main modules

- Overview
- Client Setup
- Leads
- Conversations
- UTM Analytics
- SEO Audit
- Keywords
- Reports
- Integrations
- Clients
- Subscriptions
- Settings
- System Check

## Google connection

Each client can connect a Google account from Integrations. The connection is stored per client and powers:

- Search Console property discovery and query sync
- GA4 property discovery and analytics sync
- Gmail test email and weekly report delivery

The Google account is authorized with OAuth; ASSISTQ never asks for the client's Google password.

## Client subscriptions

Admins can create client workspaces and manage plan/status from **Subscriptions**. The server automatically evaluates subscription dates. When a subscription is expired, suspended or archived:

- client login is blocked;
- client dashboard access is blocked;
- the public chatbot client-config endpoint is blocked;
- the chatbot bridge rejects new conversations/leads;
- the Apps Script verifies the client against ASSISTQ before chat/lead submission;
- historical leads and conversations are retained.

Renewing/reactivating keeps the same `clientId` and historical data. Use **Archive** instead of deleting a client so reporting history is preserved.

## Production note

The included JSON store is suitable for a local prototype / controlled deployment. For a multi-client public SaaS, move persistent data and OAuth tokens to a managed database and encrypted secret storage before launch.
