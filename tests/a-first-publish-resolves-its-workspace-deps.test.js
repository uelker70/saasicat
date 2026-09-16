// @requirement SC-COMP-001 — All packages carry one version number and move together

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The first publish of a new package is the one step outside the release
// workflow, and CONTRIBUTING.md has to name the tool that does it correctly.
//
// `workspace:^` is a protocol only the workspace understands. pnpm replaces it
// with the concrete version while it packs; npm ships it verbatim, and the
// tarball then installs nowhere — `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` in any
// repository that is not this one. `@saasicat/payment-stripe@1.0.0-rc.18` went
// out that way, from an instruction in this file that said `npm publish`, and it
// could not be taken back: it was the package's only version, and npm refuses to
// delete the last one.
//
// So this holds the instruction to the manifests rather than to itself. While a
// published package depends on a sibling through `workspace:`, the first-publish
// section says `pnpm publish` and does not say `npm publish` — and the day none
// of them does, the advice may go rather than stand for a reason that has gone.

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * The commands the first-publish section tells a maintainer to run.
 *
 * Read out of the fenced blocks rather than off the prose, because the prose
 * names `npm publish` in order to forbid it — and a guard that cannot tell an
 * instruction from a prohibition would be satisfied by deleting the warning.
 */
function firstPublishCommands() {
    const text = readFileSync(join(ROOT, 'CONTRIBUTING.md'), 'utf8');
    const start = text.indexOf('### A new package needs one manual first publish');
    assert.notEqual(start, -1, 'the first-publish section was renamed; this guard points at it');
    // To the next `##` or `###`, not to the next chapter: a `###` added under
    // this chapter later would otherwise be read as part of this section, and
    // its commands judged by a rule written for another one. Deeper headings
    // are not boundaries — nothing in this file uses them, and a `####` under
    // this very section would still be part of it.
    const body = text.slice(start + 1);
    const next = body.search(/\n#{2,3} /);
    const section = next === -1 ? body : body.slice(0, next);

    const lines = [];
    let inside = false;
    for (const line of section.split('\n')) {
        if (line.trimStart().startsWith('```')) {
            inside = !inside;
            continue;
        }
        // Commands only. A `#` line inside a fence is prose that happens to be
        // indented, and reading it as an instruction is how a comment saying
        // "never npm publish here" would turn this guard red on a document that
        // is right.
        const command = line.trim();
        if (inside && command !== '' && !command.startsWith('#')) lines.push(command);
    }
    assert.ok(lines.length > 0, 'the first-publish section shows no command at all');
    return lines;
}

/** Published packages whose dependencies reach a sibling through `workspace:`. */
function publishedPackagesUsingWorkspaceProtocol() {
    const base = join(ROOT, 'packages');
    const found = [];
    for (const name of readdirSync(base)) {
        const file = join(base, name, 'package.json');
        if (!existsSync(file)) continue;
        const manifest = JSON.parse(readFileSync(file, 'utf8'));
        if (manifest.private) continue;
        const ranges = Object.values({
            ...manifest.dependencies,
            ...manifest.peerDependencies,
            ...manifest.optionalDependencies,
        });
        if (ranges.some((range) => String(range).startsWith('workspace:')))
            found.push(manifest.name);
    }
    return found;
}

describe('the manual first publish', () => {
    test('is told to use the tool that resolves `workspace:`', () => {
        const affected = publishedPackagesUsingWorkspaceProtocol();
        assert.ok(
            affected.length > 0,
            'no published package uses the workspace protocol any more — this guard, and the ' +
                'paragraph it holds, can go',
        );
        const commands = firstPublishCommands();
        assert.ok(
            commands.some((line) => /(^|\s)pnpm publish\b/.test(line)),
            `${affected.length} published packages depend on a sibling through \`workspace:\`, and ` +
                `the first-publish section shows no \`pnpm publish\`: ${commands.join(' / ')}`,
        );
        // Anywhere on the line, not only at its start — `cd packages/x && npm
        // publish` is the same instruction. The boundary keeps `pnpm publish`
        // from matching, which sharing a suffix would otherwise do.
        const npmPublish = commands.filter((line) => /(^|\s)npm publish\b/.test(line));
        assert.deepEqual(
            npmPublish,
            [],
            'the first-publish section tells a maintainer to run `npm publish`, which ships ' +
                '`workspace:` verbatim and produces a tarball that installs nowhere',
        );
    });
});
