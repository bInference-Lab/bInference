import { err, ok } from "@binference/core";
import type { ScreenCapture } from "../screen/ports.js";
import type { ScreenRefusal, ScreenShot } from "../screen/screen-records.js";

/** A {@link ScreenCapture} that records what it was asked to take. */
export interface FakeScreenCapture extends ScreenCapture {
  /** Each request it was asked, in order. */
  readonly requests: readonly { readonly display?: number }[];
}

/** The bytes of each shot the fake takes: a PNG's signature, then the display's number. */
export function fakeScreenBytes(display: number): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, display]);
}

/**
 * Creates a {@link FakeScreenCapture} of `displays` displays (2 by default): it takes one PNG of
 * each, or of the one asked, `no_display` past the last; with `refuse` it refuses every request
 * with that refusal; `shot` replaces each shot it takes.
 */
export function createFakeScreenCapture(
  options: {
    readonly displays?: number;
    readonly refuse?: ScreenRefusal;
    readonly shot?: Omit<ScreenShot, "display">;
  } = {},
): FakeScreenCapture {
  const requests: { readonly display?: number }[] = [];
  const displays = options.displays ?? 2;
  const shotOf = (display: number): ScreenShot => ({
    ...(options.shot ?? { bytes: fakeScreenBytes(display), contentType: "image/png" }),
    display,
  });
  return {
    requests,
    program: "/usr/local/bin/node",
    capture: async (request, call) => {
      call.signal.throwIfAborted();
      requests.push(request);
      if (options.refuse !== undefined) {
        return Promise.resolve(err(options.refuse));
      }
      if (request.display !== undefined) {
        return Promise.resolve(
          request.display > displays ? err("no_display") : ok([shotOf(request.display)]),
        );
      }
      return Promise.resolve(ok(Array.from({ length: displays }, (_, at) => shotOf(at + 1))));
    },
  };
}
