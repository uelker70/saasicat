import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

// Enforces the `Symbol.for` rule from CONTRIBUTING.md mechanically.
//
// tsup emits 12+ entry points and esbuild only code-splits ESM, so in the CJS
// build every shared module is copied into each entry chunk that imports it.
// A token declared as plain `Symbol('X')` becomes a DIFFERENT symbol in every
// copy: a provider registered through one entry then fails to resolve when
// injected via the token imported from another. That has caused a production
// outage, and it resurfaced when `SaaSiCatModule` started composing modules
// from several entries.
//
// `Symbol.keyFor()` returns a key only for symbols in the process-wide
// registry — exactly the ones created with `Symbol.for`. Anything exported
// from a public entry that is a plain symbol fails here.

const ENTRIES = [
    ['.', () => import('../dist/index.js')],
    ['./admin', () => import('../dist/admin/index.js')],
    ['./billing', () => import('../dist/billing/index.js')],
    ['./catalog', () => import('../dist/catalog/index.js')],
    ['./checkout-offer', () => import('../dist/checkout-offer/index.js')],
    ['./discovery', () => import('../dist/discovery/index.js')],
    ['./entitlement', () => import('../dist/entitlement/index.js')],
    ['./platform', () => import('../dist/platform/index.js')],
    ['./promo', () => import('../dist/promo/index.js')],
    ['./subscription-contract', () => import('../dist/subscription-contract/index.js')],
];

describe('exported DI tokens live in the global symbol registry', () => {
    for (const [name, load] of ENTRIES) {
        test(`@saasicat/nest${name === '.' ? '' : name}`, async () => {
            const mod = await load();
            const offenders = Object.entries(mod)
                .filter(([, value]) => typeof value === 'symbol')
                .filter(([, value]) => Symbol.keyFor(value) === undefined)
                .map(([key, value]) => `${key} (${value.toString()})`);

            assert.deepEqual(
                offenders,
                [],
                'these exported tokens are plain Symbol() and break across CJS entry ' +
                    "chunks — declare them as Symbol.for('saas-platform/…') instead",
            );
        });
    }
});

// Registry keys are a runtime contract with consumer apps, so existing ones
// must never be renamed (CONTRIBUTING.md). Two prefixes are in use for
// historical reasons; this pins the set so a third does not creep in.
const KNOWN_PREFIXES = ['saas-platform/', 'saas-platform-nest/', 'saasicat/nest/'];

describe('token keys stay inside the shared namespace', () => {
    test('every exported token key uses a known prefix', async () => {
        const wrong = [];
        for (const [name, load] of ENTRIES) {
            const mod = await load();
            for (const [key, value] of Object.entries(mod)) {
                if (typeof value !== 'symbol') continue;
                const registryKey = Symbol.keyFor(value);
                if (registryKey && !KNOWN_PREFIXES.some((p) => registryKey.startsWith(p))) {
                    wrong.push(`${name} → ${key}: ${registryKey}`);
                }
            }
        }
        assert.deepEqual(
            wrong,
            [],
            `new tokens must use one of: ${KNOWN_PREFIXES.join(', ')} — a fresh prefix ` +
                'would silently fail to match what consumer apps already inject',
        );
    });
});
