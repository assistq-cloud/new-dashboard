# ASSISTQ v7 — Easy Client Setup

## What the client needs to provide

1. Website URL
2. A Google account that has access to the client's Google Search Console property and GA4 property
3. The email address that should receive weekly ASSISTQ reports
4. WhatsApp country code (India = 91)
5. Business information, FAQs, products/services, prices and lead-qualification rules
6. A list of target keywords (optional)

**The client should never give ASSISTQ their Google password.** They click **Connect Google** and authorize ASSISTQ through Google's consent screen.

## Part A — One-time ASSISTQ owner setup

### 1. Install Node.js LTS

Install Node.js LTS on the computer/server that will run ASSISTQ.

### 2. Create the environment file

Copy:

`.env.example` → `.env`

Set at least:

```text
PORT=8787
APP_BASE_URL=http://localhost:8787
SESSION_SECRET=use-a-long-random-secret
ADMIN_EMAIL=your-admin-email
ADMIN_PASSWORD=your-strong-admin-password
WEBHOOK_SECRET=your-long-webhook-secret
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
```

For production, `APP_BASE_URL` must be the HTTPS address of your deployed ASSISTQ app.

### 3. Install and run

```bash
npm install
npm start
```

Open:

`http://localhost:8787`

## Part B — Google Cloud setup (one time for ASSISTQ)

1. Open Google Cloud Console.
2. Create a project called `ASSISTQ Platform`.
3. Enable these APIs:
   - Google Search Console API
   - Google Analytics Admin API
   - Google Analytics Data API
   - Gmail API
4. Configure the Google Auth Platform / OAuth consent screen.
5. During development, add your own Google account as a test user if Google shows the app as testing.
6. Create an OAuth 2.0 Client ID.
7. Choose **Web application**.
8. Add this redirect URI for local testing:

```text
http://localhost:8787/auth/google/callback
```

9. Copy the Client ID and Client Secret into `.env`.
10. Restart ASSISTQ.

For production, add your real HTTPS callback URI as well, for example:

```text
https://app.yourdomain.com/auth/google/callback
```

## Part C — Create a client inside ASSISTQ

1. Login as Admin.
2. Open **Clients**.
3. Click **Add client**.
4. Enter:
   - Business name
   - Website
   - Report email
5. ASSISTQ generates an access code.
6. Select that client from the client selector.
7. Open **Client Setup**.
8. Enter the client's:
   - Business information
   - Assistant name
   - Greeting
   - Tone
   - Business knowledge / FAQs
   - Custom lead fields
9. Save.

## Part D — Connect the client's Google account

1. Select the client.
2. Open **Integrations**.
3. Click **Connect Google**.
4. The client signs into their Google account.
5. Google shows the permissions requested by ASSISTQ.
6. The client approves.
7. Return to ASSISTQ.
8. The Google account should show **Connected**.

### Search Console

1. In Integrations, click **Choose property & sync**.
2. Select the client's Search Console property.
3. Sync it.

The client must have appropriate access to the Search Console property.

### GA4

1. Click **Choose property & sync** under Google Analytics 4.
2. Select the client's GA4 property.
3. Sync it.

### Gmail reports

1. Make sure the report email is set in Client Setup / Settings.
2. In Integrations, click **Send test email**.
3. Confirm the email arrives.
4. Turn on **Automatic weekly report** in Settings.

The connected Google account is used to send the report through Gmail. SMTP is an optional fallback.

## Part E — Connect the chatbot

The v7 chatbot supports URL parameters so you can reuse one chatbot file for different clients.

Local example:

```text
ASSISTQ_Chatbot_CLIENT_READY_v7.html?clientId=demo-realty&dashboardUrl=http%3A%2F%2Flocalhost%3A8787
```

For a deployed app:

```text
ASSISTQ_Chatbot_CLIENT_READY_v7.html?clientId=abc-realty&dashboardUrl=https%3A%2F%2Fapp.yourdomain.com
```

The chatbot continues using the existing Google Apps Script AI webhook and also sends conversation/lead events to ASSISTQ.

## Part F — Test the client

Create one fake/test lead and verify:

- Name appears
- Phone appears
- Email appears
- Budget appears
- Requirement appears
- Conversation appears
- Score is calculated out of 100
- HOT/WARM/COLD is correct
- UTM source appears
- UTM medium appears
- UTM campaign appears
- WhatsApp button works
- Google Search Console data appears
- GA4 data appears
- Test report email arrives
- SEO audit completes

## Part G — SEO setup

1. Add the client's website in Settings.
2. Open **SEO Audit**.
3. Run the audit.
4. Review critical issues and warnings.
5. Add target keywords under **Keywords**.
6. Sync them with Search Console after GSC is connected.

Search Console average position is not the same thing as an independent live SERP rank tracker.

## Part H — Give the client access

The client logs in using:

- Their report/login email
- Their generated ASSISTQ access code

Then they only see their own workspace.

## Production checklist

Before public deployment:

- Use HTTPS
- Replace demo admin password
- Set a long random SESSION_SECRET
- Set a long random WEBHOOK_SECRET
- Use a production database instead of the local JSON store
- Keep `.env` out of Git/public files
- Configure Google OAuth production redirect URI
- Complete Google's OAuth verification requirements if the app will be used by external users beyond your testing users
- Test client isolation with two separate clients
- Configure backups

## Important security rule

Never put Google Client Secret, SESSION_SECRET, ADMIN_PASSWORD, SMTP password, or WEBHOOK_SECRET into the chatbot HTML.

## v8 client onboarding

1. Create the client in **Clients**.
2. Set the client's plan and subscription end date.
3. Configure Business, Client WhatsApp, report email and AI assistant in **Client Setup**.
4. Connect the client's Google account. That Google account must have access to the client's Search Console property and GA4 property.
5. In Integrations, choose the exact Search Console property and GA4 property.
6. Give the client their generated login email + access code.
7. Generate the client chatbot URL using the clientId and your deployed Growth Platform URL.
8. Test a chatbot conversation, lead submission and UTM link.
9. When the subscription expires, the client is automatically treated as expired. Their historical data remains stored.
10. Use Renew/Reactivate after payment.

### Google account troubleshooting

If Google OAuth succeeds but Search Console or GA4 shows no properties, the connected Google account does not have access to those properties. Grant that Google account access in the client's Search Console and GA4 property, then reconnect/refresh the Google integration.
