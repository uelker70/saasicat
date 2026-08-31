// The flags on the capability list are labels, so they follow the language.
//
// They were written into the template — `neu`, `experimental`, `deprecated`,
// `impl`, `Owner` — which is the shape that has no failure mode until somebody
// switches the language and reads a German word on an English screen. The
// catalogue already carried the words in a group nothing consumed; the
// component reads them now, and this is what keeps it that way.

// @requirement SC-LANG-005 — Every string on a screen follows the language that was chosen

import { afterEach, describe, expect, test } from 'vitest';
import { ref } from 'vue';

import DiscoveryCapList from '../../src/internal/discovery-page/DiscoveryCapList.vue';
import { createSuperAdminI18n, SUPER_ADMIN_I18N_KEY } from '../../src/vue/use-super-admin-i18n.js';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
});

const APPROVED_AT = '2026-01-01T00:00:00.000Z';

function capability(overrides: Record<string, unknown> = {}) {
    return {
        id: 'c-1',
        capabilityKey: 'notes.export',
        kind: 'endpoint',
        label: 'Export notes',
        owner: 'notes-team',
        codeStatus: 'active',
        replacementKey: null,
        createdAt: '2026-02-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:00:00.000Z',
        ...overrides,
    };
}

function render(locale: string, caps: Record<string, unknown>[]) {
    const wrapper = mountWithQuasar(DiscoveryCapList, {
        props: {
            capabilities: caps,
            declaredAtByKey: { 'notes.export': 'notes.controller.ts:42' },
            newSince: APPROVED_AT,
        },
        global: {
            provide: {
                [SUPER_ADMIN_I18N_KEY as symbol]: createSuperAdminI18n({ locale: ref(locale) }),
            },
        },
    });
    mounted.push(wrapper);
    return wrapper.text();
}

describe('a code flag follows the language that was chosen', () => {
    test('English reads English', () => {
        const text = render('en', [capability()]);
        expect(text).toContain('new');
        expect(text).toContain('implemented at');
        expect(text).toContain('Owner');
    });

    test('German reads German', () => {
        const text = render('de', [capability()]);
        expect(text).toContain('neu');
        expect(text).toContain('implementiert in');
        expect(text).toContain('Besitzer');
    });

    test('the flag a status raises follows it too', () => {
        expect(render('en', [capability({ codeStatus: 'experimental' })])).toContain(
            'experimental',
        );
        expect(render('de', [capability({ codeStatus: 'experimental' })])).toContain(
            'experimentell',
        );
    });

    test('and so does the sentence for a feature with nothing behind it', () => {
        expect(render('en', [])).not.toBe(render('de', []));
    });
});
