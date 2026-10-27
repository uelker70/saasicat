// The invoice register's export for a tax advisor (`SC-ADM-043`): the invoices
// of the months asked for as of a stated moment, their lines and the
// settlements against them, written as `@saasicat/core` writes them, in one ZIP
// with a manifest naming every file's SHA-256. The same months as of the same
// moment in the same language give the same archive, byte for byte, so two
// hand-overs compare by the archive's SHA-256 — which the audit log records,
// with who took the export and when. The read is platform-wide, so inside
// `RlsBypassPort`.

import { createHash } from 'node:crypto';

import { Inject, Injectable, Optional, UnprocessableEntityException } from '@nestjs/common';
import {
    invoiceExportAsOfOf,
    invoiceExportFileNameOf,
    invoiceExportFilesOf,
    invoiceExportManifestOf,
    invoiceExportOf,
    type InvoiceExport,
    type InvoiceExportLocale,
    type InvoiceExportManifest,
    type InvoiceExportSource,
    type InvoiceRegisterQuery,
    type InvoiceRegisterSpan,
    type LocalMoment,
    type PlanCatalogSettings,
    type RlsBypassPort,
    type SubscriberPaymentRepository,
    type SubscriptionInvoiceRepository,
} from '@saasicat/core';

import { RLS_BYPASS_PORT_TOKEN } from '../../admin/admin.tokens.js';
import { readAcrossTenants } from '../../admin/read-across-tenants.js';
import { codedError } from '../../errors/coded-error.js';
import { PLAN_CATALOG_SETTINGS_TOKEN } from '../plan-catalog.module.js';
import { SUBSCRIBER_PAYMENT_REPOSITORY_TOKEN } from './invoice-collection.tokens.js';
import { invoiceRegisterSpanAt } from './invoice-register.service.js';
import { storedZipOf, type StoredZipTime } from './stored-zip.js';
import { SUBSCRIPTION_INVOICE_REPOSITORY_TOKEN } from './subscription-invoice.tokens.js';

/**
 * How many invoices one read brings. The reads after it name each invoice by
 * its id, so a page is also how long their lists of ids grow.
 */
const EXPORT_PAGE_SIZE = 500;
/** The file the archive ends with; it names every file before it. */
const MANIFEST_NAME = 'manifest.json';
/** The CLI's other output is English, and so is an export nobody asked a language for. */
const DEFAULT_LOCALE: InvoiceExportLocale = 'en';

export const INVOICES_EXPORTED_AUDIT_ACTION = 'SUBSCRIPTION_INVOICES_EXPORTED';

/** What an export is asked for with: the months, the moment and the language. */
export interface InvoiceExportRequest extends InvoiceRegisterQuery {
    /** A day and time on a clock of the installation's zone; the latest one an export may be as of where none. */
    asOf?: LocalMoment;
    /** The language the CSV is written in; English where none. */
    locale?: InvoiceExportLocale;
}

/** The archive an export is handed over as. */
export interface InvoiceExportArchive {
    /** The period and the moment it is as of, as a file name. */
    fileName: string;
    content: Buffer;
    /** Of `content`: what two hand-overs are compared by. */
    sha256: string;
    /** What the archive's `manifest.json` holds. */
    manifest: InvoiceExportManifest;
}

const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** A local moment, `YYYY-MM-DDTHH:MM:SS`, as the time a ZIP entry carries. */
function zipTimeOf(local: LocalMoment): StoredZipTime {
    return {
        year: Number(local.slice(0, 4)),
        month: Number(local.slice(5, 7)),
        day: Number(local.slice(8, 10)),
        hour: Number(local.slice(11, 13)),
        minute: Number(local.slice(14, 16)),
        second: Number(local.slice(17, 19)),
    };
}

/**
 * The archive of `exported` written in `locale`: the CSV tables and
 * `export.json` in the order `@saasicat/core` gives them, the manifest last,
 * every entry dated the moment the export is as of.
 */
function archiveOf(exported: InvoiceExport, locale: InvoiceExportLocale): InvoiceExportArchive {
    const files = invoiceExportFilesOf(exported, locale).map(({ name, content }) => ({
        name,
        content: Buffer.from(content, 'utf8'),
    }));
    const manifest = invoiceExportManifestOf(
        exported,
        locale,
        files.map(({ name, content }) => ({
            name,
            bytes: content.byteLength,
            sha256: sha256Of(content),
        })),
    );
    const content = storedZipOf(
        [
            ...files,
            {
                name: MANIFEST_NAME,
                content: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
            },
        ],
        zipTimeOf(exported.asOfLocal),
    );
    return {
        fileName: invoiceExportFileNameOf(exported),
        content,
        sha256: sha256Of(content),
        manifest,
    };
}

/**
 * What the audit log records of an export: the months, the moment it is as
 * of, the language, what it holds and the archive's SHA-256, by which it is
 * found again. Who took it and when are the log's own.
 */
export function invoiceExportAudit(archive: InvoiceExportArchive): {
    entity: 'SubscriptionInvoiceExport';
    entityId: string;
    action: typeof INVOICES_EXPORTED_AUDIT_ACTION;
    changes: {
        from: string;
        until: string;
        asOf: string;
        asOfLocal: LocalMoment;
        timeZone: string;
        locale: InvoiceExportLocale;
        fileName: string;
        bytes: number;
        sha256: string;
        invoices: number;
        lines: number;
        settlements: number;
    };
} {
    const { manifest } = archive;
    return {
        entity: 'SubscriptionInvoiceExport',
        entityId: archive.sha256,
        action: INVOICES_EXPORTED_AUDIT_ACTION,
        changes: {
            from: manifest.period.from,
            until: manifest.period.until,
            asOf: manifest.asOf,
            asOfLocal: manifest.asOfLocal,
            timeZone: manifest.timeZone,
            locale: manifest.locale,
            fileName: archive.fileName,
            bytes: archive.content.byteLength,
            sha256: archive.sha256,
            ...manifest.counts,
        },
    };
}

@Injectable()
export class InvoiceExportService {
    constructor(
        @Inject(SUBSCRIPTION_INVOICE_REPOSITORY_TOKEN)
        private readonly invoices: SubscriptionInvoiceRepository,
        @Inject(PLAN_CATALOG_SETTINGS_TOKEN)
        private readonly settings: PlanCatalogSettings,
        // Optional for the injector alone: an installation that issues invoices
        // starts only with it, and one wired without it is refused by the start
        // check's sentence rather than by Nest's.
        @Optional()
        @Inject(SUBSCRIBER_PAYMENT_REPOSITORY_TOKEN)
        private readonly payments: SubscriberPaymentRepository | null = null,
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
    ) {}

    /**
     * The export of the months `request` names as of the moment it names, in
     * its language, as the archive it is handed over as. Rejected with `422`
     * for months the register does not span, and for a moment later than
     * `INVOICE_EXPORT_SETTLE_MS` before `now`.
     */
    async export(
        request: InvoiceExportRequest,
        now: Date = new Date(),
    ): Promise<InvoiceExportArchive> {
        // Required with a tax adapter, which invoicing requires.
        const timeZone = this.settings.timeZone!;
        const span = invoiceRegisterSpanAt(request, now, timeZone);
        const { asOf, refusal } = invoiceExportAsOfOf(request.asOf, now, timeZone);
        if (refusal) {
            throw new UnprocessableEntityException(codedError(refusal.code, refusal.params));
        }
        const source = await readAcrossTenants(this.rlsBypass, () => this.sourceOf(span));
        return archiveOf(
            invoiceExportOf({ span, asOf, timeZone, source }),
            request.locale ?? DEFAULT_LOCALE,
        );
    }

    /** Everything recorded of the invoices issued on the days of `span`, whenever. */
    private async sourceOf(span: InvoiceRegisterSpan): Promise<InvoiceExportSource> {
        const source: InvoiceExportSource = {
            invoices: [],
            cancellations: [],
            settlements: [],
            documents: [],
        };
        let after: string | undefined;
        do {
            const page = await this.invoices.listIssued(
                span.days,
                after === undefined
                    ? { limit: EXPORT_PAGE_SIZE }
                    : { limit: EXPORT_PAGE_SIZE, after },
            );
            const ids = page.invoices.map(({ invoice }) => invoice.id);
            source.invoices.push(...page.invoices);
            source.cancellations.push(...(await this.invoices.listCancellations(ids)));
            source.documents.push(...(await this.invoices.findDocuments(ids)));
            source.settlements.push(...(await this.payments!.listSettlements(ids)));
            after = page.hasMore ? page.invoices.at(-1)?.invoice.id : undefined;
        } while (after !== undefined);
        return source;
    }
}
