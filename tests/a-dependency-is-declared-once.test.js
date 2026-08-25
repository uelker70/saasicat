import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// One package, one range.
//
// `quasar` sat in `dependencies` and `devDependencies` of the same manifest
// with the same range — harmless until one of them is bumped, after which the
// installed version depends on which block the resolver reads and the answer
// differs between package managers. Nothing said so.
//
// `peerDependencies` is deliberately exempt on one axis: a peer paired with a
// devDependency is the documented way to develop against the thing you expect
// the host to provide. A peer paired with a real `dependency` is not — that is
// asking the host for something you already install.

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function manifests() {
    const found = [];
    for (const group of ['packages', 'examples']) {
        const base = join(ROOT, group);
        if (!existsSync(base)) continue;
        for (const name of readdirSync(base)) {
            const file = join(group, name, 'package.json');
            if (existsSync(join(ROOT, file))) found.push(file);
        }
    }
    found.push('package.json');
    return found;
}

describe('a dependency is declared once', () => {
    const packages = manifests().map((file) => ({
        file,
        json: JSON.parse(readFileSync(join(ROOT, file), 'utf8')),
    }));

    test('the sweep finds the manifests', () => {
        // The assertions below are lookups in these objects. On an empty list
        // they hold, and a moved workspace would read as a clean result.
        assert.ok(packages.length > 5, `only ${packages.length} manifests found`);
        assert.ok(
            packages.some(({ json }) => Object.keys(json.dependencies ?? {}).length > 0),
            'no manifest declares a dependency — the field names must have changed',
        );
    });

    test('nothing is both a dependency and a devDependency', () => {
        const offenders = packages.flatMap(({ file, json }) =>
            Object.keys(json.dependencies ?? {})
                .filter((name) => name in (json.devDependencies ?? {}))
                .map((name) => `${file}: ${name}`),
        );
        assert.deepEqual(offenders, [], 'pick the block that describes how it is used');
    });

    test('nothing is both a dependency and a peer', () => {
        // A peer asks the host to provide it. Installing it as well means the
        // host's copy is not the one that gets used, which is the failure
        // `resolve.dedupe` exists to paper over.
        const offenders = packages.flatMap(({ file, json }) =>
            Object.keys(json.dependencies ?? {})
                .filter((name) => name in (json.peerDependencies ?? {}))
                .map((name) => `${file}: ${name}`),
        );
        assert.deepEqual(offenders, []);
    });
});
