import { MockAgent, setGlobalDispatcher } from "undici";
import { vi } from "vitest";

// Node's built-in fetch reads the same global dispatcher, so this refuses every real request.
const offline = new MockAgent();
offline.disableNetConnect();
setGlobalDispatcher(offline);

// Time in unit tests comes from a fake clock; no test waits on a real timer.
vi.useFakeTimers();
