import process from "node:process";
import { setTimeout as wait } from "node:timers/promises";
import type { Clock } from "@binference/core";
import { serveImageShell } from "@binference/platform/image-shell";

// The image's shell launcher (decision 0412), which the image entry starts as `binference-shell`
// in that user's home. It reads no argument, variable or input of its own: its socket and home are
// the image's. Every command it runs takes its file mode mask, so what a command makes is the
// shell group's, which the engine's user shares, and nobody else's.
process.umask(0o007);

const clock: Clock = {
  now: () => Date.now(),
  sleep: async (delayMs, signal) => wait(delayMs, undefined, { signal }),
};
// How long a launcher that cannot listen waits before it ends and the image entry starts it again.
const retryMs = 60_000;

const stop = new AbortController();
for (const stopSignal of ["SIGTERM", "SIGINT"] as const) {
  process.once(stopSignal, () => stop.abort());
}
try {
  const served = await serveImageShell(clock, stop.signal);
  await served.closed;
} catch {
  // A socket folder that is not there, as on a folder bound in place of the image's volume, gets
  // one line a minute rather than one a second.
  const next = "Mount the state as the server guide does, so shell/run/ is the shell user's.";
  process.stderr.write(`${JSON.stringify({ fault: "image.shell_unlistened", next })}\n`);
  await wait(retryMs, undefined, { signal: stop.signal }).catch(() => undefined);
}
process.exit(0);
