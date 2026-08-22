// A page must not throw on a payload that is not the shape its type promises.
//
// `useDiscovery` assigns the response body straight into `snapshot` with an
// unchecked `as DiscoverySnapshot`. There is no validation at that boundary, so
// anything a server answers 200 with lands in the prop — an older backend, a
// proxy's JSON error page, a partial response.
//
// `DiscoveryPage` then read `props.snapshot?.app.key`. The optional chain covers
// `snapshot` being nullish and stops there, so a body that is non-null but has
// no `app` threw inside a computed. A throw in a computed does not degrade the
// component, it takes the route down: the admin shell rendered and the content
// area was blank.
//
// The three fallbacks in that file (`'—'`, `'Discovery'`, `'0.0.0'`) say exactly
// what should happen instead, which is what makes the half-guard a defect rather
// than a design: the intent was already written down, and the chain did not
// carry it far enough.
//
// This is the class, not the instance: any page whose props arrive from an
// unvalidated HTTP boundary has to survive a shape that is not its type.

import { describe, expect, test } from 'vitest';

import type { FeatureCatalogEntryRow } from '@saasicat/types';

import DiscoveryPage from '../src/pages/DiscoveryPage.vue';
import { mountWithQuasar } from './support/mount-with-quasar';
import { provideStubResources } from './support/stub-resources';

/**
 * One real catalog entry, annotated against its own type.
 *
 * Fabricating a partial row here failed immediately — `DiscoveryFeatureCard`
 * reads `feature.replaces.length` — which is the point of annotating fixtures
 * rather than casting them: a made-up shape is a statement about a contract, and
 * an unchecked one is a guess.
 */
const FEATURE: FeatureCatalogEntryRow = {
    id: 'f-1',
    projectKey: 'notesapp',
    featureKey: 'export',
    label: 'Export',
    description: null,
    marketingLabel: null,
    marketingDescription: null,
    icon: null,
    tier: null,
    discoveryStatus: 'approved',
    requires: [],
    replaces: [],
    successorKey: null,
    approvedAt: null,
    approvedBy: null,
    approvedSignature: null,
    plannedOnly: false,
    core: false,
    i18n: {},
    sortOrder: 0,
    createdAt: '2026-01-15T12:00:00.000Z',
    updatedAt: '2026-01-15T12:00:00.000Z',
    deletedAt: null,
};

/**
 * The props the page needs beyond the payload under test.
 *
 * `features` is non-empty on purpose. `declaredAtByKey` is a computed, so it is
 * only evaluated once something renders that reads it — with an empty catalog
 * the malformed-`capabilities` cases would mount happily without the loop ever
 * running, and would prove nothing.
 */
const REQUIRED = { activeLocales: ['en'] };

/**
 * Mounts the page with a stubbed catalog and a snapshot of the test's choosing.
 *
 * The snapshot used to be a prop. It now arrives through the discovery
 * resource, which is what this fixture has to imitate — the malformed shapes
 * below are what a SERVER sends, and pushing them through the same seam is the
 * only way this file still tests the thing it is named after.
 */
function mountWithSnapshot(snapshot: unknown) {
    return mountWithQuasar(DiscoveryPage, {
        props: REQUIRED,
        global: {
            provide: provideStubResources({
                catalog: {
                    capabilities: () => Promise.resolve([]),
                    features: () => Promise.resolve([FEATURE]),
                    quotas: () => Promise.resolve([]),
                    syncDiscovery: () => Promise.resolve({}),
                    reviewFeature: () => Promise.resolve({}),
                    reviewQuota: () => Promise.resolve({}),
                    setFeatureI18n: () => Promise.resolve({}),
                    setQuotaI18n: () => Promise.resolve({}),
                    setFeatureBase: () => Promise.resolve({}),
                    setQuotaBase: () => Promise.resolve({}),
                },
                discovery: {
                    read: () => Promise.resolve({ status: 'loaded', snapshot, etag: null }),
                    rescan: () => Promise.resolve({ snapshot, etag: null }),
                },
            }),
        },
    });
}

describe('DiscoveryPage survives a snapshot that is not a snapshot', () => {
    // Each of these is a body a server can answer 200 with. None matches
    // `DiscoverySnapshot`, and none may take the page down.
    const MALFORMED: ReadonlyArray<readonly [string, unknown]> = [
        ['an empty array', []],
        ['an empty object', {}],
        ['an object without `app`', { schemaVersion: 1, scannedAt: '2026-01-15T12:00:00.000Z' }],
        ['an `app` without `key`', { app: {} }],
        ['a string', 'not json we expected'],
        // Present but of the wrong TYPE — the half of this that the first
        // version of the fix missed. A truthy non-string passes an existence
        // check and throws on the string method that follows, which is the same
        // white-screen one step further in. Guarding presence without guarding
        // type only moves the crash.
        ['a numeric `key`', { app: { key: 1, version: '1.0.0' } }],
        ['a boolean `key`', { app: { key: true } }],
        ['an object `key`', { app: { key: {} } }],
        ['a numeric `version`', { app: { key: 'notesapp', version: 2 } }],
        ['a numeric `scannedAt`', { app: { key: 'notesapp' }, scannedAt: 1737000000000 }],
        // Non-ITERABLE, not merely not-an-array. The first version of this case
        // used a string, and a string is iterable — `for…of` walked its
        // characters, built nonsense and threw nothing, so the case passed
        // without exercising the protection it was named after.
        ['`capabilities` as an object', { app: { key: 'x' }, capabilities: { a: 1 } }],
        ['`capabilities` as a number', { app: { key: 'x' }, capabilities: 7 }],
        ['`capabilities` as a string', { app: { key: 'x' }, capabilities: 'nope' }],
        ['a capability entry that is null', { app: { key: 'x' }, capabilities: [null] }],
    ];

    for (const [label, snapshot] of MALFORMED) {
        test(`${label} renders instead of throwing`, () => {
            const wrapper = mountWithSnapshot(snapshot);

            // Rendered at all — a component that threw during setup leaves
            // nothing behind, so this is the assertion that matters.
            expect(wrapper.html().length).toBeGreaterThan(100);
            wrapper.unmount();
        });
    }

    test('the null case still shows the documented fallbacks', () => {
        // The guard must not have been "fixed" by removing the fallbacks: the
        // dash and the version placeholder are what the page promises when it
        // has no snapshot yet.
        const wrapper = mountWithSnapshot(null);
        expect(wrapper.text()).toContain('—');
        wrapper.unmount();
    });
});
