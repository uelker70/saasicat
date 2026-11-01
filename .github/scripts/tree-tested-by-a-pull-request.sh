#!/usr/bin/env bash
# Whether a pull request's CI run has already tested exactly the code a push to
# `main` brings. "Exactly" is the tree — Git's hash over every file — so the
# answer does not depend on timing: a squash merge lands the tree the pull
# request's run merged and tested, unless `main` moved after that run, and then
# the tree differs and every job runs.
#
# Every `pull_request` run of the CI workflow uploads an artifact named
# `tested-tree-<tree>`. This script looks for one among the successful runs of
# the pull request merged as `SHA` and writes `tested=true` or `tested=false`
# to `$GITHUB_OUTPUT`, with the reason in the step summary. A commit that no
# pull request brought, a run from before the artifact existed, or a run that
# failed answers `false`.
#
# Environment: REPO (owner/name), SHA (the pushed commit), TREE (its tree),
# GITHUB_OUTPUT, GH_TOKEN for `gh`. A question it cannot ask fails the step;
# the workflow then runs every job rather than skip one on a guess.
set -euo pipefail

: "${REPO:?REPO names the repository}"
: "${SHA:?SHA names the pushed commit}"
: "${TREE:?TREE names the commit tree}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is where the answer goes}"

answer() {
    echo "tested=$1" >>"$GITHUB_OUTPUT"
    echo "$2"
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "$2" >>"$GITHUB_STEP_SUMMARY"; fi
}

heads=$(gh api "repos/$REPO/commits/$SHA/pulls" --jq '.[] | select(.merged_at != null) | .head.sha')
if [ -z "$heads" ]; then
    answer false "No merged pull request brought $SHA, so every job runs."
    exit 0
fi

for head in $heads; do
    runs=$(gh api "repos/$REPO/actions/workflows/ci.yml/runs?event=pull_request&head_sha=$head&status=success&per_page=20" \
        --jq '.workflow_runs[].id')
    for run in $runs; do
        names=$(gh api "repos/$REPO/actions/runs/$run/artifacts" --jq '.artifacts[] | select(.expired | not) | .name')
        if printf '%s\n' "$names" | grep -qxF "tested-tree-$TREE"; then
            answer true "Tree $TREE was tested by the successful pull request run $run (https://github.com/$REPO/actions/runs/$run), so the jobs are skipped."
            exit 0
        fi
    done
done

answer false "No successful pull request run tested tree $TREE — main moved after it, or it predates the record — so every job runs."
