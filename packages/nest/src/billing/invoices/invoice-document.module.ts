import {
    type CanActivate,
    Controller,
    type DynamicModule,
    type ForwardReference,
    Get,
    Inject,
    Module,
    Param,
    StreamableFile,
    type Type,
} from '@nestjs/common';

import { AllowDuringMaintenance } from '../../maintenance/allow-during-maintenance.js';
import { AdminResourcesService } from '../../admin/admin-resources.module.js';
import { RLS_BYPASS_PORT_TOKEN } from '../../admin/admin.tokens.js';
import { UseRouteGuards } from '../../admin/use-route-guards.decorator.js';
import type { AdminTenantContracts, InvoiceDocument, RlsBypassPort } from '@saasicat/core';
import { ContractConfirmationService } from '../confirmations/contract-confirmation.service.js';
import { InvoiceDocumentService } from './invoice-document.service.js';

export interface InvoiceDocumentModuleOptions {
    /** The same chain the tenant routes of the administration run behind. */
    guards: Array<Type<CanActivate>>;
    /**
     * Must bring `InvoiceDocumentService` into scope — the tenant billing
     * module that already provides it, passed as the very object the
     * application imports, so that no port is built a second time — and,
     * where `confirmations` is set, `ContractConfirmationService` and the
     * administration's `AdminResourcesService`.
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

function buildContractConfirmationController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin')
    @AllowDuringMaintenance()
    @UseRouteGuards(...guards)
    class GeneratedContractConfirmationController {
        constructor(
            @Inject(ContractConfirmationService)
            private readonly confirmations: ContractConfirmationService,
            @Inject(AdminResourcesService)
            private readonly tenants: AdminResourcesService,
            // Required rather than optional: without it the tenant would be
            // looked up in the request's row-level scope, which an operator's
            // request has none of. Missing, the module does not start.
            @Inject(RLS_BYPASS_PORT_TOKEN)
            private readonly rlsBypass: RlsBypassPort,
        ) {}

        /**
         * The tenant's contracts, the newest first, each with where its
         * confirmation stands (`SC-AUD-016`).
         */
        @Get('tenants/:slug/contracts')
        contractsOf(@Param('slug') slug: string): Promise<AdminTenantContracts> {
            return this.rlsBypass.runWithBypass(async () => {
                const tenant = await this.tenants.getTenantDetail(slug);
                return this.confirmations.contractsOf(tenant.id);
            });
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
 * The operator's download of an invoice's document, and of a contract's
 * confirmation. Mounted where the platform keeps both the administration's
 * tenants and invoices.
 */
@Module({})
export class InvoiceDocumentModule {
    static forRoot(options: InvoiceDocumentModuleOptions): DynamicModule {
        return {
            module: InvoiceDocumentModule,
            imports: options.imports,
            controllers: [
                buildInvoiceDocumentController(options.guards),
                ...(options.confirmations
                    ? [buildContractConfirmationController(options.guards)]
                    : []),
            ],
        };
    }
}
