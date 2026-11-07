# @binference/qr

QR codes of addresses as module grids and PNG images, the same in Node and in a browser.

The root [AGENTS.md](../../AGENTS.md) applies here. Rules for this package:

- It is pure and runs in a browser: no Node built-in, no I/O. Its PNG writer needs no compressor.
- A code holds the text it is given exactly, nothing added: never a URI scheme, an amount or a
  chain id, which some wallets and exchanges cannot scan.
- Its callers give it only an address binference read itself, never text a model or an outside
  page wrote, so a code can never send funds to an address the owner did not see binference name.
- Its public API is what `src/index.ts` exports; every export carries TSDoc.
- Tests sit beside the code as `*.test.ts`; each image decodes back to its text with the `qr`
  package's own scanner.
