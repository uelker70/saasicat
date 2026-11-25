import { BadRequestException, ConflictException } from '@nestjs/common';
import { BILLING_ERROR_CODES } from '@saasicat/core';

/** What a request to change what the tenant pays names: the plan, and the version its preview showed. */
export interface VersionNamed {
    readonly planKey: string;
    readonly planVersionId?: string | null;
}

/**
 * Refuses a request that does not name `quoted`, the version it would bind,
 * as the version its preview showed (`SC-CHG-023`): 400
 * `PLAN_CHANGE_VERSION_NOT_NAMED` where it names none, and 409
 * `PLAN_CHANGE_QUOTE_CHANGED` where it names another — a successor went on
 * sale while the page was open — carrying `previewAsItStands()`, read only
 * then, so the next confirmation is of what the request binds today. Nobody
 * is bound to a price they were not shown. A request that binds no version
 * (`quoted` null) names none.
 */
export async function assertNamesTheVersionShown(
    named: VersionNamed,
    quoted: string | null,
    previewAsItStands: () => Promise<unknown>,
): Promise<void> {
    if (quoted === null) return;
    if (!named.planVersionId) {
        throw new BadRequestException({
            code: BILLING_ERROR_CODES.PLAN_CHANGE_VERSION_NOT_NAMED,
            message: 'A plan change has to name the version its preview showed.',
            params: { planKey: named.planKey },
        });
    }
    if (named.planVersionId !== quoted) {
        throw new ConflictException({
            code: BILLING_ERROR_CODES.PLAN_CHANGE_QUOTE_CHANGED,
            message:
                'This plan changed since it was shown. Look at it again before changing to it.',
            params: { planVersionId: named.planVersionId },
            preview: await previewAsItStands(),
        });
    }
}
