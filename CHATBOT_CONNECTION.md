# ASSISTQ Chatbot → Growth Platform connection

This version connects the supplied ASSISTQ chatbot to the local Growth Platform.

## What is connected

The chatbot continues using its existing Apps Script / webhook for the actual AI conversation and Google Sheets workflow. In parallel, it sends:

- user messages
- ASSISTQ assistant replies
- collected lead fields
- UTM source / medium / campaign
- final conversation

into the Growth Platform.

The dashboard stores the conversation and calculates a default 100-point score:

- Name: 10
- Phone: 15
- Email: 10
- Purpose: 10
- Location: 10
- Configuration: 10
- Budget: 20
- Timeline: 10
- 6+ messages: 5

Status: HOT at the configured threshold (default 80), WARM at 50–79, COLD below 50.

## Run

1. Stop the old server with `Ctrl+C`.
2. In the project folder run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:8787`.
5. Open `ASSISTQ_Chatbot_CLIENT_READY_v7.html` in Chrome (or host it on your
   client website). Use this file, not `ASSISTQ_Chatbot_Connected.html` — see
   `CHANGES_2026-08-18.md` for why.
6. Start a chat.
7. Open Dashboard → Conversations. The live conversation should appear.

## If the chatbot is hosted on a website

Pass the dashboard URL and client as query params instead of editing the file:

```text
ASSISTQ_Chatbot_CLIENT_READY_v7.html?clientId=demo-realty&dashboardUrl=https%3A%2F%2Fapp.yourdomain.com
```

See `SETUP_FOR_CLIENT.md` Part E for the full multi-client pattern.

## Important

The dashboard connection is additive: the original chatbot webhook is NOT removed. Your existing AI/Apps Script/Google Sheets flow can continue working while ASSISTQ also receives a copy for analytics and conversation intelligence.

For production deployment, add a server-side authentication token or same-origin proxy before exposing the bridge publicly.

## v8 multi-client + subscription enforcement

The chatbot continues to use the existing Google Apps Script webhook:

`https://script.google.com/macros/s/AKfycbyZddoCVD7M1bnjFzmaP_6c_JdLr6T02z-PB_KC82-G1UQDSrVr08JpTo-StU37iGBT/exec`

The chatbot now sends `clientId` on both chat and submit requests and loads non-secret client configuration from:

`/api/public/client-config?clientId=CLIENT_ID`

### Required Apps Script setting

In the Google Apps Script editor, open **Project Settings → Script Properties** and add:

- Property: `ASSISTQ_DASHBOARD_URL`
- Value: your deployed ASSISTQ Growth Platform HTTPS URL, for example `https://app.assistq.in`

Do not put a secret in the chatbot HTML.

### Client URL

Use the same chatbot file for every client. Give each client a unique URL:

`ASSISTQ_Chatbot_CLIENT_READY_v7.html?clientId=abc-realty&dashboardUrl=https%3A%2F%2Fapp.assistq.in`

When a subscription is expired/suspended, the dashboard public configuration reports the inactive state, the chatbot disables itself, the Growth Platform bridge rejects new conversations/leads, and the Apps Script rejects chat/submit requests after verifying the same client against the dashboard.

### Existing Apps Script

Use `ASSISTQ_AppsScript_MULTI_CLIENT_v8.js` as the replacement source for the Apps Script project. It keeps the existing lead scoring, UTM capture, Google Sheet logging and weekly reporting flow, but adds clientId and server-side subscription verification.
