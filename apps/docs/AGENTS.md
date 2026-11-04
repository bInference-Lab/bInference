# @binference/docs

The docs site: the guides in English and Simplified Chinese, rendered by Starlight.

The root [AGENTS.md](../../AGENTS.md) applies here. Rules for this folder:

- English pages sit under `src/content/docs/`, and each has its Chinese twin at the same path
  under `src/content/docs/zh-cn/`. `pnpm check:docs` fails a page without its twin.
- A page opens with front matter that holds its `title` and `description`, and has no `#` heading
  of its own: Starlight shows the title.
- `reference/` and `zh-cn/reference/` hold only the pages `pnpm docs:gen` generates from the code:
  the commands, the config keys, the notices, the engine operations and the tools (decision 0361).
  Never edit them; change the code and run `pnpm docs:gen`. `pnpm check:references` fails a page
  behind the code and a file no code generates. A page of your own goes under `guides/`.
- Every word on a generated page has its English and Chinese message: a config key's text in the
  i18n `configKeys` area, whose English catalog `pnpm docs:gen` writes from the schema and whose
  Chinese one is written by hand, and a tool's one-line summary in the `docs` area.
  `pnpm check:references` fails one that is missing.
- The site's own words (the language names and sidebar groups) live in
  `packages/i18n/messages/{en,zh}/docs.json`, which `astro.config.mjs` reads.
- `astro.config.mjs` lists each guide by its slug in a sidebar group, and the home page links it in
  both languages: a new guide joins both.
- A guide says what the code does today, never what is planned, and links to the generated
  references instead of copying them.
- `pnpm build` builds the site into `dist/`, with Astro's telemetry off (`build.env`). It runs in
  `pnpm check` as the package's `build` task.
