// How the platform asks the application what a tenant keeps for obligations of
// its own (`SC-PRIV-022`): bounded in time, since the application may never
// answer, and held to what a line is, since the answer is shown to people and
// written into a record kept for years.

import {
    keepLinesProblem,
    type TenantCountProblem,
    type TenantKeepLine,
    type TenantKeepReportPort,
} from '@saasicat/core';

import { withTimeout } from '../../core/with-timeout.js';

/** The application answered something that is not a list of lines. */
export class KeepLinesRefused extends Error {
    constructor(readonly problem: TenantCountProblem | 'labels') {
        super(`The TenantKeepReportPort answered lines whose ${problem} is wrong.`);
    }
}

/**
 * What `report` answers `tenantId` keeps, checked. Rejects with a
 * `TimeoutError` once `timeoutMs` have passed without an answer, with a
 * `KeepLinesRefused` where the answer is not a list of lines, and with what
 * the report threw where it failed.
 */
export async function whatATenantKeeps(
    report: TenantKeepReportPort,
    tenantId: string,
    timeoutMs: number,
): Promise<readonly TenantKeepLine[]> {
    const keep = await withTimeout(() => report.keep(tenantId), timeoutMs);
    const problem = keepLinesProblem(keep);
    if (problem !== null) throw new KeepLinesRefused(problem);
    return keep;
}
