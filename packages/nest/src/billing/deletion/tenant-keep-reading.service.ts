// What a tenant's users are told it keeps for obligations of its own while
// its subscription's end holds it to reading (`SC-PRIV-022`), in the banner of
// that period: every user of the tenant, since whoever needs the receipts is
// often not its administrator.
//
// Each read asks the application, so a page asks once as it loads, never with
// each read of the tenant's state. What the application fails to answer is
// shown as nothing: the lines are a service to the tenant, and neither the
// banner nor the deletion waits on them. The log says why, by a code alone —
// what the application threw or answered may name the tenant's data.

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { TenantKeepReportPort, TenantKeepView } from '@saasicat/core';

import { TimeoutError } from '../../core/with-timeout.js';
import { TenantAccessService } from '../../tenant-access/tenant-access.service.js';
import { TENANT_KEEP_REPORT_PORT_TOKEN } from '../tenant-billing.tokens.js';
import { KeepLinesRefused, whatATenantKeeps } from './keep-report.js';

/** How long a page's read waits for the application's report before showing no lines. */
export const KEEP_REPORT_READ_TIMEOUT_MS = 10_000;

/** Why the application's report gave nothing to show, as the log names it. */
function failureCodeOf(error: unknown): string {
    if (error instanceof TimeoutError) return 'timeout';
    if (error instanceof KeepLinesRefused) return error.problem;
    return 'failed';
}

@Injectable()
export class TenantKeepReadingService {
    private readonly logger = new Logger('SaaSiCat.TenantKeep');

    constructor(
        @Inject(TENANT_KEEP_REPORT_PORT_TOKEN) private readonly report: TenantKeepReportPort,
        // Without it — a module wired by hand without `SaaSiCatModule` —
        // nothing records a reason, so no end holds the tenant to reading.
        @Optional()
        @Inject(TenantAccessService)
        private readonly access: TenantAccessService | null = null,
    ) {}

    /** What `tenantId`'s users are told it keeps. */
    async linesFor(tenantId: string): Promise<TenantKeepView> {
        if (!(await this.heldByAnEnd(tenantId))) return { keep: [] };
        try {
            return {
                keep: await whatATenantKeeps(this.report, tenantId, KEEP_REPORT_READ_TIMEOUT_MS),
            };
        } catch (error) {
            this.logger.warn(
                `The TenantKeepReportPort gave nothing to show the users of tenant ${tenantId} ` +
                    `(${failureCodeOf(error)}); the banner shows no lines.`,
            );
            return { keep: null };
        }
    }

    /** Whether an open `ended` reason holds `tenantId`: its deletion is coming. */
    private async heldByAnEnd(tenantId: string): Promise<boolean> {
        if (!this.access) return false;
        const { holds } = await this.access.accessOf(tenantId);
        return holds.some((hold) => hold.kind === 'ended');
    }
}
