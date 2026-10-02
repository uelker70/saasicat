import { IsArray, IsString, IsUUID } from 'class-validator';

/**
 * Announcing a retirement: the version the subscriptions continue on, and the
 * subscriptions the operator was shown. The announcement goes out only if they
 * are still exactly the ones it reaches.
 */
export class AnnounceRetirementDto {
    @IsUUID()
    replacementPlanVersionId!: string;

    @IsArray()
    @IsString({ each: true })
    subscriptionIds!: string[];
}
