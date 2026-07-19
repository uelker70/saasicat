// createSaasPlatformTestModule — Convenience für Integration-Tests, die das
// `SaasPlatformModule` mit Fake-Adaptern und einem statischen In-Memory-
// PlanCatalog hochfahren wollen. Spart pro Test-Datei ~50 Zeilen Setup.
//
// Verwendung:
//
// ```ts
// import { Test } from '@nestjs/testing';
// import { createSaasPlatformTestModule } from '@saasicat/nest/testing';
//
// const moduleRef = await createSaasPlatformTestModule({
//     planCatalog: {
//         schemaVersion: 1,
//         projectKey: 'notesapp',
//         currency: 'EUR',
//         vatRate: 19,
//         quotaKeys: [{ key: 'notes.max' }],
//         plans: [{ id: 'starter', features: ['NOTES'], quotas: { 'notes.max': 25 } }],
//     },
//     defaultPlanId: 'starter',
//     quotaProviders: [NotesQuotaProvider],
// }).compile();
//
// const ent = moduleRef.get(StaticEntitlementService);
// ```
//
// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P13.

import { Module, type DynamicModule, type Type } from '@nestjs/common';
import type { PlanCatalog, QuotaProvider } from '@saasicat/types';
import { SaasPlatformModule } from '../platform/saas-platform.module.js';
import type { SaasPlatformModuleOptions } from '../platform/saas-platform.module.js';

/** No-op-Stub für `MfaPort`. */
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

/** No-op-Stub für `AuditPort`. Behält Aufrufe als Liste für Asserts. */
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

/** No-op-Stub für `RlsBypassPort` — ruft den Callback ohne Wrapping. */
export class StubRlsBypassPort {
    async runWithBypass<T>(fn: () => Promise<T>): Promise<T> {
        return fn();
    }
}

export interface CreateSaasPlatformTestModuleOptions {
    planCatalog: PlanCatalog;
    /** Default `'starter'` falls Catalog mindestens einen Plan hat. */
    defaultPlanId?: string;
    /** QuotaProvider-Klassen für den `EnforceQuotaInterceptor`. */
    quotaProviders?: Array<Type<QuotaProvider>>;
    /** Overrides — falls der Test einen anderen Adapter braucht. */
    overrides?: Partial<{
        mfa: SaasPlatformModuleOptions['adapters']['mfa'];
        audit: SaasPlatformModuleOptions['adapters']['audit'];
        rlsBypass: SaasPlatformModuleOptions['adapters']['rlsBypass'];
    }>;
}

/**
 * Liefert ein `DynamicModule`, das das SaasPlatformModule mit Stub-Adaptern
 * + dem übergebenen PlanCatalog im Static-Entitlement-Modus aufsetzt.
 * Tests können das in `Test.createTestingModule({ imports: [...] })`
 * einkippen.
 */
export function createSaasPlatformTestModule(
    options: CreateSaasPlatformTestModuleOptions,
): DynamicModule {
    const defaultPlanId =
        options.defaultPlanId ?? options.planCatalog.plans?.[0]?.id;

    @Module({
        imports: [
            SaasPlatformModule.forRoot({
                planCatalog: options.planCatalog,
                controller: { guards: [] }, // Tests laufen ohne Auth-Guard
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
    class SaasPlatformTestHost {}

    return {
        module: SaasPlatformTestHost,
    };
}
