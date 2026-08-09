// i18n core — locale registry, catalog resolution, interpolation and the
// locale-aware navigation defaults.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { computed, ref, nextTick } from 'vue';

import {
    DEFAULT_SA_LOCALE,
    SA_INTL_LOCALES,
    SA_LOCALES,
    SA_LOCALE_LABELS,
    SA_LOCALE_STORAGE_KEY,
    SA_MESSAGES,
    buildRoutes,
    buildSidebar,
    createSuperAdminI18n,
    defaultSectionOrder,
    formatCurrency,
    formatMessage,
    isSaLocale,
    mergeMessages,
    resolveMessages,
} from '../dist/index.js';

function buildStorage(initial = {}) {
    const map = new Map(Object.entries(initial));
    return {
        get: (k) => map.get(k) ?? null,
        set: (k, v) => map.set(k, v),
        remove: (k) => map.delete(k),
    };
}

function collectLeafPaths(tree, prefix = '') {
    const paths = [];
    for (const [key, value] of Object.entries(tree)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'string') paths.push(path);
        else paths.push(...collectLeafPaths(value, path));
    }
    return paths.sort();
}

describe('i18n locales', () => {
    test('German is the default locale', () => {
        assert.equal(DEFAULT_SA_LOCALE, 'de');
    });

    test('every locale has a catalog, an Intl tag and a switcher label', () => {
        for (const locale of SA_LOCALES) {
            assert.ok(SA_MESSAGES[locale], `catalog missing for ${locale}`);
            assert.ok(SA_INTL_LOCALES[locale], `Intl tag missing for ${locale}`);
            assert.ok(SA_LOCALE_LABELS[locale]?.trim(), `switcher label missing for ${locale}`);
        }
    });

    test('isSaLocale accepts known locales and rejects anything else', () => {
        for (const locale of SA_LOCALES) {
            assert.equal(isSaLocale(locale), true);
        }
        for (const value of ['fr', '', 'DE', null, undefined, 42, {}]) {
            assert.equal(isSaLocale(value), false);
        }
    });
});

describe('createSuperAdminI18n', () => {
    test('defaults to the platform locale', () => {
        const { locale } = createSuperAdminI18n({ storage: buildStorage() });
        assert.equal(locale.value, DEFAULT_SA_LOCALE);
    });

    test('switching the locale swaps the catalog and the Intl tag', () => {
        const { locale, messages, intlLocale } = createSuperAdminI18n({ storage: buildStorage() });
        locale.value = 'en';
        assert.equal(messages.value.shell.header.logout, SA_MESSAGES.en.shell.header.logout);
        assert.equal(intlLocale.value, SA_INTL_LOCALES.en);
    });

    test('the picked locale is written to storage', async () => {
        const storage = buildStorage();
        const { locale } = createSuperAdminI18n({ storage });
        locale.value = 'en';
        await nextTick();
        assert.equal(storage.get(SA_LOCALE_STORAGE_KEY), 'en');
    });

    test('a stored pick outranks the app default', () => {
        const storage = buildStorage({ [SA_LOCALE_STORAGE_KEY]: 'en' });
        const { locale } = createSuperAdminI18n({ locale: 'de', storage });
        assert.equal(locale.value, 'en');
    });

    test('a corrupt stored value falls back to the app default', () => {
        const storage = buildStorage({ [SA_LOCALE_STORAGE_KEY]: 'klingon' });
        const { locale } = createSuperAdminI18n({ locale: 'en', storage });
        assert.equal(locale.value, 'en');
    });

    test('persist: false does not read the stored pick', () => {
        const storage = buildStorage({ [SA_LOCALE_STORAGE_KEY]: 'en' });
        const { locale } = createSuperAdminI18n({ persist: false, storage });
        assert.equal(locale.value, DEFAULT_SA_LOCALE);
    });

    test('persist: false does not write the picked locale', async () => {
        const storage = buildStorage();
        const { locale } = createSuperAdminI18n({ persist: false, storage });
        locale.value = 'en';
        await nextTick();
        assert.equal(storage.get(SA_LOCALE_STORAGE_KEY), null);
    });

    test('an app-supplied Ref is used as-is and outranks the stored pick', () => {
        const storage = buildStorage({ [SA_LOCALE_STORAGE_KEY]: 'en' });
        const appLocale = ref('de');
        const { locale } = createSuperAdminI18n({ locale: appLocale, storage });
        assert.equal(locale, appLocale, 'the app ref must be used as-is');
        assert.equal(locale.value, 'de');
    });

    test('an app-supplied Ref is not persisted by the platform', async () => {
        const storage = buildStorage();
        const { locale } = createSuperAdminI18n({ locale: ref('de'), storage });
        locale.value = 'en';
        await nextTick();
        assert.equal(storage.get(SA_LOCALE_STORAGE_KEY), null);
    });
});

describe('switcher availability', () => {
    test('enabled by default', () => {
        assert.equal(createSuperAdminI18n({ storage: buildStorage() }).switcherEnabled, true);
    });

    test('switcher: false turns it off', () => {
        const i18n = createSuperAdminI18n({ switcher: false, storage: buildStorage() });
        assert.equal(i18n.switcherEnabled, false);
    });

    test('a writable Ref keeps it on', () => {
        const i18n = createSuperAdminI18n({ locale: ref('de'), storage: buildStorage() });
        assert.equal(i18n.switcherEnabled, true);
    });

    test('a writable computed keeps it on', () => {
        const source = ref('de');
        const writable = computed({ get: () => source.value, set: (v) => (source.value = v) });
        const i18n = createSuperAdminI18n({ locale: writable, storage: buildStorage() });
        assert.equal(i18n.switcherEnabled, true);
    });

    test('a readonly computed turns it off — writes would be swallowed', () => {
        const source = ref('de');
        const i18n = createSuperAdminI18n({
            locale: computed(() => source.value),
            storage: buildStorage(),
        });
        assert.equal(i18n.switcherEnabled, false);
    });
});

describe('catalog completeness', () => {
    test('English mirrors the German key structure exactly', () => {
        assert.deepEqual(collectLeafPaths(SA_MESSAGES.en), collectLeafPaths(SA_MESSAGES.de));
    });

    test('no message is left empty in either locale', () => {
        for (const locale of SA_LOCALES) {
            const walk = (tree, prefix = '') => {
                for (const [key, value] of Object.entries(tree)) {
                    const path = prefix ? `${prefix}.${key}` : key;
                    if (typeof value === 'string') {
                        assert.ok(value.trim().length > 0, `${locale}: empty message at ${path}`);
                    } else {
                        walk(value, path);
                    }
                }
            };
            walk(SA_MESSAGES[locale]);
        }
    });

    test('placeholders match between German and English', () => {
        const placeholders = (text) => (text.match(/\{(\w+)\}/g) ?? []).sort();
        const walk = (de, en, prefix = '') => {
            for (const [key, value] of Object.entries(de)) {
                const path = prefix ? `${prefix}.${key}` : key;
                if (typeof value === 'string') {
                    assert.deepEqual(
                        placeholders(en[key]),
                        placeholders(value),
                        `placeholder mismatch at ${path}`,
                    );
                } else {
                    walk(value, en[key], path);
                }
            }
        };
        walk(SA_MESSAGES.de, SA_MESSAGES.en);
    });
});

describe('formatMessage', () => {
    test('replaces named placeholders', () => {
        assert.equal(
            formatMessage('Plan {name} v{version}', { name: 'Pro', version: 3 }),
            'Plan Pro v3',
        );
    });

    test('leaves unknown placeholders verbatim', () => {
        assert.equal(formatMessage('Hallo {missing}', {}), 'Hallo {missing}');
    });

    test('replaces every occurrence of the same placeholder', () => {
        assert.equal(formatMessage('{a}-{a}', { a: 'x' }), 'x-x');
    });
});

describe('formatCurrency', () => {
    // ICU versions differ on which space precedes the symbol (NBSP vs narrow
    // NBSP), so compare with every space stripped.
    const digits = (s) => s.replace(/[\s\u00a0\u202f]/g, '');

    test('German uses a decimal comma and dot grouping', () => {
        assert.equal(digits(formatCurrency(12345.6, 'de')), '12.345,60€');
    });

    test('English uses a decimal point and comma grouping', () => {
        assert.equal(digits(formatCurrency(12345.6, 'en')), '€12,345.60');
    });

    test('defaults to the platform locale', () => {
        assert.equal(formatCurrency(1), formatCurrency(1, DEFAULT_SA_LOCALE));
    });

    test('numeric strings are accepted', () => {
        assert.equal(formatCurrency('9.5', 'de'), formatCurrency(9.5, 'de'));
    });

    test('null, undefined and non-numeric input render as an em dash', () => {
        for (const value of [null, undefined, Number.NaN, 'abc']) {
            assert.equal(formatCurrency(value, 'de'), '—');
        }
    });

    test('zero is a real amount, not an empty value', () => {
        assert.notEqual(formatCurrency(0, 'de'), '—');
    });
});

describe('mergeMessages / resolveMessages', () => {
    test('overrides replace only the given leaves', () => {
        const merged = mergeMessages(
            { a: 'A', nested: { b: 'B', c: 'C' } },
            { nested: { b: 'B2' } },
        );
        assert.deepEqual(merged, { a: 'A', nested: { b: 'B2', c: 'C' } });
    });

    test('keys absent from the base catalog are ignored', () => {
        const merged = mergeMessages({ a: 'A' }, { unknown: 'X' });
        assert.deepEqual(merged, { a: 'A' });
    });

    test('merging does not mutate the shared catalog', () => {
        const before = SA_MESSAGES.de.common.save;
        const merged = resolveMessages('de', { common: { save: 'Sichern' } });
        assert.equal(merged.common.save, 'Sichern');
        assert.equal(SA_MESSAGES.de.common.save, before);
    });

    test('without overrides the shared catalog instance is returned', () => {
        assert.equal(resolveMessages('en'), SA_MESSAGES.en);
    });
});

describe('locale-aware navigation defaults', () => {
    const manifest = {
        schemaVersion: 1,
        project: { key: 'cf', displayName: 'DemoApp' },
        build: { platformPackageVersion: '0.1.0', appVersion: '1.0.0', manifestHash: 'sha256-x' },
        capabilities: {},
        navigation: {
            standardPages: {
                dashboard: { enabled: true },
                tenants: { enabled: true },
                audit: { enabled: true },
            },
            projectPages: [],
        },
    };

    test('German labels and sections are the default', () => {
        const routes = buildRoutes(manifest);
        assert.equal(routes.find((r) => r.id === 'tenants').label, 'Mandanten');
        assert.equal(routes.find((r) => r.id === 'tenants').navSection, 'Kunden');
    });

    test('English locale switches labels and sections', () => {
        const routes = buildRoutes(manifest, { locale: 'en' });
        assert.equal(routes.find((r) => r.id === 'tenants').label, 'Tenants');
        assert.equal(routes.find((r) => r.id === 'tenants').navSection, 'Customers');
    });

    test('explicit label overrides still win over the locale defaults', () => {
        const routes = buildRoutes(manifest, {
            locale: 'en',
            standardPageLabels: { tenants: 'Clients' },
        });
        assert.equal(routes.find((r) => r.id === 'tenants').label, 'Clients');
    });

    test('defaultSectionOrder matches the drawer order per locale', () => {
        assert.deepEqual(defaultSectionOrder('de'), [
            'Übersicht',
            'Produktkatalog',
            'Kunden',
            'System',
        ]);
        assert.deepEqual(defaultSectionOrder('en'), [
            'Overview',
            'Product catalog',
            'Customers',
            'System',
        ]);
    });

    test('English sidebar groups under the English section order', () => {
        const sidebar = buildSidebar(
            buildRoutes(manifest, { locale: 'en' }),
            defaultSectionOrder('en'),
        );
        assert.deepEqual(
            sidebar.map((s) => s.section),
            ['Overview', 'Customers', 'System'],
        );
    });
});
