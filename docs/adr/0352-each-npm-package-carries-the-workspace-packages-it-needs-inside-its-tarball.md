# 0352. Each npm package carries the workspace packages it needs inside its tarball

Status: Accepted

Accepted by the owner on 2026-11-04.

## Context

ENGINEERING section 24.6 publishes four packages to npm: `binference` (the CLI, bundling the
engine, runtime, console and terminal chat), `@binference/protocol`, `@binference/client` and
`@binference/plugin-sdk`. Every other package stays private. The four import private ones:
`binference` needs 36 workspace packages at run time, `plugin-sdk` needs `core`, `chain`,
`chain-evm` and `protocol`, and `protocol` needs `core` and `chain`. A private package is never on
npm, so a tarball that names one as a dependency cannot install.

Facts that bound the choice:

- The CLI starts files of other packages by their package name: the signer, runtime and plugin
  processes and the console's build through `import.meta.resolve`, and the store's and the
  Telegram bot's workers by a path beside their own module. The image runs them from a
  `pnpm deploy` folder, where each package keeps its own folder.
- `@napi-rs/keyring` picks its native binary from optional packages per platform, so npm must
  resolve it on the owner's machine.
- Branded ids and amounts in `core` carry a `unique symbol`, so two copies of `core`'s types are
  not assignable to each other.
- npm marks every package a bundled package depends on as part of the bundle and never fetches
  it. A first try that kept the bundled copies' dependencies installed 14 of about 250 packages,
  and `binference --version` failed on the empty `@solana/kit` folder.

## Decision

- **Workspace packages ride inside.** The release copies each workspace package a published
  package needs at run time (its `dependencies`, followed through each other) to
  `node_modules/@binference/<name>` in the staged package and names them in
  `bundleDependencies`. Each copy holds its `files` and a manifest at the release's version, with
  its `exports` and without its dependencies, scripts or the workspace's source condition.
- **Outside packages are fetched by npm.** The published manifest lists every outside package any
  of the copies needs as a dependency at the catalog's exact version, so npm resolves them, the
  native ones per platform. A copy imports them from the folder above it, as Node resolves a bare
  name.
- **Each tarball stands alone.** `binference` carries its own `protocol`, `client` and
  `plugin-sdk`, and `plugin-sdk` its own `protocol`. Inside one tarball each workspace package
  exists once.
- **Build-time packages stay out.** The console's build already holds React and the rest, so they
  are its `devDependencies`, and no install of `binference` fetches them.
- **The published manifests say where they come from.** No `private`, MIT, `repository` with its
  folder, `publishConfig` with public access and provenance, `engines.node` `>=26.1`, and the
  notices in `files`. Every tarball holds `LICENSE` and `NOTICES.md`.
- **Each npm page is the package's own.** A short README in English and Simplified Chinese from
  the package's `npm` folder: what it is, how to install it, first steps, and links to the docs
  and the repository. It names and compares no other product, and the dry run runs the style
  guard over each packed README. The repository's README never ships.

## Consequences

- An owner's `npm i -g binference` runs the same folders the image runs, at the release's
  version, and fetches only outside packages. The `binference` tarball is about 5 MB.
- Two copies: a program that imports two of the libraries, such as `client` and `plugin-sdk`,
  holds two copies of `core` and `protocol`, one inside each tarball. A branded id or amount from
  one is not assignable to the other's type, and `instanceof` across them fails, so such a program
  converts at the seam between them. Plugins import `plugin-sdk` alone (its AGENTS.md), and
  `binference` holds one copy of each, so neither is affected.
- Outside packages below the direct ones float within their ranges at install time; pinning them
  needs a published lock file, which this decision does not add.
- A new published package or a new private dependency needs no change to the release: the graph's
  `publish` rows and the manifests drive it.

## Alternatives

- **Publish `core`, `chain` and `chain-evm` too.** One copy of each everywhere, but seven public
  packages instead of the four section 24.6 names, and internal modules become a public API.
- **Bundle every outside package as well.** The install would fetch nothing and pin the whole
  tree, but npm would never fetch `@napi-rs/keyring`'s binary for the owner's platform, and a
  library would carry its own `zod`, whose schemas a plugin's `zod` does not recognize.
- **One tsdown bundle of all workspace code.** It would need every child process, worker and the
  console's files moved beside the CLI and found another way, a change across the CLI, the store,
  Telegram and the image.
- **Keep the copies' dependencies.** npm marks those dependencies as bundled and leaves their
  folders empty, as the first try showed.
