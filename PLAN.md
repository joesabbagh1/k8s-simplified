# KubeLearn · plan

Every layer, from packet to pod. An interactive explainer for developers who use Kubernetes but have never seen inside it.

## Status

| Area | What | Status |
|---|---|---|
| 1 | Concept and structure | Approved |
| 2 | Visual identity | Approved (`design/style-tile.html`) |
| 3 | App shell | Done |
| 4 | Cluster diagram: camera, zoom levels (cluster → node → Pod, plus a service mesh with and without sidecars, the stops a write makes inside the API server, and a node as Falco watches it), click to drill in; hand-steered camera: wheel zoom at the cursor, drag/pinch to pan, +/− and Reset view | Done |
| 5 | Playback: markers along links, events land one by one, summary. Reading pauses sized to the text, then it moves on by itself; Pause after Event / Step / None (None by default: plays straight through); a › button in the caption skips a pause; speed-up (1×/2×/4×); zoom transitions into and out of nodes and Pods | Done |
| 6 | Decoder: fields, changed values, packet frame diagrams (incl. VXLAN) | Done |
| 7 | Sequence view | Done |
| 8 | Lessons | All 28 written; technical accuracy pass done 2026-11-23, before "Service mesh with Istio", "Kyverno policies" and "Runtime alerts with Falco" were added |
| 9 | Stack | Done |
| 10 | Polish: deep links, bundle split, a11y, tests | Done, except deploying |
| 11 | Minimal layout: diagram first, one story column, events in a drawer, quieter type | Done |
| 12 | Homepage at `/` (the logo links to it) and a Lessons page at `/lessons` | Done |

## Next

- Launched: https://kubelearn.joesabbagh.com (Cloudflare Workers static assets; `npm run deploy` typechecks, builds and ships).

## Area 1 · Concept (approved)

- Layout (revised in Area 11): diagram with Cluster/Sequence (left, most of the screen), story column with Overview/Step/Summary and the step list (right), events drawer with Events/Timing (bottom, closed until asked for). Lessons are picked on the Lessons page (`/lessons`, linked from the header), grouped Network · Node · Control plane · App · Security.
- The same demo cluster everywhere: you 192.168.1.10; control plane 10.0.0.10:6443; node-1 10.0.1.11 and node-2 10.0.1.12 (Pods 10.244.1.0/24 and 10.244.2.0/24); load balancer 203.0.113.50; app `web`, 3 replicas, Service 10.96.120.15:80 → 8080, NodePort 30080.
- Copy: plain sentences, real names and values, no analogies that break; each step says who acts, what they send and what changes.

## Area 2 · Visual identity (approved)

Inter for text, JetBrains Mono for values (IPs, fields, commands, the event table, diagram labels); capitals only for kickers and table headers (changed in Area 11, was all mono and mostly uppercase). Kubernetes blue `#326CE5`, dark and light themes, isometric line art drawn in code, layer colors API blue / STATE teal / CONTROL amber / NODE violet / NETWORK green / DROP red. Pods on nodes: grey for other apps, blue for v1, green for v2.

## Area 9 · Stack

Vite, React 19, TypeScript, UI SDK (`@ui-sdk/react` 0.1.0-beta.13, pinned), Zustand, Tailwind v4 with tokens in `src/index.css`, Vitest + jsdom. React and UI SDK ship as separate cached chunks.

## Area 11 · Minimal layout (done)

- At 1440×900 the diagram went from about 30% of the screen to about 65%.
- Lesson list → a Lessons page at `/lessons`, linked from the header breadcrumb (KubeLearn / Lessons / current lesson). It has a search over lesson titles, subtitles and step titles (matching steps link straight to that step) and a category filter (All · Network · Node · Control plane · App · Security, with counts). Lesson shortcuts are off there. The search and filter are kept while you're in a lesson, so Back returns to the same list. (Replaced the ⌘K dropdown palette; there is no ⌘K shortcut any more.)
- Event flow → a drawer under the diagram, closed by default; E, the bar, or a caption's event badge opens it. The decoder appears only once an event is selected. Table columns: No. · From → to · Info · Size.
- Each thing is said once: the step lives in the story column (with the step list under it); the caption narrates events; the zoom breadcrumb shows only inside a node or Pod.
- Transport: Previous · Play/Next · settings popover (Pause after: Never/Step/Event, Speed 1×/2×/4×, Restart), centered under the diagram.
- Header: no tagline, 52px; theme is one button; fullscreen moved into the shortcuts dialog and F. Removed: the L shortcut, the sidebar and diagram-only buttons (D still works).
- Panel titles and boxes gone: one surface with hairline dividers.
- Lesson data still writes titles in capitals; `src/data/text.ts` turns them into sentence case and keeps acronyms (DNS, VXLAN) and kinds (Pod, ConfigMap).

## Area 12 · Homepage and Lessons page (done)

- `/` is the homepage; the logo links to it. Hero: headline, one-paragraph pitch, "Start the first lesson" (Deploy an app) and "Browse all 28 lessons". Beside it, the cluster view's own isometric art with colored packets looping along the links (API, STATE, CONTROL, NODE, NETWORK), and the layer legend under it. No motion with reduced-motion on.
- Below: "How a lesson works" (watch, read, decode), every lesson under its category, and the demo cluster's addresses. The categories are an exploded stack of the Lessons page's floors (`LayerArt.tsx`), app at the top and network at the bottom, with security set apart below; each floor's name and drawing link to the Lessons page filtered to it.
- `/lessons`: see Area 11. Each category is led by its piece of the cluster (`LayerArt.tsx`) with its lessons as a two-column list beside it; the art is hidden during a search.

## Routing

Clean paths, not `#` addresses: `/`, `/lessons`, `/deploy-an-app`, `/deploy-an-app/5`, `/deploy-an-app/summary`. `src/route.ts` reads and pushes them, and `Link` in `src/components/Link.tsx` moves without a reload. The build writes every page as its own HTML file (`scripts/prerender.mjs`), and any other address gets `404.html` with a 404 status (`not_found_handling: "404-page"` in `wrangler.jsonc`). Old `/#/deploy-an-app/5` links still open and are rewritten to the path.

## Search engines

Every page is prerendered with its own title, description, canonical address, share tags and structured data (`src/meta.ts`); `sitemap.xml` lists the homepage, the Lessons page and the lessons. A lesson's steps and summary are canonical to the lesson, whose overview holds the whole lesson as text. The site was renamed from K8s Simplified to KubeLearn on 2026-11-24.
