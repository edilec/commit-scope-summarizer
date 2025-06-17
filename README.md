# Commit Scope Summarizer

This offline reporter groups a **saved local Git-history export** by package and
feature and points out changes that merit release-note review. It is useful when
a reviewer needs a compact, repeatable view of a history snapshot without
running Git or publishing history text. It does not decide that a release note
is missing.

## Quick start

Node.js 22 or newer is required. There are no runtime or development packages.

```sh
node bin/commit-scope-summarizer.mjs --root examples/clean --input input.json
node bin/commit-scope-summarizer.mjs --root examples/failing --input input.json
node bin/commit-scope-summarizer.mjs --root examples/incomplete --input input.json --json
npm run check
```

The first example exits 0, the second exits 1 with a review candidate, and the
third exits 2 because a revert target is absent. `--help` prints usage. The
default CLI writes one JSON report to stdout and a fixed count summary to
stderr; `--json` suppresses only that summary. No report file is written.

## Supported input

`--root` must name an existing directory. `--input` is a safe relative file
inside its real path; symlinked input aliases and paths resolving outside the
root are refused. The UTF-8 file is one JSON object:

```json
{
  "schemaVersion": "1",
  "packageRoots": ["packages/app"],
  "commits": [{
    "id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "subject": "docs(ui): clarify synthetic guide",
    "files": ["packages/app/README.md"],
    "reverts": null
  }]
}
```

An ID is exactly 40 or 64 lowercase hexadecimal characters and unique within
the export. A subject uses the supported `type(scope): description` form
(optional `!` before `:`): `feat`, `fix`, `perf`, `docs`, `refactor`, `test`,
`build`, `ci`, `chore`, `revert`. Each commit supplies nonempty changed-file
evidence. A revert uses an exact target ID in `reverts`; every other commit
uses `null`. The parser refuses duplicate JSON object keys and numbers because
the supported schema has no numeric fields. Unsupported fields or syntax make
the result incomplete, not an absence claim.

Files belong to their deepest configured package root; unmatched files belong
to ordinal 0. Feature groups are ordered by UTF-16 code unit. Export order is
retained as source-position ordinals, not treated as chronology. The report
contains ordinals, rule IDs and literal source pointers, but does not publish
raw commit IDs, messages, filenames, scopes or author names. An author is
neither required nor invented. Commit text is never executed.

## Rules and exits

| Rule | Meaning | Effect |
| --- | --- | --- |
| `release-note-review` | An active `feat`, `fix`, `perf` or breaking change merits human review. This does **not** assert a missing note. | error; complete report exits 1 |
| `revert-unresolved`, `revert-ambiguous` | Exact target is missing, duplicated, self-referential, repeated or a revert-of-revert has unknown net effect. | warning; exits 2 |
| `history-invalid`, `package-invalid`, `commit-invalid`, `commit-duplicate`, `subject-unsupported`, `path-invalid` | Declared evidence is unsupported or cannot be classified safely. | warning; exits 2 |
| `limit-exceeded`, `clock-invalid` | Analysis could not finish inside a declared bound. | warning; exits 2 |
| `input-unreadable`, `input-invalid`, `path-outside-root`, `input-alias-unsupported` | Named input cannot safely supply evidence. | warning; exits 2 |

Exit 0 is a complete noncandidate history (`status: pass`). Exit 1 is a
complete history with an actionable review candidate (`status: fail`). Exit 2
is `status: incomplete` if named input or its evidence cannot be evaluated;
known review candidates may still be visible. Invalid CLI configuration,
including an invalid root, instead exits 2 with **empty stdout** and a fixed
stderr diagnostic. No untrusted input text is copied into the human summary.

## Bounds and limitations

The default limits are 1,048,576 input bytes, 128 commits, 64 package roots,
32 files per commit, 200 UTF-16 subject units, 64 JSON depth levels, 100,000
JSON nodes and 2,000 elapsed milliseconds. Exactly at a bound is permitted;
N+1 is incomplete. Library callers may lower analysis bounds through `limits`
and inject a finite, monotone `now` clock; CLI uses the documented defaults.
Every report is sorted deterministically without locale collation.

This is a narrow exported-history profile, not a generic `git log` parser. It
does not inspect a working tree, infer history dates or authors, infer reverts
from prose, generate release notes, edit a repository, execute a command, or
contact a host. A revert-of-revert and other ambiguous chains remain
incomplete rather than being guessed. Run `npm run check` to verify the offline
tests and syntax checks.
