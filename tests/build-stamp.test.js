import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    inputsHash,
    isCurrent,
    readWorkspace,
    writeStamp,
    writesStamp,
} from '../scripts/build-stamp.mjs';

// The stamp decides whether `pnpm run coverage` may skip a build. The three
// inputs a heuristic once missed — a deleted source file, the build config,
// a helper the config imports — are all files in the package, so the hash
// sees them by construction. What has to be proven is the shape: an edit
// anywhere in the package or its workspace dependencies changes it, an edit
// to a test does not, and the result does not depend on when it was computed.

function scratch() {
    const root = mkdtempSync(join(tmpdir(), 'saasicat-stamp-'));
    const pkg = (name, deps = {}) => {
        const dir = join(root, 'packages', name);
        mkdirSync(join(dir, 'src'), { recursive: true });
        mkdirSync(join(dir, 'tests'), { recursive: true });
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify({ name: `@t/${name}`, scripts: { build: 'x' }, dependencies: deps }),
        );
        writeFileSync(join(dir, 'src', 'index.ts'), 'export const a = 1;\n');
        writeFileSync(join(dir, 'tests', 'a.test.js'), '// a\n');
        return dir;
    };
    return { root, pkg, workspace: () => readWorkspace(root) };
}

describe('the build stamp', () => {
    test('is stable across runs and changes with a source edit', () => {
        const { root, pkg, workspace } = scratch();
        const dir = pkg('a');
        const before = inputsHash(dir, workspace(), root);
        assert.equal(inputsHash(dir, workspace(), root), before, 'not deterministic');
        writeFileSync(join(dir, 'src', 'index.ts'), 'export const a = 2;\n');
        assert.notEqual(inputsHash(dir, workspace(), root), before);
        rmSync(root, { recursive: true });
    });

    test('sees a deleted file and a build config, not a test', () => {
        const { root, pkg, workspace } = scratch();
        const dir = pkg('a');
        writeFileSync(join(dir, 'src', 'gone.ts'), 'export const g = 1;\n');
        const withFile = inputsHash(dir, workspace(), root);
        rmSync(join(dir, 'src', 'gone.ts'));
        const without = inputsHash(dir, workspace(), root);
        assert.notEqual(without, withFile, 'a deleted source file went unseen');

        writeFileSync(join(dir, 'tsup.config.ts'), 'export default {};\n');
        assert.notEqual(
            inputsHash(dir, workspace(), root),
            without,
            'the build config went unseen',
        );

        const beforeTest = inputsHash(dir, workspace(), root);
        writeFileSync(join(dir, 'tests', 'a.test.js'), '// b\n');
        assert.equal(
            inputsHash(dir, workspace(), root),
            beforeTest,
            'a test edit forced a rebuild',
        );
        rmSync(root, { recursive: true });
    });

    test('a dependency edit makes the dependent stale', () => {
        const { root, pkg, workspace } = scratch();
        const dep = pkg('dep');
        const app = pkg('app', { '@t/dep': 'workspace:^' });
        writeStamp(app, workspace());
        assert.equal(isCurrent(app, workspace()), true);
        writeFileSync(join(dep, 'src', 'index.ts'), 'export const a = 3;\n');
        assert.equal(
            isCurrent(app, workspace()),
            false,
            'a stale dependency left the dependent current',
        );
        rmSync(root, { recursive: true });
    });

    test('no stamp means not current', () => {
        const { root, pkg, workspace } = scratch();
        assert.equal(isCurrent(pkg('a'), workspace()), false);
        rmSync(root, { recursive: true });
    });
});

describe('which builds are judged at all', () => {
    test('only a build through build-and-prune writes a stamp', () => {
        const { root, pkg } = scratch();
        const wrapped = pkg('w');
        writeFileSync(
            join(wrapped, 'package.json'),
            JSON.stringify({
                name: '@t/w',
                scripts: { build: 'node ../../scripts/build-and-prune.mjs tsup' },
            }),
        );
        assert.equal(writesStamp(wrapped), true);
        assert.equal(writesStamp(pkg('bare')), false, 'a `tsc` build has no stamp to read');
        rmSync(root, { recursive: true });
    });
});

describe('a build that does not finish leaves no stamp', () => {
    test('the previous stamp is gone before the build starts', () => {
        const { root, pkg } = scratch();
        const dir = pkg('a');
        mkdirSync(join(dir, 'dist'), { recursive: true });
        writeFileSync(join(dir, 'dist', '.build-stamp'), 'from-an-earlier-build\n');
        const wrapper = resolve(
            dirname(fileURLToPath(import.meta.url)),
            '../scripts/build-and-prune.mjs',
        );
        const result = spawnSync(process.execPath, [wrapper, 'exit 1'], {
            cwd: dir,
            encoding: 'utf8',
        });
        assert.notEqual(result.status, 0, 'the failing build was reported as a success');
        assert.equal(
            existsSync(join(dir, 'dist', '.build-stamp')),
            false,
            'a failed build left the old stamp, so the partial dist/ would pass as current',
        );
        rmSync(root, { recursive: true });
    });

    test('the lockfile is an input', () => {
        const { root, pkg, workspace } = scratch();
        const dir = pkg('a');
        const before = inputsHash(dir, workspace(), root);
        writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
        assert.notEqual(
            inputsHash(dir, workspace(), root),
            before,
            'a lockfile change went unseen',
        );
        rmSync(root, { recursive: true });
    });
});
