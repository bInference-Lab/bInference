import type { ProtocolClientOptions } from "@binference/client";

type Ports = Pick<ProtocolClientOptions, "clock" | "random" | "logger">;

/** The browser's clock: wall time, and waits that end early when their signal aborts. */
export const browserClock: Ports["clock"] = {
  now: () => Date.now(),
  sleep: async (delayMs, signal) =>
    new Promise<void>((resolve, reject) => {
      signal.throwIfAborted();
      const timer = setTimeout(resolve, delayMs);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(signal.reason);
        },
        { once: true },
      );
    }),
};

/** The browser's random bytes, from WebCrypto. */
export const browserRandom: Ports["random"] = {
  bytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
};

/** The console keeps no log: the engine logs every call it answers. */
export const quietLogger: Ports["logger"] = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => quietLogger,
};
