// First, so that no module's code writes to the control pipe through `console`.
// oxlint-disable-next-line import/no-unassigned-import -- it reroutes console for its effect, before any other module runs
import "./console-to-stderr.js";
import { runNodeRuntime } from "./node-runtime.js";

// The runtime's entry and composition root. The engine starts it with `runtimeNodeArguments`, an
// empty environment and pipes for its standard input and output, which only the engine holds.
await runNodeRuntime();
