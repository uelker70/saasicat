// i18n core — locale registry, catalog resolution, interpolation and the
// locale-aware navigation defaults.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_SA_LOCALE,
    SA_INTL_LOCALES,
    SA_LOCALES,
    SA_MESSAGES,
    buildRoutes,
    buildSidebar,
    defaultSectionOrder,
    formatCurrency,
    formatMessage,
    mergeMessages,
    resolveMessages,
} from '../dist/index.js';

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

    test('every locale has a catalog and an Intl tag', () => {
        for (const locale of SA_LOCALES) {
            assert.ok(SA_MESSAGES[locale], `catalog missing for ${locale}`);
            assert.ok(SA_INTL_LOCALES[locale], `Intl tag missing for ${locale}`);
        }
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
