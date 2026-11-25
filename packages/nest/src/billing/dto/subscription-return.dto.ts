import { IsISO8601, IsOptional, IsString, Matches } from 'class-validator';
import { CALENDAR_DAY_PATTERN, type CalendarDay } from '@saasicat/core';

import { ChangePlanDto } from './tenant-billing.dto.js';

/**
 * Coming back names the plan, the rhythm and the version its preview showed
 * (`planVersionId`, the preview's own), as a plan change does, and never the
 * tenant: that is the session's. The server binds that version only while it
 * is still the one on sale, and has to be told it wherever the return binds
 * one.
 */
export class SubscriptionReturnDto extends ChangePlanDto {
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
