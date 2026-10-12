import { runNodeRuntime } from "./node-runtime.js";

// The runtime's entry and composition root. The engine starts it with `runtimeNodeArguments`, an
// empty environment and pipes for its standard input and output, which only the engine holds.
await runNodeRuntime();
