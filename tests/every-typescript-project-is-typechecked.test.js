import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

// Every TypeScript project in a workspace package is typechecked in CI.
//
// CI's typecheck step is `pnpm -r typecheck`, which reaches a package only
// through a `typecheck` script of its own and skips one without it. A build
// does not stand in for one: a build with declarations is not a typecheck, and
// does not catch every error `tsc --noEmit` does. The packages are the ones
// `pnpm -r` walks, read from `pnpm-workspace.yaml`, and their projects the
// `tsconfig*.json` files in each package directory, so a package or a project
// added later is held to this without being listed here.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The directories a `pnpm-workspace.yaml` pattern names. A segment is either a
 * directory name or `*`, any directory; anything else is a glob this reading
 * does not know, and it fails rather than leaving packages out.
 */
function directoriesOf(pattern) {
    let found = [ROOT];
    for (const segment of pattern.split('/')) {
        if (segment !== '*' && /[*?!{}[\]]/.test(segment)) {
            throw new Error(
                `pnpm-workspace.yaml pattern '${pattern}' is not one this test expands`,
            );
        }
        found = found.flatMap((dir) =>
            segment === '*'
                ? readdirSync(dir)
                      .map((name) => join(dir, name))
                      .filter((path) => statSync(path).isDirectory())
                : [join(dir, segment)],
        );
    }
    return found;
}

/** The TypeScript projects of a package directory, by file name. */
function projectsIn(dir) {
    return readdirSync(dir).filter((name) => name.startsWith('tsconfig') && name.endsWith('.json'));
}

const workspace = parse(readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8'));
const packages = workspace.packages
    .flatMap(directoriesOf)
    .filter((dir) => existsSync(join(dir, 'package.json')))
    .map((dir) => ({
        at: relative(ROOT, dir),
        manifest: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')),
        projects: projectsIn(dir),
    }))
    .filter(({ projects }) => projects.length > 0);

describe('every TypeScript project in a workspace package is typechecked', () => {
    test('the scan finds the projects, a published package and the example among them', () => {
        const found = packages.map(({ at }) => at);
        for (const expected of ['packages/nest', 'examples/notesapp/admin']) {
            assert.ok(found.includes(expected), `${expected} not among ${found.join(', ')}`);
        }
    });

    for (const { at, manifest, projects } of packages) {
        test(`${manifest.name} (${at}) typechecks ${projects.join(' and ')}`, () => {
            const script = manifest.scripts?.typecheck;
            assert.ok(script, `${manifest.name} has no typecheck script, so CI never reaches it`);
            assert.ok(script.includes('--noEmit'), `${manifest.name}: '${script}' emits`);
            for (const project of projects) {
                assert.ok(
                    script.includes(`-p ${project}`),
                    `${manifest.name}: '${script}' leaves ${project} out`,
                );
            }
        });
    }
});
