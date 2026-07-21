import { test, expect } from '@playwright/test';

// Q.5 — Browser-validated E2E for `usePlanEditor`.
//
// Loads the built platform bundle in a real headless Chromium and checks
// that Discovery + plannedOnly filter + validation also work in the real
// ESM bundle variant — no Node leak, no Vue reactivity
// bug after tree-shaking, no subtle closure mismatch between the TS build and
// the browser.

const FIXTURE_URL = '/tests-e2e/fixtures/index.html';

const SAMPLE_MANIFEST = {
    schemaVersion: 1,
    project: { key: 'cf', displayName: 'CF' },
    build: {
        platformPackageVersion: '0.1.0',
        appVersion: '1.0.0',
        manifestHash: 'sha256-x',
    },
    capabilities: {},
    navigation: { standardPages: {} },
    planCatalogSnapshot: {
        source: 'config/plans.yaml',
        hash: 'h',
        currency: 'EUR',
        vatRate: 19,
        plans: [],
        features: [
            { key: 'VEHICLE_INVENTORY', label: 'Fahrzeugbestand', tier: 'CORE' },
            { key: 'CUSTOMER_MANAGEMENT', label: 'Kundenverwaltung', tier: 'CORE' },
            { key: 'CASHBOOK', label: 'Kassenbuch', tier: 'ADVANCED' },
            { key: 'CALENDAR', label: 'Kalender', tier: 'PRO' },
            { key: 'DMS', label: 'DMS', tier: 'PRO' },
            { key: 'ATLAS_AES', label: 'ATLAS-AES', tier: 'BUSINESS' },
            {
                key: 'API_ACCESS',
                label: 'API-Zugriff',
                tier: 'ENTERPRISE_ONLY',
                plannedOnly: true,
            },
            {
                key: 'SSO',
                label: 'Single-Sign-On',
                tier: 'ENTERPRISE_ONLY',
                plannedOnly: true,
            },
        ],
    },
};

test.describe('usePlanEditor — Browser Smoke', () => {
    test('Discovery: all catalog features reactive with markers', async ({ page }) => {
        await page.goto(FIXTURE_URL);
        await page.waitForFunction(() =>
            Boolean((globalThis as { __platform?: unknown }).__platform),
        );
        const result = await page.evaluate((manifest) => {
            const { usePlanEditor } = (
                globalThis as unknown as {
                    __platform: {
                        usePlanEditor: (
                            m: unknown,
                            opts?: unknown,
                        ) => {
                            availableFeatures: { value: Array<unknown> };
                            featuresByTier: { value: Array<{ tier: string }> };
                        };
                    };
                }
            ).__platform;
            const editor = usePlanEditor(manifest, {
                initialFeatures: ['CASHBOOK', 'DMS'],
                baseFeatures: ['VEHICLE_INVENTORY'],
                nonRegressive: true,
            });
            const rows = editor.availableFeatures.value as Array<{
                def: { key: string };
                isSelected: boolean;
                isPlannedOnly: boolean;
                isInherited: boolean;
                canToggle: boolean;
            }>;
            const tiers = editor.featuresByTier.value.map((g) => g.tier);
            return {
                count: rows.length,
                selected: rows
                    .filter((r) => r.isSelected)
                    .map((r) => r.def.key)
                    .sort(),
                plannedOnly: rows
                    .filter((r) => r.isPlannedOnly)
                    .map((r) => r.def.key)
                    .sort(),
                gelocked: rows
                    .filter((r) => !r.canToggle)
                    .map((r) => r.def.key)
                    .sort(),
                tiers,
            };
        }, SAMPLE_MANIFEST);
        expect(result.count).toBe(8);
        expect(result.selected).toEqual(['CASHBOOK', 'DMS']);
        expect(result.plannedOnly).toEqual(['API_ACCESS', 'SSO']);
        // gelocked = plannedOnly + nonRegressive-inherited-selected (locked)
        expect(result.gelocked).toEqual(['API_ACCESS', 'SSO']);
        expect(result.tiers).toEqual(['CORE', 'ADVANCED', 'PRO', 'BUSINESS', 'ENTERPRISE_ONLY']);
    });

    test('toggleFeature: plannedOnly is ignored, a normal feature reacts', async ({
        page,
    }) => {
        await page.goto(FIXTURE_URL);
        await page.waitForFunction(() =>
            Boolean((globalThis as { __platform?: unknown }).__platform),
        );
        const result = await page.evaluate((manifest) => {
            const { usePlanEditor } = (
                globalThis as unknown as {
                    __platform: {
                        usePlanEditor: (
                            m: unknown,
                            opts?: unknown,
                        ) => {
                            selectedFeatures: { value: Set<string> };
                            toggleFeature: (k: string) => void;
                        };
                    };
                }
            ).__platform;
            const editor = usePlanEditor(manifest, { initialFeatures: [] });
            editor.toggleFeature('CASHBOOK');
            editor.toggleFeature('SSO'); // plannedOnly → ignored
            editor.toggleFeature('CALENDAR');
            return [...editor.selectedFeatures.value].sort();
        }, SAMPLE_MANIFEST);
        expect(result).toEqual(['CALENDAR', 'CASHBOOK']);
    });

    test('validateDraft throws PlannedOnlyFeatureError with violations property', async ({
        page,
    }) => {
        await page.goto(FIXTURE_URL);
        await page.waitForFunction(() =>
            Boolean((globalThis as { __platform?: unknown }).__platform),
        );
        const result = await page.evaluate((manifest) => {
            const { usePlanEditor } = (
                globalThis as unknown as {
                    __platform: {
                        usePlanEditor: (
                            m: unknown,
                            opts?: unknown,
                        ) => {
                            selectedFeatures: { value: Set<string> };
                            validateDraft: () => void;
                        };
                    };
                }
            ).__platform;
            const editor = usePlanEditor(manifest, { initialFeatures: [] });
            // Deliberately bypass validation, simulate external state (e.g. a
            // server draft that still had plannedOnly keys before the backend fix).
            editor.selectedFeatures.value = new Set(['CASHBOOK', 'SSO', 'API_ACCESS']);
            try {
                editor.validateDraft();
                return { thrown: false, violations: [], name: '' };
            } catch (err) {
                const e = err as { name?: string; violations?: string[]; message?: string };
                return {
                    thrown: true,
                    name: e.name ?? '',
                    violations: e.violations ?? [],
                    message: e.message ?? '',
                };
            }
        }, SAMPLE_MANIFEST);
        expect(result.thrown).toBe(true);
        expect(result.name).toBe('PlannedOnlyFeatureError');
        expect(result.violations).toEqual(['API_ACCESS', 'SSO']);
        expect(result.message).toContain('plannedOnly');
    });

    test('snapshot returns sorted selection (deterministic for PATCH body)', async ({
        page,
    }) => {
        await page.goto(FIXTURE_URL);
        await page.waitForFunction(() =>
            Boolean((globalThis as { __platform?: unknown }).__platform),
        );
        const result = await page.evaluate((manifest) => {
            const { usePlanEditor } = (
                globalThis as unknown as {
                    __platform: {
                        usePlanEditor: (m: unknown, opts?: unknown) => { snapshot: () => string[] };
                    };
                }
            ).__platform;
            const editor = usePlanEditor(manifest, {
                initialFeatures: ['DMS', 'ATLAS_AES', 'CASHBOOK'],
            });
            return editor.snapshot();
        }, SAMPLE_MANIFEST);
        expect(result).toEqual(['ATLAS_AES', 'CASHBOOK', 'DMS']);
    });
});
