// Group page: join, answer today's question, guess who said what, reveal, weekly table.
(() => {
  const { api, esc, avatar, toast, share, copy, store } = PN;
  const id = (location.pathname.split('/')[2] || '').trim();
  const app = document.getElementById('app');
  const whoEl = document.getElementById('who');
  const params = new URLSearchParams(location.search);
  let justCreated = params.get('new') === '1';

  // A personal link (#k=token) signs this device in, then the token leaves the URL.
  // Also handled on hashchange: pasting the personal link into a tab already on this group only changes the hash.
  function takeHashToken() {
    const k = new URLSearchParams(location.hash.slice(1)).get('k');
    if (!k) return false;
    store.set(id, k);
    history.replaceState(null, '', location.pathname + location.search);
    return true;
  }
  takeHashToken();
  if (justCreated) history.replaceState(null, '', location.pathname);
  let token = store.get(id);

  let S = null; // last state from the server
  let lastJson = '';
  let draft = '';
  let editing = false;
  let picks = {}; // aid -> member id while guessing
  let openDay = null;
  let settingsOpen = false;
  let shownDay = null; // resets drafts and picks when the day rolls over
  const pastCache = {};
  const groupUrl = () => `${location.origin}/g/${id}`;

  async function load(force) {
    try {
      const data = await api('groups/' + id, { token });
      if (token && !data.me) { store.del(id); token = null; }
      const j = JSON.stringify(data);
      if (!force && j === lastJson) return;
      // Don't redraw under someone who is typing.
      const active = document.activeElement;
      if (!force && active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) return;
      lastJson = j;
      S = data;
      if (shownDay && shownDay !== S.today.day) { editing = false; draft = ''; picks = {}; openDay = null; }
      shownDay = S.today.day;
      render();
    } catch (e) {
      if (e.status === 404) return notFound(e.message);
      if (!S) app.innerHTML = `<div class="card"><h2>Couldn't load the group</h2><p class="muted">${esc(e.message)}</p><button class="btn" id="retry">Try again</button></div>`;
      const r = document.getElementById('retry');
      if (r) r.onclick = () => load(true);
    }
  }

  function notFound(msg) {
    app.innerHTML = `<div class="card center"><h2>Group not found</h2><p class="muted">${esc(msg)}</p><a class="btn" href="/">Start a new group</a></div>`;
  }

  async function act(path, body, okMsg) {
    try {
      await api(`groups/${id}/${path}`, { method: 'POST', body: body || {}, token });
      if (okMsg) toast(okMsg);
      await load(true);
      return true;
    } catch (e) {
      toast(e.message);
      return false;
    }
  }

  const names = (list) => list.map((m) => esc(m.name)).join(', ');

  function render() {
    document.title = `${S.group.name} · Penname`;
    whoEl.textContent = S.me ? `You're ${S.me.name}` : '';
    const parts = [];
    parts.push(`<div class="gh"><div><h1>${esc(S.group.name)}</h1>
      <div class="small muted">${S.members.length} ${S.members.length === 1 ? 'player' : 'players'}</div></div>
      ${S.group.streak > 1 ? `<span class="pill amber" title="Days in a row with a full round">🔥 ${S.group.streak}-day streak</span>` : ''}</div>`);
    if (!S.me) {
      parts.push(joinCard());
    } else {
      const needPeople = S.members.length < S.minPlayers;
      if (justCreated || needPeople) parts.push(inviteCard(true));
      parts.push(todayCard());
      parts.push(boardCard());
      if (S.history.length) parts.push(historyCard());
      if (!justCreated && !needPeople) parts.push(inviteCard(false));
      parts.push(ownCard());
      parts.push(settingsCard());
    }
    app.innerHTML = parts.join('');
    wire();
  }

  function joinCard() {
    const t = S.today;
    return `<form class="card" id="join" autocomplete="off">
      <span class="pill">You're invited</span>
      <h2 style="margin-top:10px">Join ${esc(S.group.name)}</h2>
      <p class="muted">Every day there's one question. Everyone answers anonymously, then you guess who said what.</p>
      <div class="card flat" style="margin-bottom:14px"><div class="small muted">Today's question</div><b>${esc(t.prompt)}</b>
        <div class="small muted" style="margin-top:6px">${t.answeredCount} of ${S.members.length} answered</div></div>
      ${S.members.length ? `<p class="small muted">Playing: ${names(S.members)}</p>` : ''}
      <div class="field"><label for="nick">Your nickname</label>
        <input id="nick" type="text" maxlength="24" placeholder="What this group calls you" required></div>
      <button class="btn block" type="submit">Join and play</button>
      <p class="error" id="jerr" role="alert"></p>
      <p class="small muted" style="margin:0">No app, no account. Your nickname is only shown to this group.</p>
    </form>`;
  }

  function inviteCard(big) {
    if (!big) {
      return `<div class="card flat row"><div class="grow"><b>Invite more people</b><div class="small muted">More players, more suspects.</div></div>
        <button class="btn soft" data-act="invite">Share link</button></div>`;
    }
    const need = Math.max(0, S.minPlayers - S.members.length);
    return `<div class="card invite">
      <h2>${need ? `Invite ${need === 1 ? 'one more person' : `${need} more people`} to start` : 'Your group is ready. Invite everyone'}</h2>
      <p class="muted" style="margin:0">Paste this link in your group chat. People open it, pick a nickname and they're in.</p>
      <div class="linkbox"><span class="grow">${esc(groupUrl())}</span></div>
      <div class="row"><button class="btn" data-act="invite">Share link</button><button class="btn ghost" data-act="copylink">Copy</button></div>
    </div>`;
  }

  function todayCard() {
    const t = S.today;
    const head = `<div class="kicker">Question #${t.number} · today</div><div class="q">${esc(t.prompt)}</div>`;
    if (t.state === 'answer') return answerCard(t, head);
    if (t.state === 'guess') return guessCard(t, head);
    return revealCard(t, head);
  }

  function peopleList(key) {
    return `<ul class="people">${S.members.map((m) => `<li class="${m[key] ? 'done' : ''}">${avatar(m)}${esc(m.name)}${m[key] ? ' ✓' : ''}</li>`).join('')}</ul>`;
  }

  function answerCard(t, head) {
    const total = S.members.length;
    const pct = total ? Math.round((t.answeredCount / total) * 100) : 0;
    let body;
    if (!t.myAnswer || editing) {
      body = `<form id="answer"><label for="ans" class="muted small" style="font-weight:600">Your answer, shown without your name</label>
        <textarea id="ans" maxlength="200" placeholder="Be honest. Or don't. Nobody will know… yet." required>${esc(editing ? (draft || t.myAnswer) : draft)}</textarea>
        <div class="row" style="margin-top:10px"><button class="btn grow" type="submit">${editing ? 'Save answer' : 'Send anonymously'}</button>
        ${editing ? '<button class="btn ghost" type="button" data-act="canceledit">Cancel</button>' : ''}</div></form>`;
    } else {
      const missing = S.members.filter((m) => !m.answered);
      const canLock = t.answeredCount >= S.minPlayers;
      body = `<div class="mine"><div class="small muted">Your answer</div>“${esc(t.myAnswer)}”
        <div><button class="btn quiet" style="color:#c9c5d8;padding-left:0" data-act="edit">Edit</button></div></div>
        <p style="margin:0">${total < S.minPlayers
          ? `You need at least ${S.minPlayers} players. Invite ${S.minPlayers - total === 1 ? 'one more person' : `${S.minPlayers - total} more people`}.`
          : missing.length ? `Waiting for ${names(missing)}. Guessing starts when everyone has answered.` : 'Everyone has answered!'}</p>
        ${canLock && missing.length ? `<button class="btn ghost" style="margin-top:12px" data-act="lock">Start guessing now</button>` : ''}`;
    }
    return `<section class="card prompt-card">${head}${body}
      <div class="progress" aria-hidden="true"><i style="width:${pct}%"></i></div>
      <div class="small muted">${t.answeredCount} of ${total} answered</div></section>
      ${t.myAnswer ? `<div class="card"><h3>Who has answered</h3>${peopleList('answered')}</div>` : ''}`;
  }

  function guessCard(t, head) {
    if (!t.myAnswer) {
      return `<section class="card prompt-card">${head}<p style="margin:0">Today's answers are locked, and you didn't get one in. You'll see who said what once the others have guessed. Tomorrow's question is yours!</p></section>
        <div class="card"><h3>Who has guessed</h3>${peopleList('guessed')}</div>`;
    }
    if (t.iGuessed) {
      const waiting = S.members.filter((m) => !m.guessed && t.answers && m.answered);
      return `<section class="card prompt-card">${head}
        <div class="center" style="padding:6px 0 10px"><div style="font-size:2.6rem;font-weight:800">${t.myCorrect} / ${t.myTotal}</div>
        <div class="muted">answers matched right. Which ones? You'll see at the reveal.</div></div>
        <p style="margin:0">${waiting.length ? `Waiting for ${names(waiting)} to guess.` : 'Revealing…'}</p>
        ${waiting.length ? '<button class="btn ghost" style="margin-top:12px" data-act="reveal">Reveal now</button>' : ''}
        <div class="progress" aria-hidden="true"><i style="width:${Math.round((t.guessedCount / t.answeredCount) * 100)}%"></i></div>
        <div class="small muted">${t.guessedCount} of ${t.answeredCount} guessed</div></section>`;
    }
    const authors = t.authors;
    const used = new Set(Object.values(picks).map(Number));
    const cards = t.answers.map((a) => {
      if (a.mine) return `<div class="ans mine-ans"><span class="small">Your answer</span><br>“${esc(a.text)}”</div>`;
      const pick = Number(picks[a.aid]);
      return `<div class="ans ${pick ? 'set' : ''}">“${esc(a.text)}”<div class="who">${authors.map((m) =>
        `<button type="button" class="chip ${pick === m.id ? 'on' : used.has(m.id) ? 'used' : ''}" data-aid="${esc(a.aid)}" data-mid="${m.id}" aria-pressed="${pick === m.id}">${esc(m.name)}</button>`).join('')}</div></div>`;
    }).join('');
    const done = t.answers.filter((a) => !a.mine).every((a) => picks[a.aid]);
    return `<section class="card prompt-card">${head}<p style="margin:0">Everyone's in. Tap who you think wrote each answer. Each person wrote exactly one.</p></section>
      <section class="card guess">${cards}
        <button class="btn block" data-act="guess" ${done ? '' : 'disabled'}>Lock in my guesses</button></section>`;
  }

  function revealBlock(r, meId) {
    const scores = r.scores || [];
    const top = (key) => {
      const max = Math.max(0, ...scores.map((s) => s[key]));
      return { max, who: scores.filter((s) => s[key] === max).map((s) => esc(s.name)).join(' & ') };
    };
    const det = top('correct');
    const mys = top('fooled');
    const awards = det.max > 0 || mys.max > 0 ? `<div class="awards">
      ${det.max > 0 ? `<div class="award"><span class="big">🕵️</span><b>${det.who}</b><span class="small muted">Best detective</span><span class="small muted">${det.max} ${det.max === 1 ? 'answer' : 'answers'} right</span></div>` : ''}
      ${mys.max > 0 ? `<div class="award"><span class="big">🎭</span><b>${mys.who}</b><span class="small muted">Hardest to spot</span><span class="small muted">fooled ${mys.max} ${mys.max === 1 ? 'person' : 'people'}</span></div>` : ''}
    </div>` : '';
    const answers = r.answers.map((a) => `<div class="ans">“${esc(a.text)}”
      <div class="author">${avatar({ id: a.author, name: a.authorName })}${esc(a.authorName)}${a.author === meId ? ' <span class="pill grey">you</span>' : ''}</div>
      ${a.guesses.length ? `<div class="verdicts">${a.guesses.map((g) => (g.right ? `<span class="v right">${esc(g.byName)} ✓</span>` : `<span class="v wrong">${esc(g.byName)} guessed ${esc(g.saidName)}</span>`)).join('')}</div>` : ''}
    </div>`).join('');
    const board = scores.length ? `<h3 style="margin-top:16px">Points today</h3><table class="board">${scores.map((s) =>
      `<tr><td><span class="row" style="gap:8px;flex-wrap:nowrap">${avatar(s)}${esc(s.name)}</span></td><td class="small muted">${s.correct} spotted · fooled ${s.fooled}</td><td class="num">${s.points}</td></tr>`).join('')}</table>` : '';
    return awards + answers + board;
  }

  function revealCard(t, head) {
    const mine = (t.answers || []).flatMap((a) => a.guesses.filter((g) => g.by === S.me.id));
    const enough = t.answers && t.answers.length >= S.minPlayers;
    return `<section class="card prompt-card">${head}<p style="margin:0">${enough ? 'The names are out. Here is who said what.' : 'Not enough answers today.'} New question at midnight.</p>
      ${mine.length ? `<div class="row" style="margin-top:14px"><button class="btn" data-act="shareresult">Share my result</button></div>` : ''}</section>
      ${enough ? `<section class="card reveal">${revealBlock(t, S.me.id)}</section>` : ''}`;
  }

  function boardCard() {
    const rows = [...S.members].sort((a, b) => b.week - a.week || b.streak - a.streak || a.name.localeCompare(b.name));
    return `<section class="card"><h2>This week</h2><table class="board">${rows.map((m) =>
      `<tr><td><span class="row" style="gap:8px">${avatar(m)}${esc(m.name)}${S.me && m.id === S.me.id ? ' <span class="pill grey">you</span>' : ''}</span></td>
       <td class="small muted">${m.streak > 0 ? `🔥 ${m.streak}` : ''}</td><td class="num">${m.week} pts</td></tr>`).join('')}</table>
      <p class="small muted" style="margin:10px 0 0">1 point for each answer you match right, 1 for each person who can't spot yours. 🔥 = days in a row answered.</p></section>`;
  }

  function historyCard() {
    return `<section class="card hist"><h2>Past rounds</h2>${S.history.map((h) => `<button data-day="${h.day}" aria-expanded="${openDay === h.day}">
      <span class="d">${fmtDay(h.day)} · ${h.answers} ${h.answers === 1 ? 'answer' : 'answers'}</span><br><b>${esc(h.prompt)}</b></button>
      ${openDay === h.day ? `<div class="reveal" id="past">${pastCache[h.day] ? pastBody(pastCache[h.day]) : '<p class="muted">Loading…</p>'}</div>` : ''}`).join('')}</section>`;
  }

  function pastBody(r) {
    if (!r.answers.length) return '<p class="muted">Nobody answered that day.</p>';
    return revealBlock(r, S.me.id);
  }

  function fmtDay(d) {
    const [y, m, day] = d.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  }

  function ownCard() {
    return `<section class="card flat"><h3>Got another group?</h3><p class="muted">Family, work, old school friends: each group gets its own daily round and its own table.</p>
      <a class="btn soft" href="/">Start a new group</a></section>`;
  }

  function settingsCard() {
    return `<details class="card flat settings" id="settings"${settingsOpen ? ' open' : ''}><summary><b>Settings</b></summary>
      <form id="rename" class="row" style="margin-top:14px" autocomplete="off"><input class="grow" style="flex:1 1 160px" id="newnick" type="text" maxlength="24" value="${esc(S.me.name)}" aria-label="Your nickname">
        <button class="btn soft" type="submit">Rename</button></form>
      <p class="small muted" style="margin:14px 0 6px">Playing on another phone or computer? Open your personal link there. Keep it to yourself: it signs in as you.</p>
      <button class="btn ghost" data-act="mylink">Copy my personal link</button>
      <div class="row" style="margin-top:18px"><button class="btn danger" data-act="leave">Leave group</button>
      ${S.me.creator ? '<button class="btn danger" data-act="delete">Delete group</button>' : ''}</div>
    </details>`;
  }

  function resultText() {
    const t = S.today;
    const mine = t.answers.flatMap((a) => a.guesses.filter((g) => g.by === S.me.id));
    const right = mine.filter((g) => g.right).length;
    const me = (t.scores || []).find((s) => s.id === S.me.id);
    const lines = [`Penname #${t.number} · ${S.group.name}`, `“${t.prompt}”`, mine.map((g) => (g.right ? '🟩' : '🟥')).join(''),
      `I spotted ${right}/${mine.length}${me ? ` and fooled ${me.fooled}` : ''}`];
    if (S.group.streak > 1) lines.push(`🔥 ${S.group.streak}-day group streak`);
    return lines.join('\n');
  }

  function wire() {
    const join = document.getElementById('join');
    if (join) join.onsubmit = async (e) => {
      e.preventDefault();
      const btn = join.querySelector('button');
      btn.disabled = true;
      try {
        const r = await api(`groups/${id}/join`, { method: 'POST', body: { nickname: document.getElementById('nick').value } });
        store.set(id, r.token);
        token = r.token;
        await load(true);
        window.scrollTo(0, 0);
      } catch (ex) {
        document.getElementById('jerr').textContent = ex.message;
        btn.disabled = false;
      }
    };
    const ans = document.getElementById('answer');
    if (ans) {
      const ta = document.getElementById('ans');
      ta.oninput = () => { draft = ta.value; };
      ans.onsubmit = async (e) => {
        e.preventDefault();
        const btn = ans.querySelector('button[type=submit]');
        btn.disabled = true;
        ta.blur();
        if (await act('answer', { text: ta.value }, editing ? 'Answer saved' : 'Sent. Nobody knows it was you.')) { draft = ''; editing = false; load(true); }
        else btn.disabled = false;
      };
    }
    const st = document.getElementById('settings');
    if (st) st.ontoggle = () => { settingsOpen = st.open; };
    const rn = document.getElementById('rename');
    if (rn) rn.onsubmit = async (e) => {
      e.preventDefault();
      document.getElementById('newnick').blur();
      await act('rename', { nickname: document.getElementById('newnick').value }, 'Nickname changed');
    };
    app.querySelectorAll('.chip[data-aid]').forEach((c) => (c.onclick = () => {
      const aid = c.dataset.aid;
      const mid = Number(c.dataset.mid);
      if (Number(picks[aid]) === mid) delete picks[aid];
      else {
        for (const k of Object.keys(picks)) if (Number(picks[k]) === mid) delete picks[k];
        picks[aid] = mid;
      }
      render();
    }));
    app.querySelectorAll('[data-day]').forEach((b) => (b.onclick = async () => {
      const d = b.dataset.day;
      openDay = openDay === d ? null : d;
      render();
      if (openDay && !pastCache[d]) {
        try { pastCache[d] = await api(`groups/${id}/day/${d}`, { token }); } catch (e) { toast(e.message); openDay = null; }
        render();
      }
    }));
    app.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => actions[b.dataset.act]()));
  }

  const actions = {
    invite: () => share({ title: `${S.group.name} on Penname`, text: `Join "${S.group.name}" on Penname: one question a day, everyone answers anonymously, then we guess who said what.`, url: groupUrl() }),
    copylink: async () => toast((await copy(groupUrl())) ? 'Link copied' : 'Copy failed'),
    edit: () => { editing = true; draft = S.today.myAnswer; render(); document.getElementById('ans').focus(); },
    canceledit: () => { editing = false; draft = ''; render(); },
    lock: () => {
      const missing = S.members.filter((m) => !m.answered);
      if (confirm(`Start guessing now? ${missing.map((m) => m.name).join(', ')} won't be able to answer today.`)) act('lock');
    },
    guess: async () => { if (await act('guess', { guesses: picks }, 'Guesses locked in')) picks = {}; },
    reveal: () => { if (confirm("Reveal the names now? Anyone who hasn't guessed yet won't be able to.")) act('reveal'); },
    shareresult: () => share({ title: 'Penname', text: resultText() + '\nPlay with your own group:', url: location.origin + '/' }),
    mylink: async () => toast((await copy(`${groupUrl()}#k=${token}`)) ? 'Personal link copied. Open it on your other device.' : 'Copy failed'),
    leave: async () => {
      if (!confirm('Leave this group? Your past answers stay in the history.')) return;
      if (await act('leave')) { store.del(id); token = null; load(true); }
    },
    delete: async () => {
      if (!confirm('Delete this group for everyone? This cannot be undone.')) return;
      try {
        await api(`groups/${id}/delete`, { method: 'POST', body: {}, token });
        store.del(id);
        location.href = '/';
      } catch (e) { toast(e.message); }
    },
  };

  if (!/^[A-Za-z0-9]{6,16}$/.test(id)) notFound('This link looks broken.');
  else {
    // Poll often while waiting on other people, rarely when nothing can change soon. Paused in background tabs.
    const pollDelay = () => {
      if (!S || !S.me) return 30000;
      const t = S.today;
      if (t.state === 'reveal') return 60000;
      if (t.state === 'answer' && !t.myAnswer) return 30000;
      return 10000;
    };
    let timer;
    const tick = async () => {
      clearTimeout(timer);
      if (document.visibilityState === 'visible') await load(false);
      timer = setTimeout(tick, pollDelay());
    };
    load(true).then(() => { timer = setTimeout(tick, pollDelay()); });
    window.addEventListener('hashchange', () => { if (takeHashToken()) { token = store.get(id); load(true); } });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
  }
})();
