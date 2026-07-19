// DEFAULT_DOCTOR_CHECKS — Plattform-Standard-Checks für `<app> doctor`.
//
// Konsumenten können sie via `doctorChecks: [...DEFAULT_DOCTOR_CHECKS, ...projectSpecific]`
// im `CliContextModule.forRoot()` einfließen lassen — analog zu
// `DEFAULT_MANIFEST_CHECKS`.
//
// Vier Plattform-Checks:
//
//   1. **`platform.plan-catalog`** — `PLAN_CATALOG_TOKEN` ist im DI verfügbar
//      und enthält mindestens einen Plan.
//   2. **`platform.discovery-snapshot`** — `DISCOVERY_SNAPSHOT_TOKEN` lieferbar
//      und enthält mindestens eine Capability.
//   3. **`platform.user-port`** — `UserPort.findByEmail` antwortet für eine
//      Test-Email (auch wenn `null` zurückkommt — Hauptsache kein Throw).
//   4. **`platform.admin-manifest`** — `AdminManifestService.getManifest()`
//      liefert ohne Exception.
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
 * Default-Liste, die Konsumenten im `CliContextModule.forRoot({ doctorChecks })`
 * spreizen können:
 *
 * ```ts
 * doctorChecks: [
 *     ...DEFAULT_DOCTOR_CHECKS,
 *     new MyAppKositReachableCheck(),
 * ],
 * ```
 *
 * Plattform-Checks brauchen DI-Provider — werden vom `CliContextModule`
 * automatisch als `extraProviders` instanziiert, wenn die App
 * `defaultDoctorChecks: true` setzt.
 */
export const PLATFORM_DOCTOR_CHECK_PROVIDERS: Array<Type<DoctorCheck>> = [
    PlanCatalogDoctorCheck,
    DiscoverySnapshotDoctorCheck,
    UserPortDoctorCheck,
    AdminManifestDoctorCheck,
];
