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
        project: { key: 'cf', displayName: 'DemoApp' },
        build: {
            platformPackageVersion: '0.1.0',
            appVersion: '1.0.0',
            manifestHash: 'sha256-x',
        },
        capabilities: {
            'tenants:list:read': true,
            'audit:list:read': true,
            'pilots:create:write': false, // disabled for this user
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
                    componentKey: 'cf-datev',
                    icon: 'account_tree',
                    navSection: 'DemoApp',
                },
            ],
        },
        planCatalogSnapshot: {
            source: 'config/plans.yaml',
            hash: 'h',
            currency: 'EUR',
            vatRate: 19,
            plans: [],
        },
        ...overrides,
    };
}

describe('buildRoutes — StandardPages filter', () => {
    test('lists enabled StandardPages with Capability=true', () => {
        const routes = buildRoutes(buildManifest());
        const ids = routes.map((r) => r.id);
        assert.ok(ids.includes('tenants'));
        assert.ok(ids.includes('audit'));
    });

    test('rejects disabled pages', () => {
        const routes = buildRoutes(buildManifest());
        assert.equal(
            routes.find((r) => r.id === 'users'),
            undefined,
        );
    });

    test('rejects pages without Capability', () => {
        const routes = buildRoutes(buildManifest());
        assert.equal(
            routes.find((r) => r.id === 'pilots'),
            undefined,
        );
    });

    test('default routes from DEFAULT_STANDARD_PAGE_ROUTES', () => {
        const routes = buildRoutes(buildManifest());
        const tenants = routes.find((r) => r.id === 'tenants');
        assert.equal(tenants.path, DEFAULT_STANDARD_PAGE_ROUTES.tenants);
    });

    test('does not expose the removed planVersions standard page', () => {
        assert.equal(Object.hasOwn(DEFAULT_STANDARD_PAGE_ROUTES, 'planVersions'), false);
    });

    test('standardPageRoutes override', () => {
        const routes = buildRoutes(buildManifest(), {
            standardPageRoutes: { tenants: '/admin/clubs' },
        });
        const tenants = routes.find((r) => r.id === 'tenants');
        assert.equal(tenants.path, '/admin/clubs');
    });

    test('isStandard=true for StandardPages', () => {
        const routes = buildRoutes(buildManifest());
        assert.equal(routes.find((r) => r.id === 'tenants').isStandard, true);
    });
});

describe('buildRoutes — ProjectPages', () => {
    test('lists a ProjectPage without requiredCapability', () => {
        const routes = buildRoutes(buildManifest());
        const datev = routes.find((r) => r.id === 'cf.datev');
        assert.notEqual(datev, undefined);
        assert.equal(datev.path, '/admin/datev');
        assert.equal(datev.componentKey, 'cf-datev');
        assert.equal(datev.isStandard, false);
    });

    test('rejects a ProjectPage with a missing Capability', () => {
        const m = buildManifest();
        m.navigation.projectPages[0].requiredCapability = 'nope:foo:bar';
        const routes = buildRoutes(m);
        assert.equal(
            routes.find((r) => r.id === 'cf.datev'),
            undefined,
        );
    });

    test('lists a ProjectPage with a satisfied Capability', () => {
        const m = buildManifest();
        m.capabilities['datev:export:run'] = true;
        m.navigation.projectPages[0].requiredCapability = 'datev:export:run';
        const routes = buildRoutes(m);
        assert.notEqual(
            routes.find((r) => r.id === 'cf.datev'),
            undefined,
        );
    });

    test('navSection is passed through', () => {
        const routes = buildRoutes(buildManifest());
        assert.equal(routes.find((r) => r.id === 'cf.datev').navSection, 'DemoApp');
    });

    test('availableExtensions filters out ProjectPages with an unknown componentKey', () => {
        const m = buildManifest();
        const routes = buildRoutes(m, {
            availableExtensions: new Set(),
        });
        // StandardPages remain untouched; ProjectPages are filtered.
        assert.equal(
            routes.find((r) => r.id === 'cf.datev'),
            undefined,
        );
        assert.notEqual(
            routes.find((r) => r.isStandard),
            undefined,
        );
    });

    test('availableExtensions keeps ProjectPages with a known componentKey', () => {
        const routes = buildRoutes(buildManifest(), {
            availableExtensions: new Set(['cf-datev']),
        });
        assert.notEqual(
            routes.find((r) => r.id === 'cf.datev'),
            undefined,
        );
    });
});

describe('buildSidebar — section grouping', () => {
    test('sectionOrder wins, the rest alphabetical', () => {
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
        // StandardPages inherit default sections (tenants→Kunden, audit→System);
        // ProjectPages bring their own navSection. DEFAULT_SECTION_ORDER
        // prioritizes Kunden over System; after that, unknown ones come alphabetically.
        const sidebar = buildSidebar(buildRoutes(m));
        const sectionNames = sidebar.map((s) => s.section);
        assert.deepEqual(sectionNames, ['Kunden', 'System', 'ASection', 'DemoApp', 'ZSection']);
    });

    test('sectionOrder override via second parameter', () => {
        const sidebar = buildSidebar(buildRoutes(buildManifest()), ['System', 'Kunden']);
        assert.deepEqual(
            sidebar.map((s) => s.section),
            ['System', 'Kunden', 'DemoApp'],
        );
    });

    test('items within a section without mutation', () => {
        const sidebar = buildSidebar(buildRoutes(buildManifest()));
        const demoapp = sidebar.find((s) => s.section === 'DemoApp');
        assert.equal(demoapp.items.length, 1);
        assert.equal(demoapp.items[0].path, '/admin/datev');
    });
});

describe('resolveExtension', () => {
    test('returns the registered component', () => {
        const Foo = { name: 'Foo' };
        assert.equal(resolveExtension('foo', { foo: Foo }), Foo);
    });

    test('null for an unknown key', () => {
        assert.equal(resolveExtension('nope', {}), null);
    });
});
