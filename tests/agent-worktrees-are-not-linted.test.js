import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

// A coding-agent session places its git worktrees under `.claude/`, which puts
// a second checkout of the whole repository inside this one. Every tool that
// walks the tree then reports another branch's files as if they were ours:
// `pnpm exec eslint .` and `pnpm run format:check` both did, and `git status`
// showed `?? .claude/` on an otherwise clean tree. A gate that fails for a
// reason outside the change under test teaches contributors to reach for
// `--ignore-pattern`, and the next real failure goes out with it.
//
// One decision, two files: `.gitignore` — which Git obeys and which Prettier
// reads by default, so `.prettierignore` needs no third copy — and the
// `ignores` list in `eslint.config.mjs`, because flat config reads no ignore
// file of its own. Two hand-written copies drift, so this test asks both tools
// the same question instead of scanning either file for a string.
//
// The second half is the half that matters: an ignore wide enough to swallow
// the source tree along with the worktree would be worse than the problem.

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** A file that exists only because an agent session put a worktree here. */
const INSIDE_AGENT_WORKTREE = '.claude/worktrees/agent-1/packages/saas-platform-nest/src/index.ts';

/** The same path in the tree the gates are actually about. */
const IN_THE_SOURCE_TREE = 'packages/saas-platform-nest/src/index.ts';

/**
 * Whether Git ignores a path. `check-ignore` answers for paths that do not
 * exist, so the probe needs no worktree on disk.
 *
 * The index matters, and the two probes want opposite answers from it. Asking
 * "will `git status` list this?" is the index-aware question, and that is the
 * one the worktree probe asks. Asking "would a widened rule hide a source file
 * somebody creates tomorrow?" is not: `check-ignore` suppresses a match for a
 * path already tracked, so a rule broad enough to swallow `src/` would answer
 * "not ignored" for every file in it and the negative probe would pass while
 * the damage it exists to catch was done. `--no-index` asks the rules alone.
 */
function gitIgnores(path, { ignoreIndex = false } = {}) {
    const flags = ignoreIndex ? ['--no-index'] : [];
    try {
        execFileSync('git', ['check-ignore', '--quiet', ...flags, path], { cwd: REPO_ROOT });
        return true;
    } catch (error) {
        if (error.status === 1) return false;
        throw error;
    }
}

describe('agent worktrees under .claude/ stay out of the repo-wide gates', () => {
    const eslint = new ESLint({ cwd: REPO_ROOT });

    test('git ignores them — this keeps `git status` clean and Prettier out', () => {
        assert.equal(
            gitIgnores(INSIDE_AGENT_WORKTREE),
            true,
            `${INSIDE_AGENT_WORKTREE} is not ignored by .gitignore. ` +
                'Restore the `.claude/` entry: without it `git status` reports the ' +
                "worktree and `prettier --check .` walks into another branch's files.",
        );
    });

    test('eslint ignores them', async () => {
        assert.equal(
            await eslint.isPathIgnored(INSIDE_AGENT_WORKTREE),
            true,
            `${INSIDE_AGENT_WORKTREE} is not ignored by eslint.config.mjs. ` +
                'Flat config does not read .gitignore, so the `**/.claude/**` entry ' +
                'in the `ignores` list is what keeps `eslint .` on this checkout.',
        );
    });

    test('and the ignore stops there — the source tree is still checked', async () => {
        assert.equal(
            gitIgnores(IN_THE_SOURCE_TREE, { ignoreIndex: true }),
            false,
            `${IN_THE_SOURCE_TREE} is ignored by .gitignore — the ignore widened past its ` +
                'target. Asked without the index, because a rule that covers a tracked file ' +
                'still lets `check-ignore` answer "not ignored" — the damage would be to the ' +
                'files nobody has created yet.',
        );
        assert.equal(
            await eslint.isPathIgnored(IN_THE_SOURCE_TREE),
            false,
            `${IN_THE_SOURCE_TREE} is ignored by eslint.config.mjs — the ignore widened past its target.`,
        );
    });
});
