# KubeLearn

Every layer, from packet to pod. An interactive explainer that plays out what a Kubernetes cluster actually does, event by event: API calls, etcd writes, watch notifications, container runtime calls and real packets, each one decoded field by field.

Live at https://kubelearn.joesabbagh.com

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest + jsdom
npm run typecheck
npm run build      # static site in dist/, one HTML file per page
```

## How it's put together

| Path | What |
|---|---|
| `src/data/lessons/*.ts` | One file per lesson: steps, the events in each step, timing spans, summary. Adding a lesson means writing one of these. |
| `src/data/types.ts` | The lesson format. |
| `src/scene/world.ts` | Every actor in the diagram, at three zoom levels (cluster, inside a node, inside a Pod), with positions, links and descriptions. |
| `src/scene/camera.ts` | The stage camera: the auto-framing the lesson drives, plus hand-steering — scroll to zoom at the cursor, drag or pinch to pan, +/− keys and buttons, Reset view. |
| `src/iso/iso.ts` | Isometric drawing helpers that produce the SVG icons. |
| `src/playback.ts`, `src/hooks.ts`, `src/store.ts` | Playback: the lesson timeline, the driver that launches and lands each event, and app state (Zustand). |
| `src/components/` | The homepage, the Lessons page (search and category filter), the header breadcrumb, the diagram with its playback controls, the sequence view, the story column, and the events drawer with decoder and timing. |
| `src/route.ts`, `src/meta.ts` | Which page an address is, and that page's title, description and share tags. |
| `src/prerender.tsx`, `scripts/prerender.mjs` | Writes every page as its own HTML file after the build. |
| `src/data/text.ts` | Turns the lessons' capitalized titles into sentence case for display. |
| `design/style-tile.html` | The approved visual identity. |

Interactive controls come from [UI SDK](https://ui-sdk.dev) (`@ui-sdk/react`, pinned beta). Its agent skill lives in `.claude/skills/ui-sdk`.

## Writing a lesson

Each step has a `view` (which zoom level), a `focus` (the actors the camera frames) and `events`. Each event can have a `path: [from, to]` of actor ids on that level; the same id twice makes the marker pulse on one actor instead of travelling. The control plane is a group (`GROUPS` in `world.ts`): a lesson's `actors` says `"cp"` to put all of it on screen, while `focus` and `path` name the component: `api`, `sched`, `kcm` (controller manager) or `etcd`. `npm test` checks that every id exists on the right level, that event times never go backwards, and that each lesson has a summary and timing.

Links like `/request-finds-pod/5` open a lesson on a given step; `/rolling-update/summary` opens its summary; `/lessons` is the lesson list and `/` the homepage. `npm run build` writes each of these as its own HTML file, so the host needs no fallback: serve `/rolling-update` from `rolling-update.html`, and `404.html` for anything else (`wrangler.jsonc` already does).

`seo` is the lesson's search result: a title people would search for, and a description. `npm test` checks their lengths.

## Search engines

`scripts/prerender.mjs` runs at the end of the build. It renders every page (`src/prerender.tsx`) with its own title, description, canonical address, share tags and structured data (`src/meta.ts`), and writes `sitemap.xml`. A lesson's steps and summary name the lesson as their canonical address, since its overview holds the whole lesson as text.

## Analytics

Production builds include the cookieless [Cloudflare Web Analytics](https://developers.cloudflare.com/web-analytics/) beacon when `VITE_CF_BEACON_TOKEN` is set in `.env.production`. The token is public, since it ships in the page. Without it, and in `npm run dev`, no beacon is added.

## Contributing

New lessons, fixes and corrections are welcome from anyone. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to set up, what to check and how to open a pull request. If you spot something technically wrong in a lesson, an [issue](https://github.com/joesabbagh1/kubelearn/issues/new) is just as helpful.

## License

MIT, see [LICENSE](LICENSE).
