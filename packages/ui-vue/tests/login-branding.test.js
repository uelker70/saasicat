// The login and first-run cards read the public boot response. That endpoint is
// a system boundary: a partial payload used to throw inside a computed and take
// the whole card down on the next render, which only became visible when
// switching the language forced one.

// @requirement SC-UI-015 — One colour makes the administration look like the integrator's product
// @requirement SC-SCOPE-003 — An installation that does not name its application does not start

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { isProductionBoot, resolveLoginBranding } from '../dist/index.js';

const FALLBACK = { name: 'NotesApp', tag: 'SuperAdmin', logoText: 'NA' };

describe('resolveLoginBranding — boot values win, app branding fills in', () => {
    test('a complete boot response is used as-is', () => {
        const branding = resolveLoginBranding(
            {
                project: {
                    displayName: 'Acme',
                    label: 'Console',
                    icon: 'AC',
                    logoUrl: '/logo.svg',
                    environment: 'staging',
                },
            },
            FALLBACK,
        );
        assert.deepEqual(branding, {
            name: 'Acme',
            tag: 'Console',
            icon: 'AC',
            logoUrl: '/logo.svg',
            environment: 'staging',
        });
    });

    test('production is not shown as an environment badge', () => {
        const branding = resolveLoginBranding({ project: { environment: 'production' } }, FALLBACK);
        assert.equal(branding.environment, null);
    });
});

describe('resolveLoginBranding — malformed boot must not take the card down', () => {
    // Each of these reached `project.displayName` before and threw.
    const brokenPayloads = [
        ['boot not loaded yet', null],
        ['boot undefined', undefined],
        ['response without project', {}],
        ['project explicitly null', { project: null }],
        ['project empty', { project: {} }],
        ['fields null', { project: { displayName: null, icon: null, logoUrl: null } }],
    ];

    for (const [name, payload] of brokenPayloads) {
        test(`${name}: falls back instead of throwing`, () => {
            const branding = resolveLoginBranding(payload, FALLBACK);
            assert.deepEqual(branding, {
                name: 'NotesApp',
                tag: 'SuperAdmin',
                icon: 'NA',
                logoUrl: null,
                environment: null,
            });
        });
    }

    test('without boot and without app branding the card still renders', () => {
        const branding = resolveLoginBranding(null);
        assert.deepEqual(branding, {
            name: '',
            tag: 'SuperAdmin',
            icon: '',
            logoUrl: null,
            environment: null,
        });
    });

    test('empty strings from boot do not blank the card', () => {
        const branding = resolveLoginBranding({ project: { displayName: '', icon: '' } }, FALLBACK);
        assert.equal(branding.name, 'NotesApp');
        assert.equal(branding.icon, 'NA');
    });
});

describe('isProductionBoot — the dev-credentials guard', () => {
    test('true only for an explicit production environment', () => {
        assert.equal(isProductionBoot({ project: { environment: 'production' } }), true);
    });

    test('a malformed payload is not treated as production', () => {
        for (const payload of [null, undefined, {}, { project: null }, { project: {} }]) {
            assert.equal(isProductionBoot(payload), false);
        }
    });

    test('other environments are not production', () => {
        assert.equal(isProductionBoot({ project: { environment: 'staging' } }), false);
    });
});
