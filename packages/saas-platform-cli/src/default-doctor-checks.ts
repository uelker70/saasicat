// DEFAULT_DOCTOR_CHECKS — platform default checks for `<app> doctor`.
//
// Consumers can fold them in via `doctorChecks: [...DEFAULT_DOCTOR_CHECKS, ...projectSpecific]`
// in `CliContextModule.forRoot()` — analogous to
// `DEFAULT_MANIFEST_CHECKS`.
//
// Four platform checks:
//
//   1. **`platform.plan-catalog`** — `PLAN_CATALOG_TOKEN` is available in DI
//      and contains at least one plan.
//   2. **`platform.discovery-snapshot`** — `DISCOVERY_SNAPSHOT_TOKEN` is deliverable
//      and contains at least one capability.
//   3. **`platform.user-port`** — `UserPort.findByEmail` responds for a
//      test email (even if `null` comes back — as long as it does not throw).
//   4. **`platform.admin-manifest`** — `AdminManifestService.getManifest()`
//      returns without an exception.
//
// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P12.

import { Inject, Injectable, type Type } from '@nestjs/common';
import {
    AdminManifestService,
    DISCOVERY_SNAPSHOT_TOKEN,
    PLAN_CATALOG_TOKEN,
    type DiscoverySnapshot,
} from '@saasicat/nest';
import type { PlanCatalog, UserPort } from '@saasicat/types';
import type { DoctorCheck, DoctorCheckResult } from './doctor-flow.js';
import { USER_PORT_TOKEN } from './tokens.js';

@Injectable()
export class PlanCatalogDoctorCheck implements DoctorCheck {
    readonly id = 'platform.plan-catalog';
    readonly label = 'Plan-Catalog im DI';
    constructor(@Inject(PLAN_CATALOG_TOKEN) private readonly catalog: PlanCatalog) {}

    async run(): Promise<DoctorCheckResult> {
        const plans = this.catalog?.plans ?? [];
        if (plans.length === 0) {
            return {
                severity: 'error',
                message: 'PlanCatalog enthält keine Pläne — Onboarding-Pricing-Page wird leer.',
            };
        }
        return {
            severity: 'ok',
            message: `${plans.length} Plan(s), ${this.catalog.features?.length ?? 0} Feature(s) geladen.`,
            details: {
                projectKey: this.catalog.projectKey,
                planIds: plans.map((p) => p.id),
            },
        };
    }
}

@Injectable()
export class DiscoverySnapshotDoctorCheck implements DoctorCheck {
    readonly id = 'platform.discovery-snapshot';
    readonly label = 'Discovery-Snapshot beim Boot';
    constructor(
        @Inject(DISCOVERY_SNAPSHOT_TOKEN) private readonly snapshot: DiscoverySnapshot,
    ) {}

    async run(): Promise<DoctorCheckResult> {
        const caps = this.snapshot?.capabilities ?? [];
        if (caps.length === 0) {
            return {
                severity: 'warning',
                message:
                    'Keine Capabilities entdeckt — Decorator-tragende Module evtl. nicht in AppModule.imports[].',
            };
        }
        return {
            severity: 'ok',
            message: `${caps.length} Capabilities, ${this.snapshot.features?.length ?? 0} Features, ${this.snapshot.quotas?.length ?? 0} Quotas.`,
        };
    }
}

@Injectable()
export class UserPortDoctorCheck implements DoctorCheck {
    readonly id = 'platform.user-port';
    readonly label = 'UserPort.findByEmail erreichbar';
    constructor(@Inject(USER_PORT_TOKEN) private readonly users: UserPort) {}

    async run(): Promise<DoctorCheckResult> {
        try {
            await this.users.findByEmail('__doctor-check__@invalid.local');
            return { severity: 'ok', message: 'UserPort antwortet.' };
        } catch (err) {
            return {
                severity: 'error',
                message: `UserPort wirft: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }
}

@Injectable()
export class AdminManifestDoctorCheck implements DoctorCheck {
    readonly id = 'platform.admin-manifest';
    readonly label = 'AdminManifestService liefert Manifest';
    constructor(private readonly manifest: AdminManifestService) {}

    async run(): Promise<DoctorCheckResult> {
        try {
            const m = this.manifest.getManifest();
            const pageCount = Object.keys(m.navigation?.standardPages ?? {}).length;
            return {
                severity: 'ok',
                message: `Manifest mit ${pageCount} Standard-Pages, Hash ${m.build?.manifestHash?.slice(0, 12) ?? '???'}…`,
            };
        } catch (err) {
            return {
                severity: 'error',
                message: `Manifest-Build wirft: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }
}

/**
 * Default list that consumers can spread in `CliContextModule.forRoot({ doctorChecks })`:
 *
 * ```ts
 * doctorChecks: [
 *     ...DEFAULT_DOCTOR_CHECKS,
 *     new MyAppKositReachableCheck(),
 * ],
 * ```
 *
 * Platform checks need DI providers — they are instantiated automatically by
 * `CliContextModule` as `extraProviders` when the app sets
 * `defaultDoctorChecks: true`.
 */
export const PLATFORM_DOCTOR_CHECK_PROVIDERS: Array<Type<DoctorCheck>> = [
    PlanCatalogDoctorCheck,
    DiscoverySnapshotDoctorCheck,
    UserPortDoctorCheck,
    AdminManifestDoctorCheck,
];
