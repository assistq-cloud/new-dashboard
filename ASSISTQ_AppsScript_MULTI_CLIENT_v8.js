/**
 * AssistQ / SonQAI Backend — v4 (Real Estate scoring + Funnel reporting)
 * -------------------------
 * NEW IN THIS VERSION:
 * 1. NUMERIC WEIGHTED LEAD SCORE (out of 100) — instead of just Hot/Warm/
 *    Cold from one field, this scores Budget, Requirement, Timeline,
 *    Location fit, and Intent separately and adds them up, e.g. 90/100.
 * 2. FUNNEL-STYLE WEEKLY REPORT — breaks down by traffic source showing
 *    Leads → Qualified → Hot counts, like a real acquisition report.
 *
 * Chat, FAQ, memory, error alerts, UTM capture all work exactly as before.
 */

// ============ CONFIG — edit this per client ============
const TEST_MODE = false;

const CONFIG = {
  dashboardUrl: "", // Optional fallback; set ASSISTQ_DASHBOARD_URL in Script Properties for production.
  clientEmail: "assistq1@gmail.com",
  clientWhatsApp: "918446242738",
  businessName: "ASSISTQ",
  sheetName: "Leads",

  // Real-estate-tailored question set. Add "options" for quick-reply
  // buttons in the widget — keep the widget's questions array in sync.
  questions: [
    { key: "name",   label: "What's your name?" },
    { key: "phone",  label: "What's the best phone number to reach you?" },
    { key: "purpose", label: "Are you looking to buy or rent?" },
    { key: "location", label: "Which location/area are you looking at?" },
    { key: "configuration", label: "What configuration are you looking for — 1BHK, 2BHK, 3BHK, or 4BHK?" },
    { key: "budget", label: "What's your budget?" },
    { key: "timeline", label: "When are you planning to move forward?" }
  ],

  faq: `
Q: What do you charge?
A: INR 4999 for setup and INR 5999 for Monthly Retainer and we have another one as a Smart Form with INR 1999 for setup and INR 2999

Q: How fast can you setup?
A: Within 48 hours

Q: Do you serve Area?
A: All over india as it is multiple business Friendly
`,

  // ---- WEIGHTED LEAD SCORING (out of 100) ----
  // Each field contributes points based on the answer given. Unmatched
  // answers get "default" points for that field. Total score sorts into
  // the bands below (Hot/Warm/Cold), same labels as before, now with a number.
  scoringRules: {
    fields: [
      {
        field: "budget", maxPoints: 25,
        map: {
          "Under ₹50L": 10, "₹50L-1Cr": 18, "₹1Cr-2Cr": 22, "₹2Cr+": 25
        },
        default: 15
      },
      {
        field: "configuration", maxPoints: 25,
        map: {
          "1BHK": 15, "2BHK": 20, "3BHK": 23, "4BHK": 25
        },
        default: 15
      },
      {
        field: "timeline", maxPoints: 20,
        map: {
          "Immediately": 20, "1-3 months": 15, "3-6 months": 10, "Just exploring": 5
        },
        default: 10
      },
      {
        field: "location", maxPoints: 20,
        // No fixed map — location fit is harder to auto-score without a
        // service-area list. Edit "serviceAreas" below to score matches
        // higher; anything else gets the default.
        serviceAreas: ["Navi Mumbai", "Mumbai", "Thane", "Pune"],
        matchPoints: 20,
        default: 12
      },
      {
        field: "purpose", maxPoints: 10,
        map: { "Buying": 10, "Renting": 6 },
        default: 5
      }
    ],
    bands: [
      { min: 80, label: "Hot🔥" },
      { min: 50, label: "Warm🌤️" },
      { min: 0,  label: "Cold❄️" }
    ]
  }
};
// =========================================================

function normaliseClientId_(id){return String(id||"demo-realty").toLowerCase().replace(/[^a-z0-9_-]/g,"-").slice(0,60)||"demo-realty";}

function dashboardUrl_(data){
  const prop=PropertiesService.getScriptProperties().getProperty("ASSISTQ_DASHBOARD_URL") || CONFIG.dashboardUrl || "";
  return String(prop).trim().replace(/\/$/,"");
}

function getClientConfig_(data){
  const clientId=normaliseClientId_(data&&data.clientId);
  const dashboard=dashboardUrl_(data);
  if(!dashboard) throw new Error("ASSISTQ_DASHBOARD_URL is not configured in Script Properties.");
  const url=dashboard+"/api/public/client-config?clientId="+encodeURIComponent(clientId);
  const response=UrlFetchApp.fetch(url,{method:"get",muteHttpExceptions:true,headers:{"Accept":"application/json"}});
  const code=response.getResponseCode();
  if(code<200 || code>=300) throw new Error("ASSISTQ client verification failed (HTTP "+code+").");
  const cfg=JSON.parse(response.getContentText());
  if(!cfg || cfg.clientId!==clientId) throw new Error("ASSISTQ client verification returned an invalid client.");
  const sub=cfg.subscription||{};
  return {clientId,active:sub.active!==false,verified:true,businessName:cfg.businessName||CONFIG.businessName,clientEmail:cfg.reportEmail||CONFIG.clientEmail,clientWhatsApp:cfg.clientWhatsApp||CONFIG.clientWhatsApp,assistant:cfg.assistant||null};
}

function assertClientActive_(data){
  const cfg=getClientConfig_(data);
  if(!cfg.active) throw new Error("ASSISTQ subscription is not active for this client.");
  return cfg;
}

function effectiveConfig_(data){
  const remote=assertClientActive_(data);
  const assistant=remote.assistant||{};
  const questions=(Array.isArray(assistant.questions)&&assistant.questions.length)
    ? assistant.questions.map(function(q){return {key:String(q.key||q.id||"").trim(),label:String(q.label||q.question||q.key||"").trim()};}).filter(function(q){return q.key&&q.label;})
    : CONFIG.questions;
  return {businessName:remote.businessName||CONFIG.businessName,questions:questions,faq:String(assistant.knowledge||CONFIG.faq||""),clientEmail:remote.clientEmail||CONFIG.clientEmail,clientWhatsApp:remote.clientWhatsApp||CONFIG.clientWhatsApp};
}

function doPost(e) {
  const timestamp = new Date();
  let data = {};
  try {
    data = JSON.parse(e.postData.contents);

    if (data.action === "chat") {
      const clientCfg = effectiveConfig_(data);
      const result = handleChat(data, clientCfg);
      return jsonOut(result);
    }

    if (data.action === "submit") {
      const clientCfg = assertClientActive_(data);
      const scored = scoreLead(data.fields || {});
      logToSheet(timestamp, data.fields || {}, data.utm || {}, scored, data.clientId || clientCfg.clientId);
      emailClient(data.fields || {}, scored, clientCfg.businessName, clientCfg.clientEmail, clientCfg.clientWhatsApp);
      return jsonOut({ status: "success", clientId: clientCfg.clientId });
    }

    return jsonOut({ status: "error", message: "Unknown action: " + data.action });

  } catch (err) {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      let dbg = ss.getSheetByName("Errors");
      if (!dbg) dbg = ss.insertSheet("Errors");
      dbg.appendRow([timestamp, err.toString()]);
      MailApp.sendEmail(
        "assistq1@gmail.com",
        `⚠️ Bot error — ${data.businessName || CONFIG.businessName}`,
        `An error occurred:\n\n${err.toString()}\n\nSheet: ${ss.getUrl()}\nTime: ${timestamp}`
      );
    } catch (e2) { /* ignore */ }

    return jsonOut({ status: "error", message: err.toString() });
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleChat(data, clientCfg) {
  const knownFields = data.knownFields || {};

  if (!TEST_MODE && data.leadId) trackSession(data.leadId);

  if (TEST_MODE) {
    const nextQ = clientCfg.questions.find(q => !knownFields[q.key]);
    if (nextQ) {
      knownFields[nextQ.key] = "TEST-" + nextQ.key;
      const remaining = clientCfg.questions.find(q => !knownFields[q.key]);
      const reply = remaining
        ? `[TEST MODE] Got it. Next: ${remaining.label}`
        : `[TEST MODE] All fields collected — submitting now.`;
      const complete = clientCfg.questions.every(q => knownFields[q.key]);
      return { reply: reply, fields: knownFields, complete: complete };
    }
    return { reply: "[TEST MODE] Already complete.", fields: knownFields, complete: true };
  }

  const apiKey = PropertiesService.getScriptProperties().getProperty("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return { reply: "Setup needed: add ANTHROPIC_API_KEY in Script Properties.", fields: knownFields, complete: false };
  }

  const questionList = clientCfg.questions
    .map(q => `- ${q.key}: "${q.label}"${knownFields[q.key] ? ` (ALREADY ANSWERED: "${knownFields[q.key]}" — do not ask again)` : ""}`)
    .join("\n");

  const systemPrompt = `You are a friendly assistant chatting with a prospective customer on behalf of ${clientCfg.businessName}.

Ask the following questions ONE AT A TIME, naturally, skipping any already answered:
${questionList}

If the prospect asks something else, answer using this info, then continue with the next unanswered question:
${clientCfg.faq}

If you don't know something, say the team will follow up on that point — never invent an answer.

Respond with ONLY valid JSON, no other text before or after it, in exactly this shape — this is critical, never write a plain sentence outside the JSON:
{"reply": "your message", "fields": {"key": "value", ...only fields learned/confirmed this turn...}}

Example of a correct response:
{"reply": "Great, thanks! What's the best phone number to reach you?", "fields": {"name": "Anushka"}}`;

  const payload = {
    model: "claude-sonnet-5",
    max_tokens: 1024,
    system: systemPrompt,
    messages: data.messages
  };

  const response = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "post",
    contentType: "application/json",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const raw = response.getContentText();
  const result = JSON.parse(raw);

  if (result.error) {
    return { reply: "AI error: " + result.error.message, fields: knownFields, complete: false };
  }

  let parsed;
  try {
    const textBlock = result.content.find(b => b.type === "text");
    if (!textBlock) throw new Error("No text block in response");
    const cleanText = textBlock.text.replace(/```json|```/g, "").trim();
    parsed = JSON.parse(cleanText);
  } catch (e) {
    const textBlock = result.content.find(b => b.type === "text");
    parsed = { reply: textBlock ? textBlock.text.trim() : "Got it, thanks!", fields: {} };
  }

  const mergedFields = Object.assign({}, knownFields);
  const pendingQ = clientCfg.questions.find(q => !knownFields[q.key]);
  const lastUserMsg = [...data.messages].reverse().find(m => m.role === "user");
  const looksLikeQuestion = lastUserMsg && isLikelyQuestion(lastUserMsg.content);

  if (pendingQ && lastUserMsg && !looksLikeQuestion) {
    mergedFields[pendingQ.key] = lastUserMsg.content;
  }

  const complete = CONFIG.questions.every(q => mergedFields[q.key]);

  return { reply: parsed.reply, fields: mergedFields, complete: complete };
}

function toLabel(key) {
  return key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function isLikelyQuestion(text) {
  const t = text.trim();
  if (t.endsWith("?")) return true;
  return /^(what|how|when|where|why|who|which|can|could|do|does|did|is|are|will|would|should|may)\b/i.test(t);
}

/**
 * Logs each unique conversation once (by leadId), so the weekly report can
 * show real "conversations started" numbers, not just completed leads.
 */
function trackSession(leadId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Sessions");
  if (!sheet) {
    sheet = ss.insertSheet("Sessions");
    sheet.appendRow(["Lead ID", "First Seen"]);
  }
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
    if (ids.includes(leadId)) return; // already tracked
  }
  sheet.appendRow([leadId, new Date()]);
}

/**
 * Weighted numeric scoring, e.g. Budget 22/25 + Requirement 23/25 +
 * Timeline 20/20 + Location 17/20 + Intent 8/10 = 90/100.
 * Returns { score, band } — band is Hot/Warm/Cold based on CONFIG.scoringRules.bands.
 */
function scoreLead(fields) {
  const rules = CONFIG.scoringRules;
  if (!rules) return { score: null, band: "" };

  let total = 0;
  rules.fields.forEach(f => {
    const value = fields[f.field];

    if (f.serviceAreas) {
      // Location-style field: score higher if it matches a known service area
      const matched = value && f.serviceAreas.some(a => value.toLowerCase().includes(a.toLowerCase()));
      total += matched ? f.matchPoints : f.default;
      return;
    }

    if (value && f.map[value] !== undefined) {
      total += f.map[value];
    } else {
      total += f.default;
    }
  });

  total = Math.min(total, 100);

  const band = (rules.bands.find(b => total >= b.min) || { label: "" }).label;

  return { score: total, band: band };
}

function logToSheet(timestamp, data, utm, scored, clientId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.sheetName);
  const fieldKeys = Object.keys(data);
  const utmCols = ["UTM Source", "UTM Medium", "UTM Campaign"];
  const fixedCols = ["Timestamp", "Client ID", "Score", "Band", ...utmCols];

  if (!sheet || sheet.getLastColumn() === 0) {
    if (!sheet) sheet = ss.insertSheet(CONFIG.sheetName);
    sheet.appendRow([...fixedCols, ...fieldKeys.map(toLabel)]);
  } else {
    const existingHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    fieldKeys.forEach(key => {
      if (!existingHeaders.includes(toLabel(key))) {
        sheet.getRange(1, sheet.getLastColumn() + 1).setValue(toLabel(key));
      }
    });
    fixedCols.forEach(col => {
      if (!existingHeaders.includes(col)) {
        sheet.getRange(1, sheet.getLastColumn() + 1).setValue(col);
      }
    });
  }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = headers.map(h => {
    if (h === "Timestamp") return timestamp;
    if (h === "Client ID") return clientId || "";
    if (h === "Score") return scored.score != null ? scored.score : "";
    if (h === "Band") return scored.band || "";
    if (h === "UTM Source") return utm.source || "";
    if (h === "UTM Medium") return utm.medium || "";
    if (h === "UTM Campaign") return utm.campaign || "";
    const key = Object.keys(data).find(k => toLabel(k) === h);
    return key ? data[key] : "";
  });
  sheet.appendRow(row);
}

function emailClient(data, scored, businessName, clientEmail, clientWhatsApp) {
  const nameField = data.name || Object.values(data)[0] || "New lead";
  const bandEmoji = scored.band === "Hot" ? " 🔥" : scored.band === "Warm" ? " 🌤️" : scored.band === "Cold" ? " ❄️" : "";
  const subject = `New Lead for ${businessName}: ${nameField} — ${scored.score}/100${bandEmoji} ${scored.band}`;

  const lines = Object.entries(data)
    .map(([key, value]) => `${toLabel(key)}: ${value}`)
    .join("\n");

  const waLink = `https://wa.me/${clientWhatsApp || CONFIG.clientWhatsApp}?text=${encodeURIComponent(
    `New lead from your bot:\n${lines}`
  )}`;

  const body = `You've got a new lead from your AssistQ chatbot.

Lead Score: ${scored.score}/100 (${scored.band})
${lines}

Tap to notify yourself on WhatsApp: ${waLink}`;

  MailApp.sendEmail(clientEmail || CONFIG.clientEmail, subject, body);
}

/**
 * ---- WEEKLY FUNNEL REPORT ----
 * ONE-TIME SETUP: run createWeeklyTrigger() once from the function
 * dropdown in the Apps Script editor. After that it runs every Sunday.
 *
 * Shows, per traffic source: Leads (total) → Qualified (score 50+) → Hot (80+)
 */
function createWeeklyTrigger() {
  ScriptApp.newTrigger('sendWeeklyReport')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(20)
    .create();
}

function sendWeeklyReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.sheetName);
  if (!sheet || sheet.getLastRow() < 2) return;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();

  const tsCol = headers.indexOf("Timestamp");
  const scoreCol = headers.indexOf("Score");
  const sourceCol = headers.indexOf("UTM Source");

  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const weekRows = rows.filter(r => r[tsCol] && new Date(r[tsCol]) >= oneWeekAgo);

  // Conversations started this week, from the Sessions tracker
  const sessionsSheet = ss.getSheetByName("Sessions");
  let conversationsCount = 0;
  if (sessionsSheet && sessionsSheet.getLastRow() > 1) {
    const sessionRows = sessionsSheet.getRange(2, 1, sessionsSheet.getLastRow() - 1, 2).getValues();
    conversationsCount = sessionRows.filter(r => r[1] && new Date(r[1]) >= oneWeekAgo).length;
  }

  const totalLeads = weekRows.length;
  const totalQualified = weekRows.filter(r => (Number(r[scoreCol]) || 0) >= 50).length;
  const totalHot = weekRows.filter(r => (Number(r[scoreCol]) || 0) >= 80).length;

  // Per-source breakdown
  const bySource = {};
  weekRows.forEach(r => {
    const src = r[sourceCol] || "Direct/Unknown";
    const score = Number(r[scoreCol]) || 0;
    if (!bySource[src]) bySource[src] = { leads: 0, qualified: 0, hot: 0 };
    bySource[src].leads++;
    if (score >= 50) bySource[src].qualified++;
    if (score >= 80) bySource[src].hot++;
  });

  // Top source = highest lead volume this week
  let topSource = null;
  Object.entries(bySource).forEach(([src, s]) => {
    if (!topSource || s.leads > bySource[topSource].leads) topSource = src;
  });
  const topSourceRate = topSource ? Math.round((bySource[topSource].qualified / bySource[topSource].leads) * 100) : 0;

  const tableRows = Object.entries(bySource)
    .map(([src, s]) => `  ${src.padEnd(20)} Leads: ${s.leads}   Qualified: ${s.qualified}   Hot: ${s.hot}`)
    .join("\n");

  const insight = generateWeeklyInsight(bySource, totalLeads, totalQualified, totalHot);

  const body = `📊 ${CONFIG.businessName} Weekly Lead Intelligence

PERFORMANCE
${conversationsCount} conversations started
${totalLeads} leads captured
${totalQualified} qualified
${totalHot} HOT leads

TOP SOURCE
🥇 ${topSource || "N/A"} — ${topSourceRate}% qualification rate

BY SOURCE (Leads → Qualified → Hot)
${tableRows || "  (none)"}

${insight ? `AI INSIGHT\n${insight}\n` : ""}
Full details in your Sheet: ${ss.getUrl()}`;

  MailApp.sendEmail(CONFIG.clientEmail, `📊 Weekly Lead Intelligence — ${CONFIG.businessName}`, body);
}

/**
 * One short AI call per week (pennies) that turns the raw numbers into a
 * plain-English insight + recommendation, the way a real analyst would.
 * If it fails for any reason, the report still sends without this section.
 */
function generateWeeklyInsight(bySource, totalLeads, totalQualified, totalHot) {
  try {
    const apiKey = PropertiesService.getScriptProperties().getProperty("ANTHROPIC_API_KEY");
    if (!apiKey) return "";

    const sourceSummary = Object.entries(bySource)
      .map(([src, s]) => `${src}: ${s.leads} leads, ${s.qualified} qualified, ${s.hot} hot`)
      .join("; ");

    const prompt = `You are a marketing analyst. Given this week's lead data, write exactly two short lines:
Line 1: one sentence of genuine insight comparing sources (not just restating numbers).
Line 2: one specific, actionable recommendation.
No preamble, no headers, just the two lines.

Data: ${sourceSummary}. Totals: ${totalLeads} leads, ${totalQualified} qualified, ${totalHot} hot.`;

    const response = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
      method: "post",
      contentType: "application/json",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      payload: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }]
      }),
      muteHttpExceptions: true
    });

    const result = JSON.parse(response.getContentText());
    const textBlock = result.content && result.content.find(b => b.type === "text");
    return textBlock ? textBlock.text.trim() : "";
  } catch (e) {
    return "";
  }
}
