import test from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, addDays, validGuesses, scoreRound, streak, validTz } from '../../functions/_game.js';
import { PROMPTS, promptIndexFor } from '../../functions/_prompts.js';

test('dayKey follows the group time zone', () => {
  const ms = Date.UTC(2026, 10, 21, 23, 30); // 23:30 UTC
  assert.equal(dayKey('UTC', ms), '2026-11-21');
  assert.equal(dayKey('Europe/Warsaw', ms), '2026-11-22');
  assert.equal(dayKey('America/Los_Angeles', ms), '2026-11-21');
  assert.equal(dayKey('Not/AZone', ms), '2026-11-21');
  assert.equal(validTz('Europe/Warsaw'), true);
  assert.equal(validTz('Not/AZone'), false);
});

test('addDays crosses months and years', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('prompts cycle through every prompt before repeating', () => {
  const seen = new Set();
  for (let i = 0; i < PROMPTS.length; i++) seen.add(promptIndexFor(addDays('2026-11-21', i)));
  assert.equal(seen.size, PROMPTS.length);
  assert.equal(promptIndexFor('2025-01-01') >= 0, true);
});

const answers = [{ aid: 'a', member_id: 1 }, { aid: 'b', member_id: 2 }, { aid: 'c', member_id: 3 }];

test('guesses must be a full assignment to distinct other authors', () => {
  assert.equal(validGuesses(answers, 1, { b: 2, c: 3 }), true);
  assert.equal(validGuesses(answers, 1, { b: 3, c: 2 }), true);
  assert.equal(validGuesses(answers, 1, { b: 2, c: 2 }), false, 'same person twice');
  assert.equal(validGuesses(answers, 1, { b: 1, c: 3 }), false, 'guessing yourself');
  assert.equal(validGuesses(answers, 1, { b: 2 }), false, 'incomplete');
  assert.equal(validGuesses(answers, 1, { a: 2, c: 3 }), false, 'own answer');
  assert.equal(validGuesses(answers, 1, { b: 2, c: 9 }), false, 'not an author');
  assert.equal(validGuesses(answers, 1, null), false);
});

test('scoring: correct guesses and fooled guessers', () => {
  const guesses = [
    { guesser_id: 1, aid: 'b', guessed_id: 2 }, { guesser_id: 1, aid: 'c', guessed_id: 3 }, // 1 gets both
    { guesser_id: 2, aid: 'a', guessed_id: 3 }, { guesser_id: 2, aid: 'c', guessed_id: 1 }, // 2 gets none
    { guesser_id: 3, aid: 'a', guessed_id: 1 }, { guesser_id: 3, aid: 'b', guessed_id: 2 }, // 3 gets both
    { guesser_id: 3, aid: 'c', guessed_id: 1 }, // own answer: ignored
  ];
  const s = scoreRound(answers, guesses);
  assert.deepEqual(s.get(1), { correct: 2, guessed: 2, fooled: 1, spotted: 1, points: 3 });
  assert.deepEqual(s.get(2), { correct: 0, guessed: 2, fooled: 0, spotted: 2, points: 0 });
  assert.deepEqual(s.get(3), { correct: 2, guessed: 2, fooled: 1, spotted: 1, points: 3 });
});

test('streak counts back from today or yesterday', () => {
  const days = new Set(['2026-11-19', '2026-11-20', '2026-11-21']);
  assert.equal(streak(days, '2026-11-21'), 3);
  assert.equal(streak(days, '2026-11-22'), 3, 'today not played yet keeps the streak');
  assert.equal(streak(days, '2026-11-23'), 0);
  assert.equal(streak(new Set(), '2026-11-23'), 0);
});
