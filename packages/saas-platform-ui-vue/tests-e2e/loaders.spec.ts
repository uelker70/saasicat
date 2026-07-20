import { test, expect } from '@playwright/test';

// Browser-validated E2E: lädt das gebaute Plattform-Bundle in einem echten
// Chromium-Headless, mockt alle HTTP-Requests via page.route() und prüft die
// Loader/Composables an dem Stand, wie sie im Konsumenten-Browser landen.
//
// Verifiziert insbesondere:
//   - dist/index.js lädt sauber als ESM in echtem Browser (kein
//     "process is not defined" o. ä. Node-Leak in der Bundle-Form).
//   - localStorage-Persistenz funktioniert wirklich (kein In-Memory-Mock).
//   - fetch via window.fetch wird korrekt vom ManifestLoader genutzt.

const FIXTURE_URL = '/tests-e2e/fixtures/index.html';

test.describe('Platform UI Bundle — Browser Smoke', () => {
    test('Bundle lädt als ESM ohne Node-Leak', async ({ page }) => {
        const errors: string[] = [];
        const consoleMsgs: string[] = [];
        page.on('pageerror', (err) => errors.push(err.message));
        page.on('console', (msg) => consoleMsgs.push(`${msg.type()}: ${msg.text()}`));
        await page.goto(FIXTURE_URL);
        await page.waitForFunction(
            () =>
                Boolean((globalThis as { __platform?: unknown }).__platform) ||
                Boolean((globalThis as { __platformError?: unknown }).__platformError),
        );
        const errFromPage = await page.evaluate(
            () => (globalThis as { __platformError?: string }).__platformError,
        );
        if (errFromPage) {
            throw new Error(
                `Bundle failed: ${errFromPage}\nPage errors: ${errors.join(' | ')}\nConsole: ${consoleMsgs.join(' | ')}`,
            );
        }
        await expect(page.locator('#root')).toContainText('Platform UI Bundle loaded.');
        expect(errors).toEqual([]);

        // Globale __platform-Symbol vorhanden
        const exposedKeys = await page.evaluate(() =>
            Object.keys((globalThis as unknown as { __platform: object }).__platform).sort(),
        );
        expect(exposedKeys).toContain('BootLoader');
        expect(exposedKeys).toContain('ManifestLoader');
        expect(exposedKeys).toContain('ActionRegistry');
        expect(exposedKeys).toContain('buildRoutes');
        expect(exposedKeys).toContain('buildSidebar');
    });

    test('BootLoader fetcht /admin/boot via echtem fetch + page.route-Mock', async ({ page }) => {
        await page.route('**/admin/boot', (route) => {
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    project: { key: 'cf', displayName: 'CF', environment: 'development' },
                }),
            });
        });
        await page.goto(FIXTURE_URL);
        await page.waitForFunction(() =>
            Boolean((globalThis as { __platform?: unknown }).__platform),
        );
        const result = await page.evaluate(async () => {
            const { BootLoader } = (
                globalThis as unknown as {
                    __platform: {
                        BootLoader: new (opts?: unknown) => { load: () => Promise<unknown> };
                    };
                }
            ).__platform;
            const loader = new BootLoader({ endpoint: '/admin/boot' });
            return loader.load();
        });
        expect((result as { project: { key: string } }).project.key).toBe('cf');
    });

    test('ManifestLoader persistiert ETag in localStorage', async ({ page }) => {
        let callCount = 0;
        await page.route('**/admin/manifest', (route) => {
            callCount += 1;
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                headers: { etag: '"sha256-abc123"' },
                body: JSON.stringify({
                    schemaVersion: 1,
                    project: { key: 'cf', displayName: 'CF' },
                    build: {
                        platformPackageVersion: '0.1.0',
                        appVersion: '1.0.0',
                        manifestHash: 'sha256-abc123',
                    },
                    capabilities: {},
                    navigation: { standardPages: {} },
                    planCatalogSnapshot: {
                        source: 'config/plans.yaml',
                        hash: 'h',
                        currency: 'EUR',
                        vatRate: 19,
                        plans: [],
                    },
                }),
            });
        });
        await page.goto(FIXTURE_URL);
        await page.waitForFunction(() =>
            Boolean((globalThis as { __platform?: unknown }).__platform),
        );
        const storedEtag = await page.evaluate(async () => {
            const { ManifestLoader } = (
                globalThis as unknown as {
                    __platform: {
                        ManifestLoader: new (opts?: unknown) => { load: () => Promise<unknown> };
                    };
                }
            ).__platform;
            const loader = new ManifestLoader({ endpoint: '/admin/manifest' });
            await loader.load();
            return localStorage.getItem('manifest:etag');
        });
        expect(storedEtag).toBe('"sha256-abc123"');
        expect(callCount).toBe(1);
    });

    test('ManifestLoader: zweiter Load schickt If-None-Match + nutzt Cache bei 304', async ({
        page,
    }) => {
        const calls: { hadIfNoneMatch: boolean }[] = [];
        await page.route('**/admin/manifest', (route, request) => {
            const ifNoneMatch = request.headers()['if-none-match'];
            calls.push({ hadIfNoneMatch: !!ifNoneMatch });
            if (ifNoneMatch) {
                return route.fulfill({ status: 304, body: '' });
            }
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                headers: { etag: '"v1"' },
                body: JSON.stringify({
                    schemaVersion: 1,
                    project: { key: 'cf', displayName: 'CF' },
                    build: {
                        platformPackageVersion: '0.1.0',
                        appVersion: '1.0.0',
                        manifestHash: 'sha256-v1',
                    },
                    capabilities: {},
                    navigation: { standardPages: {} },
                    planCatalogSnapshot: {
                        source: 'config/plans.yaml',
                        hash: 'h',
                        currency: 'EUR',
                        vatRate: 19,
                        plans: [],
                    },
                }),
            });
        });
        await page.goto(FIXTURE_URL);
        await page.waitForFunction(() =>
            Boolean((globalThis as { __platform?: unknown }).__platform),
        );
        const result = await page.evaluate(async () => {
            const { ManifestLoader } = (
                globalThis as unknown as {
                    __platform: {
                        ManifestLoader: new (opts?: unknown) => {
                            load: () => Promise<{ build: { manifestHash: string } }>;
                        };
                    };
                }
            ).__platform;
            const loader = new ManifestLoader({ endpoint: '/admin/manifest' });
            const first = await loader.load();
            const second = await loader.load();
            return {
                first: first.build.manifestHash,
                second: second.build.manifestHash,
                same: first.build.manifestHash === second.build.manifestHash,
            };
        });
        expect(result.first).toBe('sha256-v1');
        expect(result.second).toBe('sha256-v1');
        expect(result.same).toBe(true);
        expect(calls.length).toBe(2);
        expect(calls[0].hadIfNoneMatch).toBe(false);
        expect(calls[1].hadIfNoneMatch).toBe(true);
    });

    test('buildRoutes + buildSidebar im Browser', async ({ page }) => {
        await page.goto(FIXTURE_URL);
        await page.waitForFunction(() =>
            Boolean((globalThis as { __platform?: unknown }).__platform),
        );
        const result = await page.evaluate(() => {
            const { buildRoutes, buildSidebar } = (
                globalThis as unknown as {
                    __platform: {
                        buildRoutes: (m: unknown) => Array<{ id: string; path: string }>;
                        buildSidebar: (
                            r: unknown,
                        ) => Array<{ section: string | null; items: Array<{ id: string }> }>;
                    };
                }
            ).__platform;
            const manifest = {
                schemaVersion: 1,
                project: { key: 'cf', displayName: 'CF' },
                build: {
                    platformPackageVersion: '0.1.0',
                    appVersion: '1.0.0',
                    manifestHash: 'sha256-x',
                },
                capabilities: { 'tenants:list:read': true },
                navigation: {
                    standardPages: {
                        tenants: { enabled: true, requiredCapability: 'tenants:list:read' },
                    },
                    projectPages: [
                        {
                            id: 'cf.reports',
                            label: 'Reports',
                            route: '/admin/reports',
                            componentKey: 'cf-reports',
                            navSection: 'MyApp',
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
            };
            const routes = buildRoutes(manifest);
            const sidebar = buildSidebar(routes);
            return {
                routeIds: routes.map((r) => r.id),
                sidebarSections: sidebar.map((s) => ({
                    section: s.section,
                    count: s.items.length,
                })),
            };
        });
        expect(result.routeIds).toContain('tenants');
        expect(result.routeIds).toContain('cf.reports');
        // Standard-Pages tragen ihre Default-Sektion (tenants → 'Kunden');
        // unbekannte Sektionen folgen alphabetisch nach der sectionOrder.
        expect(result.sidebarSections[0].section).toBe('Kunden');
        expect(result.sidebarSections[1].section).toBe('MyApp');
    });

    test('Bulk-Publish: POST mit X-Mfa-Code-Header + parallele Calls', async ({ page }) => {
        const seenHeaders: Array<{ url: string; mfaCode: string | undefined }> = [];
        await page.route('**/api/v1/admin/plan-versions/*/publish', (route, request) => {
            seenHeaders.push({
                url: request.url(),
                mfaCode: request.headers()['x-mfa-code'],
            });
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ id: 'p', publishedAt: new Date().toISOString() }),
            });
        });
        await page.goto(FIXTURE_URL);
        await page.waitForFunction(() =>
            Boolean((globalThis as { __platform?: unknown }).__platform),
        );
        const result = await page.evaluate(async () => {
            const { useBulkPublish } = (
                globalThis as unknown as {
                    __platform: {
                        useBulkPublish: (opts?: unknown) => {
                            setItems: (items: unknown[]) => void;
                            run: (input: unknown) => Promise<void>;
                            successCount: { value: number };
                            failureCount: { value: number };
                            done: { value: boolean };
                        };
                    };
                }
            ).__platform;
            const bp = useBulkPublish({
                endpoints: {
                    plan: (draftId: string) => `/api/v1/admin/plan-versions/${draftId}/publish`,
                },
            });
            bp.setItems([
                { key: 'p:1', kind: 'plan', draftId: '1', label: 'A' },
                { key: 'p:2', kind: 'plan', draftId: '2', label: 'B' },
            ]);
            await bp.run({ changeNote: 'Q3', mfaCode: '482159' });
            return {
                success: bp.successCount.value,
                failure: bp.failureCount.value,
                done: bp.done.value,
            };
        });
        expect(result.success).toBe(2);
        expect(result.failure).toBe(0);
        expect(result.done).toBe(true);
        expect(seenHeaders.length).toBe(2);
        expect(seenHeaders[0].mfaCode).toBe('482159');
        expect(seenHeaders[1].mfaCode).toBe('482159');
    });
});
