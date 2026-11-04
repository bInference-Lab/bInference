# 0360. The docs site builds with Starlight as a workspace app in pnpm check

Status: Accepted

Accepted by the tech lead on 2026-11-04.

## Context

ENGINEERING.md section 24.5 names Starlight for the docs site, rendering the Markdown in
`apps/docs/` in English and Chinese. Until now `apps/docs/` held only Markdown: nothing built it,
so a page with broken front matter or a broken table reached `master` unseen. `check:docs` checks
only that each page has its twin.

Facts that bound the choice:

- Astro 7.4.4 and Starlight 0.42.7, the newest releases at least 7 days old, add 193 packages to
  the lockfile. None reaches a published package: the site is a dev-only app.
- On an Apple silicon laptop with 18 cores the site builds in about 1.2 s with its search index,
  and turbo replays it from its cache in about 30 ms when its inputs did not change.
- Astro sends usage telemetry by default unless `ASTRO_TELEMETRY_DISABLED` is set.
- Starlight takes a sidebar group's Chinese label from its config, and `check:style` refuses
  Chinese text outside zh files.

## Decision

- `apps/*` joins the pnpm workspace. `apps/docs` is the private package `@binference/docs`, with
  Astro and Starlight from the catalog.
- Its `build` script runs `astro build` with telemetry off through Node's `--env-file=build.env`,
  so it works the same on Linux, macOS and Windows. Turbo's `build` task runs it, so `pnpm check`
  builds the site; `apps/docs/turbo.json` names its inputs and its `dist/` output.
- English sits at the content root and Chinese under `zh-cn/`, as `check:docs` expects. The
  site's own words (the language names and the sidebar groups) live in the i18n `docs` area,
  which `astro.config.mjs` reads from the message files.
- Nothing deploys the site yet; its hosting is the owner's input.

## Consequences

- `pnpm check` fails on a page Starlight cannot build. The site build adds about 1.2 s to a cold
  run and nothing to a cached one.
- The install grows by 193 dev packages, which Renovate updates with the rest.
- A new page needs only its Markdown in both languages; a new sidebar group needs its words in
  the `docs` area.

## Alternatives

- Building the site only in a CI job of its own: a broken page would land on `master` and fail
  later, and CI runs only on pushes to `master`.
- Another site generator: section 24.5 names Starlight, and it ships search and locales.
- Labels written in `astro.config.mjs`: Chinese there breaks `check:style`, and the words would
  live outside the catalogs every other word lives in.
