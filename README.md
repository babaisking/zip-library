# Zip Library

Password for every archive: `thing`

## Run
Need Node 18+. Then:
```
npm install
npm start
```
Open http://localhost:3000. Admin at http://localhost:3000/cyberng (root / dark).

Set Telegram via env or admin panel:
```
TELEGRAM_BOT_TOKEN=xxx TELEGRAM_CHAT_ID=-5417526972 npm start
```

## What was built
- Dark minimal library, password banner everywhere, What is the password tab.
- Mobile (iOS/Android) gate: banner says PC only, download buttons disabled, share only. Server also 403s mobile downloads.
- Bot/headless block: full UA reported in Browser section (e.g. Headless Chrome), bots get 403.
- IP v4+v6, geo with 4 fallbacks (ip-api, ipwho.is, ipapi.co, freeipapi), network ISP included, referrer origin incl. apps (Telegram/Facebook/Instagram etc).
- Telegram: PC visits + downloads only, compact format, same IP same path within 15s edits message with REVISIT xN (up to 10), refresh (reload under 3s) ignored. /visited bot command + admin metrics (visits, downloads per zip, top origin, country city, browser).
- Referrals: per IP link ?ref=CODE, locked archives unlock after 1 download via your link. Admin can set locked flag.
- Videos: array per zip, no arg limit, existing untouched.
- RLS: see supabase/schema.sql, triple checked (RLS on, deny default, minimal anon/service_role policies). server.js mirrors it: anon read zips + insert visits/downloads only, admin token required for all writes.
