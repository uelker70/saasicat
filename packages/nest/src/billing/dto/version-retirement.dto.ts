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

/**
 * Announcing an add-on retirement: the version of the same add-on the bookings
 * continue on, and the bookings the operator was shown. The announcement goes
 * out only if they are still exactly the ones it reaches.
 */
export class AnnounceBundleRetirementDto {
    @IsUUID()
    replacementBundleVersionId!: string;

    @IsArray()
    @IsString({ each: true })
    subscriptionBundleIds!: string[];
}
