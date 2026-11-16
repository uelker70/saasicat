import { Injectable } from '@nestjs/common';
import type { TenantKeepLine, TenantKeepReportPort } from '@saasicat/core';

/**
 * What a tenant of the notes app has to keep for obligations of its own before
 * its data is deleted: nothing. Notes are not records anybody must retain, and
 * the export already hands them over whole.
 *
 * An app whose tenants keep receipts, contracts or ledgers under a retention
 * period counts them here, one line per category — `{ category: 'receipts',
 * count: 42, labels: { en: 'Receipts', de: 'Belege' } }` — and the platform
 * shows them in the banner of the read-only period, hands them to every
 * reminder and keeps them in the deletion record.
 */
@Injectable()
export class NotesKeepReport implements TenantKeepReportPort {
    async keep(): Promise<readonly TenantKeepLine[]> {
        return [];
    }
}
