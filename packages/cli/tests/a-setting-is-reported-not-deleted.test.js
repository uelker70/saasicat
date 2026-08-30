import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    applyTokens,
    findMovedSettings,
    SCANNED_FOR_MOVED_SETTINGS,
    planInit,
    settingsWrittenTo,
    SETTINGS_THAT_MOVED,
    WHERE_IT_GOES,
} from '../dist/index.js';
import { planCatalogSchema } from '@saasicat/spec';

// Two halves of the same migration, and they pull in opposite directions on
// purpose.
//
// `init` writes the settings and then says so — a required field with no
// default is one a new integrator has to find, and finding it from a boot
// failure six weeks later is the expensive way.
//
// The codemod finds them in existing code and REPORTS them. It does not delete
// them, and that is the decision under test: the value is a term somebody
// agreed, and removing it from the code without writing it into the file would
// leave the application running on whatever the file happens to say.

const TEMPLATES = fileURLToPath(new URL('../templates/init', import.meta.url));

async function generatedCatalog(options = { appKey: 'notesapp', quotas: ['notes:Note'] }) {
    const plan = planInit(options);
    const file = plan.files.find((f) => f.path === 'config/saas.yaml');
    const template = await readFile(join(TEMPLATES, `${file.template}.tpl`), 'utf8');
    return applyTokens(template, { ...plan.tokens, ...file.tokens });
}

describe('what init says about the settings it wrote', () => {
    test('every member is reported, flattened to the path it has in the file', async () => {
        const settings = settingsWrittenTo(await generatedCatalog());
        assert.deepEqual(settings, [
            { key: 'tenantBilling.cancellationNoticeDays.monthly', value: '0' },
            { key: 'tenantBilling.cancellationNoticeDays.yearly', value: '0' },
            { key: 'tenantBilling.selfServiceBlockedPlans.asTarget', value: '[]' },
            { key: 'tenantBilling.selfServiceBlockedPlans.asSource', value: '[]' },
        ]);
    });

    test('an empty list reads as one, rather than as nothing at all', async () => {
        const settings = settingsWrittenTo(await generatedCatalog());
        const lists = settings.filter((s) => s.key.includes('selfServiceBlockedPlans'));
        assert.equal(lists.length, 2);
        // `[]` rather than an empty string: the report exists to show that a
        // decision was made, and a blank would show the opposite.
        for (const { value } of lists) assert.equal(value, '[]');
    });

    test('the report is read off the document, so it follows what the template writes', async () => {
        const yaml = (await generatedCatalog()).replace('monthly: 0', 'monthly: 30');
        const settings = settingsWrittenTo(yaml);
        assert.deepEqual(
            settings.find((s) => s.key.endsWith('cancellationNoticeDays.monthly')),
            { key: 'tenantBilling.cancellationNoticeDays.monthly', value: '30' },
        );
    });

    test('a catalogue the platform would refuse fails here, not at the first boot', async () => {
        const broken = (await generatedCatalog()).replace('    yearly: 0\n', '');
        assert.throws(() => settingsWrittenTo(broken), /yearly/);
    });
});

describe('what the codemod says about a setting still passed in code', () => {
    const source = `
export const CONFIG = defineSaaSiCat({
    tenantBilling: {
        authGuards: [JwtAuthGuard],
        cancellationNoticeDays: { monthly: 30, yearly: 90 },
        selfServiceBlockedPlans: {
            asTarget: ['ENTERPRISE'],
        },
    },
});
`;

    test('names both, with the line each is on', () => {
        const { occurrences } = findMovedSettings(source);
        assert.deepEqual(occurrences, [
            { setting: 'cancellationNoticeDays', line: 5 },
            { setting: 'selfServiceBlockedPlans', line: 6 },
        ]);
    });

    test('the set is read off the schema, not written out beside it', () => {
        // Both halves of the migration derive from `plan-catalog.schema.json`:
        // the codemod that names a setting and the module that refuses it. A
        // third setting moving into that block reaches both without either
        // being edited — and this is what says so.
        assert.deepEqual(
            [...SETTINGS_THAT_MOVED].sort(),
            Object.keys(planCatalogSchema.properties.tenantBilling.properties).sort(),
        );
    });

    test('every setting the schema names has a sentence saying where it goes', () => {
        // The derivation makes the set grow on its own; the sentence does not.
        // A third setting arriving without one would otherwise be reported with
        // `undefined` under it.
        for (const setting of SETTINGS_THAT_MOVED) {
            assert.ok(WHERE_IT_GOES[setting], `no destination sentence for ${setting}`);
        }
    });

    test('says where each one goes, separately', () => {
        for (const setting of SETTINGS_THAT_MOVED) {
            assert.match(WHERE_IT_GOES[setting], /config\/saas\.yaml/);
            // `includes`, not a pattern built from the name.
            assert.ok(WHERE_IT_GOES[setting].includes(setting));
        }
        // One sentence per setting, not one for both: they land in the same
        // block and mean different things, and "move these two" is the
        // instruction people follow halfway.
        assert.notEqual(
            WHERE_IT_GOES.cancellationNoticeDays,
            WHERE_IT_GOES.selfServiceBlockedPlans,
        );
    });

    test('leaves the source untouched — there is nothing to write back', () => {
        const result = findMovedSettings(source);
        assert.equal('text' in result, false);
        assert.equal(Object.keys(result).length, 1);
    });

    test('a longer identifier that merely contains the name is not reported', () => {
        // Both boundaries, and both with a name that really does contain the
        // string: `legacyCancellationNoticeDays` capitalises the C and could
        // never have matched, so a test built on it proves nothing about the
        // rule it is named after.
        const { occurrences } = findMovedSettings(
            ['const _cancellationNoticeDays = 30;', 'const cancellationNoticeDaysV2 = 30;'].join(
                '\n',
            ),
        );
        assert.deepEqual(occurrences, []);
    });

    test('reads the value back as well as writing it — the same migration, later', () => {
        const { occurrences } = findMovedSettings(
            'const days = options.cancellationNoticeDays ?? 0;\n',
        );
        assert.deepEqual(occurrences, [{ setting: 'cancellationNoticeDays', line: 1 }]);
    });

    test('a file that passes nothing produces no report at all', () => {
        const { occurrences } = findMovedSettings(
            'export const CONFIG = defineSaaSiCat({ tenantBilling: { authGuards: [G] } });\n',
        );
        assert.deepEqual(occurrences, []);
    });

    // Codex found this on #249: the walk includes Markdown, both consumers keep
    // large documentation folders, and an upgrade note mentioning the setting
    // would land in the report beside the line somebody has to change.
    test('prose is not scanned — it cannot pass a module option', () => {
        for (const file of ['docs/upgrade.md', 'CHANGELOG.md', 'README.md']) {
            assert.equal(SCANNED_FOR_MOVED_SETTINGS.test(file), false, file);
        }
    });

    test('code is', () => {
        for (const file of [
            'src/saasicat.config.ts',
            'src/app.module.js',
            'src/config.mts',
            'src/config.cjs',
            'src/Billing.vue',
        ]) {
            assert.equal(SCANNED_FOR_MOVED_SETTINGS.test(file), true, file);
        }
    });

    // The other half of the trade the matching makes. Requiring a colon would
    // read as "only a property" and would miss both of these, which are
    // ordinary ways to pass the same option.
    test('a shorthand property is reported', () => {
        const { occurrences } = findMovedSettings(
            'const opts = { authGuards, cancellationNoticeDays };\n',
        );
        assert.deepEqual(occurrences, [{ setting: 'cancellationNoticeDays', line: 1 }]);
    });

    test('a destructured read is reported', () => {
        const { occurrences } = findMovedSettings('const { selfServiceBlockedPlans } = options;\n');
        assert.deepEqual(occurrences, [{ setting: 'selfServiceBlockedPlans', line: 1 }]);
    });

    test('a mention in a comment is reported, and that is the chosen trade', () => {
        // Over-reporting inside code costs a glance; under-reporting costs
        // somebody not learning that their value stops being read. Telling a
        // comment from code needs the grammar this does not have.
        const { occurrences } = findMovedSettings('// cancellationNoticeDays used to live here\n');
        assert.deepEqual(occurrences, [{ setting: 'cancellationNoticeDays', line: 1 }]);
    });

    test('several occurrences of one setting are all named, in file order', () => {
        const { occurrences } = findMovedSettings(
            ['a: cancellationNoticeDays,', '', 'b: cancellationNoticeDays,'].join('\n'),
        );
        assert.deepEqual(occurrences, [
            { setting: 'cancellationNoticeDays', line: 1 },
            { setting: 'cancellationNoticeDays', line: 3 },
        ]);
    });
});
