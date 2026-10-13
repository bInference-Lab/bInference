import { beforeAll } from "vitest";
import { repinFork } from "./repin-fork.js";

// Each test file starts on a fork pinned moments ago: the public node drops the state of older
// blocks within about a minute, and a run's later files would otherwise read past it.
beforeAll(async () => {
  await repinFork("Pinning the BSC fork for this file");
});
