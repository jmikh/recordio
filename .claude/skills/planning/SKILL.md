---
name: planning
description: Conventions for creating and managing plan docs — tiered vs oneshot plans, folder/naming rules, step docs, completion logging, and agent-suggestions docs. Load whenever creating a plan, writing a step doc, implementing any plan or plan step, or finishing a step.
---

# Planning

All plans live in `plans/` at the repo root. Use meaningful kebab-case names, never auto-generated ones (per CLAUDE.md).

## First: ask tiered or oneshot

Before writing any plan, **always ask the user** whether this should be:

- **Tiered plan** — for bigger changes: a high-level design doc plus per-step docs created as work progresses.
- **Oneshot plan** — a single self-contained plan doc.

Never assume; ask even when the size seems obvious.

## Directory structure

```
plans/
├── my-feature-oneshot.md                    # oneshot: single flat file
├── my-feature-agent-suggestions.md          # only if suggestions come up
└── big-refactor/                            # tiered: one folder per plan
    ├── big-refactor-tiered-plan.md          # high-level design + step list
    ├── big-refactor-step-1.md               # created later, when step starts
    ├── big-refactor-step-2.md
    └── big-refactor-agent-suggestions.md    # only if suggestions come up
```

## Oneshot plans

- One flat file: `plans/<plan-name>-oneshot.md`. No folder.
- Self-contained: context, design, and implementation steps all in the one doc.

## Tiered plans

- Each tiered plan gets its own folder: `plans/<plan-name>/`.
- Main doc: `plans/<plan-name>/<plan-name>-tiered-plan.md`, containing:
  - High-level design (architecture, key decisions, constraints).
  - The ordered list of steps with a one-line summary each.
  - A **Step log** section (see below).
- **Step docs are NOT written upfront.** When a step is about to be implemented, create `plans/<plan-name>/<plan-name>-step-N.md` with the detailed plan for that step only. Earlier steps' outcomes may change later steps — write step docs with current knowledge, not stale upfront guesses.

### After finishing a step

Update the tiered plan doc's **Step log**:

- The date the step was completed.
- Any changes that had to be made to the design during implementation (and propagate those changes into the design section itself, so the doc stays truthful).

```markdown
## Step log
- Step 1 — completed 2026-09-01. Design change: moved entitlement checks into middleware instead of per-route guards.
- Step 2 — completed 2026-09-04. No design changes.
```

## Agent suggestions doc

During implementation of **any** plan (tiered or oneshot), when you notice bad code hygiene, security concerns, or a better abstraction that would require big changes — do **not** expand scope inline. Record it in `<plan-name>-agent-suggestions.md` (inside the plan folder for tiered plans, beside the plan file for oneshot plans) and continue with the planned work.

Each entry should include: what you found, where (file/line), why it matters, and a sketch of the suggested change. Create the file on first finding; append afterwards.
