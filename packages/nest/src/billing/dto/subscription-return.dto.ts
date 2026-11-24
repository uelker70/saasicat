import { IsISO8601, IsOptional, IsString, Matches } from 'class-validator';
import { CALENDAR_DAY_PATTERN, type CalendarDay } from '@saasicat/core';

import { PreviewPlanChangeDto } from './tenant-billing.dto.js';

/**
 * Coming back names the plan and the rhythm, as a plan change does, and never
 * the tenant: that is the session's. The version is the one on sale, which the
 * server reads itself.
 */
export class SubscriptionReturnDto extends PreviewPlanChangeDto {
    /**
     * The deletion day the page showed, `YYYY-MM-DD`: where the tenant's end
     * names another, the return is refused with the day that applies, and
     * nothing is written.
     */
    @IsOptional()
    @IsString()
    @Matches(CALENDAR_DAY_PATTERN, { message: 'expectedDeletesOn must be a day, YYYY-MM-DD' })
    @IsISO8601({ strict: true })
    expectedDeletesOn?: CalendarDay;
}
