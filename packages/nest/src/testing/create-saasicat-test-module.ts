// createSaaSiCatTestModule — convenience for integration tests that want to
// spin up the `SaaSiCatModule` with fake adapters and a static in-memory
// PlanCatalog. Saves ~50 lines of setup per test file.
//
// Usage:
//
// ```ts
// import { Test } from '@nestjs/testing';
// import { createSaaSiCatTestModule } from '@saasicat/nest/testing';
//
// const moduleRef = await createSaaSiCatTestModule({
//     planCatalog: {
//         schemaVersion: 1,
//         projectKey: 'notesapp',
//         currency: 'EUR',
//         vatRate: 19,
//         plans: [{ id: 'starter', features: ['NOTES'], quotas: { notesMax: 25 } }],
//     },
//     defaultPlanId: 'starter',
//     quotaProviders: [NotesQuotaProvider],
// }).compile();
//
// const ent = moduleRef.get(StaticEntitlementService);
// ```
//

import { Module, type DynamicModule, type Type } from '@nestjs/common';
import type { PlanCatalog, QuotaProvider } from '@saasicat/core';
import { SaaSiCatModule } from '../platform/saasicat.module.js';
import type { SaaSiCatAdapters } from '../platform/saasicat.module.js';

/** No-op stub for `MfaPort`. */
export class StubMfaPort {
    private secrets = new Map<string, string>();
    async getSecret(userId: string): Promise<string | null> {
        return this.secrets.get(userId) ?? null;
    }
    async setSecret(userId: string, secret: string | null): Promise<void> {
        if (secret === null) this.secrets.delete(userId);
        else this.secrets.set(userId, secret);
    }
    async isEnabled(userId: string): Promise<boolean> {
        return this.secrets.has(userId);
    }
}

/** No-op stub for `AuditPort`. Keeps calls as a list for asserts. */
export class StubAuditPort {
    public readonly calls: Array<{
        actor: unknown;
        entity: string;
        entityId: string;
        action: string;
        changes?: Record<string, unknown>;
    }> = [];
    async write(input: {
        actor: unknown;
        entity: string;
        entityId: string;
        action: string;
        changes?: Record<string, unknown>;
    }): Promise<void> {
        this.calls.push(input);
    }
}

/** No-op stub for `RlsBypassPort` — calls the callback without wrapping. */
export class StubRlsBypassPort {
    async runWithBypass<T>(fn: () => Promise<T>): Promise<T> {
        return fn();
    }
}

export interface CreateSaaSiCatTestModuleOptions {
    planCatalog: PlanCatalog;
    /** Default `'starter'` if the catalog has at least one plan. */
    defaultPlanId?: string;
    /** QuotaProvider classes for the `EnforceQuotaInterceptor`. */
    quotaProviders?: Array<Type<QuotaProvider>>;
    /** Overrides — if the test needs a different adapter. */
    overrides?: Partial<Pick<SaaSiCatAdapters, 'mfa' | 'audit' | 'rlsBypass'>>;
}

/**
 * Returns a `DynamicModule` that sets up the SaaSiCatModule with stub
 * adapters + the given PlanCatalog in static entitlement mode.
 * Tests can drop this into `Test.createTestingModule({ imports: [...] })`.
 */
export function createSaaSiCatTestModule(options: CreateSaaSiCatTestModuleOptions): DynamicModule {
    const defaultPlanId = options.defaultPlanId ?? options.planCatalog.plans?.[0]?.id;

    @Module({
        imports: [
            SaaSiCatModule.forRoot({
                planCatalog: options.planCatalog,
                controller: { guards: [] }, // Tests run without an auth guard
                adapters: {
                    mfa: options.overrides?.mfa ?? new StubMfaPort(),
                    audit: options.overrides?.audit ?? new StubAuditPort(),
                    rlsBypass: options.overrides?.rlsBypass ?? new StubRlsBypassPort(),
                },
                defaultPlanId,
                quotaProviders: options.quotaProviders,
            }),
        ],
    })
    class SaaSiCatTestHost {}

    return {
        module: SaaSiCatTestHost,
    };
}
