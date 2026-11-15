// @requirement SC-COMP-002 — A break is deliberate, documented, and belongs to a release that says it is breaking
// @requirement SC-COMP-003 — There is one deliberate break on the way to 1.0, and one guide for it

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// What the candidate line may be asked for before the stable 1.0.0.
//
// Until the stable `1.0.0`, a break is a `minor` with its section in the
// upgrade guide, and `major` is never written (CONTRIBUTING.md, "Versioning and
// releases"). In pre mode the level does not choose the number — every
// changeset releases the next `1.0.0-rc.N` — so nothing in the release itself
// fails on a `major`. This is where the rule is held.

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHANGESETS = join(ROOT, '.changeset');
const PRE = join(CHANGESETS, 'pre.json');
const CONTRIBUTING = join(ROOT, 'CONTRIBUTING.md');
const LEVELS = new Set(['patch', 'minor', 'major', 'none']);
const FENCE = '---';

/** The version the fixed group is on right now. */
function currentVersion() {
    const manifest = join(ROOT, 'packages', 'nest', 'package.json');
    return JSON.parse(readFileSync(manifest, 'utf8')).version;
}

/** Whether a version lies before the stable `1.0.0`: any 0.x, or a prerelease of 1.0.0. */
function isBeforeStableOne(version) {
    const [core, prerelease] = version.split('-', 2);
    const [major, minor, patch] = core.split('.').map(Number);
    if (major === 0) return true;
    return major === 1 && minor === 0 && patch === 0 && prerelease !== undefined;
}

/**
 * The package → level lines of one changeset's frontmatter.
 *
 * Read line by line rather than with one pattern, so that a key in double
 * quotes, in single quotes or bare is read the same way, and a line this
 * cannot read fails the test instead of being skipped — a parser that drops
 * what it does not understand would let exactly the unexpected shape through.
 */
function frontmatterLevels(name) {
    const lines = readFileSync(join(CHANGESETS, name), 'utf8').split('\n');
    assert.equal(lines[0].trim(), FENCE, `${name} does not open with frontmatter`);
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === FENCE);
    assert.notEqual(end, -1, `${name} never closes its frontmatter`);
    return lines
        .slice(1, end)
        .filter((line) => line.trim() !== '')
        .map((line) => {
            const colon = line.lastIndexOf(':');
            const level = line.slice(colon + 1).trim();
            assert.ok(
                colon > 0 && LEVELS.has(level),
                `${name}: cannot read a bump level from "${line}"`,
            );
            return { name, level };
        });
}

/**
 * Changesets not yet released.
 *
 * In pre mode Changesets keeps every changeset already released on this line
 * in `.changeset/` until pre mode is left, and lists it in `pre.json`. Only the
 * others are pending, and only those are judged.
 */
function pendingChangesets(released) {
    return readdirSync(CHANGESETS)
        .filter((name) => name.endsWith('.md') && name !== 'README.md')
        .filter((name) => !released.has(name.slice(0, -'.md'.length)));
}

function preMode() {
    if (!existsSync(PRE)) return undefined;
    return JSON.parse(readFileSync(PRE, 'utf8'));
}

describe('the configured release line can reach the version it is for', () => {
    test('until the stable 1.0.0, no pending changeset asks for a major', () => {
        const pre = preMode();
        if (pre?.mode !== 'pre' || !isBeforeStableOne(currentVersion())) return;

        const majors = pendingChangesets(new Set(pre.changesets))
            .flatMap(frontmatterLevels)
            .filter(({ level }) => level === 'major')
            .map(({ name }) => name);
        assert.deepEqual(
            [...new Set(majors)],
            [],
            `the group is on ${currentVersion()} in pre mode, and a pending changeset asks for ` +
                'a `major`. Until the stable 1.0.0 a break is a `minor`, with its section in ' +
                'docs/guides/upgrade-to-1.0.md (CONTRIBUTING.md, "Versioning and releases").',
        );
    });

    test('and the tag it uses is the tag the docs name', () => {
        const pre = preMode();
        // `changeset pre exit` leaves pre.json with mode "exit" until the version PR
        // removes it; the tag the docs name matters only while the group is in pre mode.
        if (pre === undefined || pre.mode === 'exit') return;
        assert.equal(pre.mode, 'pre', `pre.json exists with mode "${pre.mode}"`);
        assert.ok(
            readFileSync(CONTRIBUTING, 'utf8').includes(`\`${pre.tag}\``),
            `pre mode uses the tag "${pre.tag}", which CONTRIBUTING.md never names`,
        );
    });

    test('the check has a subject either way', () => {
        // Both tests above return early when there is no pre mode — the first
        // also past the stable 1.0.0, or with nothing pending — which is the
        // shape of a guard that passes by having nothing to do. This one fails
        // instead if the things they read stopped existing or stopped being
        // readable: every changeset present, released or not, has to parse.
        assert.match(currentVersion(), /^\d+\.\d+\.\d+/, 'no version to reason about');
        pendingChangesets(new Set()).forEach(frontmatterLevels);
        assert.ok(
            readFileSync(CONTRIBUTING, 'utf8').includes('pre enter rc'),
            'CONTRIBUTING.md no longer documents how the candidate line is opened',
        );
    });
});
