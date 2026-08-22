# Relife Engine Lite

One task moves through one controlled chain:

`Owner goal -> Codex prompt -> Claude artifact -> Codex verification -> Draft PR -> CI -> Owner merge`

There is one source of truth: the current GitHub `main` branch. Reports, screenshots,
scratchpads, archives, and sandbox branches are evidence only.

## 1. Responsibility split

| Actor | Responsible for | Must not do |
|---|---|---|
| Owner | goal, business decision, merge/deploy authorization | provide credentials in chat |
| Codex | scope, prompt, artifact validation, code review, independent checks, commit, Draft PR, CI triage | trust an artifact claim without verification |
| Claude | code and tests inside the supplied scope; one handoff artifact | push, PR, merge, deploy, credentials, live data mutation |
| GitHub CI | impact gate, lint, full tests, production build | prove live deployment or production data correctness |

## 2. Risk tiers

### Standard

UI, read-only behavior, tests, documentation, and bounded fixes that reuse an existing
canonical path. Required preflight: read relevant source, search the existing path,
identify permission/authority, and name focused regression tests.

### High

Finance semantics, authentication/authorization, writers, idempotency, locks,
schema/RLS, authority, migration/cutover, or production mutation. In addition to the
standard preflight, review `CLAUDE.md`, `MIGRATION_AUDIT.md`, and
`docs/CANONICAL_PATH_REGISTRY.md`. A new writer or authority change needs an
Owner-approved GitHub issue.

Uncertainty about authority is a blocker, not permission to invent a path.

## 3. Codex creates the task packet

Codex fills `.github/CLAUDE_TASK_PROMPT.md` with:

- exact repository and immutable base SHA;
- one outcome and bounded changed-file scope;
- canonical route/domain/writer and exact permission;
- invariants and must-not-change boundaries;
- acceptance tests and commands;
- risk tier and audit requirement;
- output artifact name.

The prompt is complete. Claude should not need a sequence of small follow-up prompts.

## 4. Claude returns one artifact

Artifact layout:

```text
relife-handoff/
  HANDOFF.json
  changes.patch
  REVIEW.md
  evidence/
    tests.txt
    lint.txt
    build.txt
```

For a blocked task, return `HANDOFF.json` with `status: "blocked"` and `BLOCKED.md`;
do not include a speculative patch.

`HANDOFF.json` version 1 contains:

```json
{
  "version": 1,
  "repository": "avatarbd1/relife-owner-app",
  "baseSha": "40-character commit SHA",
  "taskId": "short-stable-id",
  "riskTier": "standard",
  "status": "complete",
  "changedFiles": ["path/from/repo-root"],
  "patchSha256": "64-character SHA-256",
  "authorityChanged": false,
  "newCanonicalWriter": false,
  "ownerIssue": null,
  "actions": {
    "commit": false,
    "push": false,
    "pullRequest": false,
    "merge": false,
    "deploy": false,
    "productionMutation": false
  },
  "verification": [
    { "command": "npm test", "exitCode": 0, "evidence": "evidence/tests.txt" }
  ]
}
```

`changes.patch` is produced from the exact base with:

```bash
git diff --binary --full-index BASE_SHA...HEAD > changes.patch
```

Claude packages the `relife-handoff/` directory as a `.tar.gz` only after its contents
are complete. The archive is transport, not a repository or proof of GitHub state.

## 5. Codex import and verification

Codex performs these steps on a fresh branch from current `main`:

1. List archive entries and reject absolute paths, `..`, symlinks, or unexpected roots.
2. Extract into a temporary directory.
3. Run `node scripts/validate-claude-artifact.mjs EXTRACTED_DIR --base-sha CURRENT_SHA`.
4. Run `git apply --check changes.patch`, then apply it.
5. Compare the actual changed-file list with `HANDOFF.json`.
6. Read every diff and inspect upstream/downstream consumers.
7. Independently run focused tests, full tests, lint, and build as applicable.
8. Fix only evidenced issues; never silently expand scope.
9. Commit once the worktree and evidence are coherent.
10. Push one branch and open one Draft PR.

Claude's logs help triage but never replace Codex or CI verification.

## 6. PR and merge lifecycle

- Draft runtime PR: manual user flow may be `DEFERRED (Draft)`.
- Ready-for-review runtime PR: user flow must be `YES` with concrete role, context,
  scenario, result, and evidence.
- PR-body edits rerun CI; no empty refresh commit is required.
- CI success means the checked commit passed the repository gates. It does not mean
  merged, deployed, live, or production-verified.
- Owner approval is required for merge. Deployment and live-data verification are a
  separate step.

## 7. Stop conditions

Stop and report a blocker when:

- artifact base SHA differs from current `main`;
- changed files differ from the manifest;
- the patch adds an unapproved writer, route, permission, schema, or authority;
- Python parity is required but Python source is absent;
- tests expose an unrelated failure that cannot be isolated safely;
- credentials, live writes, deployment, or a broader business decision are required.

No completion report may claim work that is not visible in the artifact, branch, PR,
CI run, or production evidence.
