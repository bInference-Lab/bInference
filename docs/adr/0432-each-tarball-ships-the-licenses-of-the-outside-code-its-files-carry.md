# 0432. Each tarball ships the licenses of the outside code its files carry

Status: Accepted

Accepted by the tech lead on 2026-11-13.

## Context

[Decision 0352](0352-each-npm-package-carries-the-workspace-packages-it-needs-inside-its-tarball.md)
puts the workspace packages inside the four published tarballs, and npm installs every outside
package they name as a dependency, each with its own license file. Some built files hold outside
code all the same. The runtime process and its store worker, the signer process and the plugin
host's programs bundle every dependency, since each runs with access to its own file only or to no
file at all. The console's build holds React and the rest of its page. A plain tsdown build inlines
an outside package its manifest does not name as a dependency, such as viem in the CLI's
`dist/main.mjs` and fast-check in the engine's testing entry. A build on 2026-11-13 put copies of
61 outside packages inside the `binference` tarball's files, `openai` and `@anthropic-ai/sdk`
among them; the other three tarballs carry none.

An inlined copy has no license file of its own, and `NOTICES.md` covers only copied source, logos
and fonts. MIT, ISC, the BSD licenses and Apache-2.0 each ask that their notice ship with every
copy, and Apache-2.0 also asks for the text of the package's NOTICE file when it has one.

Facts that bound the choice:

- tsdown and Vite both build with rolldown and run its plugins. Once a build is written, rolldown
  names each chunk's modules (`moduleIds`) and each asset's source files (`originalFileNames`).
- The comments rolldown writes before each module of an unminified file changed form between
  rolldown 1.2.11 and 1.2.15, and a minified file, such as the console's, has none.
- tsdown looks for `tsdown.config.*` from a package's folder up, so a file at the repository's root
  serves every package that has no config of its own. Node loads that config itself, and it runs no
  TypeScript it imports by a `.js` name.
- One bundled package, standardwebhooks 1.0.0 (a dependency of `@anthropic-ai/sdk`), names MIT in
  its `package.json` and ships no license file. Its repository keeps the text in
  `libraries/LICENSE`.

## Decision

- **Each build records what it bundles.** A rolldown plugin, `config/build/bundle-record.mjs`, runs
  in every build of a file the release packs: tsdown's, through the root `tsdown.config.ts` and the
  configs of the runtime, the signer and the plugin host, and the console's two Vite builds. Once a
  build has written its files, it writes `bundle-record/<first entry>.json` in the package's
  folder: each file the build wrote, with the paths of the outside modules inside each chunk and
  of the outside files each asset copies. The folder is ignored by git, emptied with `dist`, and an
  output of turbo's `build`, whose inputs now name the bundler configs. A package's build config may
  import `config/build/` by its path; it still may not import another package that way.
- **The release reads the records.** When it stages a published package, `pnpm release:dry` lists
  each file of code the tarball holds, in the package's own copy and in each workspace package
  inside it: JavaScript, declarations, stylesheets, HTML and WebAssembly. Each must be in exactly
  one record of its package. A file in none could hold anything, so the release refuses it rather
  than read it as empty. The packages bundled are the folders after the last `node_modules/` of
  each path those records name, each name and version once.
- **The file.** A tarball whose files carry outside code holds `BUNDLED-LICENSES.md` at its root,
  listed in its manifest's `files`: each package once, by name and version, with the license its
  `package.json` names and its license and notice files (`LICENSE*`, `LICENCE*`, `COPYING*`,
  `NOTICE*`) in full. The pack refuses a tarball that lacks it. The name says what the file holds,
  and like `LICENSE` and `NOTICES.md` it is in capitals at the root, where people and tools look.
  `NOTICES.md` stays the notices people write for the repository; this one is written at each pack
  from what that tarball carries.
- **The allowed licenses.** `config/release/allowed-licenses.txt` is the one list: 0BSD,
  Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC and MIT, which ask only for their notice with each
  copy; Unlicense, a public-domain dedication that asks for nothing (fast-sha256); and OFL-1.1, the
  console's typeface's license, which binds only the font files and lets them ship with any
  software (`@fontsource-variable/hanken-grotesk`). No copyleft license goes on it. An expression of
  ids joined by `OR` passes when one of them is listed, and one joined by `AND` when each is; any
  other expression, such as one with `WITH`, nested parentheses or `SEE LICENSE IN`, is refused.
- **A package that ships no license.** The repository keeps its license from the package's own
  repository as `config/release/licenses/<name>@<version>.txt`, a scope's `/` written as `+`, and
  the file ships that text in its place. The first is standardwebhooks 1.0.0, from its repository's
  `libraries/LICENSE` (MIT, Svix).
- **Refusals.** The dry run, a nightly pack too, stops before it packs, naming the tarball and each
  package: a file of code in no record or in two, a bundled package whose `package.json` names no
  license, one under a license the list does not allow, and one with no license text to ship.
  `vet-release` checks the file in each published tarball.

## Consequences

- An install of `npm i -g binference` holds the license of every outside package whose code its
  files carry, beside the copies, at the version they were built from.
- A change that bundles a new outside package fails the dry run until its license is on the list
  or the package is left out; adding a license to the list is a reviewed change of one file.
- A kept license names its package's version, so a new version that still ships none fails the
  dry run until its text is kept again.
- A package added with `pnpm gen:package` records its builds through the root config with no
  change. A file a package's `files` list copies without a build, such as a script, fails the dry
  run as a file in no record.
- Code a bundler plugin writes from no module is in no record: the stylesheet compiler's base
  styles in the console's CSS are, and tailwindcss marks that file with its own license line.
- Every build writes one small JSON file beside `dist`.

## Alternatives

- **Read the comments rolldown writes before each module.** They are not a stable format, as two
  patch releases showed, and a minified file has none.
- **List the dependencies of each package's `package.json`.** An inlined package is often one its
  manifest does not name, such as viem in the CLI, and a dependency's own dependencies are inlined
  with it.
- **Vite's own license file.** It covers the console alone, and it writes into the folder the
  engine serves.
- **A tsdown config in every package.** About 40 files to keep in step; the root one reaches each
  package that has none.
- **Name the bundled packages as dependencies and stop inlining them.** The runtime, signer and
  plugin processes may read no file but their own, so their code must stay in one file.
- **Add the licenses to `NOTICES.md`.** It is one file people edit for every tarball, and the
  licenses differ by tarball and by build.
