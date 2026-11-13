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
- Model clients are built only in `src/providers/` (spec 8, section 8.1; `check:model-clients`).
- The link to the engine (`linkOverClient` in `src/process/engine-link.ts`) sends a call again only
  when it never ran (decision 0442): the engine refused it `protocol.busy` or `engine.starting`,
  at most 5 attempts, or its own client refused it `client.busy`, and then the call waits for one
  of the link's calls to settle (`createCallSlots`) for as long as its signal allows. This holds
  for the turn's own calls and the inbox through `createResendingClient`, each write under one
  key, and for the tools' and contexts' reads, the owner's images and the wake-ups through
  `createEngineToolClient`. At most 40 reads run at once (`createReadLimit`), and the rest wait
  their turn, so the turns' own calls always find room. A draft, a progress line, reasoning and a
  proposal go once.
- The turn loop in `src/loop/` depends only on its ports (`ports.ts`, each with a contract suite)
  and reads a tool's kind, never its name. Keep each step a small function: a new rule of the turn
  is a new step or a new port method, never another branch in `takeStep`.
- A tool that shows the owner something in the chat names it in its outcome's `shown`; the turn's
  drafts and final text leave out each paragraph that repeats it (`loop/shown-text.ts`, decision
  0381), so the owner never reads the same thing twice.
