# @binference/web

The agent's landing site: the agent as a living engraving of the mark, in English at `/` and
Simplified Chinese at `/zh`, built with Next.js ([decision 0452](../../docs/DECISIONS.md#d0452)).

The root [AGENTS.md](../../AGENTS.md) applies here. Rules for this folder:

- Every page is prerendered: no server code runs at request time. The source behind "Read me" is
  read from the engine's files at build time (`src/sections/source-files.ts`); a file it names is
  also an input of the build in `turbo.json`.
- Every word a person sees lives in `packages/i18n/messages/{en,zh}/web.json` and is formatted on
  the server by `src/words/words.tsx`, with the tags `b`, `light`, `gold`, `br` and `dot`. Client
  components get their words as props, never import the catalogs.
- The look is the bInference brand, dark and flat: ink and gold, Hanken Grotesk, thin lines, no
  shadows or gradients except the masks that fade a scene's edges. It must not look like the main
  bInference site.
- The agent is one canvas (`src/agent/agent-stage.tsx`). Its behavior is the pure step in
  `agent-motion.ts`, its figure the relief in `relief.ts` over the mark in `mark-field.ts`, and
  its drawing `draw-agent.ts`; a change to any of them changes its test. A section places an
  `AgentSlot` where the agent stands and may give it a short order through `useAgent()`; an order
  ends when the agent moves to another slot.
- Scroll scenes read their progress as `--p` from `Scene` (`src/motion/scene.tsx`), which one loop
  in `scene-loop.ts` eases for every scene. Motion lives in CSS on `--p`, not in JavaScript per
  frame, and every scene rests when the reader prefers reduced motion.
- Next.js finds pages, layouts, the metadata files (`opengraph-image.tsx`, `robots.ts`,
  `sitemap.ts`) and `next.config.ts` by their default export, the one place it is allowed.
  `pnpm typecheck` checks the app; its build does not.
- The link picture is drawn at build time from the same relief as the live agent
  (`src/agent/agent-figure.ts`). Whole addresses come from `siteUrl()`, which reads Vercel's
  production domain, so the site needs no address of its own in the code.
- `pnpm --filter @binference/web dev` serves it on port 4819 with Next.js telemetry off
  (`next-run.mjs`). `pnpm build` builds it with the rest; run it through `heavy` on the owner's
  laptop.
