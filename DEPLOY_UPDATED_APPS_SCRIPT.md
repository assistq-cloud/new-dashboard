# Deploy the updated Apps Script

Use `ASSISTQ_AppsScript_MULTI_CLIENT_v8.js` as the source for the Apps Script project that owns the existing `/exec` URL.

## 1. Back up the current script
Copy the current Apps Script source somewhere safe before replacing it.

## 2. Replace the source
Paste the contents of `ASSISTQ_AppsScript_MULTI_CLIENT_v8.js` into the Apps Script project.

Keep the same linked Google Spreadsheet.

## 3. Script Properties
In **Project Settings → Script Properties**, add:

- `ANTHROPIC_API_KEY` = your existing Anthropic API key
- `ASSISTQ_DASHBOARD_URL` = the public HTTPS URL of the deployed ASSISTQ Growth Platform

Do not put either secret into the chatbot HTML.

## 4. Deploy
Deploy as a web app:

- Execute as: **Me**
- Who has access: **Anyone**

Keep using the existing production `/exec` URL if you update the existing deployment.

## 5. Test
Open the chatbot URL with a real clientId and dashboardUrl. Start a conversation and submit a lead.

The Apps Script will:
- verify the clientId against the Growth Platform
- verify the subscription is active
- use the client's public assistant configuration
- log Client ID + UTM + lead data to the existing Sheet
- email the client's configured report email

If the subscription expires, the Apps Script rejects chat/submit requests for that client.

## Important
The Apps Script source does not automatically create client rows in Google Sheets. Client identity/subscription is controlled by the ASSISTQ Growth Platform. The Apps Script verifies that state through the `ASSISTQ_DASHBOARD_URL` public client-config endpoint.
