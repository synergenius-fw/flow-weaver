# Branch protection ruleset — source of truth

`main.json` is the canonical spec for the `main` branch-protection
ruleset. It mirrors the same trunk-based policy the
`flow-weaver-platform` repo enforces: **nobody pushes raw commits to
`main`**; every change lands through a `feature/* → main` PR with a
code-owner review and green CI.

| File        | Branch |
| ----------- | ------ |
| `main.json` | `main` |

## What it enforces

- **No direct pushes to `main`.** Deletion + non-fast-forward blocked,
  linear history required.
- **PR required**, 1 approving review, code-owner review
  (`.github/CODEOWNERS`), squash-merge only, stale reviews dismissed on
  push.
- **Required status checks** (strict): `check`, `build`,
  `test (1)`, `test (2)`, `test (3)`.
- **Bypass actors** (`bypass_mode: pull_request`): @moraispgsi (owner)
  and @otelom (co-admin) can merge a PR without satisfying every rule as
  the emergency escape hatch, but can NO LONGER push raw commits to
  `main`. Everyone, admins included, goes through a PR.

## How changes land

Edit `main.json`, open a `feature/* → main` PR, merge. Unlike the
platform repo there is no `ruleset-guard` workflow here, so after the
spec changes an admin re-applies it to the live ruleset:

```sh
# find the ruleset id
gh api repos/synergenius-fw/flow-weaver/rulesets \
  | jq '.[] | select(.name=="main branch protection") | .id'

# apply the committed spec
gh api -X PUT repos/synergenius-fw/flow-weaver/rulesets/<id> \
  --input .github/rulesets/main.json
```

To create it the first time (no id yet):

```sh
gh api -X POST repos/synergenius-fw/flow-weaver/rulesets \
  --input .github/rulesets/main.json
```

## Verifying the live state

```sh
gh api repos/synergenius-fw/flow-weaver/rulesets/<id> \
  | jq -S 'del(.id, .source_type, .source, .node_id, .created_at, .updated_at, .current_user_can_bypass, ._links)' \
  > /tmp/main-live.json
diff -u <(jq -S '.' .github/rulesets/main.json) /tmp/main-live.json
```

## Emergency exceptions

If a rule genuinely needs relaxing (incident, stuck merge the bypass
actors do not cover), the right path is a fast PR to `main.json` plus the
`PUT` above. Do NOT flip the ruleset via the UI without landing the spec
change too, or the committed spec stops matching what is enforced and
nobody can tell what is actually live.
