import {
    type CanActivate,
    Controller,
    type DynamicModule,
    type ForwardReference,
    Get,
    Inject,
    Module,
    Param,
    Query,
    StreamableFile,
    type Type,
} from '@nestjs/common';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

import { AllowDuringMaintenance } from '../../maintenance/allow-during-maintenance.js';
import { RLS_BYPASS_PORT_TOKEN } from '../../admin/admin.tokens.js';
import { UseRouteGuards } from '../../admin/use-route-guards.decorator.js';
import {
    CALENDAR_MONTH_PATTERN,
    type AdminInvoiceRegisterPage,
    type AdminInvoiceRegisterTotals,
    type AdminSubscriberContractDossier,
    type AdminSubscriberContracts,
    type InvoiceDocument,
    type InvoiceRegisterQuery,
    type RlsBypassPort,
} from '@saasicat/core';
import { ContractConfirmationService } from '../confirmations/contract-confirmation.service.js';
import { CatalogContractSourceLookup } from '../confirmations/contract-source-lookup.js';
import { InvoiceDocumentService } from './invoice-document.service.js';
import { InvoiceRegisterService } from './invoice-register.service.js';

/** Longer than any id a store hands out; an `after` beyond it names no invoice. */
const MAX_ID_LENGTH = 200;
const MONTH_MESSAGE = 'must be a month, YYYY-MM';

/** `GET admin/invoice-totals` — the months the register's totals are read for (`SC-ADM-042`). */
export class InvoiceRegisterTotalsQueryDto implements InvoiceRegisterQuery {
    @IsOptional()
    @IsString()
    @Matches(CALENDAR_MONTH_PATTERN, { message: `from ${MONTH_MESSAGE}` })
    from?: string;

    @IsOptional()
    @IsString()
    @Matches(CALENDAR_MONTH_PATTERN, { message: `until ${MONTH_MESSAGE}` })
    until?: string;
}

/** `GET admin/invoices` — the months, and the invoice the page goes on after. */
export class InvoiceRegisterQueryDto extends InvoiceRegisterTotalsQueryDto {
    @IsOptional()
    @IsString()
    @MaxLength(MAX_ID_LENGTH)
    after?: string;
}

export interface InvoiceDocumentModuleOptions {
    /** The same chain the tenant routes of the administration run behind. */
    guards: Array<Type<CanActivate>>;
    /**
     * Must bring `InvoiceDocumentService` into scope — the tenant billing
     * module that already provides it, passed as the very object the
     * application imports, so that no port is built a second time — and,
     * where `confirmations` is set, `ContractConfirmationService`.
     */
    imports: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
    /** Whether the contracts' confirmations are offered too. */
    confirmations: boolean;
}

/**
 * The file name a download offers, kept to characters that cannot end the
 * header it stands in: the name comes from the renderer, and a quote or a line
 * break in it would let it write a header of its own.
 */
function downloadNameOf(fileName: string, fallback: string): string {
    const kept = fileName.replace(/[^A-Za-z0-9._-]/g, '_');
    return kept === '' ? fallback : kept;
}

/** An archived file as the download hands it out, under the name it was archived with. */
function downloadOf(file: InvoiceDocument, fallback: string): StreamableFile {
    return new StreamableFile(file.content, {
        type: file.mediaType,
        length: file.content.byteLength,
        disposition: `attachment; filename="${downloadNameOf(file.fileName, fallback)}"`,
    });
}

function buildInvoiceDocumentController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin')
    @AllowDuringMaintenance()
    @UseRouteGuards(...guards)
    class GeneratedInvoiceDocumentController {
        constructor(
            @Inject(InvoiceDocumentService)
            private readonly documents: InvoiceDocumentService,
        ) {}

        /**
         * The invoice's archived document, the file it was issued as and
         * nothing rendered again (`SC-AUD-014`), checked against the checksum
         * recorded when it was rendered (`SC-AUD-019`).
         */
        @Get('invoices/:id/document')
        async documentOf(@Param('id') id: string): Promise<StreamableFile> {
            return downloadOf(await this.documents.documentOf(id), 'invoice');
        }
    }

    return GeneratedInvoiceDocumentController;
}

function buildInvoiceRegisterController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin')
    @AllowDuringMaintenance()
    @UseRouteGuards(...guards)
    class GeneratedInvoiceRegisterController {
        constructor(
            @Inject(InvoiceRegisterService)
            private readonly register: InvoiceRegisterService,
            // Required rather than optional: without it the invoices would be
            // read in the request's row-level scope, which an operator's
            // request has none of. Missing, the module does not start.
            @Inject(RLS_BYPASS_PORT_TOKEN)
            private readonly rlsBypass: RlsBypassPort,
        ) {}

        /**
         * One page of every invoice issued in the months asked for — the
         * current month where none is —, by issue date and then number
         * (`SC-ADM-042`).
         */
        @Get('invoices')
        page(@Query() query: InvoiceRegisterQueryDto): Promise<AdminInvoiceRegisterPage> {
            return this.rlsBypass.runWithBypass(() => this.register.page(query));
        }

        /**
         * What the invoices of those months add up to, per month, currency,
         * tax treatment and rate, and over all of them (`SC-ADM-042`). A route
         * of its own rather than part of each page, so paging on does not add
         * the months up again; and not under `invoices/`, where Express would
         * hand it to `invoices/:invoiceId` when that route is registered first.
         */
        @Get('invoice-totals')
        totals(@Query() query: InvoiceRegisterTotalsQueryDto): Promise<AdminInvoiceRegisterTotals> {
            return this.rlsBypass.runWithBypass(() => this.register.totals(query));
        }
    }

    return GeneratedInvoiceRegisterController;
}

function buildContractConfirmationController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin')
    @AllowDuringMaintenance()
    @UseRouteGuards(...guards)
    class GeneratedContractConfirmationController {
        constructor(
            @Inject(ContractConfirmationService)
            private readonly confirmations: ContractConfirmationService,
            // Required rather than optional: without it the contracts would be
            // read in the request's row-level scope, which an operator's
            // request has none of. Missing, the module does not start.
            @Inject(RLS_BYPASS_PORT_TOKEN)
            private readonly rlsBypass: RlsBypassPort,
            @Inject(CatalogContractSourceLookup)
            private readonly sources: CatalogContractSourceLookup,
        ) {}

        /**
         * The subscriber's contracts, the newest first, each with what it
         * changed against the one before it and where its confirmation stands
         * (`SC-AUD-016`, `SC-ADM-041`).
         */
        @Get('subscribers/:id/contracts')
        contractsOf(@Param('id') id: string): Promise<AdminSubscriberContracts> {
            return this.rlsBypass.runWithBypass(() => this.confirmations.contractsOf(id));
        }

        /**
         * One of the subscriber's contracts as it was frozen, with the invoices
         * issued under it and whether its archived confirmation is intact
         * (`SC-ADM-041`).
         */
        @Get('subscribers/:id/contracts/:contractId')
        dossierOf(
            @Param('id') id: string,
            @Param('contractId') contractId: string,
        ): Promise<AdminSubscriberContractDossier> {
            return this.rlsBypass.runWithBypass(() =>
                this.confirmations.dossierOf(id, contractId, this.sources),
            );
        }

        /**
         * The contract's archived confirmation, the file the subscriber was
         * sent (`SC-AUD-016`), checked against the checksum recorded when it
         * was rendered.
         */
        @Get('contracts/:id/confirmation')
        async confirmationOf(@Param('id') id: string): Promise<StreamableFile> {
            return downloadOf(await this.confirmations.confirmationOf(id), 'confirmation');
        }
    }

    return GeneratedContractConfirmationController;
}

/**
 * The operator's register of every invoice issued, the download of an
 * invoice's document, and of a contract's confirmation. Mounted where the
 * platform keeps both the administration's tenants and invoices.
 */
@Module({})
export class InvoiceDocumentModule {
    static forRoot(options: InvoiceDocumentModuleOptions): DynamicModule {
        return {
            module: InvoiceDocumentModule,
            imports: options.imports,
            controllers: [
                buildInvoiceDocumentController(options.guards),
                buildInvoiceRegisterController(options.guards),
                ...(options.confirmations
                    ? [buildContractConfirmationController(options.guards)]
                    : []),
            ],
            // Where a line came from is asked of the catalogue's own plan and
            // bundle repositories, which the platform exports with the
            // catalogue module. Registered again here, a factory would lose
            // the scope the application gave the catalogue — `catalog.imports`,
            // `catalog.extraProviders` — and the application would not start.
            providers: options.confirmations ? [CatalogContractSourceLookup] : [],
        };
    }
}
