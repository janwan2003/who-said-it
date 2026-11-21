# Penname (who-said-it)

The daily "who said it?" game for group chats. One question a day; everyone answers anonymously, then guesses who wrote what.

- Live: https://pb-who-said-it.pages.dev
- Product page: https://janwan2003.github.io/who-said-it/

Stack: Cloudflare Pages (static `public/`) + Pages Functions (`functions/`) + D1 (`pb-who-said-it`, schema in `schema.sql`). No build step.

```
pnpm install
npx wrangler d1 execute pb-who-said-it --local --file schema.sql
pnpm dev                                   # http://127.0.0.1:8817
pnpm test:unit
BASE=http://127.0.0.1:8817 pnpm test:e2e   # 4 browsers play a full round; screenshots in shots/
node tools/render-images.mjs               # og.png + icons
```
