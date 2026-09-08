const isMobileUA = /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
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

// visit ping
(function () {
  const nav = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0] && performance.getEntriesByType('navigation')[0].type) || '';
  fetch('/api/visit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: location.pathname, referrer: document.referrer, ref: localStorage.getItem('inbound_ref') || myRefQuery || '', navType: nav })
  }).catch(() => {});
})();

async function load() {
  const mm = document.getElementById('mobileMsg');
  if (isMobileUA) {
    mm.innerHTML = '<div class="mobilewarn">You are on mobile. Download only works on PC. You can view and share here, but to extract you need a computer. Password is thing.</div>';
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
        : (isMobileUA ? `<button class="btn dim" disabled>PC only. Open on computer to download</button><div><button class="btn dim" onclick="navigator.clipboard&&navigator.clipboard.writeText(location.href)">Share</button></div>`
        : (z.hasFile ? `<a class="btn" href="/api/download/${z.id}${myRefQuery ? '' : ''}" onclick="return dl(event,'${z.id}')">Download</a>` : `<button class="btn dim" disabled>No file yet</button>`))}</div>`;
    box.appendChild(d);
  });
  const me = await fetch('/api/me').then(x => x.json());
  const link = location.origin + '/?ref=' + me.refCode;
  document.getElementById('refInfo').innerHTML = `Your IP: ${escapeHtml(me.ip)}<br>Your link: <a href="${link}">${link}</a><br>Downloads through your link: <b>${me.downloads}</b><br>${me.downloads > 0 ? 'Locked archives unlocked.' : 'Get one download to unlock locked archives.'}`;
}
function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
async function dl(e, id) {
  e.preventDefault();
  const inbound = localStorage.getItem('inbound_ref') || '';
  const url = '/api/download/' + id + (inbound ? '?ref=' + encodeURIComponent(inbound) : '');
  location.href = url;
  return false;
}
load();
