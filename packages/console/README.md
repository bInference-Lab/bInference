# @binference/console

## Purpose

The web console of binference. `binference console` prints a single-use link; the browser that
opens it makes a non-extractable device key with WebCrypto, pairs it with the engine at
`POST /pair`, and signs in over the page's WebSocket by signing each challenge. The engine serves
the built files from memory at `/`, and at `/mini` for the Telegram Mini App.

## API

The package exports its build only.

| Path                     | What it holds                                                    |
| ------------------------ | ---------------------------------------------------------------- |
| `dist/index.html`        | The page the engine serves at `/` and `/mini`                    |
| `dist/assets/*`          | The script, the stylesheet and the fonts, by hash                |
| `dist/hermes.webp`       | The Hermes mark of the sign-in page, 357 by 480 pixels, lossless |
| `dist/mark.svg`          | The mark, as the page's icon                                     |
| `dist/push-worker.js`    | The service worker that shows card notifications                 |
| `dist/*.br`, `dist/*.gz` | The Brotli and gzip copies of each text file of 1 KiB or more    |
| `dist/*-ofl.txt`         | The licence of the shipped font                                  |

## Example

```sh
pnpm --filter @binference/console build
binference console
```
