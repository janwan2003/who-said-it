// Shared helpers: API calls, per-group tokens, small UI bits.
const PN = (() => {
  const key = (id) => 'penname:' + id;
  const store = {
    get(id) { try { return localStorage.getItem(key(id)); } catch { return null; } },
    set(id, t) { try { localStorage.setItem(key(id), t); } catch {} },
    del(id) { try { localStorage.removeItem(key(id)); } catch {} },
  };
  async function api(path, { method = 'GET', body, token } = {}) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers['x-token'] = token;
    let res;
    try {
      res = await fetch('/api/' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new Error("Can't reach Penname. Check your connection and try again.");
    }
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) { const e = new Error(data.error || 'Something went wrong'); e.status = res.status; throw e; }
    return data;
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COLORS = ['#5b3df5', '#e8590c', '#1f9d63', '#d6336c', '#1c7ed6', '#a15c00', '#7048e8', '#0b7285', '#c2255c', '#5c940d'];
  const avatar = (m) => `<span class="av" style="background:${COLORS[(m.id || 0) % COLORS.length]}">${esc((m.name || '?').trim().charAt(0).toUpperCase())}</span>`;
  let toastTimer;
  function toast(msg) {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    ta.remove();
    return ok;
  }
  // Native share sheet on phones, clipboard elsewhere.
  async function share({ title, text, url }) {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ title, text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    if (await copy(url ? `${text}\n${url}` : text)) toast('Copied. Paste it in your chat.');
    else toast('Copy failed. Select the text and copy it.');
  }
  const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
  return { store, api, esc, avatar, toast, copy, share, tz };
})();
