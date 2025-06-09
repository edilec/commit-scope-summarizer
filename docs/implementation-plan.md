# Commit Scope Summarizer implementation plan

**Goal:** Group one saved Git-history export and locate release-note candidates
and reverts without invoking Git or echoing untrusted history text.

**Architecture:** `src/json.mjs` parses strict JSON; `src/index.mjs` validates
records, assigns package/feature ordinals and resolves explicit reverts; the CLI
reads one confined export. Tests drive the real library and CLI.

**Tech stack:** Node.js ESM, `node:test`, `node:assert/strict`, no packages.

**Spec:** [design.md](./design.md)

## Global constraints

- The subject, filenames and IDs are data, never instructions or output prose.
- No Git subprocess, network, input mutation, report file or dependency.
- Invalid CLI/configuration emits empty stdout; invalid named export emits an
  incomplete report. Bounds are inclusive at N, refuse N+1; clock is injected.

## Task 1: strict parser and clean history

Files: `src/json.mjs`, `src/index.mjs`, `test/core.test.mjs`.

- [ ] Write a named real-entry test with one conventional commit whose file
  maps to one configured package; assert `pass`, one package ordinal, one
  feature ordinal, an exact source pointer and no authorship or raw subject.
- [ ] Run red because `summarizeHistory` is absent, then implement the narrow
  validation/parser/grouping path and run green.
- [ ] Add tests for duplicate IDs/JSON keys, invalid paths, unsupported
  subjects, missing files, empty history and syntactically valid but unknown
  fields; observe red before each behavior and then green.
- [ ] Commit the parser and honest good-case milestone.

## Task 2: reverts and release-note candidates

Files: `src/index.mjs`, `test/core.test.mjs`.

- [ ] Write red tests for `feat`, `fix`, `perf`, `!`, non-candidates, a simple
  exact-ID revert, unresolved reference and a revert-of-revert chain. Assert
  exact source-position links and no raw ID/message/filename output.
- [ ] Implement only the supported relationship semantics; unsupported or
  ambiguous relationships make the report incomplete.
- [ ] Pin UTF-16 group ordering, multi-package commits, no invented author,
  synthetic command-looking messages as inert data, N/N+1 limits and injected
  finite/monotone timeout with red/green checks.
- [ ] Commit the independently testable grouping/revert milestone.

## Task 3: confined CLI, active offline denial and docs

Files: `bin/commit-scope-summarizer.mjs`, `support/deny-network.mjs`,
`test/cli.test.mjs`, `test/no-network.test.mjs`, `examples/`, `README.md`,
`package.json`.

- [ ] Add red real-CLI tests for pass/incomplete, help, configuration stdout
  empty, unreadable/malformed named export JSON, symlink escape, identical
  output, fixed human summary and `--json` suppression.
- [ ] Implement root-relative input confinement and JSON/human streams, then
  run focused tests green.
- [ ] Add active denial controls on a data-URL fetch and null-receiver socket;
  run the whole suite under denial.
- [ ] Document input, rule table, quick start, exit shapes, bounds and non-goals.
- [ ] Run `npm run check`, real sample CLI controls, raw-byte and clean-tree
  checks, then commit the final coherent milestone.
