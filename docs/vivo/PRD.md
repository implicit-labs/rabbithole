# Vivo × Rabbithole — PRD

Fork of `shlokkhemani/rabbithole` (MIT) → `implicit-labs/rabbithole`. Upstream
remote is wired; our work lives on the `vivo` branch so `main` stays cleanly
rebasable. Vivo-specific code goes in `src/web/vivo/` + `src/core` extensions
per the repo's purity rules (core imports nothing environmental; hosts own I/O).

## Thesis

Rabbithole becomes the exploration surface for Vivo: a transcript is a new way
to start a rabbithole, atomic units are a typed kind of follow-up node, and
"produce nodes" is an action any document supports. The canvas is also where
figures get generated. Everything is auth-gated by the Vivo surface ticket.

The acceptance scenario (fixture: `docs/vivo/fixtures/funnel-engineering-convo.md`):
start from one idea nugget → branch through exploration → end with a visual
exploration + a final written piece + a set of Linear issues.

## Ground truth from recon (what we build on)

- **Ingress is three calls**: `runtime.createHoleFromMarkdown({title, markdown})`
  → `store.saveHole` → `startHole`. New composer path modeled on
  `src/web/ingest/url.js`. Hole ids must match the whimsical pattern; external
  ids live in `node.extensions.vivo` (free-form namespaced bag, round-trips
  storage + portable format; snapshots strip it unless allowlisted).
- **Providers are OpenAI-compatible presets** (`provider-registry.js`); a
  custom HTTPS endpoint works with zero code changes if it serves
  `GET /v1/models` + streaming `POST /v1/chat/completions`.
- **Programmatic typed nodes**: `branch_request` + `node_answered` dispatched
  host-side (a method on `DirectRabbitholeHost`) — the UI receives them like
  streamed answers. Anchors are rendered-DOM text offsets (or durable block
  anchors); evidence quotes are exact substrings of the transcript, so anchors
  are computable.
- **Figures already exist**: `mermaid` and sanitized-SVG/HTML `show` fences,
  KaTeX, images, per-type shadow-root mounts (`registerBlockType` +
  `registerBlockMount`). No freehand drawing yet.
- **No auth exists**; the gate point is `boot()` in `src/web/app.js`. Per-user
  isolation is `new IdbStore({dbName})` + namespaced localStorage keys.
- **House rules**: committed byte-verified `dist/`, purity + UI-architecture
  checks, 300-line cap in `src/ui/canvas/*`, snapshot/portable contracts,
  reducer goldens, node:test tiers + Playwright e2e harness with provider mock.

## Phases

### Phase 0 — Fork foundation ✅
Fork, clone, upstream remote, `npm install`/build/tests green (Playwright
browsers installed), fixture committed.

### Phase 1 — Auth gate (step 2)
- `src/web/vivo/auth.js`: minimal Supabase password sign-in against the Vivo
  web API (`/api/auth/supabase/config` → token grant → `/api/auth/supabase`
  ticket exchange), sessionStorage-held session, mirroring the app's
  `BrowserSupabaseAuth` contract.
- `requireVivoSession()` inserted in `boot()` before `renderShell()`; renders a
  sign-in shell on failure. Vanilla (un-configured) builds keep upstream
  behavior so the fork stays testable and rebasing stays honest.
- Per-user storage: `new IdbStore({dbName: rabbithole-vivo-<userId>})`,
  namespaced `rh-*` localStorage keys.
- Config: `VIVO_BASE_URL` baked at build; CSP `connect-src` already allows https.

### Phase 2 — Vivo ingress + voice memos (step 3)
- `src/web/ingest/vivo.js`: list sessions via `GET /api/debug/transcripts`
  (ticket auth), pick one → hole with the transcript as root document; capture
  id + unit metadata stashed in `extensions.vivo` on the root.
- New composer path "Vivo" in `shell.js`/`app.js` alongside ask/file/paste/url.
- Voice memos v1: the composer's Vivo path links to the existing staging
  `/vivo` voice surface (live transcription → capture) and offers refresh;
  embedding a recorder in-canvas is a later phase.

### Phase 3 — Produce nodes (step 4)
- Host method `produceVivoNodes(holeId)` on the direct host: for transcript
  holes, fan persisted atomic units out as typed child nodes — no model call —
  each anchored to its verbatim evidence in the rendered root; for arbitrary
  documents/writing, call a new authed extraction endpoint on the Vivo server
  (text → the same two-pass pipeline) and fan out identically.
- Node typing via `extensions.vivo = {type: fact|task|idea|question, unit_id,
  capture_id}`; card chrome classes in `src/ui/canvas/card.js` + CSS; the
  snapshot allowlist gains the `vivo` namespace (with contract-test updates).
- Card actions: idea nodes get "Send to Linear" (existing Vivo endpoint;
  server's idea-only rule unchanged); units get review state sync.
- Server side (dogfooding-memory): `POST /api/extract` running the evaluated
  extraction components over submitted text, behind the same ticket + flag.

### Phase 4 — Figures & visual exploration (step 5 + figure generation)
- "Generate figure" lens/preset (`ASK_PRESET_KEYS` + prompt) instructing
  answers as `mermaid` or sanitized-SVG `show` blocks — model-generated
  figures render natively today.
- Freeform draw (the miro-like ask): add a `draw` block type via
  `registerBlockType`/`registerBlockMount` hosting a lightweight MIT stroke
  editor (`perfect-freehand`-based, SVG persisted in the fence) rather than
  embedding a heavy React whiteboard; re-evaluate a tldraw/Excalidraw embed
  only if strokes prove insufficient. (Decision D2.)
- Figures exportable: mermaid/SVG blocks already survive snapshots.

### Phase 5 — Branching, stellar (step 6)
- Extend the existing `web-app-branching` e2e suite with vivo scenarios:
  produce-nodes fan-out, typed-node marks painting and surviving re-render,
  follow-ups from unit nodes, figure-lens branches.
- Perf: respect `test/budgets.json`; fan-out batches must not blow the
  canvas budget on a 20-unit transcript.

### Phase 6 — Design pass (step 7)
- A full design run over the vivo surfaces (sign-in shell, composer path,
  typed cards, bins-equivalent affordances) honoring the repo's design gates
  (`check:design`, generated design doc, biome, icon pipeline).

### Phase 7 — Acceptance: funnel engineering end-to-end (step 8)
Scripted + manual run against the fixture:
1. Ingest the fixture (as pasted writing and as a Vivo transcript).
2. Produce nodes → typed unit cards anchored in the text.
3. Branch: explorations off the "funnel engineering as business intelligence"
   nugget (constraint-finding, experiment contract, three funnel variants).
4. Figures: the general/consumer/ecom funnels as generated mermaid + one
   `draw` annotation pass.
5. Final written piece: a synthesized article node.
6. Linear: a set of issues created from idea nodes to start the project.
Deliverables checked in as a `.rabbithole` portable artifact + snapshot.

## Decisions

- **D1 — Where server code lives**: all pipeline/API work stays in
  `dogfooding-memory` (eval-first rules apply there); this fork only consumes
  authed HTTP. The two-plane boundary is untouched.
- **D2 — Drawing engine**: custom `draw` block (perfect-freehand, MIT) first;
  tldraw/Excalidraw embed only on demonstrated need.
- **D3 — Hosting**: any static host works (auth is a client-side ticket
  exchange). Ship v1 wherever is cheapest next to staging; revisit
  Cloudflare Pages + fetch-proxy allowlist when URL ingestion of Vivo hosts
  is needed.
- **D4 — Upstream etiquette**: tell Shlok about the fork; keep vivo code
  additive and isolated; upstream generic pieces (e.g. "produce nodes from a
  document" host seam, figure lens) if he wants them.

## Risks

- Anchor drift: rendered-text offsets break if the root document is edited —
  prefer block anchors where possible; accept mark loss otherwise (upstream
  behavior).
- Snapshot/portable contracts: every `extensions.vivo` surface needs the
  corresponding contract tests updated, or exports silently strip our data.
- Fork drift: upstream moves fast; rebase `main` weekly, keep `vivo` diffs
  small and additive.
