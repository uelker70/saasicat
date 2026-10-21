import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Every TypeScript project in a package is typechecked in CI.
//
// CI's typecheck step is `pnpm -r typecheck`, which reaches a package only
// through a `typecheck` script of its own. A build does not stand in for one:
// a build with declarations is not a typecheck, and does not catch every error
// `tsc --noEmit` does. The projects are read from the `tsconfig*.json` files in
// each package directory, so a package or a project added later is held to
// this without being listed here.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = join(ROOT, 'packages');

/** The TypeScript projects of a package directory, by file name. */
function projectsIn(dir) {
    return readdirSync(dir).filter((name) => name.startsWith('tsconfig') && name.endsWith('.json'));
}

const packages = readdirSync(PACKAGES)
    .map((dir) => join(PACKAGES, dir))
    .filter((dir) => existsSync(join(dir, 'package.json')))
    .map((dir) => ({
        manifest: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')),
        projects: projectsIn(dir),
    }))
    .filter(({ projects }) => projects.length > 0);

describe('every TypeScript project in a package is typechecked', () => {
    test('the scan finds the projects, among them the platform module', () => {
        assert.ok(
            packages.some(({ manifest }) => manifest.name === '@saasicat/nest'),
            `found ${packages.map(({ manifest }) => manifest.name).join(', ') || 'none'}`,
        );
    });

    for (const { manifest, projects } of packages) {
        test(`${manifest.name} typechecks ${projects.join(' and ')}`, () => {
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
