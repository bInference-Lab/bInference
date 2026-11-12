# 0414. A note search ignores the case of ASCII letters only, on both databases

Status: Accepted

Accepted by the tech lead on 2026-11-12.

## Context

`NoteStore.search` finds an agent's notes whose text holds a query
([decision 0206](0206-the-engine-labels-each-note-and-a-proposal-never-takes-an-address-from-one.md)):
a query of three characters or more through the trigram index, the best match first, and a shorter
one as a substring, in any case of its ASCII letters. Each database ranks by its own
([decision 0366](0366-postgres-writes-run-serializable-and-every-ordered-read-names-its-order.md)),
but both run the same contract suites and must find the same notes
([decision 0367](0367-each-install-keeps-its-own-pair-of-postgres-schemas-with-sqlite-s-row-shapes.md)).

The databases fold letter case differently:

- SQLite's FTS5 trigram tokenizer folds every letter its own table holds, Unicode 6.1's case
  folding of the first 65,536 code points: `ä` finds `Ä`, `привет` finds `ПРИВЕТ` and `ς` finds
  `Σ`, while `i` misses `İ` and a letter added to Unicode later matches only its own case.
  SQLite's `lower`, which a short query reads, folds ASCII letters only.
- Every Postgres text column is `COLLATE "C"`, so that sorts and prefix ranges match SQLite byte by
  byte (decision 0366). Under it `lower` and `ILIKE` fold ASCII letters only. Postgres 17's `lower`
  under the `pg_c_utf8` collation maps each letter by Unicode 15.1's lowercase table, which keeps
  `ς` apart from `σ` and folds `İ`; `casefold` comes in Postgres 18.
- The in-memory fake folded a long query with JavaScript's `toLowerCase`, which maps `İ` to two
  code points and a final `Σ` to `ς`, as neither database does.

No fold of letters beyond ASCII is the same on both databases.

## Decision

- A note search of any length finds the notes whose text holds the query with only the case of
  ASCII letters ignored. Every other character, the letters of other scripts among them, matches
  only as written, and `%`, `_` and `\` match themselves.
- On SQLite a query of three characters or more is matched through `notes_fts`, and a note stays
  only when `instr` over `lower` finds the query in it: FTS5's wider fold picks the candidates and
  never adds a note, and FTS5's rank orders them. A shorter query reads `instr` over `lower` alone.
- On Postgres every query is `ILIKE` under `COLLATE "C"`, with `\`, `%` and `_` escaped, which the
  `pg_trgm` index serves; a query of three characters or more ranks by trigram similarity.
- The in-memory fake folds ASCII letters only.

## Consequences

- SQLite, Postgres and the fake find the same notes for every query. A contract case pins `Ä` and
  Cyrillic capitals apart from their small letters, and ASCII letters alike in either case.
- English and Simplified Chinese, the languages binference ships, lose nothing: Chinese has no
  case. A note in German or Russian is found by its letters as written: `ärger` misses `ÄRGER`.
  On self-hosted, such a search found the note until now.
- The trigram index keeps its use on both databases: it narrows a long query's candidates, and on
  SQLite its rank orders them.

## Alternatives

- **Fold every letter on both.** No Postgres 17 function folds as FTS5's table does, and a copy of
  that table in SQL would be one more thing to keep in step with SQLite's. Rejected.
- **Fold in the program and search a folded copy.** binference would keep a second, folded copy
  of each note's text, made by one function in both adapters, and search it on both databases. It
  needs a new column and its index on both, a rewrite of every stored note, and an FTS5 table over
  the copy, for letters the shipped languages do not use. Rejected for now; it stays open should a
  language with case join the shipped ones.
- **Let each database fold its own way.** One search would find other notes on Cloud than on a
  self-hosted install, and the contract suite could not pin either. Rejected.
- **A `pg_c_utf8` collation on `notes.text`.** It folds by another table than FTS5's, so the
  answers still differ, and the column would no longer compare byte by byte as every other text
  column does. Rejected.
