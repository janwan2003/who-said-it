// Pure game logic, shared by the API and the unit tests.

export const MIN_PLAYERS = 3;

// Local calendar day (YYYY-MM-DD) for a group's time zone.
export function dayKey(tz, ms = Date.now()) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

export function validTz(tz) {
  if (typeof tz !== 'string' || tz.length > 64) return false;
  try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); return true; } catch { return false; }
}

export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Guesses must assign every answer except the guesser's own to a distinct other author.
export function validGuesses(answers, guesserId, guesses) {
  const others = answers.filter((a) => a.member_id !== guesserId);
  if (!others.length || !guesses || typeof guesses !== 'object') return false;
  const keys = Object.keys(guesses);
  if (keys.length !== others.length) return false;
  const authors = new Set(others.map((a) => a.member_id));
  const used = new Set();
  for (const a of others) {
    const g = Number(guesses[a.aid]);
    if (!authors.has(g) || used.has(g)) return false;
    used.add(g);
  }
  return true;
}

// Score one round. answers: [{aid, member_id}], guesses: [{guesser_id, aid, guessed_id}].
// 1 point per answer you matched right, 1 point per person who failed to spot yours.
export function scoreRound(answers, guesses) {
  const author = new Map(answers.map((a) => [a.aid, a.member_id]));
  const s = new Map();
  const get = (id) => {
    if (!s.has(id)) s.set(id, { correct: 0, guessed: 0, fooled: 0, spotted: 0, points: 0 });
    return s.get(id);
  };
  for (const a of answers) get(a.member_id);
  for (const g of guesses) {
    const real = author.get(g.aid);
    if (real === undefined || real === g.guesser_id) continue;
    const me = get(g.guesser_id);
    me.guessed++;
    if (g.guessed_id === real) { me.correct++; get(real).spotted++; }
    else get(real).fooled++;
  }
  for (const v of s.values()) v.points = v.correct + v.fooled;
  return s;
}

// Consecutive days ending today (or yesterday, if today isn't done yet) that are in the set.
export function streak(days, today) {
  let d = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

// Deterministic shuffle so every player sees answers in the same order, unrelated to who wrote them.
export function orderAnswers(answers, seed) {
  const h = (s) => { let x = 2166136261; for (const c of s) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; };
  return [...answers].sort((a, b) => h(seed + a.aid) - h(seed + b.aid));
}
