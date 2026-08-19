import express from "express";
import session from "express-session";
import dotenv from "dotenv";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import nodemailer from "nodemailer";

dotenv.config();
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express();
app.set("trust proxy",1);
const PORT=Number(process.env.PORT||8787);
const DATA_DIR=path.join(__dirname,"data");
const DATA_FILE=path.join(DATA_DIR,"store.json");
fs.mkdirSync(DATA_DIR,{recursive:true});

const defaultStore={
  settings:{businessName:"Demo Realty Group",clientId:"demo-realty",website:"https://example-realty.in",reportEmail:"",clientWhatsApp:"",whatsappCountryCode:"91",reportEnabled:false,hotThreshold:80,warmThreshold:50,assistant:{name:"ASSISTQ Assistant",greeting:"Hi! 👋 What can I help you with today?",tone:"Professional, friendly and concise",knowledge:"",questions:[]},customLeadFields:[],scoring:{name:10,phone:15,email:10,purpose:10,location:10,configuration:10,budget:20,timeline:10,engagement:5}},
  clients:[{id:"demo-realty",name:"Demo Realty Group",website:"https://example-realty.in",reportEmail:"",accessCode:"ASSISTQ-DEMO",plan:"Demo",subscriptionStatus:"active",subscriptionStart:null,subscriptionEnd:null}],
  keywords:[
    {id:"kw1",clientId:"demo-realty",keyword:"2 bhk flats in kharghar",targetUrl:"/2-bhk-kharghar",priority:"High",intent:"Commercial"},
    {id:"kw2",clientId:"demo-realty",keyword:"flats for sale in kharghar",targetUrl:"/flats-sale-kharghar",priority:"High",intent:"Commercial"},
    {id:"kw3",clientId:"demo-realty",keyword:"real estate agents in navi mumbai",targetUrl:"/real-estate-agents",priority:"Medium",intent:"Commercial"}
  ],
  leads:[],conversations:{},utm:{},clientProfiles:{"demo-realty":{assistant:{name:"ASSISTQ Assistant",greeting:"Hi! 👋 What can I help you with today?",tone:"Professional, friendly and concise",knowledge:"",questions:[]},customLeadFields:[]}},
  gsc:{connected:false,property:null,rows:[],syncedAt:null,byClient:{}},
  ga4:{connected:false,propertyId:null,metrics:{},rows:[],syncedAt:null,byClient:{}},
  google:{byClient:{}},
  seoAudits:{},reportHistory:[]
};
if(!fs.existsSync(DATA_FILE))fs.writeFileSync(DATA_FILE,JSON.stringify(defaultStore,null,2));
function readStore(){return JSON.parse(fs.readFileSync(DATA_FILE,"utf8"));}
function writeStore(s){fs.writeFileSync(DATA_FILE,JSON.stringify(s,null,2));}
function ensureStoreShape(s){
  s.settings=s.settings||defaultStore.settings; s.clients=s.clients||defaultStore.clients; s.clientProfiles=s.clientProfiles||{}; s.keywords=s.keywords||[]; s.leads=s.leads||[]; s.conversations=s.conversations||{}; s.utm=s.utm||{}; s.gsc=s.gsc||defaultStore.gsc; s.gsc.byClient=s.gsc.byClient||{}; s.ga4=s.ga4||defaultStore.ga4; s.ga4.byClient=s.ga4.byClient||{}; s.google=s.google||defaultStore.google; s.google.byClient=s.google.byClient||{}; s.seoAudits=s.seoAudits||{}; s.reportHistory=s.reportHistory||[];
  s.clients=s.clients.map(c=>({...c,accessCode:c.accessCode||crypto.randomBytes(4).toString("hex").toUpperCase(),plan:c.plan||"Starter",subscriptionStatus:c.subscriptionStatus||"active",subscriptionStart:c.subscriptionStart||null,subscriptionEnd:c.subscriptionEnd||null}));
  return s;
}

app.use(express.json({limit:"4mb"}));app.use(express.urlencoded({extended:true}));
app.use(session({secret:process.env.SESSION_SECRET||"ASSISTQ-local-change-me",resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:7*24*60*60*1000}}));

// Basic production hardening. Put the app behind HTTPS in production.
app.use((req,res,next)=>{res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("X-Frame-Options","SAMEORIGIN");res.setHeader("Referrer-Policy","strict-origin-when-cross-origin");res.setHeader("Permissions-Policy","camera=(), microphone=(), geolocation=()");next();});
const rateBuckets=new Map();
function rateLimit(key,limit=30,windowMs=60000){return (req,res,next)=>{const now=Date.now(),ip=req.ip||req.socket.remoteAddress||"unknown",k=key+"|"+ip;const a=rateBuckets.get(k)||[];const fresh=a.filter(t=>now-t<windowMs);if(fresh.length>=limit)return res.status(429).json({error:"Too many requests. Please try again shortly."});fresh.push(now);rateBuckets.set(k,fresh);next();};}
setInterval(()=>{const now=Date.now();for(const [k,a] of rateBuckets)if(!a.some(t=>now-t<60000))rateBuckets.delete(k);},60000);

// Public chatbot bridge. Production deployments should set WEBHOOK_SECRET.
app.use((req,res,next)=>{
  if(req.path.startsWith("/api/bridge")||req.path==="/api/leads"||req.path==="/api/public/client-config"){
    const origin=req.headers.origin;res.setHeader("Access-Control-Allow-Origin",origin||"*");res.setHeader("Vary","Origin");res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS");res.setHeader("Access-Control-Allow-Headers","Content-Type, X-AssistQ-Secret");
    if(req.method==="OPTIONS")return res.sendStatus(204);
  }
  next();
});
app.use(express.static(path.join(__dirname,"public")));

function normaliseClientId(id){return String(id||"demo-realty").toLowerCase().replace(/[^a-z0-9_-]/g,"-").slice(0,60)||"demo-realty";}
function clientSettings(s,id){const c=s.clients.find(x=>x.id===id)||{};return {...s.settings,...c,clientId:id,subscription:subscriptionInfo(c),assistant:c.assistant||s.settings.assistant,customLeadFields:c.customLeadFields||s.settings.customLeadFields,scoring:c.scoring||s.settings.scoring,hotThreshold:c.hotThreshold??s.settings.hotThreshold,warmThreshold:c.warmThreshold??s.settings.warmThreshold,reportEnabled:c.reportEnabled??s.settings.reportEnabled,clientWhatsApp:c.clientWhatsApp||s.settings.clientWhatsApp||"",whatsappCountryCode:c.whatsappCountryCode||s.settings.whatsappCountryCode};}
function requireAuth(req,res,next){if(!req.session.user)return res.status(401).json({error:"Authentication required"});next();}
function requireAdmin(req,res,next){if(!req.session.user||req.session.user.role!=="admin")return res.status(403).json({error:"Admin access required"});next();}
function selectedClient(req,s){return normaliseClientId(req.query.clientId||req.body?.clientId||req.session.user?.clientId||s.settings.clientId);}

function subscriptionInfo(c={}){
  const status=String(c.subscriptionStatus||"active").toLowerCase();
  const now=Date.now();
  const start=c.subscriptionStart?new Date(c.subscriptionStart).getTime():null;
  const end=c.subscriptionEnd?new Date(c.subscriptionEnd).getTime():null;
  let effective=status;
  if(status==="active" && start && Number.isFinite(start) && now<start) effective="scheduled";
  if(status==="active" && end && Number.isFinite(end) && now>=end) effective="expired";
  if(status==="scheduled" && start && Number.isFinite(start) && now>=start) effective=(end && now>=end)?"expired":"active";
  return {active:effective==="active",status:effective,plan:c.plan||"Starter",start:c.subscriptionStart||null,end:c.subscriptionEnd||null};
}
function requireActiveClient(req,res,next){
  const s=ensureStoreShape(readStore());
  const id=selectedClient(req,s);
  const c=s.clients.find(x=>x.id===id);
  if(!c)return res.status(404).json({error:"Client not found"});
  const sub=subscriptionInfo(c);
  if(!sub.active)return res.status(403).json({error:`Client subscription is ${sub.status}.`,subscription:sub});
  req.assistqClientId=id; next();
}

function scoreLead(fields={},messages=[],settings={}){const w={name:10,phone:15,email:10,purpose:10,location:10,configuration:10,budget:20,timeline:10,engagement:5,...(settings.scoring||{})};let score=0;for(const key of ["name","phone","email","purpose","location","configuration","budget","timeline"])if(fields[key])score+=Number(w[key])||0;if(messages.length>=6)score+=Number(w.engagement)||0;return Math.min(100,Math.max(0,Math.round(score)));}
function statusFor(score,settings={}){const hot=Number(settings.hotThreshold||80),warm=Number(settings.warmThreshold||50);return score>=hot?"HOT":score>=warm?"WARM":"COLD";}
function scoreBreakdown(fields={},messages=[],settings={}){const w={name:10,phone:15,email:10,purpose:10,location:10,configuration:10,budget:20,timeline:10,engagement:5,...(settings.scoring||{})};return {name:fields.name?Number(w.name):0,phone:fields.phone?Number(w.phone):0,email:fields.email?Number(w.email):0,purpose:fields.purpose?Number(w.purpose):0,location:fields.location?Number(w.location):0,configuration:fields.configuration?Number(w.configuration):0,budget:fields.budget?Number(w.budget):0,timeline:fields.timeline?Number(w.timeline):0,engagement:messages.length>=6?Number(w.engagement):0};}
function normaliseFields(f={}){return {name:String(f.name||"").trim(),phone:String(f.phone||"").trim(),email:String(f.email||"").trim(),purpose:String(f.purpose||"").trim(),location:String(f.location||"").trim(),configuration:String(f.configuration||"").trim(),budget:String(f.budget||"").trim(),timeline:String(f.timeline||"").trim()};}
function cleanUTM(u={}){return {source:String(u.source||u.utm_source||"").trim(),medium:String(u.medium||u.utm_medium||"").trim(),campaign:String(u.campaign||u.utm_campaign||"").trim()};}
function requireWebhookSecret(req,res,next){
  const secret=String(process.env.WEBHOOK_SECRET||"").trim();
  if(secret && req.headers["x-assistq-secret"]!==secret)return res.status(401).json({error:"Invalid webhook secret"});
  if(!secret && process.env.NODE_ENV==="production")return res.status(503).json({error:"WEBHOOK_SECRET is required in production"});
  next();
}
function whatsappUrl(phone,message=""){const digits=String(phone||"").replace(/\D/g,"");if(!digits)return "";const s=readStore();const cc=String(s.settings.whatsappCountryCode||"91");const full=digits.length===10?cc+digits:digits;return `https://wa.me/${full}?text=${encodeURIComponent(message)}`;}

// ---------- Auth ----------
app.get("/api/auth/status",(req,res)=>res.json({authenticated:!!req.session.user,user:req.session.user||null,googleConnected:!!req.session.tokens,googleEmail:req.session.googleEmail||null}));
app.post("/api/auth/login",rateLimit("login",10,60000),(req,res)=>{
  const email=String(req.body.email||"").trim().toLowerCase();const password=String(req.body.password||"");
  const adminEmail=String(process.env.ADMIN_EMAIL||"admin@assistq.local").toLowerCase();const adminPassword=String(process.env.ADMIN_PASSWORD||"ChangeMe123!");
  if(email===adminEmail&&password===adminPassword){req.session.user={role:"admin",email};return res.json({ok:true,user:req.session.user});}
  const s=ensureStoreShape(readStore());const c=s.clients.find(x=>x.reportEmail?.toLowerCase()===email&&x.accessCode===password);
  if(c){const sub=subscriptionInfo(c);if(!sub.active)return res.status(403).json({error:`This client account is ${sub.status}. Please contact ASSISTQ to renew the subscription.`,subscription:sub});req.session.user={role:"client",email,clientId:c.id,name:c.name};return res.json({ok:true,user:req.session.user});}
  res.status(401).json({error:"Invalid email or password"});
});
app.post("/api/auth/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));

// Public, non-secret client configuration for embeddable chatbot.
app.get("/api/public/client-config",rateLimit("public-config",120,60000),(req,res)=>{const s=ensureStoreShape(readStore());const id=normaliseClientId(req.query.clientId||s.settings.clientId);const c=s.clients.find(x=>x.id===id);if(!c)return res.status(404).json({error:"Client not found"});const sub=subscriptionInfo(c);if(!sub.active)return res.status(403).json({error:`Client subscription is ${sub.status}.`,subscription:sub});const profile=s.clientProfiles[id]||{};const cs=clientSettings(s,id);res.setHeader("Cache-Control","no-store");res.json({clientId:id,businessName:c.name,website:c.website,reportEmail:c.reportEmail||"",clientWhatsApp:cs.clientWhatsApp||"",whatsappCountryCode:cs.whatsappCountryCode||"91",subscription:sub,assistant:profile.assistant||cs.assistant||defaultStore.settings.assistant,customLeadFields:profile.customLeadFields||cs.customLeadFields||[]});});

// ---------- State ----------
app.get("/api/state",requireAuth,(req,res)=>{
  let s=ensureStoreShape(readStore());const clientId=selectedClient(req,s);const allowed=req.session.user.role==="admin"||req.session.user.clientId===clientId;
  if(!allowed)return res.status(403).json({error:"You do not have access to this client workspace"});
  const filter=x=>x.clientId===clientId||(!x.clientId&&clientId===s.settings.clientId);
  const client=clientSettings(s,clientId);
  if(req.session.user.role!=="admin" && !client.subscription.active)return res.status(403).json({error:`Client subscription is ${client.subscription.status}. Please contact ASSISTQ to renew.`,subscription:client.subscription});
  const profile=s.clientProfiles[clientId]||{assistant:client.assistant||defaultStore.settings.assistant,customLeadFields:client.customLeadFields||[]};const gscClient=s.gsc.byClient[clientId]||s.gsc;const gaClient=s.ga4.byClient[clientId]||s.ga4;const out={settings:client,clientId,clients:req.session.user.role==="admin"?s.clients:s.clients.filter(c=>c.id===clientId),leads:s.leads.filter(filter),conversations:Object.fromEntries(Object.entries(s.conversations).filter(([,x])=>filter(x))),keywords:s.keywords.filter(x=>x.clientId===clientId||(!x.clientId&&clientId===s.settings.clientId)),utm:s.utm,gsc:gscClient,ga4:gaClient,seo:s.seoAudits[clientId]||null,reportHistory:s.reportHistory.filter(x=>x.clientId===clientId),profile,googleConnected:!!googleConnection(s,clientId)?.tokens,googleEmail:googleConnection(s,clientId)?.email||null,user:req.session.user};
  writeStore(s);res.json(out);
});

app.post("/api/settings",requireAuth,(req,res)=>{
  const s=ensureStoreShape(readStore());const clientId=normaliseClientId(req.body.clientId||req.session.user.clientId||s.settings.clientId);if(req.session.user.role!=="admin"&&req.session.user.clientId!==clientId)return res.status(403).json({error:"Workspace access denied"});
  const scoring={...s.settings.scoring,...(req.body.scoring||{})};if(Object.values(scoring).reduce((a,b)=>a+Number(b||0),0)!==100)return res.status(400).json({error:"Scoring weights must total 100"});
  s.settings={...s.settings,...req.body,clientId,scoring};const idx=s.clients.findIndex(x=>x.id===clientId);const existing=s.clients[idx]||{};const c={...existing,id:clientId,name:String(req.body.businessName||s.settings.businessName||"Client"),website:String(req.body.website||s.settings.website||""),reportEmail:String(req.body.reportEmail||s.settings.reportEmail||""),clientWhatsApp:String(req.body.clientWhatsApp||existing.clientWhatsApp||s.settings.clientWhatsApp||""),whatsappCountryCode:String(req.body.whatsappCountryCode||existing.whatsappCountryCode||s.settings.whatsappCountryCode||"91"),hotThreshold:Number(req.body.hotThreshold??existing.hotThreshold??s.settings.hotThreshold??80),warmThreshold:Number(req.body.warmThreshold??existing.warmThreshold??s.settings.warmThreshold??50),reportEnabled:req.body.reportEnabled!==undefined?!!req.body.reportEnabled:!!(existing.reportEnabled??s.settings.reportEnabled),scoring,assistant:existing.assistant||s.settings.assistant,customLeadFields:existing.customLeadFields||s.settings.customLeadFields,accessCode:existing.accessCode||crypto.randomBytes(5).toString("hex").toUpperCase(),plan:existing.plan||"Starter",subscriptionStatus:existing.subscriptionStatus||"active",subscriptionStart:existing.subscriptionStart||null,subscriptionEnd:existing.subscriptionEnd||null};if(idx>=0)s.clients[idx]={...s.clients[idx],...c};else s.clients.push(c);writeStore(s);res.json({ok:true,settings:clientSettings(s,clientId),accessCode:c.accessCode});
});
app.get("/api/client/profile",requireAuth,(req,res)=>{const s=ensureStoreShape(readStore());const id=selectedClient(req,s);if(req.session.user.role!=="admin"&&req.session.user.clientId!==id)return res.status(403).json({error:"Workspace access denied"});const cs=clientSettings(s,id);res.json(s.clientProfiles[id]||{assistant:cs.assistant||defaultStore.settings.assistant,customLeadFields:cs.customLeadFields||[]});});
app.post("/api/client/profile",requireAuth,(req,res)=>{const s=ensureStoreShape(readStore());const id=selectedClient(req,s);if(req.session.user.role!=="admin"&&req.session.user.clientId!==id)return res.status(403).json({error:"Workspace access denied"});const assistant={name:String(req.body.assistant?.name||"ASSISTQ Assistant").slice(0,80),greeting:String(req.body.assistant?.greeting||"Hi! 👋 What can I help you with today?").slice(0,300),tone:String(req.body.assistant?.tone||"Professional, friendly and concise").slice(0,300),knowledge:String(req.body.assistant?.knowledge||"").slice(0,12000),questions:Array.isArray(req.body.assistant?.questions)?req.body.assistant.questions.slice(0,20):[]};const customLeadFields=Array.isArray(req.body.customLeadFields)?req.body.customLeadFields.slice(0,30).map(x=>({key:String(x.key||"").trim().toLowerCase().replace(/[^a-z0-9_]/g,"_").slice(0,40),label:String(x.label||"").trim().slice(0,80),required:!!x.required})).filter(x=>x.key&&x.label):[];s.clientProfiles[id]={assistant,customLeadFields};const idx=s.clients.findIndex(x=>x.id===id);if(idx>=0)s.clients[idx]={...s.clients[idx],assistant,customLeadFields};if(id===s.settings.clientId)s.settings={...s.settings,assistant,customLeadFields};writeStore(s);res.json({ok:true,profile:s.clientProfiles[id]});});

app.post("/api/clients",requireAdmin,(req,res)=>{const s=ensureStoreShape(readStore());if(!req.body.name)return res.status(400).json({error:"Client name required"});const id=normaliseClientId(req.body.id||req.body.name);if(s.clients.some(x=>x.id===id))return res.status(409).json({error:"Client already exists"});const c={id,name:String(req.body.name),website:String(req.body.website||""),reportEmail:String(req.body.reportEmail||""),clientWhatsApp:String(req.body.clientWhatsApp||""),accessCode:crypto.randomBytes(5).toString("hex").toUpperCase(),plan:String(req.body.plan||"Starter"),subscriptionStatus:"active",subscriptionStart:req.body.subscriptionStart||new Date().toISOString(),subscriptionEnd:req.body.subscriptionEnd||null};s.clients.push(c);s.settings={...s.settings,clientId:id,businessName:c.name,website:c.website,reportEmail:c.reportEmail};writeStore(s);res.status(201).json(c);});

// ---------- Subscription management ----------
app.post("/api/clients/:id/subscription",requireAdmin,(req,res)=>{
  const s=ensureStoreShape(readStore());
  const id=normaliseClientId(req.params.id);
  const idx=s.clients.findIndex(x=>x.id===id);
  if(idx<0)return res.status(404).json({error:"Client not found"});
  const action=String(req.body.action||"renew").toLowerCase();
  const c={...s.clients[idx]};
  if(action==="suspend"){c.subscriptionStatus="suspended";}
  else if(action==="archive"){c.subscriptionStatus="archived";}
  else if(action==="reactivate"||action==="renew"){
    const start=req.body.subscriptionStart||new Date().toISOString();
    const end=req.body.subscriptionEnd||c.subscriptionEnd||null;
    if(end && !Number.isFinite(new Date(end).getTime()))return res.status(400).json({error:"Invalid subscription end date"});
    c.subscriptionStatus="active"; c.subscriptionStart=start; c.subscriptionEnd=end; c.plan=String(req.body.plan||c.plan||"Starter");
  } else return res.status(400).json({error:"Unknown subscription action"});
  s.clients[idx]=c; writeStore(s); res.json({ok:true,client:{...c,subscription:subscriptionInfo(c)}});
});

// ---------- Google integrations (client-scoped) ----------
function oauthClient(){return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID,process.env.GOOGLE_CLIENT_SECRET,`${process.env.APP_BASE_URL||`http://localhost:${PORT}`}/auth/google/callback`);}
function googleConnection(s,id){return s.google?.byClient?.[id]||null;}
function requireGoogle(req,res,next){const s=ensureStoreShape(readStore());const id=selectedClient(req,s);if(!googleConnection(s,id)?.tokens)return res.status(401).json({error:"Google account is not connected for this client. Connect it from Integrations first."});req.googleClientId=id;next();}
function googleAuthClientFor(req){const s=ensureStoreShape(readStore());const id=req.googleClientId||selectedClient(req,s);const g=googleConnection(s,id);if(!g?.tokens)throw new Error("Google account not connected");const client=oauthClient();client.setCredentials(g.tokens);return {client,id,g};}
app.get("/auth/google",requireAuth,(req,res)=>{if(!process.env.GOOGLE_CLIENT_ID||!process.env.GOOGLE_CLIENT_SECRET)return res.status(500).send("Google OAuth is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env first.");const s=ensureStoreShape(readStore());const id=selectedClient(req,s);if(req.session.user.role!=="admin"&&req.session.user.clientId!==id)return res.status(403).send("Workspace access denied");const state=crypto.randomBytes(24).toString("hex");req.session.googleOAuthState={state,clientId:id};const client=oauthClient();res.redirect(client.generateAuthUrl({access_type:"offline",prompt:"consent",include_granted_scopes:true,state,scope:["openid","email","profile","https://www.googleapis.com/auth/webmasters.readonly","https://www.googleapis.com/auth/analytics.readonly","https://www.googleapis.com/auth/gmail.send"]}));});
app.get("/auth/google/callback",async(req,res)=>{try{if(!req.query.code)throw new Error("Google did not return an authorization code.");if(!req.session.googleOAuthState||req.query.state!==req.session.googleOAuthState.state)throw new Error("Invalid OAuth state. Please start the connection again.");const id=req.session.googleOAuthState.clientId;const client=oauthClient();const {tokens}=await client.getToken(req.query.code);client.setCredentials(tokens);const oauth2=google.oauth2({auth:client,version:"v2"});const me=await oauth2.userinfo.get();const s=ensureStoreShape(readStore());s.google.byClient[id]={connected:true,email:me.data.email||null,tokens,connectedAt:new Date().toISOString()};writeStore(s);req.session.googleOAuthState=null;res.redirect("/");}catch(e){res.status(500).send("Google authorization failed: "+e.message+". Return to ASSISTQ and try Connect Google again.");}});
app.post("/auth/google/disconnect",requireAuth,(req,res)=>{const s=ensureStoreShape(readStore());const id=selectedClient(req,s);if(req.session.user.role!=="admin"&&req.session.user.clientId!==id)return res.status(403).json({error:"Workspace access denied"});delete s.google.byClient[id];writeStore(s);res.json({ok:true});});
app.get("/api/google/status",requireAuth,(req,res)=>{const s=ensureStoreShape(readStore());const id=selectedClient(req,s);const g=googleConnection(s,id);res.json({connected:!!g?.tokens,email:g?.email||null,connectedAt:g?.connectedAt||null,clientId:id});});
app.get("/api/gsc/properties",requireAuth,requireGoogle,async(req,res)=>{try{const {client}=googleAuthClientFor(req);const r=await google.webmasters({version:"v3",auth:client}).sites.list();res.json((r.data.siteEntry||[]).map(x=>({url:x.siteUrl,permission:x.permissionLevel})));}catch(e){res.status(500).json({error:e.message});}});
app.post("/api/gsc/sync",requireAuth,requireGoogle,async(req,res)=>{try{const {siteUrl,startDate,endDate}=req.body;if(!siteUrl)return res.status(400).json({error:"siteUrl required"});const {client,id}=googleAuthClientFor(req);const r=await google.webmasters({version:"v3",auth:client}).searchanalytics.query({siteUrl,requestBody:{startDate:startDate||new Date(Date.now()-30*864e5).toISOString().slice(0,10),endDate:endDate||new Date(Date.now()-2*864e5).toISOString().slice(0,10),dimensions:["query"],type:"web",rowLimit:25000}});const rows=(r.data.rows||[]).map(x=>({query:x.keys?.[0]||"",clicks:x.clicks||0,impressions:x.impressions||0,ctr:x.ctr||0,position:x.position||0}));const s=ensureStoreShape(readStore());s.gsc.byClient[id]={connected:true,property:siteUrl,rows,syncedAt:new Date().toISOString()};writeStore(s);res.json(s.gsc.byClient[id]);}catch(e){res.status(500).json({error:e.message});}});
app.get("/api/ga4/properties",requireAuth,requireGoogle,async(req,res)=>{
  try{
    const {client}=googleAuthClientFor(req);
    const admin=google.analyticsadmin({version:"v1beta",auth:client});
    const properties=[];
    let accountToken;

    // Google does not accept parent:accounts/- here. First discover the
    // Analytics accounts the connected Google user can access, then list
    // properties under each real account resource (accounts/123...).
    do{
      const accountsResponse=await admin.accounts.list({pageSize:200,pageToken:accountToken});
      const accounts=accountsResponse.data.accounts||[];
      for(const account of accounts){
        let propertyToken;
        do{
          const r=await admin.properties.list({
            filter:`parent:${account.name}`,
            pageSize:200,
            pageToken:propertyToken
          });
          for(const property of (r.data.properties||[])){
            properties.push({
              name:property.displayName,
              id:property.name?.split("/").pop(),
              resource:property.name,
              accountName:account.displayName||account.name
            });
          }
          propertyToken=r.data.nextPageToken;
        }while(propertyToken);
      }
      accountToken=accountsResponse.data.nextPageToken;
    }while(accountToken);

    res.json(properties);
  }catch(e){
    res.status(500).json({error:`GA4 property discovery failed: ${e.message}`});
  }
});
app.post("/api/ga4/sync",requireAuth,requireGoogle,async(req,res)=>{try{const {propertyId}=req.body;if(!propertyId)return res.status(400).json({error:"propertyId required"});const {client,id}=googleAuthClientFor(req);const r=await google.analyticsdata({version:"v1beta",auth:client}).properties.runReport({property:`properties/${propertyId}`,requestBody:{dateRanges:[{startDate:"30daysAgo",endDate:"today"}],dimensions:[{name:"date"}],metrics:[{name:"activeUsers"},{name:"sessions"},{name:"conversions"}]}});const rows=(r.data.rows||[]).map(x=>({date:x.dimensionValues?.[0]?.value,activeUsers:Number(x.metricValues?.[0]?.value||0),sessions:Number(x.metricValues?.[1]?.value||0),conversions:Number(x.metricValues?.[2]?.value||0)}));const totals=rows.reduce((a,x)=>({users:a.users+x.activeUsers,sessions:a.sessions+x.sessions,conversions:a.conversions+x.conversions}),{users:0,sessions:0,conversions:0});const s=ensureStoreShape(readStore());s.ga4.byClient[id]={connected:true,propertyId,rows,metrics:totals,syncedAt:new Date().toISOString()};writeStore(s);res.json(s.ga4.byClient[id]);}catch(e){res.status(500).json({error:e.message});}});
app.post("/api/google/test-email",requireAuth,requireGoogle,async(req,res)=>{try{const {client,id}=googleAuthClientFor(req);const to=String(req.body.to||clientSettings(ensureStoreShape(readStore()),id).reportEmail||"").trim();if(!to)return res.status(400).json({error:"Enter a test email address first."});const subject="ASSISTQ Google connection test";const body="Your Google account is connected to ASSISTQ. This is a test email.";const raw=Buffer.from([`To: ${to}`,`Subject: ${subject}`,"Content-Type: text/plain; charset=utf-8","",body].join("\r\n")).toString("base64url");await google.gmail({version:"v1",auth:client}).users.messages.send({userId:"me",requestBody:{raw}});res.json({ok:true,to});}catch(e){res.status(500).json({error:e.message});}});

// ---------- Leads / chatbot bridge ----------
function saveConversationEvent(body){const s=ensureStoreShape(readStore());const clientId=normaliseClientId(body.clientId||s.settings.clientId);const id=body.leadId||"lead_"+crypto.randomBytes(6).toString("hex");const now=new Date().toISOString();const existing=s.conversations[id]||{id,clientId,createdAt:now,updatedAt:now,fields:{},utm:{},messages:[],score:0,status:"COLD"};if(body.event?.role&&body.event?.content){const last=existing.messages.at(-1);if(!(last&&last.role===body.event.role&&last.content===body.event.content))existing.messages.push({role:body.event.role,content:String(body.event.content).slice(0,8000),at:body.event.at||now});}existing.fields={...existing.fields,...normaliseFields(body.fields||{})};existing.utm={...existing.utm,...cleanUTM(body.utm||{})};existing.clientId=clientId;existing.updatedAt=now;const cs=clientSettings(s,clientId);existing.score=scoreLead(existing.fields,existing.messages,cs);existing.scoreBreakdown=scoreBreakdown(existing.fields,existing.messages,cs);existing.status=statusFor(existing.score,cs);s.conversations[id]=existing;writeStore(s);return existing;}
function saveLeadInternal(body){const s=ensureStoreShape(readStore());const clientId=normaliseClientId(body.clientId||s.settings.clientId);const cs=clientSettings(s,clientId);const fields=normaliseFields(body.fields||{});const messages=Array.isArray(body.messages)?body.messages:[];const score=Number(body.score??scoreLead(fields,messages,cs));const status=statusFor(score,cs);const utm=cleanUTM(body.utm||{});const lead={clientId,id:body.id||body.leadId||"AQ-"+crypto.randomBytes(4).toString("hex").toUpperCase(),name:body.name||fields.name||"Unknown",phone:body.phone||fields.phone||"",email:body.email||fields.email||"",requirement:body.requirement||[fields.purpose,fields.location,fields.configuration].filter(Boolean).join(" · "),budget:body.budget||fields.budget||"",score,scoreBreakdown:scoreBreakdown(fields,messages,cs),status,source:body.utm_source||utm.source||"Direct",medium:body.utm_medium||utm.medium||"",campaign:body.utm_campaign||utm.campaign||"",utm,conversationId:body.conversationId||body.leadId||null,messagesCount:messages.length,date:new Date().toISOString()};const idx=s.leads.findIndex(x=>x.id===lead.id&&x.clientId===clientId);if(idx>=0)s.leads[idx]={...s.leads[idx],...lead};else s.leads.unshift(lead);const key=`${clientId}|${lead.source}|${lead.medium}|${lead.campaign}`;s.utm[key]=(s.utm[key]||0)+1;if(lead.conversationId&&s.conversations[lead.conversationId])Object.assign(s.conversations[lead.conversationId],{score,status,fields,clientId,utm});writeStore(s);return lead;}
app.post("/api/leads",(req,res)=>{if(process.env.WEBHOOK_SECRET&&req.headers["x-assistq-secret"]!==process.env.WEBHOOK_SECRET)return res.status(401).json({error:"Invalid webhook secret"});try{res.status(201).json({ok:true,lead:saveLeadInternal(req.body||{})});}catch(e){res.status(500).json({error:e.message});}});
// These two routes are called directly from the public, client-side chatbot widget
// (see ASSISTQ_Chatbot_Connected.html), so they intentionally do NOT require
// WEBHOOK_SECRET — a browser-side script can never hold a secret safely, and
// SETUP_FOR_CLIENT.md correctly warns against putting WEBHOOK_SECRET in the chatbot
// HTML. Abuse is bounded by rateLimit() below instead. WEBHOOK_SECRET remains
// required for /api/leads, which is for trusted server-to-server integrations
// (Tally, Zapier, etc.) rather than the public browser widget.
app.post("/api/bridge/conversation",rateLimit("conversation",120,60000),requireActiveClient,(req,res)=>{try{res.json({ok:true,conversation:saveConversationEvent(req.body||{})});}catch(e){res.status(500).json({error:e.message});}});
app.post("/api/bridge/lead",rateLimit("lead",60,60000),requireActiveClient,(req,res)=>{try{const s=readStore();const c=req.body.conversationId?s.conversations[req.body.conversationId]:null;const body={...req.body,fields:normaliseFields(req.body.fields||c?.fields||{}),messages:Array.isArray(req.body.messages)?req.body.messages:(c?.messages||[]),utm:req.body.utm||c?.utm||{}};res.status(201).json({ok:true,lead:saveLeadInternal(body)});}catch(e){res.status(500).json({error:e.message});}});

// ---------- Keywords ----------
app.post("/api/keywords",requireAuth,(req,res)=>{const s=ensureStoreShape(readStore());const clientId=selectedClient(req,s);if(req.session.user.role!=="admin"&&req.session.user.clientId!==clientId)return res.status(403).json({error:"Workspace access denied"});const keyword=String(req.body.keyword||"").trim();if(!keyword)return res.status(400).json({error:"Keyword required"});const x={id:"kw_"+crypto.randomBytes(4).toString("hex"),clientId,keyword,targetUrl:String(req.body.targetUrl||""),priority:String(req.body.priority||"Medium"),intent:String(req.body.intent||"Commercial")};s.keywords.push(x);writeStore(s);res.status(201).json(x);});
app.delete("/api/keywords/:id",requireAuth,(req,res)=>{const s=ensureStoreShape(readStore());s.keywords=s.keywords.filter(x=>x.id!==req.params.id);writeStore(s);res.json({ok:true});});
app.post("/api/keywords/sync",requireAuth,(req,res)=>{const s=ensureStoreShape(readStore());const clientId=selectedClient(req,s);const clientGsc=s.gsc.byClient[clientId]||s.gsc;const g=clientGsc.rows||[];let count=0;s.keywords=s.keywords.map(k=>{if(k.clientId!==clientId)return k;const q=g.find(r=>r.query.toLowerCase()===k.keyword.toLowerCase())||g.find(r=>r.query.toLowerCase().includes(k.keyword.toLowerCase())||k.keyword.toLowerCase().includes(r.query.toLowerCase()));if(q){count++;return {...k,lastPosition:q.position,lastClicks:q.clicks,lastImpressions:q.impressions,lastCtr:q.ctr,rankSource:"Google Search Console",rankSyncedAt:new Date().toISOString()};}return k;});writeStore(s);res.json({ok:true,matched:count});});

// ---------- SEO crawler ----------
function absolute(base,href){try{return new URL(href,base).toString().split("#")[0];}catch{return null;}}
function sameOrigin(a,b){try{return new URL(a).origin===new URL(b).origin;}catch{return false;}}
function parseHtml(html,url){const title=(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();const description=(html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i)?.[1]||html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i)?.[1]||"").trim();const h1=(html.match(/<h1\b/gi)||[]).length;const h2=(html.match(/<h2\b/gi)||[]).length;const canonical=html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["'][^>]*>/i)?.[1]||"";const imgs=[...html.matchAll(/<img\b[^>]*>/gi)].map(m=>m[0]);const missingAlt=imgs.filter(x=>!/\balt\s*=\s*["'][^"']*["']/i.test(x)).length;const links=[...html.matchAll(/<a\b[^>]+href=["']([^"']+)["'][^>]*>/gi)].map(m=>absolute(url,m[1])).filter(Boolean);const jsonLd=(html.match(/<script[^>]+type=["']application\/ld\+json["']/gi)||[]).length;return {url,title,description,h1,h2,canonical,missingAlt,images:imgs.length,internalLinks:[...new Set(links.filter(x=>sameOrigin(x,url)))].slice(0,40),structuredData:jsonLd,https:url.startsWith("https://")};}
async function fetchText(url,timeout=8000){const c=new AbortController();const t=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(url,{redirect:"follow",signal:c.signal,headers:{"User-Agent":"ASSISTQ-SEO-Audit/1.0"}});const text=await r.text();return {ok:r.ok,status:r.status,url:r.url,text};}finally{clearTimeout(t);}}
async function runSeoAudit(inputUrl){let url=inputUrl.trim();if(!/^https?:\/\//i.test(url))url="https://"+url;const root=new URL(url);const seen=new Set(),queue=[root.toString()];const pages=[];const broken=[];let robots=false,sitemap=false;try{const rr=await fetchText(new URL("/robots.txt",root).toString(),5000);robots=rr.ok;const sm=rr.text.match(/Sitemap:\s*(\S+)/i)?.[1];if(sm){const sr=await fetchText(sm,5000);sitemap=sr.ok;}}catch{}while(queue.length&&pages.length<10){const u=queue.shift();if(seen.has(u))continue;seen.add(u);try{const r=await fetchText(u,8000);if(!r.ok){broken.push({url:u,status:r.status});continue;}const p=parseHtml(r.text,r.url);pages.push({...p,status:r.status});for(const link of p.internalLinks){if(pages.length+queue.length>=15)break;const nu=new URL(link);nu.hash="";if(!seen.has(nu.toString())&&!queue.includes(nu.toString()))queue.push(nu.toString());}}catch(e){broken.push({url:u,status:e.name==="AbortError"?"timeout":"error"});}}
const checks=[];const add=(name,ok,detail)=>checks.push({name,ok,detail});add("HTTPS",root.protocol==="https:",root.protocol==="https:"?"Secure connection detected":"Use HTTPS for the client website");add("Robots.txt",robots,robots?"Robots file found":"robots.txt not found or unavailable");add("XML sitemap",sitemap,sitemap?"Sitemap found through robots.txt":"No sitemap discovered from robots.txt");const noTitle=pages.filter(p=>!p.title||p.title.length<10).length;const noDesc=pages.filter(p=>!p.description||p.description.length<50).length;const badH1=pages.filter(p=>p.h1!==1).length;const badCanonical=pages.filter(p=>!p.canonical).length;const alt=pages.reduce((n,p)=>n+p.missingAlt,0);add("Title tags",noTitle===0,`${noTitle} of ${pages.length} pages need title attention`);add("Meta descriptions",noDesc===0,`${noDesc} of ${pages.length} pages need description attention`);add("H1 structure",badH1===0,`${badH1} of ${pages.length} pages do not have exactly one H1`);add("Canonical tags",badCanonical===0,`${badCanonical} of ${pages.length} pages have no canonical`);add("Image alt text",alt===0,alt?`${alt} images missing alt text`:`All sampled images have alt text`);add("Structured data",pages.some(p=>p.structuredData>0),pages.some(p=>p.structuredData>0)?"JSON-LD detected":"No JSON-LD detected in sampled pages");add("Broken internal links",broken.length===0,broken.length?`${broken.length} broken/unreachable URLs found`:`No broken URLs found in sampled crawl`);const critical=checks.filter(c=>!c.ok&&["HTTPS","Robots.txt","XML sitemap","Broken internal links"].includes(c.name)).length;const warnings=checks.filter(c=>!c.ok).length-critical;const score=Math.max(0,Math.round(100-(critical*15)-(warnings*7)));return {url,checkedAt:new Date().toISOString(),pagesChecked:pages.length,score,critical,warnings,checks,pages:pages.map(p=>({url:p.url,status:p.status,title:p.title,description:p.description,h1:p.h1,h2:p.h2,missingAlt:p.missingAlt,canonical:p.canonical,structuredData:p.structuredData})),broken};}
app.post("/api/seo/audit",requireAuth,rateLimit("seo",20,60000),async(req,res)=>{try{const s=ensureStoreShape(readStore());const clientId=selectedClient(req,s);const website=String(req.body.url||clientSettings(s,clientId).website||"").trim();if(!website)return res.status(400).json({error:"Website URL required"});const audit=await runSeoAudit(website);s.seoAudits[clientId]=audit;writeStore(s);res.json(audit);}catch(e){res.status(500).json({error:"SEO audit failed: "+e.message});}});

app.get("/api/health",(req,res)=>res.json({ok:true,service:"ASSISTQ Growth Platform",version:"v8",time:new Date().toISOString()}));

// Deployment readiness checks. These verify configuration without exposing secrets.
app.get("/api/deployment/check",requireAdmin,(req,res)=>{const checks=[
{name:"SESSION_SECRET",ok:!!process.env.SESSION_SECRET&&process.env.SESSION_SECRET.length>=32,detail:"Use a long random secret in production."},
{name:"ADMIN_PASSWORD",ok:!!process.env.ADMIN_PASSWORD&&process.env.ADMIN_PASSWORD!=="ChangeMe123!",detail:"Replace the demo admin password."},
{name:"WEBHOOK_SECRET",ok:!!process.env.WEBHOOK_SECRET&&process.env.WEBHOOK_SECRET.length>=16,detail:"Protect public lead ingestion."},
{name:"APP_BASE_URL",ok:!!process.env.APP_BASE_URL&&/^https:\/\//i.test(process.env.APP_BASE_URL),detail:"Use an HTTPS public URL in production."},
{name:"Google OAuth credentials",ok:!!process.env.GOOGLE_CLIENT_ID&&!!process.env.GOOGLE_CLIENT_SECRET,detail:"Required to connect client Google accounts."},
{name:"Email delivery",ok:(!!process.env.SMTP_HOST&&!!process.env.SMTP_USER&&!!process.env.SMTP_PASS)||true,detail:"Weekly reports can use connected Gmail; SMTP is an optional fallback."}
];res.json({ready:checks.every(x=>x.ok),checks});});

// ---------- Reports ----------
async function sendWeeklyReport(clientId){const s=ensureStoreShape(readStore());const cs=clientSettings(s,clientId);if(!cs.reportEmail)return {ok:false,reason:"Report email is not configured for this client."};const leads=s.leads.filter(x=>x.clientId===clientId);const conv=Object.values(s.conversations).filter(x=>x.clientId===clientId);const hot=leads.filter(x=>x.status==="HOT").length,warm=leads.filter(x=>x.status==="WARM").length,cold=leads.filter(x=>x.status==="COLD").length;const seo=s.seoAudits[clientId];const top=leads.filter(x=>x.status==="HOT").slice(0,10).map(x=>{const wa=whatsappUrl(x.phone,`Hi ${x.name}, this is ${cs.businessName}. Following up on your enquiry.`);return `<li><b>${escapeHtml(x.name)}</b> — ${x.score}/100 — ${escapeHtml(x.budget||"Budget not provided")} ${wa?`<a href="${wa}">WhatsApp</a>`:""}</li>`}).join("")||"<li>No hot leads.</li>";const html=`<h2>ASSISTQ Weekly Growth Report</h2><p><b>${escapeHtml(cs.businessName)}</b></p><p>Leads: <b>${leads.length}</b> · Hot: <b>${hot}</b> · Warm: <b>${warm}</b> · Cold: <b>${cold}</b></p><p>Conversations: ${conv.length}</p><p>UTM-attributed campaigns: ${Object.keys(s.utm).filter(k=>k.startsWith(clientId+"|")).length}</p><p>SEO health: ${seo?seo.score+"/100":"Not audited"}</p><h3>Priority leads</h3><ul>${top}</ul>`;const g=googleConnection(s,clientId); if(g?.tokens){const client=oauthClient();client.setCredentials(g.tokens);const raw=Buffer.from([`To: ${cs.reportEmail}`,`Subject: ASSISTQ Weekly Growth Report — ${cs.businessName}`,"Content-Type: text/html; charset=utf-8","",html].join("\r\n")).toString("base64url");await google.gmail({version:"v1",auth:client}).users.messages.send({userId:"me",requestBody:{raw}});}else{if(!process.env.SMTP_HOST||!process.env.SMTP_USER||!process.env.SMTP_PASS)return {ok:false,reason:"Connect the client Google account or configure SMTP before sending reports."};const transporter=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:Number(process.env.SMTP_PORT||587)===465,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});await transporter.sendMail({from:process.env.REPORT_FROM||process.env.SMTP_USER,to:cs.reportEmail,subject:`ASSISTQ Weekly Growth Report — ${cs.businessName}`,html});}s.reportHistory.unshift({clientId,sentAt:new Date().toISOString(),to:cs.reportEmail});writeStore(s);return {ok:true};}
function escapeHtml(x){return String(x??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}
app.post("/api/reports/send",requireAuth,async(req,res)=>{try{const s=readStore();const id=selectedClient(req,s);res.json(await sendWeeklyReport(id));}catch(e){res.status(500).json({error:e.message});}});

setInterval(async()=>{try{const s=ensureStoreShape(readStore());for(const c of s.clients){const cs=clientSettings(s,c.id);if(!cs.reportEnabled||!cs.reportEmail||!process.env.SMTP_HOST)continue;const last=s.reportHistory.find(x=>x.clientId===c.id);if(!last||Date.now()-new Date(last.sentAt).getTime()>=7*864e5)await sendWeeklyReport(c.id);}}catch(e){console.error("ASSISTQ report scheduler",e.message);}},60*60*1000);

app.use((req,res,next)=>{if(req.method!=="GET")return next();if(req.path.startsWith("/api/")||req.path.startsWith("/auth/"))return res.status(404).end();res.sendFile(path.join(__dirname,"public","index.html"));});
app.listen(PORT,()=>console.log(`ASSISTQ Growth Platform running at http://localhost:${PORT}`));
