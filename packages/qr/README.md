# @binference/qr

## Purpose

QR codes of addresses as module grids and PNG images, the same in Node and in a browser.

## API

| Export      | What it does                                                                  |
| ----------- | ----------------------------------------------------------------------------- |
| `qrModules` | The modules of the QR code that holds a text exactly, quiet zone included.    |
| `qrPng`     | A 1-bit PNG of that code, 16 pixels a module, for an upload or a `data:` URL. |

## Example

```ts
import { qrPng } from "@binference/qr";

const png = qrPng("0x52908400098527886E0F7030069857D2E4169EE7");
```
