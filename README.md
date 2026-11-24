# K8s Simplified

Every layer, from packet to pod. An interactive explainer that plays out what a Kubernetes cluster actually does, event by event: API calls, etcd writes, watch notifications, container runtime calls and real packets, each one decoded field by field.

Live at https://kubelearn.joesabbagh.com

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest + jsdom
npm run typecheck
npm run build      # static site in dist/
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
| `src/data/text.ts` | Turns the lessons' capitalized titles into sentence case for display. |
| `design/style-tile.html` | The approved visual identity. |

Interactive controls come from [UI SDK](https://ui-sdk.dev) (`@ui-sdk/react`, pinned beta). Its agent skill lives in `.claude/skills/ui-sdk`.

## Writing a lesson

Each step has a `view` (which zoom level), a `focus` (the actors the camera frames) and `events`. Each event can have a `path: [from, to]` of actor ids on that level; the same id twice makes the marker pulse on one actor instead of travelling. `npm test` checks that every id exists on the right level, that event times never go backwards, and that each lesson has a summary and timing.

Links like `/request-finds-pod/5` open a lesson on a given step; `/rolling-update/summary` opens its summary; `/lessons` is the lesson list and `/` the homepage. The host must serve `index.html` for every path (`wrangler.jsonc` already does).

## Analytics

Production builds include the cookieless [Cloudflare Web Analytics](https://developers.cloudflare.com/web-analytics/) beacon when `VITE_CF_BEACON_TOKEN` is set in `.env.production`. The token is public, since it ships in the page. Without it, and in `npm run dev`, no beacon is added.

## Contributing

New lessons, fixes and corrections are welcome. Fork the repo, add or edit a file in `src/data/lessons/` (see "Writing a lesson" above), make sure `npm test` and `npm run typecheck` pass, and open a pull request. If you spot something technically wrong in a lesson, an issue is just as helpful.

## License

MIT, see [LICENSE](LICENSE).
