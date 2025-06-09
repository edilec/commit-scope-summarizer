# Commit Scope Summarizer design

## Purpose and boundary

The tool reads an exported local Git history document. It never invokes Git,
executes commit text, contacts a host, or modifies the repository described by
the export. The CLI requires `--root` and a root-relative `--input`; stdout is
one JSON report and stderr is a fixed count summary unless `--json` is used.

## Supported export

```json
{
  "schemaVersion": "1",
  "packageRoots": ["packages/app", "packages/lib"],
  "commits": [{
    "id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "subject": "feat(ui): add a synthetic view",
    "files": ["packages/app/src/view.js"],
    "reverts": null
  }]
}
```

`id` is a unique 40- or 64-character lowercase hexadecimal commit ID. `subject`
uses a small Conventional Commit profile: `type(scope): description`, with
optional `!` immediately before the colon. Supported types are `feat`, `fix`,
`perf`, `docs`, `refactor`, `test`, `build`, `ci` and `chore`; scope and
description are parsed but never echoed. `files` is a nonempty list of safe
root-relative paths. `reverts` is `null` or an exact ID present in the same
export. Missing, ambiguous, self-referential or cyclic revert relationships
are incomplete, not guessed from prose. A revert of a revert is represented by
both links but its net release-note effect is incomplete in this narrow profile;
the tool does not guess whether the original change is active again. No author
field is accepted or emitted.

## Grouping and release-note semantics

Files map to the longest matching configured package root. Files matching no
root belong to a documented root group. A commit touching multiple groups is
listed in each group; the top-level checked count still counts commits once.
Scopes become stable feature ordinals sorted by UTF-16 code unit, not raw names.
All report identities are ordinals and exact source pointers; filenames,
subjects, descriptions, IDs and arbitrary labels remain internal evidence.

`feat`, `fix`, `perf`, or a `!` marker yields a release-note candidate. A
proven reverted commit is annotated as reverted and is not an active candidate.
The revert relationship names both source commit pointers. Reverts themselves
are reported, not treated as new features. Unsupported subjects and unresolved
reverts make the run incomplete. A valid complete history with no candidate is
still a pass, not a fabricated release note.

The parser rejects duplicate JSON keys, unsupported numeric spelling, excessive
depth, bytes, commits, files and elapsed time as incomplete. The clock is
injected for library calls. CLI path syntax errors are invalid configuration
with empty stdout; unreadable or malformed named exports yield a located
incomplete report. The real input must remain inside the real declared root.
