// End-to-end test in real Chromium, four people in separate browser contexts:
// Ann creates a group on the landing page (desktop), Ben, Cat and Dan join from the link (phones).
// Ann, Ben and Cat answer anonymously, Ann starts the guessing early, Dan is locked out,
// everyone guesses with the name chips, the reveal and scores are checked, then Ann deletes the group.
// Usage: BASE=http://127.0.0.1:8817 node tests/e2e/run.mjs   (screenshots go to shots/)
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8817';
const SHOTS = process.env.SHOTS || 'shots';
fs.mkdirSync(SHOTS, { recursive: true });

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const root = path.join(os.homedir(), '.cache/ms-playwright');
  for (const d of fs.readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
    const p = path.join(root, d, 'chrome-linux64/chrome');
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1280, height: 860 } };
const errors = [];
const browser = await chromium.launch({ executablePath: findChrome() });
const step = (s) => console.log('·', s);

async function person(label, opts, expected = []) {
  const ctx = await browser.newContext(opts);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !expected.some((re) => re.test(m.text()))) errors.push(`${label}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('dialog', (d) => d.accept());
  return { label, ctx, page };
}
const shot = (p, name) => p.page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true });

let groupUrl;
try {
  // 1. Landing + create
  const ann = await person('Ann', DESKTOP);
  await ann.page.goto(BASE + '/');
  await shot(ann, 'landing-desktop');
  await ann.page.click('button[type=submit]');
  assert.equal(await ann.page.locator('#gname:invalid').count(), 1, 'empty form is blocked');
  await ann.page.fill('#gname', 'E2E Family');
  await ann.page.fill('#nick', 'Ann');
  await ann.page.click('button[type=submit]');
  await ann.page.waitForURL(/\/g\/[A-Za-z0-9]+$/);
  groupUrl = ann.page.url();
  await ann.page.getByText('Invite 2 more people to start').waitFor();
  step('Ann created ' + groupUrl);

  // Link preview before anyone answered
  const og = async () => (await (await fetch(groupUrl)).text()).match(/property="og:description" content="([^"]*)"/)[1];
  assert.match(await og(), /0 of 1 answered · 1 player so far/);

  // 2. Joins
  const ben = await person('Ben', PHONE, [/status of 409/]);
  const cat = await person('Cat', PHONE);
  const dan = await person('Dan', PHONE);
  await ben.page.goto(groupUrl);
  await ben.page.getByText('Join E2E Family').waitFor();
  await shot(ben, 'join-phone');
  await ben.page.fill('#nick', 'ann');
  await ben.page.click('#join button');
  await ben.page.getByText('already uses that name').waitFor();
  assert.match(await ben.page.locator('#jerr').innerText(), /personal link/, 'duplicate name explains the personal link');
  await ben.page.fill('#nick', 'Ben');
  await ben.page.click('#join button');
  await ben.page.locator('#ans').waitFor();
  for (const [p, n] of [[cat, 'Cat'], [dan, 'Dan']]) {
    await p.page.goto(groupUrl);
    await p.page.fill('#nick', n);
    await p.page.click('#join button');
    await p.page.locator('#ans').waitFor();
  }
  step('Ben, Cat, Dan joined (duplicate name rejected)');

  // 3. Answers
  const A = { Ann: 'Geese. Just geese.', Ben: 'Replying "you too" to a waiter', Cat: 'Deep water <b>at night</b>' };
  const answer = async (p, text) => {
    await p.page.reload();
    await p.page.fill('#ans', text);
    await p.page.click('#answer button[type=submit]');
    await p.page.getByText('Your answer', { exact: true }).waitFor();
  };
  await answer(ann, A.Ann);
  await answer(ben, A.Ben);
  await shot(ben, 'answered-phone');
  assert.equal(await ann.page.locator('[data-act=lock]').count(), 0, 'no early start with 2 answers');
  // Ben opens Settings; a live update (Cat answering) must not collapse it.
  await ben.page.locator('#settings summary').click();
  assert.equal(await ben.page.locator('#settings[open]').count(), 1);
  await answer(cat, A.Cat);
  await ben.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await ben.page.getByText('3 of 4 answered').waitFor();
  assert.equal(await ben.page.locator('#settings[open]').count(), 1, 'settings stay open after a live update');
  assert.match(await og(), /3 of 4 answered · 4 players so far/);
  // Answers stay secret: nobody's state contains another person's answer text.
  const benState = await ben.page.evaluate(async (gid) => {
    const r = await fetch('/api/groups/' + gid, { headers: { 'x-token': localStorage.getItem('penname:' + gid) } });
    return r.text();
  }, groupUrl.split('/').pop());
  assert.ok(!benState.includes('Geese') && !benState.includes('Deep water'), 'answers hidden during answering');
  step('3 answers in, hidden from others, OG shows 3 of 4');

  // 4. Ann starts guessing early; Dan is locked out
  await ann.page.reload();
  await ann.page.click('[data-act=lock]');
  await ann.page.locator('.guess').waitFor();
  await dan.page.reload();
  await dan.page.getByText("you didn't get one in").waitFor();
  step('early start works, late Dan locked out');

  // Guessing state must not leak authors
  const annState = await ann.page.evaluate(async (gid) => {
    const r = await fetch('/api/groups/' + gid, { headers: { 'x-token': localStorage.getItem('penname:' + gid) } });
    return r.json();
  }, groupUrl.split('/').pop());
  assert.equal(annState.today.state, 'guess');
  assert.equal(annState.today.answers.length, 3);
  for (const a of annState.today.answers) assert.deepEqual(Object.keys(a).sort(), ['aid', 'mine', 'text']);

  // 5. Guesses. Ben and Cat match both right; Ann swaps both on purpose.
  const guess = async (p, map) => {
    await p.page.reload();
    await p.page.locator('.guess').waitFor();
    const submit = p.page.locator('[data-act=guess]');
    assert.equal(await submit.isDisabled(), true, 'submit disabled until all assigned');
    for (const [text, who] of map) {
      await p.page.locator('.guess .ans', { hasText: text }).getByRole('button', { name: who, exact: true }).click();
    }
    assert.equal(await submit.isDisabled(), false);
    await submit.click();
  };
  await guess(ben, [['Geese', 'Ann'], ['Deep water', 'Cat']]);
  await ben.page.getByText('answers matched right').waitFor();
  assert.match(await ben.page.locator('.prompt-card').innerText(), /2 \/ 2/);
  await shot(ben, 'guessed-phone');
  await cat.page.reload();
  await cat.page.locator('.guess').waitFor();
  // Moving a name: tapping Ann on the second answer takes it away from the first.
  const geese = cat.page.locator('.guess .ans', { hasText: 'Geese' });
  const waiter = cat.page.locator('.guess .ans', { hasText: 'waiter' });
  await geese.getByRole('button', { name: 'Ben', exact: true }).click();
  await waiter.getByRole('button', { name: 'Ben', exact: true }).click();
  assert.equal(await geese.locator('.chip.on').count(), 0, 'name moved off the first answer');
  await geese.getByRole('button', { name: 'Ann', exact: true }).click();
  await shot(cat, 'guess-phone');
  await cat.page.click('[data-act=guess]');
  await cat.page.getByText('answers matched right').waitFor();
  await guess(ann, [['waiter', 'Cat'], ['Deep water', 'Ben']]);
  step('3 guessers done');

  // 6. Reveal (automatic after the last guess)
  await ann.page.locator('.reveal').waitFor();
  const reveal = await ann.page.locator('.reveal').innerText();
  for (const [who, text] of Object.entries(A)) {
    const card = ann.page.locator('.reveal .ans', { hasText: text.slice(0, 10) });
    assert.match(await card.locator('.author').innerText(), new RegExp(who));
  }
  assert.ok(reveal.includes('Deep water <b>at night</b>'), 'HTML in answers is shown as text');
  assert.ok(reveal.includes('Ann guessed Cat') && reveal.includes('Ben ✓'), 'verdicts read as sentences');
  // Scores: Ben 2 right + fooled 1 (Ann) = 3; Cat 2 right + fooled 1 = 3; Ann 0 right + fooled 0 = 0.
  const pts = await ann.page.evaluate(async (gid) => {
    const r = await fetch('/api/groups/' + gid, { headers: { 'x-token': localStorage.getItem('penname:' + gid) } });
    return (await r.json()).today.scores.map((s) => `${s.name}:${s.points}`).sort().join(',');
  }, groupUrl.split('/').pop());
  assert.equal(pts, 'Ann:0,Ben:3,Cat:3');
  await shot(ann, 'reveal-desktop');
  await ben.page.reload();
  await ben.page.locator('.reveal').waitFor();
  await shot(ben, 'reveal-phone');
  const weekBen = await ben.page.locator('section.card', { hasText: 'This week' }).locator('tr', { hasText: 'Ben' }).innerText();
  assert.match(weekBen, /3 pts/);
  step('reveal correct, scores Ann 0 / Ben 3 / Cat 3');

  // Share result (desktop copies to clipboard)
  await ann.page.click('[data-act=shareresult]');
  const clip = await ann.page.evaluate(() => navigator.clipboard.readText());
  assert.match(clip, /Penname #\d+ · E2E Family/);
  assert.match(clip, /I spotted 0\/2 and fooled 0/);
  assert.match(clip, /🟥🟥/);
  step('share result text ok');

  // Personal link signs in on a new device
  await ann.page.locator('details summary').click();
  await ann.page.click('[data-act=mylink]');
  const personal = await ann.page.evaluate(() => navigator.clipboard.readText());
  const ann2 = await person('Ann2', PHONE);
  await ann2.page.goto(personal);
  await ann2.page.locator('.reveal').waitFor();
  assert.ok(!ann2.page.url().includes('#k='), 'token removed from URL');
  assert.match(await ann2.page.locator('#who').innerText(), /Ann/);
  step('personal link works on a second device');

  // Landing on a phone
  await ann2.page.goto(BASE + '/');
  await shot(ann2, 'landing-phone');

  // Small phones (320 px): nothing wider than the screen on the landing, join and reveal pages.
  const tiny = await person('Tiny', { ...PHONE, viewport: { width: 320, height: 640 } });
  const overflow = () => tiny.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await tiny.page.goto(BASE + '/');
  assert.ok((await overflow()) <= 0, 'landing fits 320 px');
  await tiny.page.goto(groupUrl);
  await tiny.page.locator('#join').waitFor();
  assert.ok((await overflow()) <= 0, 'join fits 320 px');
  await tiny.page.goto(personal);
  await tiny.page.locator('.reveal').waitFor();
  assert.ok((await overflow()) <= 0, 'reveal fits 320 px');
  await shot(tiny, 'reveal-320');
  step('320 px layouts fit');

  // Rename shows everywhere; leaving removes the player.
  await cat.page.reload();
  await cat.page.locator('#settings summary').click();
  await cat.page.fill('#newnick', 'Kat');
  await cat.page.click('#rename button');
  await cat.page.getByText("You're Kat").waitFor();
  assert.match(await cat.page.locator('.reveal .ans', { hasText: 'Deep water' }).locator('.author').innerText(), /Kat/);
  await dan.page.reload();
  await dan.page.locator('#settings summary').click();
  await dan.page.click('[data-act=leave]');
  await dan.page.locator('#join').waitFor();
  assert.match(await dan.page.locator('.gh').innerText(), /3 players/);
  step('rename and leave work');

  // Unknown pages are real 404s, not the landing page.
  const nf = await fetch(BASE + '/no-such-page');
  assert.equal(nf.status, 404);
  assert.match(await nf.text(), /Page not found/);
  for (const href of ['/privacy', '/og.png', '/icon-180.png', '/manifest.webmanifest', '/sitemap.xml', '/robots.txt']) {
    assert.equal((await fetch(BASE + href)).status, 200, href);
  }
  step('404 page and static links ok');

  // 7. Delete
  await ann.page.click('[data-act=delete]');
  await ann.page.waitForURL(BASE + '/');
  const gone = await fetch(BASE + '/api/groups/' + groupUrl.split('/').pop());
  assert.equal(gone.status, 404);
  groupUrl = null;
  step('group deleted');

  assert.deepEqual(errors, [], 'no console errors');
  console.log('E2E PASS');
} catch (e) {
  console.error('E2E FAIL', e);
  console.error('console errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
}
