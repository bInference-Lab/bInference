# @binference/runtime

The agent runtime: the process the engine starts to run each agent's model loop, sessions and tools.

The root [AGENTS.md](../../AGENTS.md) and [spec 8](../../docs/specs/runtime.md) apply here. Rules for
this package:

- Its public API is what `src/index.ts` exports; every export carries TSDoc. Tests sit beside the
  code as `*.test.ts`; `src/testing.ts` holds the fakes other packages test with.
- The runtime is a client of the engine like any other. It holds no key, confirms nothing, writes
  no money state, and reads no environment variable, config file or engine file: everything it
  needs arrives on its control pipe.
- The control pipe is its standard input and output, one JSON line per message, each checked by
  the schemas in `src/control/` on both sides. A line the runtime cannot read ends it with a fault,
  and the engine starts it again.
- `src/process/runtime-process.ts` is its entry and composition root, built into one file,
  `dist/runtime-process.mjs`, so Node's permission model can let it read that file alone. A new
  dependency of the entry is bundled into it; a new file, folder or permission it needs is granted
  in `runtimeNodeArguments` and nowhere else.
- Model clients are built only in `src/providers/` (spec 8, section 8.1).
