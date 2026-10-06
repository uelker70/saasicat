import { Type } from 'class-transformer';
import {
    IsArray,
    IsIn,
    IsISO8601,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsPositive,
    IsString,
    MaxLength,
    ValidateNested,
} from 'class-validator';
import { FEATURE_WITHDRAWAL_REASON_MAX_LENGTH } from '@saasicat/core';

/** The longest feature, plan or add-on key the routes accept. */
const KEY_MAX_LENGTH = 100;

/** A reduction for one plan or add-on in one rhythm, net, per whole period of that rhythm. */
export class FeatureWithdrawalReductionDto {
    @IsIn(['plan', 'bundle'])
    kind!: 'plan' | 'bundle';

    @IsString()
    @IsNotEmpty()
    @MaxLength(KEY_MAX_LENGTH)
    key!: string;

    @IsIn(['MONTHLY', 'YEARLY'])
    billingCycle!: 'MONTHLY' | 'YEARLY';

    // To the cent: a reduction is written to the journal as it is named.
    @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
    @IsPositive()
    amountNet!: number;
}

/**
 * Withdrawing a feature: why, from when — at once where left out — the
 * reductions, and the subscriptions the operator was shown. The withdrawal is
 * announced only if they are still exactly the ones it reaches.
 */
export class AnnounceFeatureWithdrawalDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(KEY_MAX_LENGTH)
    featureKey!: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(FEATURE_WITHDRAWAL_REASON_MAX_LENGTH)
    reason!: string;

    @IsOptional()
    @IsISO8601({ strict: true })
    effectiveFrom?: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => FeatureWithdrawalReductionDto)
    reductions!: FeatureWithdrawalReductionDto[];

    @IsArray()
    @IsString({ each: true })
    subscriptionIds!: string[];
}

/** What withdrawing a feature from a date would do: the feature, and the date — now where left out. */
export class FeatureWithdrawalPreviewQueryDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(KEY_MAX_LENGTH)
    featureKey!: string;

    @IsOptional()
    @IsISO8601({ strict: true })
    effectiveFrom?: string;
}

/** Lifting a withdrawal: from when — at once where left out. */
export class LiftFeatureWithdrawalDto {
    @IsOptional()
    @IsISO8601({ strict: true })
    liftedFrom?: string;
}
