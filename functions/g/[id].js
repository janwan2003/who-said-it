// Serves the group page with a live link preview: group name, today's question and how many have answered.
import { PROMPTS, promptIndexFor } from '../_prompts.js';
import { dayKey } from '../_game.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function onRequestGet({ request, env, params }) {
  const url = new URL(request.url);
  const page = await env.ASSETS.fetch(new URL('/g', url.origin));
  let html = await page.text();
  let title = 'Join my group on Penname';
  let status = 200;
  let desc = 'One question a day. Everyone answers anonymously, then you guess who said what. No app, no sign-up.';
  try {
    const id = String(params.id || '');
    const g = /^[A-Za-z0-9]{6,16}$/.test(id) && await env.DB.prepare('SELECT id, name, tz FROM groups WHERE id = ?1').bind(id).first();
    if (g) {
      const day = dayKey(g.tz);
      const row = await env.DB.prepare(
        `SELECT (SELECT COUNT(*) FROM members WHERE group_id = ?1 AND left_at IS NULL) AS members,
                (SELECT COUNT(*) FROM answers WHERE group_id = ?1 AND day = ?2) AS answered`
      ).bind(g.id, day).first();
      const q = PROMPTS[promptIndexFor(day)];
      title = `${g.name} · Penname`;
      const people = row.members === 1 ? '1 player so far' : `${row.members} players so far`;
      desc = `Today: “${q}” · ${row.answered} of ${row.members} answered · ${people}. Answer anonymously, then guess who said what.`;
    } else if (id) {
      title = 'Penname · group not found';
      status = 404;
    }
  } catch (e) {
    console.error(e);
  }
  const og = `${url.origin}/og.png`;
  const meta = `<title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Penname">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:image" content="${og}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:url" content="${esc(url.origin + url.pathname)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="robots" content="noindex">`;
  html = html.replace('<!--META-->', meta);
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
