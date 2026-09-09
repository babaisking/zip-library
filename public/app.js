function gpuName() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) return gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '';
    return gl.getParameter(gl.RENDERER) || '';
  } catch (e) { return ''; }
}
function signals() {
  let uaMobile = false;
  try { if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') uaMobile = navigator.userAgentData.mobile; } catch (e) {}
  let coarse = false;
  try { coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches; } catch (e) {}
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
  return {
    touch: navigator.maxTouchPoints || 0,
    coarse: !!coarse,
    uaMobile: !!uaMobile,
    sw: window.screen ? window.screen.width : 0,
    sh: window.screen ? window.screen.height : 0,
    gpu: gpuName(),
    tz: tz,
    lang: navigator.language || '',
    plat: (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '',
    cores: navigator.hardwareConcurrency || 0,
    mem: navigator.deviceMemory || 0,
    dr: window.devicePixelRatio || 0
  };
}
let serverSaysMobile = false;
const params = new URLSearchParams(location.search);
const myRefQuery = params.get('ref');
if (myRefQuery) localStorage.setItem('inbound_ref', myRefQuery);

document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  document.querySelectorAll('nav button').forEach(x => x.classList.remove('on'));
  b.classList.add('on');
  document.getElementById('tab-lib').style.display = b.dataset.tab === 'lib' ? '' : 'none';
  document.getElementById('tab-pass').style.display = b.dataset.tab === 'pass' ? '' : 'none';
  document.getElementById('tab-ref').style.display = b.dataset.tab === 'ref' ? '' : 'none';
});

// visit ping (hardware signals included so desktop-site mode on phones is caught)
(function () {
  const nav = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0] && performance.getEntriesByType('navigation')[0].type) || '';
  fetch('/api/visit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: location.pathname, referrer: document.referrer, ref: localStorage.getItem('inbound_ref') || myRefQuery || '', navType: nav, signals: signals() })
  }).then(x => x.json()).then(j => {
    if (j && j.device === 'mobile') { serverSaysMobile = true; paintMobile(); }
  }).catch(() => {});
})();

function paintMobile() {
  document.getElementById('mobileMsg').innerHTML = '<div class="mobilewarn"><b>This site needs a computer.</b><br>You are on a phone or tablet. Zip extraction does not work on mobile, so downloads are off here. You can look around and share links, but to download and extract you must open this page on a PC. Password is <b>thing</b>.</div>';
  load();
}

function looksMobile() {
  if (serverSaysMobile) return true;
  if (/android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent)) return true;
  const s = signals();
  if (s.uaMobile) return true;
  if (s.touch > 0 && s.coarse && Math.min(s.sw, s.sh) <= 1024) return true;
  return false;
}

async function load() {
  const mm = document.getElementById('mobileMsg');
  const mobile = looksMobile();
  if (mobile && !mm.innerHTML) {
    mm.innerHTML = '<div class="mobilewarn"><b>This site needs a computer.</b><br>You are on a phone or tablet. Zip extraction does not work on mobile, so downloads are off here. You can look around and share links, but to download and extract you must open this page on a PC. Password is <b>thing</b>.</div>';
  }
  const r = await fetch('/api/zips').then(x => x.json());
  const box = document.getElementById('tab-lib');
  box.innerHTML = '';
  r.zips.forEach(z => {
    const d = document.createElement('div');
    d.className = 'card';
    const vids = (z.videos || []).map(v => {
      if (/youtube|youtu\.be/i.test(v)) {
        let id = '';
        const m = v.match(/(?:embed\/|v=|youtu\.be\/)([\w-]{6,})/);
        if (m) id = m[1];
        const src = id ? 'https://www.youtube.com/embed/' + id : v;
        return `<iframe height="220" src="${src}" frameborder="0" allowfullscreen></iframe>`;
      }
      if (/\.mp4/i.test(v)) return `<video controls src="${v}"></video>`;
      return `<div class="small"><a href="${v}" target="_blank">${v}</a></div>`;
    }).join('');
    const locked = z.locked && !z.accessible;
    d.innerHTML = `<h3>${escapeHtml(z.title)}</h3>
      <div>${z.locked ? '<span class="tag lock">locked</span>' : '<span class="tag">unlocked</span>'}<span class="tag">${z.downloads} downloads</span>${z.size ? `<span class="tag">${Math.round(z.size / 1024)} KB</span>` : ''}</div>
      <p>${escapeHtml(z.desc || '')}</p>
      <div class="meta">Password: <b>thing</b></div>${vids}
      <div>${locked ? `<button class="btn lock" disabled>Locked. Get a referral download to unlock</button>`
        : (mobile ? `<button class="btn dim" disabled>PC only. Open on a computer to download</button><div><button class="btn dim" onclick="navigator.clipboard&&navigator.clipboard.writeText(location.href)">Share</button></div>`
        : (z.hasFile ? `<button class="btn" onclick="dl('${z.id}')">Download</button>` : `<button class="btn dim" disabled>No file yet</button>`))}</div>`;
    box.appendChild(d);
  });
  const me = await fetch('/api/me').then(x => x.json());
  const link = location.origin + '/?ref=' + me.refCode;
  document.getElementById('refInfo').innerHTML = `Your IP: ${escapeHtml(me.ip)}<br>Your link: <a href="${link}">${link}</a><br>Downloads through your link: <b>${me.downloads}</b><br>${me.downloads > 0 ? 'Locked archives unlocked.' : 'Get one download to unlock locked archives.'}`;
}
function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
async function dl(id) {
  const inbound = localStorage.getItem('inbound_ref') || '';
  const r = await fetch('/api/download-token/' + id, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signals: signals(), ref: inbound })
  }).then(x => x.json()).catch(() => ({}));
  if (!r.ok) {
    alert(r.error === 'pc only' ? 'Downloads need a computer. Phones and tablets are blocked, including desktop site mode.' : (r.error === 'locked' ? 'Locked archive. Get a download through your referral link first.' : 'Download not available right now.'));
    if (r.device === 'mobile') { serverSaysMobile = true; paintMobile(); }
    return;
  }
  location.href = '/api/download/' + id + '?t=' + encodeURIComponent(r.token) + (inbound ? '&ref=' + encodeURIComponent(inbound) : '');
}
load();
