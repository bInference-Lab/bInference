# @binference/console

## Purpose

The web console of binference. `binference console` prints a single-use link; the browser that
opens it makes a non-extractable device key with WebCrypto, pairs it with the engine at
`POST /pair`, and signs in over the page's WebSocket by signing each challenge. The engine serves
the built files from memory at `/`, and at `/mini` for the Telegram Mini App.

## API

The package exports its build only.

| Path              | What it holds                                     |
| ----------------- | ------------------------------------------------- |
| `dist/index.html` | The page the engine serves at `/` and `/mini`     |
| `dist/assets/*`   | The script, the stylesheet and the fonts, by hash |
| `dist/hermes.svg` | The Hermes mark of the sign-in page               |
| `dist/mark.svg`   | The mark, as the page's icon                      |
| `dist/*-ofl.txt`  | The licence of the shipped font                   |

## Example

```sh
pnpm --filter @binference/console build
binference console
```
