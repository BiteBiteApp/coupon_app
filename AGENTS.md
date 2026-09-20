# BiteStar Codex Operating Instructions

These instructions apply to the entire `coupon_app` repository unless a
more specific `AGENTS.md` in a subdirectory provides compatible,
narrower instructions.

Task-specific user instructions take precedence over this file.

## 1. Core working philosophy

Work toward the explicitly authorized BiteStar task with the smallest
safe, production-quality change.

Preserve existing behavior, UI/UX, architecture, data contracts, and
workflows unless the task explicitly authorizes changing them.

Do not invent or implement unrelated:
- features;
- workflows;
- architectures;
- migrations;
- schema redesigns;
- infrastructure;
- refactors;
- cleanup projects.

Aggressively look for real bugs and edge cases, but do not turn every
finding into another project.

Prefer robust solutions across supported devices, screen sizes,
orientations, accessibility settings, and production scale over
device-specific patches.

## 2. Autonomous execution inside an approved task

For a coherent and bounded authorized task, continue autonomously
through the ordinary engineering loop:

inspect relevant code and requirements
-> implement
-> add/update focused tests
-> run tests
-> diagnose ordinary failures
-> fix failures caused by the work
-> rerun tests
-> review the complete diff
-> identify missed requirements or in-scope defects
-> correct them
-> rerun relevant verification
-> perform final scope review
-> report once.

Do not stop merely because:
- an ordinary test fails;
- a local script needs a small correction;
- formatting/linting fails;
- an implementation detail needs an obvious in-scope adjustment;
- the first attempt needs refinement.

Self-correct ordinary in-scope problems.

Do not use autonomous self-correction as permission to broaden scope.

## 3. Mandatory stop conditions

STOP and report rather than independently proceeding if completion
requires a consequential decision that was not explicitly authorized,
including:

- meaningful architecture change;
- database/schema redesign;
- migration or backfill;
- new service or major infrastructure;
- destructive production-data action;
- production deployment not explicitly authorized;
- security/authorization policy change outside the stated task;
- major product behavior decision;
- significant scope expansion;
- broad compatibility layer solely to preserve obsolete/test behavior;
- irreversible action not clearly authorized.

Explain the concrete blocker and smallest reasonable next decision.

## 4. BiteStar bug / edge-case filter

For every material incidental issue, evaluate in this order:

1. CONSEQUENCE FIRST
   What actually happens if the issue occurs?

2. LIKELIHOOD SECOND
   Is the path realistically reachable?

3. PROPORTIONALITY THIRD
   Is fixing it now proportionate to the actual risk?

Classify material findings as exactly one of:

### FIX NOW / DIRECTLY REQUIRED
A real issue that must be corrected for the authorized task to be safe
or correct.

### FIX SEPARATELY — REAL BUG
A legitimate issue that does not need to block the current task.
Record it without expanding the current assignment.

### PRODUCT DECISION REQUIRED
Correct resolution depends on an owner/product/policy choice.

### ACCEPT AND CLOSE
The consequence is harmless, bounded, already sufficiently mitigated,
or disproportionate to pursue.

A small, local, obvious adjacent defect may be fixed in the same run
only when it:
- is clearly a real bug;
- requires no product/architecture decision;
- introduces no meaningful scope expansion;
- can be properly tested.

Otherwise classify and report it.

## 5. Scope discipline

Before editing, identify the actual execution path and smallest relevant
file set.

Prefer targeted reads/searches over broad repository scans.

Reuse trustworthy existing reports, manifests, tests, and evidence when
still applicable rather than redoing completed work.

Do not repeatedly audit unrelated areas merely because the task is
long-running.

Do not change tests merely to make a failure disappear.
Fix the underlying in-scope defect.

Do not silently weaken validation, security, or acceptance criteria to
obtain a passing result.

## 6. Git safety

Default workflow is `main`.

Do not create, switch, merge, rebase, or delete branches unless the
current task explicitly authorizes it.

Never force-push.

Never use broad staging commands such as:
- `git add .`
- `git add -A`

Stage exact intended paths only when staging is explicitly authorized.

Do not discard, overwrite, clean, reset, stash, or otherwise destroy
pre-existing worktree changes merely to obtain a clean state.

On unexpected changes:
- inspect;
- preserve them;
- stop if they materially conflict with the authorized task.

Verify expected HEAD and worktree state before consequential work when
the task provides an expected checkpoint.

Commit, tag, and push only when the task explicitly authorizes those
actions.

## 7. Production and deployment safety

No production write, deletion, reset, initialization, deployment,
Rules change, IAM change, secret change, signing change, or customer
activation is implied by an implementation task.

Such actions require explicit authorization in the current task.

Prefer targeted deployments.
Do not use broad Firebase/Functions deployment as a convenience when
only specific targets are authorized.

Treat payment, Stripe, authentication, account identity, secrets,
signing, and unrelated production infrastructure as protected unless
the task explicitly includes them.

Do not restore historical configuration merely because it is available;
first verify it remains appropriate for current state.

Never expose credentials or secret payloads.

Avoid:
- `firebase login:list --json`
- `firebase login:ci`
- `--token`
- credential/environment dumps
- auth-debug output containing credentials
- service-account key creation unless explicitly authorized.

## 8. BiteStar durable data boundaries

`restaurant_accounts` represents genuine BiteSaver
participants/applicants. Never mass-create account documents for
scraped/imported public restaurants.

`bitescore_restaurants` is the public restaurant catalog and is
independent of BiteSaver account participation.

Do not assume IDs from those collections are interchangeable.

BiteSaver and BiteScore participation remain independent unless a
specific approved contract says otherwise.

Do not delete or replace mixed identity/account roots merely to clean
content. Use explicit field-level behavior when required by the task.

Current test/synthetic content may be disposable when the owner
explicitly states so; that does not make authentication, billing,
identity, infrastructure, signing, or security configuration disposable.

## 9. Testing and verification

Use the smallest test set that meaningfully validates the change first.

Expand testing when warranted by:
- shared code;
- security/data-integrity risk;
- broad behavioral impact;
- failures discovered during focused testing.

Within the approved task, diagnose and fix ordinary regressions caused
by the change and rerun affected tests without asking for a new prompt.

Do not endlessly rerun expensive suites without a concrete reason.

Report:
- what was tested;
- relevant pass/fail counts;
- unresolved failures;
- whether failures pre-existed or were caused by the task when that can
  be established.

Do not claim verification that was not actually performed.

## 10. Long autonomous tasks

For longer assignments, continue working through ordinary inspect /
implement / test / fix / self-review cycles without waiting for the user
after each routine step.

A long-running assignment does NOT implicitly authorize:
- commits;
- pushes;
- tags;
- deployments;
- production-data changes;
- destructive actions;
- major architecture changes.

Those permissions must be explicit in the task.

Prefer one comprehensive final report over repeated routine progress
reports unless user input is genuinely required.

## 11. Independent review and self-review

Before finishing a substantial implementation:

- inspect the complete diff;
- compare it against every stated acceptance criterion;
- check for missed edge cases;
- check for unnecessary scope expansion;
- check that existing behavior outside scope was preserved;
- check tests cover the changed contract.

When the task authorizes an internal independent reviewer/subagent, use
it for a focused second look rather than reopening the whole repository.

The external ChatGPT project thread remains the owner's independent
supervisory/review layer.

## 12. Reporting discipline

For substantial BiteStar runs, when applicable, report:

- Run ID;
- prompt timestamp;
- role/task type;
- expected starting HEAD;
- actual starting HEAD;
- final/current HEAD;
- completion timestamp;
- Git/worktree state;
- tests/verification;
- material bug-filter findings;
- exact unresolved blocker or decision;
- verdict.

Use plain English in the owner-facing summary.

The owner is not expected to interpret implementation jargon.
Explain real-world consequences without unnecessary technical detail.

Do not overstate certainty.

## 13. Efficiency

Spend effort where it changes correctness or risk.

Do not use deeper analysis as a reason to:
- create speculative edge cases;
- redesign working systems;
- repeat completed audits;
- preserve disposable legacy/test behavior;
- produce unnecessary multi-step projects.

When a safe coherent task can be completed in one bounded autonomous
assignment, prefer that over unnecessary inspect/report/implement/report
micro-prompts.
