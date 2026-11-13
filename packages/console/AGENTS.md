# @binference/console

The web console: the owner's confirmations, ledger and limits in a browser, served by the engine at
`/` and, in the Telegram Mini App, at `/mini`. The specs are
[docs/specs/protocol.md](../../docs/specs/protocol.md) (sections 2.1 and 4) and
[spec 4](../../docs/specs/cards-and-messages.md) for the words on a card.

The root [AGENTS.md](../../AGENTS.md) applies here. Rules for this package:

- It is a client like any other: it reaches the engine only through `@binference/client` over the
  page's own `/ws`, and it decides nothing the engine decides. It imports `client`, `protocol`,
  `i18n`, `rich-text`, `chart` and `qr`, never `core` or another package. The wallets the agent
  shows to fund (`chat/deposit`, decision 0380) are a card each in the words of Telegram's
  caption (`src/chat/deposit-cards.tsx`): the QR code of the address the engine read, drawn as
  SVG from `qrModules` in the theme's `--qr-dark` and `--qr-light`, ink on white in both themes
  (`src/chat/address-code.tsx`), the address as code with a copy button, the warnings of
  `depositWarnings` and the wallet's `explorerLink`. A chart the agent shows
  (`chat/chart`, decision 0387) is drawn as SVG from `chartLayout` in the theme's `--chart-*`
  colors (`src/chat/chart-figure.tsx`), its words as text and its text form for screen readers.
  The images the agent made (`chat/images`, decision 0392) are drawn from the bytes `image/read`
  answers, never loaded from an address (`src/chat/made-images-figure.tsx`), and so are the videos and speech it made (`chat/media`, decision 0405), played from what `media/read` answers (`src/chat/made-media-player.tsx`). A credential request
  (decision 0388) shows above the composer with a masked field and editable
  hosts (`src/chat/credential-request-card.tsx`); the value goes only in the answer's call. The agent's answers show their
  Markdown through `rich-text`, the reader the Telegram bot uses, drawn as elements
  (`src/chat/rich-text.tsx`, decision 0383).
- The brakes live on the safety screen (`src/safety/`, decisions 0089 and 0128): a freeze, asked
  once more in the page, through `safety/freeze` with `confirm`; an unfreeze through
  `safety/unfreeze` with `loosen`, which only opens its card; the rescue card through
  `safety/rescue`. A tap on the card confirms, here or on any surface. While the breaker holds,
  its `safety.breaker` words show in place of every Unfreeze (decision 0441).
- The stack is React, Vite, Tailwind, shadcn on Base UI, TanStack Router and TanStack Query.
  Add a component with the shadcn CLI (`pnpm dlx shadcn@<version> add <name>` in this folder).
  `src/components/ui/` stays as the CLI writes it: lint, format, dead-code and duplicate checks
  skip it, and the console's look lives in `src/app/theme.css` (decision 0156).
- The look is the bInference brand, flat: ink and gold, Hanken Grotesk, the mark, light and dark
  from the system, no shadows or gradients, thin line icons (lucide, `strokeWidth` 1.5).
  Components paint with theme tokens (`bg-primary`, `text-muted-foreground`), never raw colors.
- Every word a person sees comes from the i18n `console` area through `useText()`, in English and
  Chinese in the same change; amounts and times through the one formatter.
- Browser push (decision 0158) lives in `src/push/`: the push worker, built on its own by
  `vite.push-worker.config.ts` into the classic script `/push-worker.js`, shows the engine's card
  pushes and opens the console at the card; it holds no key and answers nothing. A device turns
  notifications on from the confirmations screen, which asks the browser's permission only on a
  click; the Mini App never offers them.
- The build writes a Brotli and a gzip copy beside each text file of 1 KiB or more
  (`precompress-plugin.ts`); the engine sends the copy `Accept-Encoding` takes best, with
  `Vary: accept-encoding`, and never compresses on a request.
- Parsing uses `zod/mini` (SCH-5), in `*.schema.ts` files, the one place `unknown` appears.
- The device key is a WebCrypto key made non-extractable and kept in IndexedDB as the
  `CryptoKey` itself; nothing reads, logs or sends its private half. A pairing link's hash leaves
  the address bar once it is used.
- Tests sit beside the code: `*.test.ts` in Node, and `*.test.tsx` that render, with
  `@vitest-environment jsdom` at the top. Chinese text goes in `*.zh.test.tsx`.
- The smoke test (`pnpm test:console`) lives in `src/smoke/`: Playwright on headless Chromium
  only, one worker, never a window, against the skeleton's engine on loopback
  (`packages/cli/src/console-smoke/smoke-engine.ts`), which serves the built console and a
  control listener the test drives. It pairs a browser, confirms a paper card, makes an alert rule
  whose alert the engine's webhook listener takes and fills on paper, and fails on any error or
  warning the page logs. The control listener sets the owner's language, which the signed-in
  console speaks, for the Chinese screenshots. It is not part of `pnpm test`; its screenshots go to
  `smoke-results/`, which git leaves out.
