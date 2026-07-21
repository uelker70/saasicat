import { Injectable } from '@nestjs/common';
import { DefinesQuota } from '@saasicat/nest/discovery';
import type { QuotaProvider } from '@saasicat/types';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Declares WHAT is countable and HOW to count it. The decorator is the
 * single source of truth for the quota (discovery picks it up at boot);
 * `count()` feeds the `EnforceQuotaInterceptor` at request time.
 */
@Injectable()
@DefinesQuota({
    key: 'notesMax',
    label: 'Notes count',
    unit: 'count',
    policy: 'hardCap', // continuous | monthlyReset | hardCap — hardCap blocks at the limit
    feature: 'NOTES',
})
export class NotesQuotaProvider implements QuotaProvider {
    readonly key = 'notesMax';

    constructor(private readonly prisma: PrismaService) {}

    async count(tenantId: string): Promise<number> {
        return this.prisma.note.count({ where: { tenantId } });
    }
}
