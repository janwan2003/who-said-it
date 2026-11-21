import { PROMPTS, promptIndexFor } from '../_prompts.js';
import { MIN_PLAYERS, dayKey, validTz, addDays, validGuesses, scoreRound, streak, orderAnswers } from '../_game.js';

const MAX_MEMBERS = 30;
const LIMITS = {
  create: [20, 3600], // new groups per IP per hour
  join: [60, 3600], // joins per IP per hour
  write: [600, 3600], // answers, guesses and other writes per IP per hour
  read: [3000, 3600], // state reads per IP per hour (the page polls)
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
const err = (status, message) => json({ error: message }, status);
const now = () => Math.floor(Date.now() / 1000);

function randomId(len = 10) {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function clean(v, max) {
  if (v === undefined || v === null) return '';
  return String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
}
const cleanName = (v) => clean(v, 24).replace(/\s+/g, ' ');

async function rateLimited(env, request, action) {
  const [max, windowSec] = LIMITS[action];
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const t = now();
  const row = await env.DB.prepare(
    `INSERT INTO rate (k, n, reset_at) VALUES (?1, 1, ?2)
     ON CONFLICT(k) DO UPDATE SET
       n = CASE WHEN reset_at < ?3 THEN 1 ELSE n + 1 END,
       reset_at = CASE WHEN reset_at < ?3 THEN ?2 ELSE reset_at END
     RETURNING n`
  ).bind(action + ':' + ip, t + windowSec, t).first();
  return row && row.n > max;
}

// Groups with no activity for 120 days are deleted with everything in them.
async function cleanup(env) {
  const t = now();
  const old = t - 120 * 86400;
  const sub = 'SELECT id FROM groups WHERE active_at < ?1';
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM guesses WHERE group_id IN (${sub})`).bind(old),
    env.DB.prepare(`DELETE FROM answers WHERE group_id IN (${sub})`).bind(old),
    env.DB.prepare(`DELETE FROM rounds WHERE group_id IN (${sub})`).bind(old),
    env.DB.prepare(`DELETE FROM members WHERE group_id IN (${sub})`).bind(old),
    env.DB.prepare('DELETE FROM groups WHERE active_at < ?1').bind(old),
    env.DB.prepare('DELETE FROM rate WHERE reset_at < ?1').bind(t),
  ]);
}

async function body(request) {
  try {
    const text = await request.text();
    if (text.length > 8000) return null;
    return text ? JSON.parse(text) : {};
  } catch {
    return null;
  }
}

async function loadGroup(env, id) {
  if (!/^[A-Za-z0-9]{6,16}$/.test(id || '')) return null;
  return env.DB.prepare('SELECT * FROM groups WHERE id = ?1').bind(id).first();
}

async function me(env, request, groupId) {
  const token = request.headers.get('x-token');
  if (!token || token.length > 100) return null;
  const hash = await sha256(token);
  return env.DB.prepare('SELECT id, name, created_at FROM members WHERE token_hash = ?1 AND group_id = ?2 AND left_at IS NULL')
    .bind(hash, groupId).first();
}

async function activeMembers(env, groupId) {
  const { results } = await env.DB.prepare('SELECT id, name FROM members WHERE group_id = ?1 AND left_at IS NULL ORDER BY id')
    .bind(groupId).all();
  return results;
}

// Today's round, created on first touch. Moves answer -> guess -> reveal as people finish.
async function currentRound(env, group, members) {
  const day = dayKey(group.tz);
  await env.DB.prepare('INSERT OR IGNORE INTO rounds (group_id, day, prompt) VALUES (?1, ?2, ?3)')
    .bind(group.id, day, promptIndexFor(day)).run();
  const round = await env.DB.prepare('SELECT * FROM rounds WHERE group_id = ?1 AND day = ?2').bind(group.id, day).first();
  const [{ results: answers }, { results: guesses }] = await env.DB.batch([
    env.DB.prepare('SELECT aid, member_id, text FROM answers WHERE group_id = ?1 AND day = ?2').bind(group.id, day),
    env.DB.prepare('SELECT guesser_id, aid, guessed_id FROM guesses WHERE group_id = ?1 AND day = ?2').bind(group.id, day),
  ]);
  const activeIds = new Set(members.map((m) => m.id));
  if (round.state === 'answer') {
    const answeredActive = answers.filter((a) => activeIds.has(a.member_id)).length;
    if (answers.length >= MIN_PLAYERS && answeredActive >= members.length) await setState(env, round, 'guess');
  }
  if (round.state === 'guess' && answers.length >= MIN_PLAYERS) {
    const guessers = new Set(guesses.map((g) => g.guesser_id));
    const pending = answers.filter((a) => activeIds.has(a.member_id) && !guessers.has(a.member_id));
    if (!pending.length) await setState(env, round, 'reveal');
  }
  return { round, answers, guesses };
}

async function setState(env, round, state) {
  const col = state === 'guess' ? 'locked_at' : 'revealed_at';
  await env.DB.prepare(`UPDATE rounds SET state = ?1, ${col} = ?2 WHERE group_id = ?3 AND day = ?4`)
    .bind(state, now(), round.group_id, round.day).run();
  round.state = state;
}

function revealOf(answers, guesses, nameOf, seed) {
  const scores = scoreRound(answers, guesses);
  return {
    answers: orderAnswers(answers, seed).map((a) => ({
      aid: a.aid,
      text: a.text,
      author: a.member_id,
      authorName: nameOf(a.member_id),
      guesses: guesses.filter((g) => g.aid === a.aid && g.guesser_id !== a.member_id)
        .map((g) => ({ by: g.guesser_id, byName: nameOf(g.guesser_id), said: g.guessed_id, saidName: nameOf(g.guessed_id), right: g.guessed_id === a.member_id })),
    })),
    scores: [...scores.entries()].map(([id, s]) => ({ id, name: nameOf(id), ...s })).sort((a, b) => b.points - a.points || b.correct - a.correct),
  };
}

async function state(env, request, group) {
  const members = await activeMembers(env, group.id);
  const self = await me(env, request, group.id);
  const { round, answers, guesses } = await currentRound(env, group, members);
  const today = round.day;
  const { results: allNames } = await env.DB.prepare('SELECT id, name FROM members WHERE group_id = ?1').bind(group.id).all();
  const names = new Map(allNames.map((m) => [m.id, m.name]));
  const nameOf = (id) => names.get(id) || 'Someone';

  const answered = new Set(answers.map((a) => a.member_id));
  const guessed = new Set(guesses.map((g) => g.guesser_id));
  const mine = self ? answers.find((a) => a.member_id === self.id) : null;
  const t = {
    day: today,
    prompt: PROMPTS[round.prompt] || PROMPTS[0],
    number: round.prompt + 1,
    state: round.state,
    answeredCount: answers.length,
    guessedCount: answers.filter((a) => guessed.has(a.member_id)).length,
    myAnswer: mine ? mine.text : null,
    iGuessed: self ? guessed.has(self.id) : false,
  };
  if (round.state === 'guess' && mine) {
    t.answers = orderAnswers(answers, today).map((a) => ({ aid: a.aid, text: a.text, mine: a.member_id === self.id }));
    t.authors = answers.filter((a) => a.member_id !== self.id).map((a) => ({ id: a.member_id, name: nameOf(a.member_id) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (t.iGuessed) {
      const s = scoreRound(answers, guesses.filter((g) => g.guesser_id === self.id)).get(self.id);
      t.myCorrect = s ? s.correct : 0;
      t.myTotal = answers.length - 1;
    }
  }
  if (round.state === 'reveal') Object.assign(t, revealOf(answers, guesses, nameOf, today));

  // Last 7 days: weekly points, streaks, history.
  const from = addDays(today, -6);
  const histFrom = addDays(today, -60);
  const [{ results: weekAnswers }, { results: weekGuesses }, { results: rounds }, { results: playedDays }] = await env.DB.batch([
    env.DB.prepare('SELECT aid, day, member_id FROM answers WHERE group_id = ?1 AND day >= ?2').bind(group.id, from),
    env.DB.prepare('SELECT day, guesser_id, aid, guessed_id FROM guesses WHERE group_id = ?1 AND day >= ?2').bind(group.id, from),
    env.DB.prepare(`SELECT r.day, r.prompt, r.state, (SELECT COUNT(*) FROM answers a WHERE a.group_id = r.group_id AND a.day = r.day) AS n
                    FROM rounds r WHERE r.group_id = ?1 AND r.day >= ?2 ORDER BY r.day DESC`).bind(group.id, histFrom),
    env.DB.prepare('SELECT DISTINCT day, member_id FROM answers WHERE group_id = ?1 AND day >= ?2').bind(group.id, histFrom),
  ]);
  const week = new Map();
  const finished = (d) => d < today || round.state === 'reveal';
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, -i);
    if (!finished(d)) continue;
    const a = weekAnswers.filter((x) => x.day === d);
    if (a.length < MIN_PLAYERS) continue;
    for (const [id, s] of scoreRound(a, weekGuesses.filter((g) => g.day === d))) week.set(id, (week.get(id) || 0) + s.points);
  }
  const daysBy = new Map();
  for (const r of playedDays) {
    if (!daysBy.has(r.member_id)) daysBy.set(r.member_id, new Set());
    daysBy.get(r.member_id).add(r.day);
  }
  const groupDays = new Set(rounds.filter((r) => r.n >= MIN_PLAYERS).map((r) => r.day));

  return json({
    group: { id: group.id, name: group.name, tz: group.tz, streak: streak(groupDays, today) },
    me: self ? { id: self.id, name: self.name, creator: self.id === Math.min(...members.map((m) => m.id)) } : null,
    members: members.map((m) => ({
      id: m.id, name: m.name, answered: answered.has(m.id), guessed: guessed.has(m.id),
      week: week.get(m.id) || 0, streak: streak(daysBy.get(m.id) || new Set(), today),
    })),
    minPlayers: MIN_PLAYERS,
    today: t,
    history: rounds.filter((r) => r.day < today).slice(0, 14).map((r) => ({ day: r.day, prompt: PROMPTS[r.prompt], answers: r.n })),
  });
}

async function pastRound(env, request, group, day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return err(400, 'Bad day');
  const self = await me(env, request, group.id);
  if (!self) return err(403, 'Join the group to see past rounds');
  const round = await env.DB.prepare('SELECT * FROM rounds WHERE group_id = ?1 AND day = ?2').bind(group.id, day).first();
  if (!round) return err(404, 'No round that day');
  if (day >= dayKey(group.tz) && round.state !== 'reveal') return err(403, 'Not revealed yet');
  const [{ results: answers }, { results: guesses }, { results: allNames }] = await env.DB.batch([
    env.DB.prepare('SELECT aid, member_id, text FROM answers WHERE group_id = ?1 AND day = ?2').bind(group.id, day),
    env.DB.prepare('SELECT guesser_id, aid, guessed_id FROM guesses WHERE group_id = ?1 AND day = ?2').bind(group.id, day),
    env.DB.prepare('SELECT id, name FROM members WHERE group_id = ?1').bind(group.id),
  ]);
  const names = new Map(allNames.map((m) => [m.id, m.name]));
  return json({ day, prompt: PROMPTS[round.prompt], ...revealOf(answers, guesses, (id) => names.get(id) || 'Someone', day) });
}

async function newMember(env, groupId, name) {
  const token = randomId(32);
  const res = await env.DB.prepare('INSERT INTO members (group_id, name, token_hash, created_at) VALUES (?1, ?2, ?3, ?4) RETURNING id')
    .bind(groupId, name, await sha256(token), now()).first();
  return { token, memberId: res.id };
}

async function touch(env, group) {
  await env.DB.prepare('UPDATE groups SET active_at = ?1 WHERE id = ?2').bind(now(), group.id).run();
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const parts = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const method = request.method;
  try {
    if (Math.random() < 0.02) context.waitUntil(cleanup(env));

    // POST /api/groups -> create a group and its first member
    if (parts.length === 1 && parts[0] === 'groups' && method === 'POST') {
      if (await rateLimited(env, request, 'create')) return err(429, 'Too many new groups from here. Try again in an hour.');
      const b = await body(request);
      if (!b) return err(400, 'Bad request');
      const name = clean(b.name, 40).replace(/\s+/g, ' ');
      const nick = cleanName(b.nickname);
      if (!name) return err(400, 'Give your group a name');
      if (!nick) return err(400, 'Pick a nickname');
      const tz = validTz(b.tz) ? b.tz : 'UTC';
      const id = randomId(10);
      const t = now();
      await env.DB.prepare('INSERT INTO groups (id, name, tz, created_at, active_at) VALUES (?1, ?2, ?3, ?4, ?4)').bind(id, name, tz, t).run();
      const m = await newMember(env, id, nick);
      return json({ id, ...m }, 201);
    }

    if (parts[0] !== 'groups' || !parts[1]) return err(404, 'Not found');
    const group = await loadGroup(env, parts[1]);
    if (!group) return err(404, 'This group does not exist (groups are deleted after 120 days without play)');
    const action = parts[2] || '';

    if (method === 'GET' && !action) {
      if (await rateLimited(env, request, 'read')) return err(429, 'Slow down a little');
      return state(env, request, group);
    }
    if (method === 'GET' && action === 'day' && parts[3]) return pastRound(env, request, group, parts[3]);
    if (method !== 'POST') return err(405, 'Method not allowed');

    const b = await body(request);
    if (!b) return err(400, 'Bad request');

    if (action === 'join') {
      if (await rateLimited(env, request, 'join')) return err(429, 'Too many joins from here. Try again later.');
      const nick = cleanName(b.nickname);
      if (!nick) return err(400, 'Pick a nickname');
      const members = await activeMembers(env, group.id);
      if (members.length >= MAX_MEMBERS) return err(409, `This group is full (${MAX_MEMBERS} people)`);
      if (members.some((m) => m.name.toLowerCase() === nick.toLowerCase())) return err(409, 'Someone in this group already uses that name');
      const m = await newMember(env, group.id, nick);
      await touch(env, group);
      return json(m, 201);
    }

    if (await rateLimited(env, request, 'write')) return err(429, 'Too many actions from here. Try again later.');
    const self = await me(env, request, group.id);
    if (!self) return err(403, 'Join the group first');
    const members = await activeMembers(env, group.id);

    if (action === 'answer') {
      const text = clean(b.text, 200).replace(/\s+/g, ' ');
      if (!text) return err(400, 'Write an answer first');
      const { round } = await currentRound(env, group, members);
      if (round.state !== 'answer') return err(409, "Answers are closed for today. You can still watch the guessing.");
      await env.DB.prepare(
        `INSERT INTO answers (aid, group_id, day, member_id, text, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(group_id, day, member_id) DO UPDATE SET text = excluded.text`
      ).bind(randomId(12), group.id, round.day, self.id, text, now()).run();
      await currentRound(env, group, members); // may move to guessing if this was the last answer
      await touch(env, group);
      return json({ ok: true });
    }

    if (action === 'lock') {
      const { round, answers } = await currentRound(env, group, members);
      if (round.state !== 'answer') return json({ ok: true });
      if (answers.length < MIN_PLAYERS) return err(409, `Guessing needs at least ${MIN_PLAYERS} answers`);
      if (!answers.some((a) => a.member_id === self.id)) return err(403, 'Answer first, then you can start the guessing');
      await setState(env, round, 'guess');
      return json({ ok: true });
    }

    if (action === 'guess') {
      const { round, answers } = await currentRound(env, group, members);
      if (round.state !== 'guess') return err(409, round.state === 'reveal' ? 'The answers are already revealed' : 'Guessing has not started yet');
      if (!answers.some((a) => a.member_id === self.id)) return err(403, "You didn't answer today, so you can't guess this round");
      if (!validGuesses(answers, self.id, b.guesses)) return err(400, 'Match every answer to a different person');
      await env.DB.batch([
        env.DB.prepare('DELETE FROM guesses WHERE group_id = ?1 AND day = ?2 AND guesser_id = ?3').bind(group.id, round.day, self.id),
        ...answers.filter((a) => a.member_id !== self.id).map((a) =>
          env.DB.prepare('INSERT INTO guesses (group_id, day, guesser_id, aid, guessed_id) VALUES (?1, ?2, ?3, ?4, ?5)')
            .bind(group.id, round.day, self.id, a.aid, Number(b.guesses[a.aid]))),
      ]);
      await currentRound(env, group, members); // may reveal if this was the last guesser
      await touch(env, group);
      return json({ ok: true });
    }

    if (action === 'reveal') {
      const { round, guesses } = await currentRound(env, group, members);
      if (round.state !== 'guess') return json({ ok: true });
      if (!guesses.some((g) => g.guesser_id === self.id)) return err(403, 'Make your guesses first');
      await setState(env, round, 'reveal');
      return json({ ok: true });
    }

    if (action === 'rename') {
      const nick = cleanName(b.nickname);
      if (!nick) return err(400, 'Pick a nickname');
      if (members.some((m) => m.id !== self.id && m.name.toLowerCase() === nick.toLowerCase())) return err(409, 'Someone in this group already uses that name');
      await env.DB.prepare('UPDATE members SET name = ?1 WHERE id = ?2').bind(nick, self.id).run();
      return json({ ok: true });
    }

    if (action === 'leave') {
      await env.DB.prepare('UPDATE members SET left_at = ?1 WHERE id = ?2').bind(now(), self.id).run();
      return json({ ok: true });
    }

    if (action === 'delete') {
      if (self.id !== Math.min(...members.map((m) => m.id))) return err(403, 'Only the person who started the group can delete it');
      await env.DB.batch(['guesses', 'answers', 'rounds', 'members'].map((t) =>
        env.DB.prepare(`DELETE FROM ${t} WHERE group_id = ?1`).bind(group.id))
        .concat(env.DB.prepare('DELETE FROM groups WHERE id = ?1').bind(group.id)));
      return json({ ok: true });
    }

    return err(404, 'Not found');
  } catch (e) {
    console.error(e);
    return err(500, 'Something went wrong. Please try again.');
  }
}
