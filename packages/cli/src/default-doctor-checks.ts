// DEFAULT_DOCTOR_CHECKS — platform default checks for `<app> doctor`.
//
// Consumers can fold them in via `doctorChecks: [...DEFAULT_DOCTOR_CHECKS, ...projectSpecific]`
// in `CliContextModule.forRoot()` — analogous to
// `DEFAULT_MANIFEST_CHECKS`.
//
// Five platform checks:
//
//   1. **`platform.plan-catalog`** — `PLAN_CATALOG_TOKEN` is available in DI
//      and contains at least one plan.
//   2. **`platform.discovery-snapshot`** — `DISCOVERY_SNAPSHOT_TOKEN` is deliverable
//      and contains at least one capability.
//   3. **`platform.user-port`** — `UserPort.findByEmail` responds for a
//      test email (even if `null` comes back — as long as it does not throw).
//   4. **`platform.admin-manifest`** — `AdminManifestService.getManifest()`
//      returns without an exception.
//   5. **`platform.issuer-identity`** — the issuer in `config/saas.yaml` is the
//      legal entity the installation recorded, and says how many contracts a
//      change of it would have to be declared against.
//

import { Inject, Injectable, type Type } from '@nestjs/common';
import {
    AdminManifestService,
    DISCOVERY_SNAPSHOT_TOKEN,
    IssuerIdentityInspector,
    PLAN_CATALOG_TOKEN,
    type DiscoverySnapshot,
} from '@saasicat/nest';
import type { PlanCatalog, UserPort } from '@saasicat/core';
import type { DoctorCheck, DoctorCheckResult } from './doctor-flow.js';
import { USER_PORT_TOKEN } from './cli.tokens.js';

@Injectable()
export class PlanCatalogDoctorCheck implements DoctorCheck {
    readonly id = 'platform.plan-catalog';
    readonly label = 'Plan catalog in DI';
    constructor(@Inject(PLAN_CATALOG_TOKEN) private readonly catalog: PlanCatalog) {}

    async run(): Promise<DoctorCheckResult> {
        const plans = this.catalog?.plans ?? [];
        if (plans.length === 0) {
            return {
                severity: 'error',
                message:
                    'The plan catalog contains no plans — the onboarding pricing page will be empty.',
            };
        }
        return {
            severity: 'ok',
            message: `${plans.length} plan(s), ${this.catalog.features?.length ?? 0} feature(s) loaded.`,
            details: {
                app: this.catalog.app.name,
                planIds: plans.map((p) => p.id),
            },
        };
    }
}

@Injectable()
export class DiscoverySnapshotDoctorCheck implements DoctorCheck {
    readonly id = 'platform.discovery-snapshot';
    readonly label = 'Discovery snapshot on boot';
    constructor(@Inject(DISCOVERY_SNAPSHOT_TOKEN) private readonly snapshot: DiscoverySnapshot) {}

    async run(): Promise<DoctorCheckResult> {
        const caps = this.snapshot?.capabilities ?? [];
        if (caps.length === 0) {
            return {
                severity: 'warning',
                message:
                    'No capabilities discovered — decorator-carrying modules may be missing from AppModule.imports[].',
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
    readonly label = 'UserPort.findByEmail reachable';
    constructor(@Inject(USER_PORT_TOKEN) private readonly users: UserPort) {}

    async run(): Promise<DoctorCheckResult> {
        try {
            await this.users.findByEmail('__doctor-check__@invalid.local');
            return { severity: 'ok', message: 'UserPort responds.' };
        } catch (err) {
            return {
                severity: 'error',
                message: `UserPort throws: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }
}

@Injectable()
export class AdminManifestDoctorCheck implements DoctorCheck {
    readonly id = 'platform.admin-manifest';
    readonly label = 'AdminManifestService returns a manifest';
    constructor(private readonly manifest: AdminManifestService) {}

    async run(): Promise<DoctorCheckResult> {
        try {
            const m = this.manifest.getManifest();
            const pageCount = Object.keys(m.navigation?.standardPages ?? {}).length;
            return {
                severity: 'ok',
                message: `Manifest with ${pageCount} standard pages, hash ${m.build?.manifestHash?.slice(0, 12) ?? '???'}…`,
            };
        } catch (err) {
            return {
                severity: 'error',
                message: `Manifest build throws: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }
}

/**
 * The issuer identity, and what changing it would cost.
 *
 * A start compares the issuer in `config/saas.yaml` with the identity the
 * installation recorded and refuses an undeclared difference, because moving a
 * contract to another legal entity is a transfer and not an edit of a setting.
 * This asks the same question without acting on it and says, while nothing has
 * moved, what a change would cost.
 *
 * It does NOT turn a refusal into a report where the same application also
 * mounts the platform's boot check: that check runs at `init()`, so the CLI
 * process carrying it is refused before any command runs — with the same
 * message, which is the point. The `refused` branch below is for a diagnostic
 * that runs without the hook.
 */
@Injectable()
export class IssuerIdentityDoctorCheck implements DoctorCheck {
    readonly id = 'platform.issuer-identity';
    readonly label = 'Issuer identity against the recorded one';
    constructor(private readonly issuer: IssuerIdentityInspector) {}

    async run(): Promise<DoctorCheckResult> {
        const verdict = await this.issuer.inspect();
        if (verdict.kind === 'refused') {
            return {
                severity: 'error',
                message: verdict.refusal,
                // The number and the identifiers, not the rows: `DoctorReport`
                // is serialised as JSON, and the dates on a row would come out
                // as timestamps beside the same dates already written as days in
                // the message above.
                details: {
                    runningContracts: verdict.running?.total ?? null,
                    named: verdict.running?.contracts.map((row) => row.id) ?? [],
                },
            };
        }
        if (verdict.kind === 'not-compared') {
            return {
                severity: 'warning',
                message:
                    `The issuer in the file is compared with nothing — ${verdict.why} — so a start ` +
                    'that names another legal entity than the last one is not refused.',
            };
        }
        const change = verdict.change;
        switch (change.kind) {
            case 'none-named':
                return { severity: 'ok', message: 'No issuer is named, and none was recorded.' };
            case 'first-naming':
                return {
                    severity: 'ok',
                    message: `'${change.identity.legalName}' is named for the first time; no contract can name another.`,
                };
            case 'corrected':
                return {
                    severity: 'ok',
                    message:
                        `A correction of '${change.recorded.legalName}' is declared: ` +
                        `${change.reason}. This is what the start found; whether it has been ` +
                        'recorded is what `GET /admin/settings` shows, and `issuer.correctionOf` ' +
                        'may be dropped once it does.',
                };
            case 'unchanged': {
                const running = await this.issuer.runningContractCount();
                const weighedAgainst =
                    running === null
                        ? ''
                        : ` ${running} contract(s) are running, and their issuer copies do not follow a change.`;
                return {
                    severity: 'ok',
                    message:
                        `'${change.identity.legalName}' is what the installation recorded.` +
                        weighedAgainst +
                        ' Changing the legal name or a tax identifier needs `issuer.correctionOf` ' +
                        'beside the values it replaces; the address and the contact details do not.',
                };
            }
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
    IssuerIdentityDoctorCheck,
];
