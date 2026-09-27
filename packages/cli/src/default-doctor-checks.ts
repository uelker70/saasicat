// DEFAULT_DOCTOR_CHECKS — platform default checks for `<app> doctor`.
//
// Consumers can fold them in via `doctorChecks: [...DEFAULT_DOCTOR_CHECKS, ...projectSpecific]`
// in `CliContextModule.forRoot()` — analogous to
// `DEFAULT_MANIFEST_CHECKS`.
//
// Seven platform checks:
//
//   1. **`platform.plan-catalog`** — `PLAN_CATALOG_SOURCE_TOKEN` is available in
//      DI, reads, and the catalogue it reads contains at least one plan.
//   2. **`platform.discovery-snapshot`** — `DISCOVERY_SNAPSHOT_TOKEN` is deliverable
//      and contains at least one capability.
//   3. **`platform.user-port`** — `UserPort.findByEmail` responds for a
//      test email (even if `null` comes back — as long as it does not throw).
//   4. **`platform.admin-manifest`** — `AdminManifestService.getManifest()`
//      returns without an exception.
//   5. **`platform.issuer-identity`** — the issuer in `config/saas.yaml` is the
//      legal entity the installation recorded, and says how many contracts a
//      change of it would have to be declared against.
//   6. **`platform.maintenance`** — whether tenants are locked out, since when
//      and past which announced end; an announcement that lapsed without a
//      lock; a table the lock cannot be read from.
//   7. **`platform.contract-features`** — the contracts in force whose frozen
//      features hold a key the application no longer knows, or lack one the
//      versions they cover grant today (`SC-ENTL-022`). Reports and changes
//      nothing; `<app> contracts refresh` carries the vocabulary over.
//

import { Inject, Injectable, Optional, type Type } from '@nestjs/common';
import {
    AdminManifestService,
    ContractRefreshService,
    type ContractRefreshPreview,
    DISCOVERY_SNAPSHOT_TOKEN,
    IssuerIdentityInspector,
    MaintenanceService,
    PLAN_CATALOG_SOURCE_TOKEN,
    type DiscoverySnapshot,
    type PlanCatalogSource,
} from '@saasicat/nest';
import type { PlanCatalog, UserPort } from '@saasicat/core';
import type { DoctorCheck, DoctorCheckResult } from './doctor-flow.js';
import { USER_PORT_TOKEN } from './cli.tokens.js';

@Injectable()
export class PlanCatalogDoctorCheck implements DoctorCheck {
    readonly id = 'platform.plan-catalog';
    readonly label = 'Plan catalog in DI';
    constructor(@Inject(PLAN_CATALOG_SOURCE_TOKEN) private readonly catalogs: PlanCatalogSource) {}

    async run(): Promise<DoctorCheckResult> {
        let catalog: PlanCatalog;
        try {
            catalog = await this.catalogs.current();
        } catch (err) {
            return {
                severity: 'error',
                message: `The plan catalog cannot be read: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
        const plans = catalog.plans ?? [];
        if (plans.length === 0) {
            return {
                severity: 'error',
                message:
                    'The plan catalog contains no plans — the onboarding pricing page will be empty.',
            };
        }
        return {
            severity: 'ok',
            message: `${plans.length} plan(s), ${catalog.features?.length ?? 0} feature(s) loaded.`,
            details: {
                app: catalog.app.name,
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
            const m = await this.manifest.getManifest();
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
                // One unknown answered once: `null` for both where the
                // contracts could not be read, rather than a null count beside
                // an empty list that reads as "none".
                details: verdict.running
                    ? {
                          runningContracts: verdict.running.total,
                          named: verdict.running.contracts.map((row) => row.id),
                      }
                    : { runningContracts: null, named: null },
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
 * Whether tenants are locked out, and whether they should still be.
 *
 * A lock ends only when somebody says so (`SC-OPS-014`), so a deploy that died
 * after `maintenance on` leaves every tenant outside until an operator notices.
 * This is one of the two places that notice for them; the administration is
 * the other. A lock in place is reported as a warning even while a deploy is
 * running — tenants cannot work, and that is never nothing.
 */
@Injectable()
export class MaintenanceDoctorCheck implements DoctorCheck {
    readonly id = 'platform.maintenance';
    readonly label = 'Maintenance lock';
    constructor(
        @Optional()
        @Inject(MaintenanceService)
        private readonly maintenance: MaintenanceService | null = null,
    ) {}

    async run(): Promise<DoctorCheckResult> {
        if (!this.maintenance) {
            return { severity: 'ok', message: 'Maintenance windows are not turned on.' };
        }
        let open;
        try {
            ({ open } = await this.maintenance.overview());
        } catch (err) {
            return {
                severity: 'error',
                message:
                    `The maintenance windows cannot be read, so a lock would protect no deploy: ` +
                    `${err instanceof Error ? err.message : String(err)}`,
            };
        }
        if (!open) return { severity: 'ok', message: 'No maintenance window is open.' };
        if (open.status === 'locked') {
            return {
                severity: 'warning',
                message: open.overrun
                    ? `Tenants have been locked out since ${open.lockedAt}, and the announced end ` +
                      `${open.endsAt} has passed. Unlock with \`maintenance off\` once the deploy is through.`
                    : `Tenants are locked out since ${open.lockedAt}` +
                      (open.endsAt
                          ? `, announced until ${open.endsAt}.`
                          : ', with no end announced.'),
                details: { windowId: open.id, lockedBy: open.lockedBy },
            };
        }
        if (open.lapsed) {
            return {
                severity: 'warning',
                message:
                    `A window was announced for ${open.startsAt} to ${open.endsAt} and never locked; ` +
                    'its end has passed. Cancel it — it stands in the way of the next announcement.',
                details: { windowId: open.id },
            };
        }
        return {
            severity: 'ok',
            message: `A window is announced for ${open.startsAt} to ${open.endsAt}.`,
        };
    }
}

/** How many contracts the check's message names before it stops naming them. */
const CONTRACTS_NAMED = 5;

/**
 * The contracts in force whose frozen vocabulary has fallen behind the
 * application's (`SC-ENTL-022`).
 *
 * A warning rather than an error: a contract keeps what it was frozen with by
 * design, and whether to carry a renamed feature into it is the operator's
 * decision, made with `<app> contracts refresh` after a look at what it would
 * change.
 */
@Injectable()
export class ContractFeaturesDoctorCheck implements DoctorCheck {
    readonly id = 'platform.contract-features';
    readonly label = 'Contract features against the vocabulary';
    constructor(
        @Optional()
        @Inject(ContractRefreshService)
        private readonly refresh: ContractRefreshService | null = null,
    ) {}

    async run(): Promise<DoctorCheckResult> {
        if (!this.refresh) {
            return { severity: 'ok', message: 'Contracts are not frozen in this installation.' };
        }
        let report;
        try {
            report = await this.refresh.inspect();
        } catch (err) {
            return {
                severity: 'error',
                message: `The contracts in force cannot be read: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
        if (report.stale.length === 0 && report.unreadable.length === 0) {
            return {
                severity: 'ok',
                message: `${report.inForce} contract(s) in force, each granting the vocabulary the application has.`,
            };
        }
        const parts: string[] = [];
        if (report.stale.length > 0) {
            parts.push(
                `${report.stale.length} of ${report.inForce} contract(s) in force grant a ` +
                    `vocabulary the application has left: ${named(report.stale, vocabularyOf)}. ` +
                    '`<app> contracts refresh --all` shows what carrying it over would change.',
            );
        }
        if (report.unreadable.length > 0) {
            parts.push(
                `${report.unreadable.length} contract(s) in force could not be compared, so ` +
                    `nothing is known about their vocabulary: ${named(report.unreadable, reasonOf)}.`,
            );
        }
        return {
            severity: 'warning',
            message: parts.join(' '),
            details: {
                contracts: report.stale.map((contract) => ({
                    id: contract.contractId,
                    tenantId: contract.tenantId,
                    unknown: contract.vocabulary.unknown,
                    missing: contract.vocabulary.missing,
                })),
                unreadable: report.unreadable.map((contract) => ({
                    id: contract.contractId,
                    tenantId: contract.tenantId,
                    reason: reasonOf(contract),
                })),
            },
        };
    }
}

/** Up to `CONTRACTS_NAMED` contracts, each with what `describe` says of it, and the rest counted. */
function named(
    contracts: readonly ContractRefreshPreview[],
    describe: (contract: ContractRefreshPreview) => string,
): string {
    const listed = contracts
        .slice(0, CONTRACTS_NAMED)
        .map(
            (contract) =>
                `${contract.contractId} (tenant ${contract.tenantId}: ${describe(contract)})`,
        )
        .join(', ');
    const more = contracts.length - CONTRACTS_NAMED;
    return more > 0 ? `${listed} and ${more} more` : listed;
}

function vocabularyOf({ vocabulary }: ContractRefreshPreview): string {
    return [
        ...(vocabulary.unknown.length > 0 ? [`unknown ${vocabulary.unknown.join(', ')}`] : []),
        ...(vocabulary.missing.length > 0 ? [`missing ${vocabulary.missing.join(', ')}`] : []),
    ].join('; ');
}

function reasonOf({ refusal }: ContractRefreshPreview): string {
    if (refusal?.code === 'NO_SUBSCRIPTION') return 'its tenant has no subscription';
    return refusal?.code === 'REFUSED' ? refusal.reason : 'not read';
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
    MaintenanceDoctorCheck,
    ContractFeaturesDoctorCheck,
];
