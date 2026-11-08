// What leaves this repository and is read by somebody outside it.
//
// The repository-wide guards that hold a promise about shipped text — its
// language, what it says about the licence — read the same set of files, so
// the set is decided here once rather than once per guard.

import { execFileSync } from 'node:child_process';

/**
 * What carries prose somebody reads, which is wider than "source".
 *
 * `.yaml` is here because `@saasicat/spec` ships `admin-api.openapi.yaml` and
 * calls it normative; `.json` because the four JSON Schemas hold 68
 * `description` strings that are the field-by-field documentation of the
 * platform contract, and because a `package.json` description is what npm
 * shows. The example's operational files are here for the plainest reason of
 * all: they are the first thing anybody runs.
 */
const SHIPPED =
    /\.(ts|mts|cts|js|mjs|cjs|vue|md|prisma|sql|css|scss|html|tpl|ya?ml|jsonc?|sh|conf|example)$/;

/** Shipped files a stranger reads that carry no extension at all. */
const SHIPPED_BY_NAME = new Set(['Dockerfile', 'Makefile']);
const IS_TEST = /\.(test|spec)\.[cm]?[jt]sx?$/;

/**
 * Whether a repository-relative path is something a stranger reads.
 *
 * The test tree is out: its fixtures are the data of an installation, not
 * prose the platform says. `CHANGELOG.md` is published history, written by
 * Changesets from the pending `.changeset/*.md`, which are in.
 */
export function isShipped(path) {
    const name = path.split('/').at(-1);
    if (!SHIPPED.test(path) && !SHIPPED_BY_NAME.has(name.split('.')[0])) return false;
    // The changeset config, not a release note.
    if (path.startsWith('.changeset/') && !path.endsWith('.md')) return false;
    if (path.endsWith('CHANGELOG.md')) return false;
    // Tool-owned: nobody writes it, and the extension list would otherwise take it.
    if (name === 'pnpm-lock.yaml') return false;
    const parts = path.split('/');
    if (parts.includes('tests') || parts.includes('node_modules')) return false;
    return !IS_TEST.test(parts.at(-1));
}

/** Every tracked file under `root` that ships, as repository-relative paths. */
export function shippedFiles(root) {
    return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
        .split('\n')
        .filter(Boolean)
        .filter(isShipped);
}
