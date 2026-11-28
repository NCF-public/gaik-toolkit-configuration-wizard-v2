# GitFlow — Fork Development Process

This document describes the branching model and commit conventions for this fork
(`NCF-public/gaik-toolkit-configuration-wizard-v2`). It keeps day-to-day development
separate from released code.

For coding guidelines (module structure, tests, releases), see
[`guidance_layer/CONTRIBUTING.md`](guidance_layer/CONTRIBUTING.md).

---

## Branch roles

| Branch | Purpose | Who merges here |
|--------|---------|-----------------|
| **`release/wizard-v2`** | Released code only (the default branch) | Maintainer via PR from `develop` or `hotfix/*`, merge commit |
| **`develop`** | Integration branch for ongoing work | Contributors via PR from `fix/*` and `feat/*`, squash |
| **`fix/*`, `feat/*`** | Changes in progress | — (merge target: `develop`) |
| **`hotfix/*`** | Urgent fixes to released code | — (merge target: `release/wizard-v2`, then back-merge to `develop`) |
| `main` | Old copy of the upstream `main`; not used | — |

### Rules

- **Never commit directly to `release/wizard-v2` or `develop`.** All changes arrive by a reviewed pull request.
- **`develop` may be ahead of `release/wizard-v2`.** That is expected — it is the integration branch.
- **Merge only with CI green.**
- **Delete `fix/*` and `feat/*` branches** after they are merged.

---

## Daily workflow

### Start a new change

```bash
git checkout develop
git pull origin develop
git checkout -b fix/short-description
```

Use a short, kebab-case slug that describes the change, e.g. `feat/wizard-bpmn-export`.

### Work, commit, push

```bash
git add <files>
git commit
git push -u origin fix/short-description
```

Open a **pull request into `develop`**. Wait for CI to pass, then squash-merge.

---

## Solution Wizard V2 releases

`wizard-v2` is the product name; the version follows it.

### Branches and environments

| Branch | Deployed to | What runs there |
|--------|-------------|-----------------|
| `develop` | s4 (`wizard-v2-s4-*`) | the tip of `develop`; acceptance rounds run here |
| `release/wizard-v2` | staging (`wizard-v2-*`) | tagged releases only: the latest release, the environment users work on |

Changes reach `develop` by squash-merged PRs from `fix/*` and `feat/*`. When
`develop` has passed an acceptance round on s4, a PR merges it into
`release/wizard-v2` with a merge commit, and the release is tagged there.

### Tags

Annotated tags on `release/wizard-v2` only: `wizard-v2-MAJOR.MINOR.PATCH`.

- **PATCH** (`0.1.0` → `0.1.1`): fixes only; nothing changes for the user except that it works.
- **MINOR** (`0.1.x` → `0.2.0`): a feature or a change users notice; PATCH goes back to 0.
- **`1.0.0`** is the first official release. Until then versions are `0.x.y`, published as
  GitHub pre-releases.

The tag matches `wizard-v2*`, which `wizard-v2-deploy.yml` listens to, and not `v*.*.*`,
which publishes gaik to PyPI. `deploy.sh` bakes `git describe` into both images, so the
login page and `/health` show `wizard-v2-0.1.0` on a tagged build and
`wizard-v2-0.1.0-3-gabc1234` on a build from `develop`. The version is also an image
tag, so it never contains `/`.

The tags `wizard-v2.0.0-sprint4`, `wizard-v2.0.0-rc1` and `wizard-v2.0.0-rc2` predate
this scheme and stay as history.

### Example

| Tag | Kind |
|-----|------|
| `wizard-v2-0.1.0` | first numbered release |
| `wizard-v2-0.1.1` | fixes |
| `wizard-v2-0.2.0` | a small feature set |
| `wizard-v2-0.2.1`, `wizard-v2-0.2.2` | fixes |
| `wizard-v2-0.3.0` | a small feature set |
| … | |
| `wizard-v2-1.0.0` | the first official release, on the commit of an accepted `0.x.y` |

### Cutting a release

1. PR `develop` → `release/wizard-v2`, merge commit, CI green.
2. An acceptance round on a build of that commit.
3. Release certification (see `AGENTS.md`), run locally.
4. `git tag -a wizard-v2-0.X.Y -m "…"` on the merge commit, push the tag, and create the
   GitHub Release (`--prerelease` while below 1.0.0) listing the PRs and the acceptance result.
5. Deploy the tag to staging.

A fix that cannot wait for `develop` goes on a `hotfix/*` branch from
`release/wizard-v2`, by PR into it, is tagged as a PATCH, and `release/wizard-v2` is then
merged back into `develop`.

---

## Delivering upstream

This fork is delivered to the upstream GAIK toolkit
(`GAIK-project/gaik-toolkit`) by a pull request from `release/wizard-v2`. Add the
upstream remote once:

```bash
git remote add upstream https://github.com/GAIK-project/gaik-toolkit.git
```

To take upstream changes into the fork, merge them into a branch from `develop` and
open a PR into `develop`:

```bash
git fetch upstream
git checkout -b chore/upstream-sync origin/develop
git merge upstream/main
# resolve conflicts, run tests, push, PR → develop
```

---

## Commit message conventions

Every commit must be documented clearly so the history is readable without opening
the diff. We follow [Conventional Commits](https://www.conventionalcommits.org/)
— the same style already used in this repository.

### Format

```
<type>(<scope>): <short summary>

<optional body — explain why, not just what>

<optional footer — issue refs, breaking changes>
```

### Subject line (first line)

- Use the imperative mood: `add`, `fix`, `update` — not `added` or `fixes`
- Keep it ≤ 72 characters
- No trailing period
- Scope is optional but encouraged when the change is localized

### Types

| Type | When to use |
|------|-------------|
| `feat` | New feature or user-visible behaviour |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test` | Adding or updating tests |
| `chore` | Build, CI, tooling, dependencies |
| `style` | Formatting, whitespace (no logic change) |
| `perf` | Performance improvement |

### Scope examples

Use the area of the codebase affected:

- `solution-wizard`, `demo-app`, `transcriber`, `RAG`, `skills`, `website`, `ci`

### Body (required when the change is non-trivial)

Write 1–5 lines explaining:

- **Why** the change was made (problem, requirement, context)
- **What** changed at a high level (if not obvious from the subject)
- **How to verify** (test command, manual step) when helpful

### Footer

- Reference issues: `Closes #42`, `Refs #17`
- Breaking changes: start a paragraph with `BREAKING CHANGE:` describing migration steps

### Examples

**Simple fix:**

```
fix(parallel_transcriber): raise api_timeout_seconds default 180→600
```

**Feature with body:**

```
feat(admin): per-user report limit override + summary stats

Allow admins to set individual report quotas per user and view
aggregate usage in the admin panel. Defaults remain unchanged for
existing users.

Test: pytest implementation_layer/unit_tests/ -k admin
```

**Documentation:**

```
docs: add GitFlow branching model for fork development

Documents main/dev workflow, upstream sync, and commit conventions
so contributors follow a consistent process.
```

**Breaking change:**

```
refactor(evaluation_layer): move output methods to evaluation_layer/

BREAKING CHANGE: import paths changed from
implementation_layer/evaluation/ to evaluation_layer/. Update imports
before upgrading.
```

### What to avoid

- Vague messages: `fix stuff`, `update`, `wip`, `changes`
- Mixing unrelated changes in one commit
- Commit messages that only restate the diff without context

---

## Pull request checklist

Before merging into `develop`:

- [ ] Branch is up to date with `develop`
- [ ] CI passes (tests + format check)
- [ ] Commit messages follow the conventions above
- [ ] PR description explains **why** and how to test
- [ ] No secrets, credentials, or `.env` files committed

Before merging into `release/wizard-v2`:

- [ ] All `develop` checklist items satisfied
- [ ] An acceptance round passed on s4 with this commit's tree
- [ ] The release version is clear (see *Solution Wizard V2 releases*)

---

## CI triggers

The Solution Wizard V2 CI (`solution-wizard-v2.yml`) and the stack specs
(`wizard-v2-acceptance.yml`) run on pushes to and pull requests into `develop` and
`release/wizard-v2`; the stack specs also run on a weekday schedule. `test.yml` (the gaik
library) runs on `main` and `dev` and on its schedule from the default branch.

Publishing gaik to PyPI is triggered only by version tags (`v*.*.*`); Solution Wizard V2
releases use `wizard-v2-*` tags and never match it.
