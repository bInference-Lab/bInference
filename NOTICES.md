# Notices

binference is released under the [MIT license](LICENSE). This file holds the notices for third-party work that
ships in the repository.

## Copied source code

When code is copied from another project, its license notice is added here in full, one section
per source, in the same change.

### OpenClaw

Code adapted from [OpenClaw](https://github.com/openclaw/openclaw) at commit
`f997ec3775567f942585d729346628adf3466edb`:

- the SQLite query layer in `packages/store/src/dialect/`;
- the background service definitions in `packages/platform/src/posix/launchd-plist.ts`,
  `packages/platform/src/posix/systemd-unit.ts`, `packages/platform/src/win32/task-xml.ts` and the
  task state probe in `packages/platform/src/win32/schtasks-service-manager.ts`.

```text
MIT License

Copyright (c) 2026 OpenClaw Foundation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Logos

The logos in `.github/assets/logos/` belong to their owners. They appear only to name the services
binference works with.
