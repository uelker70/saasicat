// InvoiceExportCliFlow — `<app> invoices export`.
//
// Writes the invoices of a span of months as of a moment to the ZIP the
// administration downloads, for a tax advisor (`SC-ADM-043`):
//
//     <app> invoices export --from 2026-01 --until 2026-12          # as of five minutes ago
//     <app> invoices export --from 2026-01 --until 2026-12 \
//         --as-of 2027-01-15T10:00 --locale de --out ./handover      # as of a stated moment
//
// The moment is a day and a time on a clock of the installation's zone, as
// `config/saas.yaml` names it; the CSV is English unless `--locale de` asks for
// German separators and decimal commas. A read, so the command asks for the
// operator's identity and neither the second factor nor a confirmation; the
// audit log records the operator, the months, the moment and the archive's
// SHA-256, as the route does, and where it cannot, the file is taken back and
// the command fails. The archive is written under the name the route
// offers, into `--out` or the current directory, and never over a file that is
// there already: the same name is the same months as of the same moment in the
// same language, and a file under it that differs is one to look at, not to
// replace.

import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Inject, Injectable } from '@nestjs/common';
import {
    CALENDAR_MONTH_PATTERN,
    INVOICE_EXPORT_LOCALES,
    isLocalMoment,
    type InvoiceExportLocale,
} from '@saasicat/core';
import {
    InvoiceExportService,
    invoiceExportAudit,
    type InvoiceExportArchive,
    type InvoiceExportRequest,
} from '@saasicat/nest';

import { CliContextService, CliError } from './cli-context.service.js';
import { refusalsAsCliErrors } from './cli-refusals.js';

/** Exit codes per `cli-conventions.md` §6. */
const EXIT_USER_ERROR = 1;
const EXIT_CONFLICT = 6;

export interface InvoiceExportOptions {
    as?: string;
    /** The first month, `YYYY-MM`; the current one where neither is given. */
    from?: string;
    /** The last month, `YYYY-MM`; `from` alone where none is given. */
    until?: string;
    /** A day and a time in the installation's zone, `YYYY-MM-DDTHH:MM[:SS]`. */
    asOf?: string;
    /** `de` or `en`, the language of the CSV; English where none is given. */
    locale?: string;
    /** The directory the archive is written into; the current one where none is given. */
    out?: string;
}

/** What the command wrote, and what it handed over. */
export interface ExportedInvoices {
    path: string;
    sha256: string;
    bytes: number;
    manifest: InvoiceExportArchive['manifest'];
}

@Injectable()
export class InvoiceExportCliFlow {
    constructor(
        @Inject(CliContextService) private readonly ctx: CliContextService,
        @Inject(InvoiceExportService) private readonly exports: InvoiceExportService,
    ) {}

    /**
     * Writes the export, then records it in the audit log under the operator;
     * where the log cannot record it, removes the file and throws. Refused as
     * the route refuses, with exit code 1; with 6 where a file of the
     * archive's name is there already.
     */
    async export(options: InvoiceExportOptions): Promise<ExportedInvoices> {
        const request = requestOf(options);
        const identity = this.ctx.resolveIdentity(options.as);
        const user = await this.ctx.ensureSuperAdmin(identity);
        const archive = await refusalsAsCliErrors('INVOICE_EXPORT_REFUSED', () =>
            this.exports.export(request),
        );
        const path = join(options.out ?? '.', archive.fileName);
        try {
            await writeFile(path, archive.content, { flag: 'wx' });
        } catch (error) {
            if (codeOf(error) !== 'EEXIST') throw error;
            throw new CliError(
                'INVOICE_EXPORT_FILE_EXISTS',
                `${path} is there already, and the export is not written over it.`,
                EXIT_CONFLICT,
            );
        }
        try {
            await this.ctx.log({ identity, userId: user.id, ...invoiceExportAudit(archive) });
        } catch (error) {
            // A hand-over the audit log cannot record is not made: the file this
            // command just wrote is taken back.
            await unlink(path);
            throw error;
        }
        return {
            path,
            sha256: archive.sha256,
            bytes: archive.content.byteLength,
            manifest: archive.manifest,
        };
    }

    /** What the command wrote, for the terminal. */
    formatExported(exported: ExportedInvoices): string {
        const { manifest } = exported;
        return [
            `Wrote ${exported.path}: the invoices of ${manifest.period.from} to ` +
                `${manifest.period.until} as of ${manifest.asOfLocal} (${manifest.timeZone}).`,
            `Invoices ${manifest.counts.invoices}, lines ${manifest.counts.lines}, ` +
                `settlements ${manifest.counts.settlements}; ${exported.bytes} bytes.`,
            `SHA-256 ${exported.sha256}`,
        ].join('\n');
    }
}

/** The request the options name, each checked as the route's DTO checks it. */
function requestOf(options: InvoiceExportOptions): InvoiceExportRequest {
    for (const [flag, month] of [
        ['--from', options.from],
        ['--until', options.until],
    ] as const) {
        if (month !== undefined && !CALENDAR_MONTH_PATTERN.test(month)) {
            throw new CliError(
                'INVOICE_EXPORT_MONTH_INVALID',
                `${flag} takes a month, YYYY-MM — got '${month}'.`,
                EXIT_USER_ERROR,
            );
        }
    }
    if (options.asOf !== undefined && !isLocalMoment(options.asOf)) {
        throw new CliError(
            'INVOICE_EXPORT_AS_OF_INVALID',
            `--as-of takes a day and a time, YYYY-MM-DDTHH:MM[:SS] — got '${options.asOf}'.`,
            EXIT_USER_ERROR,
        );
    }
    return {
        from: options.from,
        until: options.until,
        asOf: options.asOf,
        locale: localeOf(options.locale),
    };
}

function localeOf(given: string | undefined): InvoiceExportLocale | undefined {
    if (given === undefined) return undefined;
    const locale = INVOICE_EXPORT_LOCALES.find((each) => each === given);
    if (!locale) {
        throw new CliError(
            'INVOICE_EXPORT_LOCALE_INVALID',
            `--locale takes ${INVOICE_EXPORT_LOCALES.join(' or ')} — got '${given}'.`,
            EXIT_USER_ERROR,
        );
    }
    return locale;
}

/** The `code` a Node file-system error carries, read rather than assumed. */
function codeOf(error: unknown): unknown {
    return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
}
