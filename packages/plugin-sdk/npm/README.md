# @binference/plugin-sdk

**English** · [简体中文](README.zh.md)

What a binference plugin imports. binference is an open-source AI agent that trades on BNB Smart
Chain for its owner and asks before every transaction. A community plugin adds read tools the
agent may call; it runs in a sandboxed process of its own and reaches the network only through
the hosts its manifest declares.

## Install

```sh
npm install @binference/plugin-sdk
```

It needs Node 26.1 or later.

## Use

```ts
import { defineTools } from "@binference/plugin-sdk/community";

export const tools = defineTools({
  async token_notes(input, { fetch, signal }) {
    signal.throwIfAborted();
    const answer = await fetch({ url: "https://api.example.org/notes" });
    return { status: answer.status, notes: answer.body };
  },
});
```

The plugin's `package.json` declares its id, its tools with their JSON Schemas and its hosts in a
`binference` field, which `communityManifestSchema` checks. The owner reviews every permission
before the plugin runs.

| Import                             | What it holds                                        |
| ---------------------------------- | ---------------------------------------------------- |
| `@binference/plugin-sdk/community` | `defineTools` and the manifest's schema              |
| `@binference/plugin-sdk/data`      | Exact number reading and paced reads of a public API |
| `@binference/plugin-sdk`           | `defineVenue` and the venue types                    |
| `@binference/plugin-sdk/evm`       | Calldata helpers for EVM chains                      |
| `@binference/plugin-sdk/testing`   | The contract suites a venue passes                   |

## Links

- Source and docs: <https://github.com/bInference-Lab/bInference>
- Website: <https://binference.io>

MIT license. Third-party notices are in `NOTICES.md`.
