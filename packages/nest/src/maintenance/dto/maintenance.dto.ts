// Request bodies of the operator's maintenance routes.
//
// The times arrive as text and are read by `parseZonedInstant`, which refuses a
// time without its zone with a code the administration can translate; the
// message's length is the service's to check, after it is trimmed, for the same
// reason.

import { IsOptional, IsString } from 'class-validator';

export class AnnounceMaintenanceDto {
    @IsString()
    startsAt!: string;

    @IsString()
    endsAt!: string;

    @IsOptional()
    @IsString()
    message?: string | null;
}

export class RescheduleMaintenanceDto {
    @IsOptional()
    @IsString()
    startsAt?: string;

    @IsOptional()
    @IsString()
    endsAt?: string;

    /** `null` takes the message away; left out, it stays. */
    @IsOptional()
    @IsString()
    message?: string | null;
}

export class LockMaintenanceDto {
    /** The window the operator is looking at; left out, the open one or a new one. */
    @IsOptional()
    @IsString()
    windowId?: string;

    @IsOptional()
    @IsString()
    endsAt?: string;

    @IsOptional()
    @IsString()
    message?: string | null;
}

export class UnlockMaintenanceDto {
    @IsOptional()
    @IsString()
    windowId?: string;
}
