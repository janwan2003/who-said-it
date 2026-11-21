---
slug: who-said-it
stage: launched
priority: 5
url: https://pb-who-said-it.pages.dev
repo: https://github.com/janwan2003/who-said-it
updated: 2026-11-21
---

# who-said-it (brand: **Penname**)

## Thesis
**Who:** friend groups, families and small teams that already share a group chat (WhatsApp, Messenger, iMessage, Discord, Slack).
**What:** a daily group game. Every day one question goes to the group; everyone answers anonymously; once all have
answered (or anyone starts it early with at least 3 answers) everyone matches each answer to its author. Names are revealed
when all have guessed. Points for spotting friends and for fooling them, a weekly table and streaks.
**Why now:** the same mechanic is proven in an iPhone-only, account-based app (Circles, below) and in manual group-chat
games ("Guess Who Sent It", where one person collects answers by hand). Nothing we found runs from one link in a browser.

## Market evidence
Checked 2026-11-21 by a research subagent (web search; "opened" = page loaded, "snippet" = search result only).
- **Circles – Know Your People** (opened, [App Store](https://apps.apple.com/app/id6753855763), [site](https://circlestheapp.com)):
  closest match. Groups up to 20 answer one daily prompt and guess which friend wrote each answer; streaks + leaderboard.
  iPhone only, collects phone number (account), Circles+ at $4.99/week or $29.99/year. 4.5★ from 29 ratings.
  Shows the mechanic exists and someone charges for it; small rating count says it has not broken out.
- **Who Said That?** (opened, [App Store](https://apps.apple.com/us/app/who-said-that/id1611032961)): iOS, guess the author + AI player, 2.8★ from 4 ratings.
- **Whose Answer?** (opened, [App Store](https://apps.apple.com/us/app/-/id6751831981)): iPad, 3–15 players, live play.
- **Psych! (Warner Bros)** (opened, [App Store](https://apps.apple.com/us/app/id1005765746)): 4.3★ from 21K ratings, last
  update Aug 2023. Live bluffing game, not guess-the-author, but shows demand for friend party games on phones.
- **Jackbox** (snippet, [Wikipedia: Fibbage](https://en.wikipedia.com/wiki/Fibbage)): no guess-the-author title; packs $20–30, live only.
- **PonderPro Discord bot** (opened, [listing](https://discordbotlist.com/bots/ponderpro/upvote)): `/guesswho` mode, paid, Discord only.
- **Manual version in chats** (snippet, [kf.social guide](https://kf.social/guides/chat/group-chat-games)): "Guess Who Sent It",
  one person collects answers by hand. That collecting step is what Penname automates.
- **Gas / NGL** (snippets, 2022): anonymous-social apps reached 3.2M downloads/month (Gas,
  [Appfigures](https://appfigures.com/resources/insights/20221111/5-gas-the-overnight-sensation-is-actually-making-money)) and
  15M+ installs (NGL, [TechCrunch](https://techcrunch.com/2022/07/11/anonymous-social-ngl-tops-15m-installs-2-4m-in-revenue-as-users-complain-about-being-scammed)).
  Different mechanic, same appetite for anonymous answers among friends.
- **Not found / not checked:** search volume (no Semrush/Ahrefs access), Reddit threads (searches returned none),
  Android-only and non-English apps. A 2026 daily-prompts-for-friends iOS app (Supp) got 0 Product Hunt upvotes: building it is not enough, the loop has to carry it.

## Our edge
- **Loop: needs others.** One person cannot play: guessing needs at least 3 answers.
- **K estimate ≈ 1.2** = 6 invites per creator × 60% join (one tap + nickname) × 30% of joiners start another group
  (people sit in several chats: family, work, friends). Weakest factor: joiner → creator. Designed for with a
  "Got another group? Start a new group" card on every group page and a "Share my result" text whose link goes to the landing page.
- **vs Circles:** works in any browser (Android + iPhone + desktop, and inside chat apps' in-app browsers), no install,
  no phone number, no account, free with no paywall.
- **Live link preview:** the group link's preview says "Today: “…question…” · 3 of 5 answered · 5 players so far".
- **Daily return reason:** new question at local midnight, weekly table, personal and group streaks, past rounds.

## Status
**Live: https://pb-who-said-it.pages.dev** · product/privacy/support page: https://janwan2003.github.io/who-said-it/ ·
Search Console: verified (META) and sitemap submitted 2026-11-21 (`scripts/gsc.py`).

What exists (Cloudflare Pages + Functions + D1 `pb-who-said-it`, free plan, no build step):
- Landing with create form (group name + nickname, browser time zone stored) → group page with invite link (native share sheet on phones, copy on desktop).
- Join from the link with a nickname (duplicates rejected, max 30). Personal link (`#k=token`) to sign in on another device; token hashed (SHA-256) in D1.
- Daily round per group per local day; 120 original prompts, same prompt for all groups, full cycle before repeating.
- States: answer (edit allowed until locked) → guess (auto when all members answered with ≥3 answers, or anyone who answered starts early) →
  reveal (auto when every answerer has guessed, or "Reveal now" by someone who has guessed). Answers carry random ids; the API sends no author until reveal.
- Guess UI: name chips per answer, each person used once (tapping a used name moves it), submit enabled when complete; shows "x / y matched" until reveal.
- Reveal: authors, everyone's guesses, awards (best detective, hardest to spot, ties shown), today's points, "Share my result" (🟩🟥 text).
- Weekly table (last 7 days), personal streaks, group streak badge (≥2 days), past rounds (last 14, members only).
- Settings: rename, copy personal link, leave, delete group (creator). Groups auto-deleted after 120 days idle.
- Rate limits per IP in D1: create 20/h, join 60/h, writes 600/h, reads 3000/h. CSP + security headers. `/g/<unknown>` returns 404.

Verified 2026-11-21:
- `pnpm test:unit`: 6/6 pass (time-zone day keys, prompt cycle, guess validation, scoring, streaks).
- `tests/e2e/run.mjs` in real Chromium, 5 browser contexts (Ann desktop 1280px, Ben/Cat/Dan/Ann's 2nd device phone 390px):
  **passes on local `wrangler pages dev` and on production** (last prod run on deploy fefd7714; the later deploy 46ad59de only shortened a placeholder).
  Covers create with empty-form validation, 3 joins + duplicate name, OG text "0 of 1" → "3 of 4", answers hidden from other players' API state,
  early start, late joiner locked out, guess state has no author fields, chip reassignment, auto reveal, correct authors, HTML shown as text,
  scores Ann 0 / Ben 3 / Cat 3, weekly table, share text, personal link on a new device (token stripped from URL), delete → 404, zero console errors.
  The test deletes its group; prod D1 counts afterwards: 0 groups, 0 members, 0 answers, 0 guesses.
- Past-rounds API checked locally with a seeded yesterday round: history listed, weekly points and streaks include it, 403 without a token, 403 for today before reveal.
- Rate limit checked locally: creates return 201 until 20 in the hour, then 429.
- Screenshots checked by eye: landing (desktop + phone), join, answered, guessing, reveal (phone + desktop). Fixed after review: tied awards, 1-day streak badge, cut-off placeholder.

Not covered: real iOS Safari / Android Chrome and WhatsApp/iMessage in-app browsers and preview rendering; per-group OG image (preview text is live, image is static);
midnight rollover with a round still in progress (logic: the old round is treated as finished, shown in Past rounds); load beyond a handful of users; languages other than English.

## Next steps
1. **Seed the first real groups** (the loop can't start from zero): operator plays it with one real group chat for a week (inbox request), and
   write `store/launch-posts.md` with honest posts for places that allow them (Product Hunt, r/WhatsApp-type game threads where rules permit, AlternativeTo as an alternative to Circles/Psych!).
2. Per-group OG image (PNG from the Function: question + "3 of 5 answered") so chat previews visibly change during the day.
3. Real-device QA in WhatsApp/Instagram/Messenger in-app browsers (localStorage persistence, share sheet) and fix what breaks.
4. Reminder hook without accounts: "Add to home screen" prompt + optional Web Push "today's question is up" (no email).
5. Question packs per group (family-friendly default, "work", "spicy-but-safe") and a custom question by the group creator.
6. Translations (PL, DE, ES) of UI and prompts.
7. Weekly `## Metrics` from D1: new groups (creators), new members (joiners), members with an answer in the last 7 days (active).

## Monetization plan
None until the operator enables it (charter rule 4). Later options: optional supporter tier with extra question packs and custom themes,
or a team/office version with Slack posting. Never paywall the daily round, group size or history.

## Metrics
- 2026-11-21: launched today. Prod D1: 0 groups / 0 members (after test cleanup; `wrangler d1 execute pb-who-said-it --remote`). Search Console: no data yet.

## Log
- 2026-11-20 (operator session): seeded as a priority-5 idea.
- 2026-11-21 builder: evidence check (Circles is the closest rival, iPhone-only + account + paid tier; no browser/no-login version found),
  then designed, built, deployed and published **Penname** (Pages + Functions + D1, all `pb-who-said-it`), GitHub repo + Pages product/privacy page,
  Search Console verified + sitemap. Unit 6/6; Playwright e2e (4 players + second device) passes locally and on production. Stage → launched.
