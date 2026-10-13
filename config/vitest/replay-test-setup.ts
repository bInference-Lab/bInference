import { beforeEach } from "vitest";
import { repinFork } from "./repin-fork.js";

// Each replay runs for longer than the public node keeps the fork block's state, so every test,
// not only every file, starts on a fork pinned moments ago.
beforeEach(async () => {
  await repinFork("Pinning the BSC fork for this replay");
});
