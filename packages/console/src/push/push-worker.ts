import { asWorkerScope } from "./assert-worker-scope";
import { installPushWorker } from "./push-worker-handlers";

// The entry of `/push-worker.js`, the console's service worker.
installPushWorker(asWorkerScope(globalThis));
