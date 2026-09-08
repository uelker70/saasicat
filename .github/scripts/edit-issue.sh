#!/usr/bin/env bash
# Changes the title and/or body of exactly the issue that triggered this run.
# Nothing more: no labels, assignees, milestones, relations, no other issue,
# no pull request. The workflow allows only this script, not `gh issue edit`
# itself — a prefix rule could not rule out the rest.
#
# Usage: edit-issue.sh [--title "<new title>"] [--body-file <file inside the workspace>]
#
# The issue number comes from the run's event, not from an argument. The new
# body comes from a file, because a multi-line body fails as a shell argument.
set -euo pipefail

fail() {
    echo "edit-issue: $*" >&2
    exit 1
}

jq --version >/dev/null 2>&1 || fail "jq is missing on the runner — the script reads the run's event with it"

[ -f "${GITHUB_EVENT_PATH:-}" ] || fail "no event (GITHUB_EVENT_PATH) — this script only runs inside the workflow"
number=$(jq -r '.issue.number // empty' "$GITHUB_EVENT_PATH")
[[ "$number" =~ ^[0-9]+$ ]] || fail "the event carries no issue (pull request or review event?)"
[ "$(jq -r '.issue.pull_request != null' "$GITHUB_EVENT_PATH")" = "false" ] \
    || fail "#$number is a pull request; only issues are edited"

title=""
body=""
while [ $# -gt 0 ]; do
    case "$1" in
        --title)
            [ $# -ge 2 ] || fail "--title needs a value"
            title="$2"
            shift 2
            ;;
        --body-file)
            [ $# -ge 2 ] || fail "--body-file needs a path"
            body="$2"
            shift 2
            ;;
        *)
            fail "unknown argument '$1' — only --title and --body-file are accepted"
            ;;
    esac
done
[ -n "$title" ] || [ -n "$body" ] || fail "nothing to change: pass --title and/or --body-file"

args=()
[ -z "$title" ] || args+=(--title "$title")
if [ -n "$body" ]; then
    workspace=$(realpath "${GITHUB_WORKSPACE:?}")
    file=$(realpath -e "$body" 2>/dev/null) || fail "file not found: $body"
    case "$file" in
        "$workspace"/*) ;;
        *) fail "the body file must lie inside the workspace: $file" ;;
    esac
    [ -s "$file" ] || fail "the body file is empty: $file"
    args+=(--body-file "$file")
fi

# The repository comes from the run, not from the checkout's git remote.
export GH_REPO="${GITHUB_REPOSITORY:?}"
# Separate assignments, not `echo "$(…)"`: if `gh issue view` fails, the run
# ends here before anything is written — and the log names the state before.
before=$(gh issue view "$number" --json title,body --jq '"\(.title) — \(.body | length) chars"')
echo "before: $before"
gh issue edit "$number" "${args[@]}"
after=$(gh issue view "$number" --json title,body --jq '"\(.title) — \(.body | length) chars"')
echo "after:  $after"
