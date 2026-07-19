import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_STANDARD_PAGE_ROUTES,
    buildRoutes,
    buildSidebar,
    resolveExtension,
} from '../dist/index.js';

function buildManifest(overrides = {}) {
    return {
        schemaVersion: 1,
        project: { key: 'cf', displayName: 'AutohausPro' },
        build: {
            platformPackageVersion: '0.1.0',
            appVersion: '1.0.0',
            manifestHash: 'sha256-x',
        },
        capabilities: {
            'tenants:list:read': true,
            'audit:list:read': true,
            'pilots:create:write': false, // disabled für diesen User
        },
        navigation: {
            standardPages: {
                tenants: { enabled: true, requiredCapability: 'tenants:list:read' },
                audit: { enabled: true, requiredCapability: 'audit:list:read' },
                pilots: { enabled: true, requiredCapability: 'pilots:create:write' },
                users: { enabled: false },
            },
            projectPages: [
                {
                    id: 'cf.datev',
                    label: 'DATEV',
                    route: '/admin/datev',
                    componentKey: 'ahp-datev',
                    icon: 'account_tree',
                    navSection: 'AutohausPro',
                },
            ],
        },
        planCatalogSnapshot: {
            source: 'config/plans.yaml',
            hash: 'h',
            currency: 'EUR',
            vatRate: 19,
            quotaKeys: [],
            plans: [],
        },
        ...overrides,
    };
}

describe('buildRoutes — StandardPages-Filter', () => {
    test('listet aktivierte StandardPages mit Capability=true', () => {
        const routes = buildRoutes(buildManifest());
        const ids = routes.map((r) => r.id);
        assert.ok(ids.includes('tenants'));
        assert.ok(ids.includes('audit'));
    });

    test('lehnt disabled-Pages ab', () => {
        const routes = buildRoutes(buildManifest());
        assert.equal(
            routes.find((r) => r.id === 'users'),
            undefined,
        );
    });

    test('lehnt Pages ohne Capability ab', () => {
        const routes = buildRoutes(buildManifest());
        assert.equal(
            routes.find((r) => r.id === 'pilots'),
            undefined,
        );
    });

    test('Default-Routen aus DEFAULT_STANDARD_PAGE_ROUTES', () => {
        const routes = buildRoutes(buildManifest());
        const tenants = routes.find((r) => r.id === 'tenants');
        assert.equal(tenants.path, DEFAULT_STANDARD_PAGE_ROUTES.tenants);
    });

    test('standardPageRoutes-Override', () => {
        const routes = buildRoutes(buildManifest(), {
            standardPageRoutes: { tenants: '/admin/clubs' },
        });
        const tenants = routes.find((r) => r.id === 'tenants');
        assert.equal(tenants.path, '/admin/clubs');
    });

    test('isStandard=true für StandardPages', () => {
        const routes = buildRoutes(buildManifest());
        assert.equal(routes.find((r) => r.id === 'tenants').isStandard, true);
    });
});

describe('buildRoutes — ProjectPages', () => {
    test('listet ProjectPage ohne requiredCapability auf', () => {
        const routes = buildRoutes(buildManifest());
        const datev = routes.find((r) => r.id === 'cf.datev');
        assert.notEqual(datev, undefined);
        assert.equal(datev.path, '/admin/datev');
        assert.equal(datev.componentKey, 'ahp-datev');
        assert.equal(datev.isStandard, false);
    });

    test('lehnt ProjectPage mit fehlender Capability ab', () => {
        const m = buildManifest();
        m.navigation.projectPages[0].requiredCapability = 'nope:foo:bar';
        const routes = buildRoutes(m);
        assert.equal(
            routes.find((r) => r.id === 'cf.datev'),
            undefined,
        );
    });

    test('listet ProjectPage mit erfüllter Capability auf', () => {
        const m = buildManifest();
        m.capabilities['datev:export:run'] = true;
        m.navigation.projectPages[0].requiredCapability = 'datev:export:run';
        const routes = buildRoutes(m);
        assert.notEqual(
            routes.find((r) => r.id === 'cf.datev'),
            undefined,
        );
    });

    test('navSection wird durchgereicht', () => {
        const routes = buildRoutes(buildManifest());
        assert.equal(routes.find((r) => r.id === 'cf.datev').navSection, 'AutohausPro');
    });

    test('availableExtensions filtert ProjectPages mit unbekanntem componentKey', () => {
        const m = buildManifest();
        const routes = buildRoutes(m, {
            availableExtensions: new Set(),
        });
        // StandardPages bleiben unberührt; ProjectPages werden gefiltert.
        assert.equal(
            routes.find((r) => r.id === 'cf.datev'),
            undefined,
        );
        assert.notEqual(
            routes.find((r) => r.isStandard),
            undefined,
        );
    });

    test('availableExtensions behält ProjectPages mit bekanntem componentKey', () => {
        const routes = buildRoutes(buildManifest(), {
            availableExtensions: new Set(['ahp-datev']),
        });
        assert.notEqual(
            routes.find((r) => r.id === 'cf.datev'),
            undefined,
        );
    });
});

describe('buildSidebar — Section-Gruppierung', () => {
    test('sectionOrder gewinnt, übrige alphabetisch', () => {
        const m = buildManifest();
        m.navigation.projectPages.push({
            id: 'cf.zfix',
            label: 'Z',
            route: '/admin/z',
            componentKey: 'z',
            navSection: 'ZSection',
        });
        m.navigation.projectPages.push({
            id: 'cf.afix',
            label: 'A',
            route: '/admin/a',
            componentKey: 'a',
            navSection: 'ASection',
        });
        // StandardPages erben Default-Sections (tenants→Kunden, audit→System);
        // ProjectPages bringen ihr eigenes navSection mit. DEFAULT_SECTION_ORDER
        // priorisiert Kunden vor System; danach kommen unbekannte alphabetisch.
        const sidebar = buildSidebar(buildRoutes(m));
        const sectionNames = sidebar.map((s) => s.section);
        assert.deepEqual(sectionNames, ['Kunden', 'System', 'ASection', 'AutohausPro', 'ZSection']);
    });

    test('sectionOrder-Override durch zweiten Parameter', () => {
        const sidebar = buildSidebar(buildRoutes(buildManifest()), ['System', 'Kunden']);
        assert.deepEqual(
            sidebar.map((s) => s.section),
            ['System', 'Kunden', 'AutohausPro'],
        );
    });

    test('items innerhalb einer Section ohne Mutation', () => {
        const sidebar = buildSidebar(buildRoutes(buildManifest()));
        const autohauspro = sidebar.find((s) => s.section === 'AutohausPro');
        assert.equal(autohauspro.items.length, 1);
        assert.equal(autohauspro.items[0].path, '/admin/datev');
    });
});

describe('resolveExtension', () => {
    test('liefert registrierte Komponente', () => {
        const Foo = { name: 'Foo' };
        assert.equal(resolveExtension('foo', { foo: Foo }), Foo);
    });

    test('null bei unbekanntem Key', () => {
        assert.equal(resolveExtension('nope', {}), null);
    });
});
