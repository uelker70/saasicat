// A repository is cloned far more often than its images are looked at.
//
// `docs/brands/` held five uncompressed PNGs at 6.9 MB — more than the entire
// source of several packages, in files nothing referenced. They are flat
// illustrations in two colours; re-encoded with a 128-entry palette at sane
// dimensions the same five are 381 KB, and the difference is invisible.
//
// The limit is per file rather than per directory, because that is where the
// decision is made: someone adds one asset, and the one asset is the thing they
// can still fix before committing. The message says how.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Kilobytes a single tracked binary may weigh.
 *
 * Set above the heaviest asset that survived the re-encode (`brand-sheet.png`,
 * 127 KB) with room for one more of its kind, and far below what a
 * straight-from-the-generator PNG costs. A ratchet under RULES 3.7: it moves
 * down when the assets get lighter, never up to admit a new one.
 */
const LIMIT_KB = 200;

/** Text is Prettier's and the linters' problem; this file weighs the rest. */
const TEXT = new Set([
    '.ts',
    '.mts',
    '.cts',
    '.js',
    '.mjs',
    '.cjs',
    '.vue',
    '.md',
    '.json',
    '.yaml',
    '.yml',
    '.css',
    '.scss',
    '.html',
    '.txt',
    '.sql',
    '.prisma',
    '.tpl',
    '.snap',
    '.svg',
    '.editorconfig',
]);

function trackedBinaries() {
    return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
        .split('\0')
        .filter(Boolean)
        .filter((path) => {
            const dot = path.lastIndexOf('.');
            const extension = dot === -1 ? '' : path.slice(dot);
            return !TEXT.has(extension);
        });
}

describe('no tracked binary is heavier than it needs to be', () => {
    const binaries = trackedBinaries();

    test('the sweep finds the assets it claims to weigh', () => {
        // Vacuously true on an empty list — and the extension filter is exactly
        // the kind of thing that quietly matches nothing after a rename.
        assert.ok(
            binaries.some((path) => path.endsWith('.png')),
            'no PNG reached the sweep',
        );
    });

    test(`every tracked binary stays under ${LIMIT_KB} KB`, () => {
        const heavy = binaries
            .map((path) => ({ path, kb: Math.round(statSync(join(ROOT, path)).size / 1024) }))
            .filter(({ kb }) => kb > LIMIT_KB)
            .map(({ path, kb }) => `${path} — ${kb} KB`);

        assert.deepEqual(
            heavy,
            [],
            'Re-encode before committing. For flat illustrations:\n' +
                '  pnpm dlx sharp-cli --input x.png --output ./dir -f png --palette --colors 128 -c 9 resize 1200\n' +
                heavy.join('\n'),
        );
    });
});
