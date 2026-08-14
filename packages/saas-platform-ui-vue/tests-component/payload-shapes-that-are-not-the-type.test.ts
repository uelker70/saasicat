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

import DiscoveryPage from '../src/pages-standard/DiscoveryPage.vue';
import { mountWithQuasar } from './support/mount-with-quasar';

/** The props the page needs beyond the payload under test. */
const REQUIRED = {
    capabilities: [],
    features: [],
    quotas: [],
    loading: false,
    error: null,
    activeLocales: ['en'],
    runDiscovery: async () => {},
    reviewFeature: async () => ({}),
    reviewQuota: async () => ({}),
    setFeatureI18n: async () => ({}),
    setQuotaI18n: async () => ({}),
    setFeatureBase: async () => ({}),
    setQuotaBase: async () => ({}),
};

describe('DiscoveryPage survives a snapshot that is not a snapshot', () => {
    // Each of these is a body a server can answer 200 with. None matches
    // `DiscoverySnapshot`, and none may take the page down.
    const MALFORMED: ReadonlyArray<readonly [string, unknown]> = [
        ['an empty array', []],
        ['an empty object', {}],
        ['an object without `app`', { schemaVersion: 1, scannedAt: '2026-01-15T12:00:00.000Z' }],
        ['an `app` without `key`', { app: {} }],
        ['a string', 'not json we expected'],
    ];

    for (const [label, snapshot] of MALFORMED) {
        test(`${label} renders instead of throwing`, () => {
            const wrapper = mountWithQuasar(DiscoveryPage, {
                props: { ...REQUIRED, snapshot },
            });

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
        const wrapper = mountWithQuasar(DiscoveryPage, {
            props: { ...REQUIRED, snapshot: null },
        });
        expect(wrapper.text()).toContain('—');
        wrapper.unmount();
    });
});
