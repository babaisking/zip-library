const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
let fetchFn = global.fetch;
try { if (!fetchFn) fetchFn = require('node-fetch'); } catch (e) {}

const app = express();
const PORT = process.env.PORT || 3000;

const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, 'db.json');

function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) throw new Error('no db');
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    const seed = {
      settings: {
        botToken: process.env.TELEGRAM_BOT_TOKEN || '',
        chatId: process.env.TELEGRAM_CHAT_ID || '-5417526972',
        passwordWord: 'thing'
      },
      zips: [
        { id: 'zip1', title: 'Starter Pack', desc: 'Sample starter collection. Password for every archive is thing.', file: null, size: 0, downloads: 0, locked: false, videos: ['https://www.youtube.com/embed/dQw4w9WgXcQ'], created: Date.now() },
        { id: 'zip2', title: 'Essentials', desc: 'Essential files collection. All passwords are thing.', file: null, size: 0, downloads: 0, locked: false, videos: [], created: Date.now() }
      ],
      visits: [],
      downloads: [],
      referrals: {},
      ipMeta: {}
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2));
    return seed;
  }
}
let db = loadDB();
function saveDB() { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }

// ---------- helpers ----------
function getClientIp(req) {
  let raw = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.headers['x-real-ip']
    || req.socket.remoteAddress || '';
  raw = String(raw).trim();
  if (raw.startsWith('::ffff:')) raw = raw.slice(7);
  if (raw === '::1') raw = '127.0.0.1';
  return raw;
}
function isIPv6(ip) { return ip.includes(':'); }

function parseUA(uaRaw) {
  const ua = String(uaRaw || '');
  const l = ua.toLowerCase();
  let browser = 'Unknown';
  if (/headlesschrome/i.test(ua)) browser = 'Headless Chrome';
  else if (/phantomjs/i.test(ua)) browser = 'PhantomJS';
  else if (/selenium|webdriver|puppeteer|playwright/i.test(ua)) browser = 'Automation';
  else if (/edg/i.test(ua)) browser = 'Edge';
  else if (/opr\/|opera/i.test(ua)) browser = 'Opera';
  else if (/chrome/i.test(ua)) browser = 'Chrome';
  else if (/firefox/i.test(ua)) browser = 'Firefox';
  else if (/safari/i.test(ua) && !/chrome/i.test(ua)) browser = 'Safari';
  else if (/bot|crawl|spider|slurp|mediapartners|baidu|yandex|sogou|exabot|facebot|ia_archiver/i.test(ua)) browser = 'Bot';

  let os = 'Unknown';
  if (/windows/i.test(ua)) os = 'Windows';
  else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/mac os|macintosh/i.test(ua)) os = 'macOS';
  else if (/linux/i.test(ua)) os = 'Linux';

  const isMobile = /android|iphone|ipad|ipod|mobile/i.test(ua) || os === 'Android' || os === 'iOS';
  const device = isMobile ? 'mobile' : 'pc';
  const isHeadless = /headless|phantomjs|webdriver|selenium|puppeteer|playwright/i.test(ua) || l.includes('headless');
  const isBot = isHeadless || /bot|crawl|spider|slurp|mediapartners|baidu|yandex|sogou|exabot|facebot|ia_archiver|python-requests|curl|wget/i.test(ua);
  return { browser, os, device, isMobile, isHeadless, isBot, raw: ua.slice(0, 500) };
}

function parseSource(referrer, refQuery) {
  const r = String(referrer || '');
  if (!r && refQuery) return { label: 'Referral ' + refQuery, origin: 'referral:' + refQuery };
  if (!r) return { label: 'Direct', origin: 'direct' };
  try {
    if (r.startsWith('android-app://')) return { label: 'Android app ' + r.slice(14), origin: r };
    if (r.startsWith('ios-app://')) return { label: 'iOS app ' + r.slice(10), origin: r };
    const u = new URL(r);
    const host = u.hostname.toLowerCase();
    const appMap = { 't.me': 'Telegram', 'l.facebook.com': 'Facebook', 'lm.facebook.com': 'Facebook', 'instagram.com': 'Instagram', 'l.instagram.com': 'Instagram', 'twitter.com': 'X', 't.co': 'X', 'youtube.com': 'YouTube', 'youtu.be': 'YouTube', 'tiktok.com': 'TikTok', 'discord.com': 'Discord', 'discord.gg': 'Discord', 'reddit.com': 'Reddit', 'google.com': 'Google', 'bing.com': 'Bing' };
    let appName = appMap[host] || (host.endsWith('.facebook.com') ? 'Facebook' : null);
    if (appName) return { label: appName + ' app/site', origin: host };
    return { label: host, origin: host };
  } catch (e) { return { label: r.slice(0, 80), origin: r.slice(0, 80) }; }
}

// ---- geo with fallbacks (ipv4 + ipv6) ----
const geoCache = new Map();
async function fetchTimeout(url, ms, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const f = fetchFn || global.fetch;
    const res = await f(url, { ...opts, signal: ctrl.signal });
    return res;
  } finally { clearTimeout(t); }
}
async function geoLookup(ip) {
  if (!ip || ip === '127.0.0.1' || ip === 'localhost') return { country: 'Local', city: 'Local', isp: 'Local network', query: ip };
  if (geoCache.has(ip)) return geoCache.get(ip);
  const fallbacks = [
    async () => {
      const r = await fetchTimeout(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,city,isp,org,query`, 3500);
      const j = await r.json();
      if (j.status === 'success') return { country: j.country || '?', city: j.city || '?', isp: j.isp || j.org || '?', query: j.query || ip };
      throw new Error('ip-api fail');
    },
    async () => {
      const r = await fetchTimeout(`https://ipwho.is/${encodeURIComponent(ip)}`, 3500);
      const j = await r.json();
      if (j.success !== false) return { country: j.country || '?', city: j.city || '?', isp: j.connection ? (j.connection.isp || j.connection.org || '?') : (j.isp || '?'), query: ip };
      throw new Error('ipwho fail');
    },
    async () => {
      const r = await fetchTimeout(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, 3500);
      const j = await r.json();
      if (j.country_name) return { country: j.country_name, city: j.city || '?', isp: j.org || '?', query: ip };
      throw new Error('ipapi fail');
    },
    async () => {
      const r = await fetchTimeout(`https://freeipapi.com/api/json/${encodeURIComponent(ip)}`, 3500);
      const j = await r.json();
      if (j.countryName) return { country: j.countryName, city: j.cityName || '?', isp: j.isp || j.asnOrganization || '?', query: ip };
      throw new Error('freeipapi fail');
    }
  ];
  for (const fn of fallbacks) {
    try { const g = await fn(); geoCache.set(ip, g); return g; } catch (e) {}
  }
  const g = { country: '?', city: '?', isp: '?', query: ip };
  geoCache.set(ip, g);
  return g;
}

// ---- telegram ----
let revisitMap = new Map(); // key ip|path -> {message_id, count, firstTs}
let botOffset = 0;

async function tgApi(method, payload) {
  const token = db.settings.botToken;
  if (!token) return null;
  try {
    const f = fetchFn || global.fetch;
    const r = await f(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await r.json();
  } catch (e) { return null; }
}
function cleanHw(s) {
  const o = {};
  if (!s || typeof s !== 'object') return o;
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  o.touch = Number(s.touch || 0) || 0;
  o.coarse = !!s.coarse;
  o.uaMobile = !!s.uaMobile;
  o.sw = Number(s.sw || 0) || 0;
  o.sh = Number(s.sh || 0) || 0;
  if (s.gpu) o.gpu = str(s.gpu, 120);
  if (s.tz) o.tz = str(s.tz, 60);
  if (s.lang) o.lang = str(s.lang, 20);
  if (s.plat) o.plat = str(s.plat, 60);
  if (s.cores) o.cores = Number(s.cores) || 0;
  if (s.mem) o.mem = Number(s.mem) || 0;
  if (s.dr) o.dr = Number(s.dr) || 0;
  return o;
}
function fmtMsg(o) {
  const hw = o.hw || {};
  const lines = [];
  lines.push(o.kind === 'download' ? '📥 Download' : '👁 Visit');
  if (o.revisit && o.revisit > 0) lines.push(`🔁 REVISIT x${o.revisit}`);
  lines.push(`📄 path: ${o.path}`);
  lines.push(`🖥 device: ${o.device === 'pc' ? 'PC' : 'Mobile'}`);
  lines.push(`💻 os: ${o.os}`);
  lines.push(`🌐 browser: ${o.browser}`);
  lines.push(`🧾 ua: ${String(o.ua || '').slice(0, 200)}`);
  lines.push(`📍 geo: ${o.country}, ${o.city}`);
  lines.push(`🔌 network: ${o.isp}`);
  lines.push(`🌐 ip: ${o.ip}${isIPv6(o.ip) ? ' (ipv6)' : ' (ipv4)'}`);
  const scr = (hw.sw && hw.sh) ? `${hw.sw}x${hw.sh}` : '?';
  lines.push(`🖼 graphics: ${hw.gpu || '?'} | screen ${scr}`);
  const extra = [`tz ${hw.tz || '?'}`, `lang ${hw.lang || '?'}`, `cores ${hw.cores || '?'}`, `touch ${hw.touch || 0}`].join(' | ');
  lines.push(`⚙️ hw: ${extra}`);
  lines.push(`🔗 source: ${o.sourceLabel}`);
  if (o.kind === 'download') lines.push(`📦 zip: ${o.zipTitle || ''}`);
  if (o.ref) lines.push(`👥 ref: ${o.ref}`);
  lines.push(`🕒 time: ${new Date(o.ts).toLocaleString()}`);
  return lines.join('\n');
}
async function notifyTelegram(evt) {
  const chatId = db.settings.chatId;
  const token = db.settings.botToken;
  if (!token || !chatId) return;
  // Only PC visits notify. Mobile disabled. Downloads always notify (pc only anyway since mobile blocked).
  if (evt.device !== 'pc') return;
  const key = evt.ip + '|' + evt.path;
  const now = Date.now();
  const prev = revisitMap.get(key);
  // Same IP on the same path within 5 minutes: edit the message with
  // REVISIT xN instead of sending a new one, so notifications don't bomb.
  if (prev && (now - prev.firstTs) < 5 * 60 * 1000) {
    prev.count += 1;
    prev.lastTs = now;
    const text = fmtMsg({ ...evt, revisit: prev.count });
    try { await tgApi('editMessageText', { chat_id: chatId, message_id: prev.message_id, text }); } catch (e) {}
    return;
  }
  const text = fmtMsg({ ...evt, revisit: 0 });
  const res = await tgApi('sendMessage', { chat_id: chatId, text });
  if (res && res.ok && res.result) {
    revisitMap.set(key, { message_id: res.result.message_id, count: 0, firstTs: now, lastTs: now });
  } else {
    revisitMap.set(key, { message_id: null, count: 0, firstTs: now, lastTs: now });
  }
}

// bot /visited polling
async function pollBot() {
  const token = db.settings.botToken;
  if (!token) { setTimeout(pollBot, 10000); return; }
  try {
    const f = fetchFn || global.fetch;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const r = await f(`https://api.telegram.org/bot${token}/getUpdates?offset=${botOffset}&timeout=10`, { signal: ctrl.signal });
    clearTimeout(t);
    const j = await r.json();
    if (j.ok && j.result) {
      for (const u of j.result) {
        botOffset = u.update_id + 1;
        const msg = u.message;
        if (msg && msg.text && msg.text.trim() === '/visited') {
          const s = buildStats();
          const text = `📊 /visited\n👁 Visits: ${s.totalVisits} (pc ${s.pcVisits}, mobile ${s.mobileVisits})\n📥 Downloads: ${s.totalDownloads}\n🏆 Top origin: ${s.topOrigin || '-'}\n🌍 Top place: ${s.topGeo || '-'}`;
          await tgApi('sendMessage', { chat_id: msg.chat.id, text });
        }
      }
    }
  } catch (e) {}
  setTimeout(pollBot, 3000);
}
setTimeout(pollBot, 3000);

function buildStats() {
  const visits = db.visits || [];
  const totalVisits = visits.length;
  const pcVisits = visits.filter(v => v.device === 'pc').length;
  const mobileVisits = totalVisits - pcVisits;
  const totalDownloads = (db.downloads || []).length;
  const byOrigin = {};
  const byGeo = {};
  const byBrowser = {};
  visits.forEach(v => {
    byOrigin[v.origin || 'direct'] = (byOrigin[v.origin || 'direct'] || 0) + 1;
    const g = (v.country || '?') + ', ' + (v.city || '?');
    byGeo[g] = (byGeo[g] || 0) + 1;
    byBrowser[v.browser || '?'] = (byBrowser[v.browser || '?'] || 0) + 1;
  });
  const top = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1])[0];
  const tO = top(byOrigin), tG = top(byGeo);
  const perZip = {};
  (db.downloads || []).forEach(d => { perZip[d.zipId] = (perZip[d.zipId] || 0) + 1; });
  return { totalVisits, pcVisits, mobileVisits, totalDownloads, byOrigin, byGeo, byBrowser, topOrigin: tO ? `${tO[0]} (${tO[1]})` : '-', topGeo: tG ? `${tG[0]} (${tG[1]})` : '-', perZip };
}

// ---------- middleware ----------
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// bot / headless block (server-side). Runs before logging.
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
  const { isBot, isHeadless } = parseUA(req.headers['user-agent']);
  if (isBot || isHeadless) return res.status(403).send('<h1>Access denied</h1><p>Automated browsers are blocked.</p>');
  next();
});

// Desktop-site mode sends a Linux/Chrome UA from phones, so UA alone is not
// trusted. The page also sends hardware signals (touch, pointer, screen,
// userAgentData.mobile). Touchscreen laptops have touch too, so touch only
// counts as mobile together with a small screen and coarse pointer.
function effectiveDevice(uaInfo, signals) {
  if (uaInfo.isMobile) return { device: 'mobile', desktopMode: false };
  const s = signals || {};
  const touch = Number(s.touch || 0) > 0;
  const coarse = !!s.coarse;
  const uaMobile = !!s.uaMobile;
  const smallest = Math.min(Number(s.sw || 9999), Number(s.sh || 9999));
  if (uaMobile) return { device: 'mobile', desktopMode: true };
  if (touch && coarse && smallest <= 1024) return { device: 'mobile', desktopMode: true };
  return { device: 'pc', desktopMode: false };
}
const dlTokens = new Map(); // token -> {zipId, ip, exp}

// ---------- public API (RLS mirror: anon read-only + insert visits/downloads) ----------
app.get('/api/zips', (req, res) => {
  const ip = getClientIp(req);
  const myRef = referralCodeForIp(ip);
  const referredDownloads = referralDownloads(myRef);
  const unlocked = referredDownloads > 0;
  const list = db.zips.map(z => ({
    id: z.id, title: z.title, desc: z.desc, size: z.size,
    downloads: z.downloads || 0, locked: !!z.locked, videos: z.videos || [],
    hasFile: !!z.file,
    accessible: !z.locked || unlocked,
    created: z.created
  }));
  res.json({ zips: list, password: db.settings.passwordWord, myRefCode: myRef, referralDownloads: referredDownloads, unlocked });
});

app.get('/api/me', (req, res) => {
  const ip = getClientIp(req);
  const code = referralCodeForIp(ip);
  res.json({ ip, refCode: code, refLink: `?ref=${code}`, downloads: referralDownloads(code) });
});

// visit log. Body: {path, referrer, ref, navType, signals}
app.post('/api/visit', async (req, res) => {
  const ip = getClientIp(req);
  const uaInfo = parseUA(req.headers['user-agent']);
  if (uaInfo.isBot || uaInfo.isHeadless) return res.status(403).json({ blocked: true });
  const body = req.body || {};
  const eff = effectiveDevice(uaInfo, body.signals);
  const clientPath = String(body.path || req.headers['x-page'] || '/').slice(0, 200);
  const navType = String(body.navType || '');
  const now = Date.now();
  // refresh: same ip+path within 3s with reload navType -> ignore (no revisit count)
  const last = [...(db.visits || [])].reverse().find(v => v.ip === ip && v.path === clientPath);
  if (last && navType === 'reload' && (now - last.ts) < 3000) return res.json({ ok: true, refresh: true, device: eff.device });
  const geo = await geoLookup(ip);
  const src = parseSource(body.referrer || req.headers['referer'] || '', body.ref || '');
  const rec = {
    ip, path: clientPath, ts: now,
    country: geo.country, city: geo.city, isp: geo.isp,
    browser: uaInfo.browser + (eff.desktopMode ? ' (desktop mode)' : ''), os: uaInfo.os, device: eff.device,
    ua: uaInfo.raw, origin: src.origin, sourceLabel: src.label,
    ref: String(body.ref || '').slice(0, 50) || null, ipv6: isIPv6(ip),
    hw: cleanHw(body.signals)
  };
  db.visits.push(rec);
  if (db.visits.length > 5000) db.visits = db.visits.slice(-5000);
  saveDB();
  // mobile visits: store but do not telegram
  notifyTelegram({ kind: 'visit', ...rec }).catch(() => {});
  res.json({ ok: true, device: eff.device });
});

// Step 1 of download: page JS (which sees touch hardware) asks for a
// one-time token. This is what stops phones in desktop-site mode.
app.post('/api/download-token/:id', async (req, res) => {
  const zip = db.zips.find(z => z.id === req.params.id);
  if (!zip) return res.status(404).json({ error: 'not found' });
  const ip = getClientIp(req);
  const uaInfo = parseUA(req.headers['user-agent']);
  if (uaInfo.isBot || uaInfo.isHeadless) return res.status(403).json({ error: 'bots blocked' });
  const eff = effectiveDevice(uaInfo, (req.body || {}).signals);
  if (eff.device !== 'pc') return res.status(403).json({ error: 'pc only', device: 'mobile' });
  const myCode = referralCodeForIp(ip);
  if (zip.locked && referralDownloads(myCode) <= 0) return res.status(403).json({ error: 'locked' });
  if (!zip.file) return res.status(404).json({ error: 'no file yet' });
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  dlTokens.set(token, { zipId: zip.id, ip, exp: Date.now() + 90000, hw: cleanHw((req.body || {}).signals), ua: uaInfo.raw });
  res.json({ ok: true, token });
});

// Step 2: token is single use, 90s expiry, bound to the IP that asked.
app.get('/api/download/:id', async (req, res) => {
  const zip = db.zips.find(z => z.id === req.params.id);
  if (!zip) return res.status(404).send('Not found');
  const ip = getClientIp(req);
  const uaInfo = parseUA(req.headers['user-agent']);
  if (uaInfo.isBot || uaInfo.isHeadless) return res.status(403).send('Bots blocked');
  if (uaInfo.isMobile) return res.status(403).send('Downloads only work on PC. Please open this page on a computer. All archives use password: thing.');
  const grant = dlTokens.get(String(req.query.t || ''));
  if (!grant || grant.zipId !== zip.id || grant.ip !== ip || Date.now() > grant.exp) {
    return res.status(403).send('Please use the Download button on the site. Direct links do not work.');
  }
  dlTokens.delete(String(req.query.t || ''));
  const myCode = referralCodeForIp(ip);
  if (zip.locked && referralDownloads(myCode) <= 0) {
    return res.status(403).send('Locked archive. Share your referral link and get a download from it to unlock.');
  }
  if (!zip.file) return res.status(404).send('No file attached yet. Admin needs to upload a real zip.');
  // referral credit: ?ref=CODE
  const refCode = String(req.query.ref || req.headers['x-ref'] || '').slice(0, 50);
  if (refCode && refCode !== myCode) {
    db.referrals[refCode] = db.referrals[refCode] || { ownerIp: null, count: 0 };
    db.referrals[refCode].count += 1;
  }
  zip.downloads = (zip.downloads || 0) + 1;
  const geo = await geoLookup(ip);
  const src = parseSource(req.headers['referer'] || '', refCode);
  const rec = { ip, zipId: zip.id, ts: Date.now() };
  db.downloads.push(rec);
  saveDB();
  notifyTelegram({ kind: 'download', ip, path: '/download/' + zip.id, device: 'pc', os: uaInfo.os, browser: uaInfo.browser, country: geo.country, city: geo.city, isp: geo.isp, sourceLabel: src.label, zipTitle: zip.title, ref: refCode || null, ts: Date.now(), hw: grant.hw || {}, ua: grant.ua || uaInfo.raw }).catch(() => {});
  const fp = path.join(UPLOAD_DIR, zip.file);
  res.download(fp, (zip.file || zip.title) + '');
});

// ---------- referrals ----------
function referralCodeForIp(ip) {
  // stable short code from ip
  let h = 0;
  for (let i = 0; i < ip.length; i++) h = ((h << 5) - h + ip.charCodeAt(i)) | 0;
  return 'u' + Math.abs(h).toString(36);
}
function referralDownloads(code) {
  const r = db.referrals[code];
  return r ? (r.count || 0) : 0;
}

// ---------- admin auth (RLS mirror: only root/dark = service_role) ----------
const ADMIN_USER = process.env.ADMIN_USER || 'root';
const ADMIN_PASS = process.env.ADMIN_PASS || 'dark';
const sessions = new Set();
function adminAuth(req, res, next) {
  const tok = req.headers['x-admin-token'];
  if (tok && sessions.has(tok)) return next();
  return res.status(401).json({ error: 'unauthorized' });
}
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const tok = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessions.add(tok);
    return res.json({ ok: true, token: tok });
  }
  res.status(401).json({ error: 'bad login' });
});
app.get('/api/admin/stats', adminAuth, (req, res) => {
  res.json({ ...buildStats(), visits: db.visits.slice(-200).reverse(), downloads: db.downloads.slice(-200).reverse(), referrals: db.referrals, settings: { chatId: db.settings.chatId, hasToken: !!db.settings.botToken } });
});
app.get('/api/admin/zips', adminAuth, (req, res) => { res.json({ zips: db.zips }); });
app.post('/api/admin/zips', adminAuth, (req, res) => {
  const { title, desc, locked, videos } = req.body || {};
  const z = { id: 'z' + Date.now().toString(36), title: String(title || 'Untitled').slice(0, 120), desc: String(desc || '').slice(0, 500), file: null, size: 0, downloads: 0, locked: !!locked, videos: Array.isArray(videos) ? videos.slice(0, 100) : [], created: Date.now() };
  db.zips.push(z); saveDB();
  res.json({ ok: true, zip: z });
});
app.put('/api/admin/zips/:id', adminAuth, (req, res) => {
  const z = db.zips.find(x => x.id === req.params.id);
  if (!z) return res.status(404).json({ error: 'not found' });
  const { title, desc, locked, videos } = req.body || {};
  if (title !== undefined) z.title = String(title).slice(0, 120);
  if (desc !== undefined) z.desc = String(desc).slice(0, 500);
  if (locked !== undefined) z.locked = !!locked;
  if (videos !== undefined && Array.isArray(videos)) z.videos = videos.slice(0, 100);
  saveDB();
  res.json({ ok: true, zip: z });
});
app.delete('/api/admin/zips/:id', adminAuth, (req, res) => {
  const i = db.zips.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'not found' });
  const [z] = db.zips.splice(i, 1);
  if (z.file) { try { fs.unlinkSync(path.join(UPLOAD_DIR, z.file)); } catch (e) {} }
  saveDB();
  res.json({ ok: true });
});
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'))
});
const upload = multer({ storage, limits: { fileSize: 1024 * 1024 * 1024 } });
app.post('/api/admin/upload/:id', adminAuth, upload.single('file'), (req, res) => {
  const z = db.zips.find(x => x.id === req.params.id);
  if (!z) return res.status(400).json({ error: 'zip not found' });
  if (!req.file) return res.status(400).json({ error: 'no file' });
  if (z.file) { try { fs.unlinkSync(path.join(UPLOAD_DIR, z.file)); } catch (e) {} }
  z.file = req.file.filename;
  z.size = req.file.size;
  saveDB();
  res.json({ ok: true, zip: z });
});
app.post('/api/admin/settings', adminAuth, (req, res) => {
  const { botToken, chatId } = req.body || {};
  if (botToken !== undefined) db.settings.botToken = String(botToken).slice(0, 100);
  if (chatId !== undefined) db.settings.chatId = String(chatId).slice(0, 50);
  saveDB();
  res.json({ ok: true, settings: { chatId: db.settings.chatId, hasToken: !!db.settings.botToken } });
});
app.post('/api/admin/test-telegram', adminAuth, async (req, res) => {
  const text = String((req.body || {}).text || '✅ Telemetry OK').slice(0, 1000);
  const r = await tgApi('sendMessage', { chat_id: db.settings.chatId, text });
  res.json({ ok: !!(r && r.ok), raw: r });
});

// ---------- routes ----------
app.get('/cyberng', (req, res) => res.sendFile(path.join(ROOT, 'public', 'cyberng.html')));
app.get('/cyberng/', (req, res) => res.sendFile(path.join(ROOT, 'public', 'cyberng.html')));

app.listen(PORT, '0.0.0.0', () => console.log('zip-library on :' + PORT));
