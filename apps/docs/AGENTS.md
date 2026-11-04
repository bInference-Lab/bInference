# @binference/docs

The docs site: the guides in English and Simplified Chinese, rendered by Starlight.

The root [AGENTS.md](../../AGENTS.md) applies here. Rules for this folder:

- English pages sit under `src/content/docs/`, and each has its Chinese twin at the same path
  under `src/content/docs/zh-cn/`. `pnpm check:docs` fails a page without its twin.
- A page opens with front matter that holds its `title` and `description`, and has no `#` heading
  of its own: Starlight shows the title.
- The site's own words (the language names and sidebar groups) live in
  `packages/i18n/messages/{en,zh}/docs.json`, which `astro.config.mjs` reads.
- `pnpm build` builds the site into `dist/`, with Astro's telemetry off (`build.env`). It runs in
  `pnpm check` as the package's `build` task.
