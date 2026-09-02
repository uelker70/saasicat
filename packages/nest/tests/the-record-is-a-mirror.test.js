// Nothing reads the record of the applied settings to decide behaviour.
//
// The behavioural half of that promise is in `a-boot-records-what-it-applied`:
// a record disagreeing with the file changes nothing about what runs. This is
// the structural half, and it is the one that holds tomorrow: a service that
// started reading `applied_settings` for a default would pass every existing
// behavioural test right up to the boot where the file and the record disagree.
//
// So the port is reachable from exactly the files that mirror and show it, and
// a new importer fails here with its path. Read off the source rather than off
// `dist/`, because the bundle folds every file into one chunk and the question
// is which FILE reaches for the token.

// @requirement SC-CFG-026 — The record of the applied configuration is a mirror, never a source

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** The files that may know the port exists: the record's own directory. */
const MIRROR_DIR = 'settings';

/** The names a file would have to mention to reach the record. */
const HANDLES = ['APPLIED_SETTINGS_PORT_TOKEN', 'AppliedSettingsPort', 'appliedSettings'];

function sourceFiles(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) sourceFiles(path, out);
        else if (entry.endsWith('.ts')) out.push(path);
    }
    return out;
}

/**
 * Files outside the record's directory that name one of the handles, with the
 * reason each is allowed to.
 *
 * The composition layer binds the port — that is wiring, not reading — and
 * `module-options.ts` declares the slot a consumer overrides it through. Each
 * is listed with its line so a reader can check the claim, and anything else
 * fails.
 */
const WIRING = new Map([
    ['platform/saasicat.module.ts', 'merges the bundle slice into the adapter slots'],
    ['platform/module-options.ts', 'declares the `adapters.appliedSettings` slot'],
    ['platform/compose/base.ts', 'hands the port to SettingsModule'],
]);

describe('the applied-settings port', () => {
    const mentions = sourceFiles(SRC)
        .filter((file) => !relative(SRC, file).startsWith(`${MIRROR_DIR}/`))
        .filter((file) => {
            const text = readFileSync(file, 'utf8');
            return HANDLES.some((handle) => text.includes(handle));
        })
        .map((file) => relative(SRC, file));

    test('the scan sees the wiring, so an empty result is not a broken scan', () => {
        assert.ok(mentions.includes('platform/compose/base.ts'), mentions);
    });

    test('is reached from the record and its wiring, and from nowhere else', () => {
        const readers = mentions.filter((file) => !WIRING.has(file));
        assert.deepEqual(
            readers,
            [],
            'A file outside src/settings/ reaches for the applied-settings port. The record is a\n' +
                'mirror of config/saas.yaml, never a source: read the catalogue instead.\n' +
                readers.join('\n'),
        );
    });

    test('every wiring exemption is still there to be exempted', () => {
        for (const file of WIRING.keys()) {
            assert.ok(
                mentions.includes(file),
                `${file} no longer mentions the port — drop the exemption`,
            );
        }
    });

    test('the record itself never reads a setting out of what it stored', () => {
        // The recorder reads the record to compare, and the controller to show.
        // Neither hands a stored value to anything that decides — which shows
        // in the imports: nothing under src/settings/ imports a token another
        // DOMAIN decides with. Named file by file rather than by directory, so
        // the next import into this directory is argued for rather than
        // admitted by where it happens to sit:
        //   - the catalogue token, because the record mirrors the catalogue;
        //   - the DI helper and the email token, which decide nothing;
        //   - the error envelope, likewise;
        //   - the audit logger — the one hop out, into `admin/`: it WRITES the
        //     acknowledgement to the trail through an `@Optional()` service,
        //     and reads nothing back.
        const ALLOWED = [
            '/billing/plan-catalog.module.js',
            '/core/di.js',
            '/core/email.tokens.js',
            '/core/web-audit.js',
            '/errors/coded-error.js',
        ];
        for (const file of sourceFiles(join(SRC, MIRROR_DIR))) {
            const text = readFileSync(file, 'utf8');
            const imports = [...text.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
            const foreign = imports.filter(
                (specifier) =>
                    specifier.startsWith('../') &&
                    !ALLOWED.some((allowed) => specifier.endsWith(allowed)),
            );
            assert.deepEqual(foreign, [], `${relative(SRC, file)} imports ${foreign.join(', ')}`);
        }
    });
});
