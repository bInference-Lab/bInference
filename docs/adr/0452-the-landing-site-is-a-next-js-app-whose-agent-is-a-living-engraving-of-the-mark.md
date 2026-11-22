# 0452. The landing site is a Next.js app whose agent is a living engraving of the mark

Status: Accepted

Accepted by the owner on 2026-11-22.

## Context

binference has no page of its own: the README and the docs site explain it, but nothing shows
what the agent is to someone who has never run it. The owner asked for a landing page that
people talk about, with Apple's product pages as the bar for motion and finish, and that looks
nothing like the main bInference site.

The owner reviewed seven HTML concepts and chose one: the page waits for a tap, as the agent
does, and the agent is the main character, drawn from the logo, in a dark theme. A first agent
drawn as polished 3D gold was refused. The agent stays a figure of fine gold lines, the way the
brand's engraved art is drawn.

Facts that bound the choice:

- Next.js 16.4.6, the newest release at least 7 days old, adds 26 packages to the lockfile. None
  reaches a published package: the site is a private workspace app.
- On an Apple silicon laptop with 18 cores the site builds in about 0.3 s once its cache is warm,
  and prerenders both languages as static HTML. Its JavaScript is about 180 KB gzipped in all.
- Next.js sends usage telemetry by default unless `NEXT_TELEMETRY_DISABLED` is set, and `next dev`
  refuses Node's `--env-file` flag in the workers it starts.
- Next.js finds a page, a layout and its config by their default export, which the lint rules
  refuse elsewhere.
- Every word a person sees lives in the i18n catalogs, in English and Chinese, and `check:style`
  refuses Chinese text outside zh files.

## Decision

- `apps/web` is the private package `@binference/web`, a Next.js app with the App Router. English
  is served at `/` and Chinese at `/zh`, each its own root layout with its own `lang`.
- Every page is prerendered at build time. The source shown behind "Read me" is read from the
  engine's files during the build, so it is always the code that ships.
- Its words live in the i18n `web` area, formatted with ICU tags for bold, the gold full stop and
  the light second line. `check:i18n` and the glossary cover them.
- The agent is one canvas over the page: the mark traced as rows of gold lines whose weight
  follows a light that tracks what the agent looks at, with a dial, a needle and a core inside.
  Its behavior (where it stands, what it looks at, its needle, its blink, its color) is a pure
  step function with tests; sections place slots and give it short orders.
- A reader who prefers reduced motion gets every scene at rest and no blinking.
- Its scripts run Next.js through `next-run.mjs`, which sets `NEXT_TELEMETRY_DISABLED` first, so
  they work the same on Linux, macOS and Windows. Turbo's `build` task builds it in `pnpm check`;
  `apps/web/turbo.json` names its inputs, the engine files it shows among them.
- `pnpm typecheck` checks it with TypeScript 7 and the repo's strict settings, so its build skips
  Next.js's own type check. Its tests run in the vitest project `web`.
- The lint rules allow a default export only in its pages, layouts and config, and an unassigned
  import only for its global stylesheet.
- Nothing deploys the site yet; its hosting on Vercel is the owner's input.

## Consequences

- `pnpm check` builds the site in both languages and fails on a page that does not render.
- A change to the four engine files the wall shows rebuilds the site.
- The install grows by 26 packages, which Renovate updates with the rest.
- A new section needs its words in the `web` area in both languages and, if the agent stands in
  it, a slot.

## Alternatives

- Astro, which builds the docs site: it ships less JavaScript, but the scenes that react to the
  reader (the gate, the tools, the demo, the trust diagram) would be hand-wired scripts, and the
  owner chose Next.js on Vercel.
- The agent as a 3D render: refused by the owner as gold that looks fake.
- A plain HTML page outside the workspace: its words would escape the catalogs and its code every
  check.
