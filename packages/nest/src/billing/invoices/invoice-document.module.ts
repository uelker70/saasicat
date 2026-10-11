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
import { UseRouteGuards } from '../../admin/use-route-guards.decorator.js';
import { InvoiceDocumentService } from './invoice-document.service.js';

export interface InvoiceDocumentModuleOptions {
    /** The same chain the tenant routes of the administration run behind. */
    guards: Array<Type<CanActivate>>;
    /**
     * Must bring `InvoiceDocumentService` into scope — the tenant billing
     * module that already provides it, passed as the very object the
     * application imports, so that no port is built a second time.
     */
    imports: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
}

/**
 * The file name a download offers, kept to characters that cannot end the
 * header it stands in: the name comes from the renderer, and a quote or a line
 * break in it would let it write a header of its own.
 */
function downloadNameOf(fileName: string): string {
    const kept = fileName.replace(/[^A-Za-z0-9._-]/g, '_');
    return kept === '' ? 'invoice' : kept;
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
            const document = await this.documents.documentOf(id);
            return new StreamableFile(document.content, {
                type: document.mediaType,
                length: document.content.byteLength,
                disposition: `attachment; filename="${downloadNameOf(document.fileName)}"`,
            });
        }
    }

    return GeneratedInvoiceDocumentController;
}

/**
 * The operator's download of an invoice's document. Mounted where the
 * platform keeps both the administration's tenants and invoices.
 */
@Module({})
export class InvoiceDocumentModule {
    static forRoot(options: InvoiceDocumentModuleOptions): DynamicModule {
        return {
            module: InvoiceDocumentModule,
            imports: options.imports,
            controllers: [buildInvoiceDocumentController(options.guards)],
        };
    }
}
