# 0361. The docs references are generated from the code in both languages

Status: Accepted

Accepted by the tech lead on 2026-11-04.

## Context

The docs site needs references for the commands, the config keys, the notices, the engine
operations and the tools, in English and Chinese, that never drift from the code. Every word a
person reads ships in both languages, and a docs page is read by a person. Each reference has one
source in the code:

- the commands: the program's commander tree, whose help words are i18n `cli` messages in both
  languages;
- the config keys: the config schema, whose `.describe()` texts and 7 machine-dependent defaults,
  such as "from the OS", are English only;
- the notices: the notice table, which holds an example of every notice, and the `notice`
  messages in both languages;
- the operations: the protocol's operation tables, which hold names, scopes and flags but no
  words;
- the tools: the agent's tool declarations and the MCP server's tool table. Their texts are what
  a model reads or an MCP client shows, which section 14 keeps in English.

Until now only the config keys had a reference, an English Markdown file in `packages/cli/docs/`
that `check:config-schema` kept current.

## Decision

- `pnpm docs:gen` writes `commands.md`, `config.md`, `notices.md`, `operations.md` and
  `agent-and-mcp-tools.md` under `apps/docs/src/content/docs/reference/` and their twins under
  `zh-cn/reference/`. Those folders hold only generated pages; each page carries a comment that
  names the command, which `check:pr` reads to leave the page out of a branch's size.
- The words around the data come from the i18n `docs` area, and what a config key takes from the
  `config` area, which config issues also use in English.
- Each config key's text and machine-dependent default is a message of the i18n `configKeys`
  area, keyed by the key's path (`engine.port`, `owner.locale:default`). `pnpm docs:gen` writes
  the English catalog from the schema; the Chinese catalog is written by hand in the glossary's
  words.
- Each agent tool and MCP tool has a one-line summary for the owner in the `docs` area, in both
  languages. The pages show the summaries; the texts a model reads stay English and stay off the
  pages.
- `pnpm check:references`, in `pnpm check`, fails a generated file behind the code, a hand edit, a
  file no code generates in the reference folders, a config key without its Chinese text and a
  tool without its summary in either language. `check:gates` plants a changed config default, a
  hand edit, a missing Chinese key text and a missing summary, and each must fail.
- `check:config-schema` keeps only the schema snapshot; `packages/cli/docs/config-keys.generated.md`
  is gone.
- oxfmt skips the reference folders, since it pads every table cell; the notices pages keep the
  status icons the owner sees, as the card spec does.

## Consequences

- A change to a command, a config key, a notice, an operation or a tool changes its pages in the
  same commit, or `pnpm check` fails. A new config key or tool also needs its Chinese text or its
  summary in both languages.
- The schema's `.describe()` text stays the English source for the JSON Schema that editors read,
  and the English catalog copies it.
- Publishing the generated pages adds about 4,600 lines of Markdown to the repo.

## Alternatives

- Hand-written references: they drift, and nothing would catch it.
- One hash of the generated text committed, the pages left out of git: the site needs the pages
  to build, and a reviewer reads a changed page in the diff.
- English texts on the Chinese pages: a Chinese reader would meet English in every config key.
- Machine-translated Chinese: its terms would not follow the glossary, and nobody would own them.
- The model's tool texts translated: section 14 keeps them English, and they are written for a
  model, not for the owner.
