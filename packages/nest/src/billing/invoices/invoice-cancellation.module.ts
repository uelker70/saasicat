import {
    Body,
    type CanActivate,
    Controller,
    type DynamicModule,
    type ForwardReference,
    Get,
    HttpCode,
    Inject,
    Module,
    Param,
    Post,
    Req,
    type Type,
} from '@nestjs/common';
import { Type as Nested, Transform } from 'class-transformer';
import {
    IsArray,
    IsInt,
    IsNumber,
    IsObject,
    IsOptional,
    IsString,
    Matches,
    MaxLength,
    ValidateIf,
    ValidateNested,
} from 'class-validator';
import {
    INVOICE_CANCELLATION_REASON_MAX_LENGTH,
    INVOICE_CORRECTION_MAX_LENGTH,
    type AdminInvoice,
    type InvoiceCancellationRequest,
    type InvoiceLineOwed,
    type RlsBypassPort,
} from '@saasicat/core';

import { RLS_BYPASS_PORT_TOKEN } from '../../admin/admin.tokens.js';
import { EnforceMfa } from '../../admin/enforce-mfa.decorator.js';
import { UseRouteGuards } from '../../admin/use-route-guards.decorator.js';
import { WebAuditLogger } from '../../core/web-audit.js';
import { AllowDuringMaintenance } from '../../maintenance/allow-during-maintenance.js';
import {
    type CancelledInvoice,
    InvoiceCancellationService,
    type InvoiceCancellationPlan,
    invoiceCancellationAudit,
} from './invoice-cancellation.service.js';

/** RFC 5321 caps an address at 254 characters. */
const MAX_ADDRESS_LENGTH = 254;
/** Something besides blanks. */
const NOT_BLANK = /\S/;
/** A preview's digest: SHA-256, in hex. */
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Text trimmed before its length is checked, as the service settles it: the
 * route accepts what the command line does, and nothing more.
 */
const Trimmed = () =>
    Transform(({ value }: { value: unknown }) =>
        typeof value === 'string' ? value.trim() : value,
    );

/**
 * The details of the subscriber the cancelled invoice named wrongly, as the
 * replacement is to name them. A detail left out stays as it was; `null`
 * clears one, except the legal name, which a party always has.
 */
export class InvoiceSubscriberCorrectionsDto {
    @Trimmed()
    @IsOptional()
    @IsString()
    @MaxLength(INVOICE_CORRECTION_MAX_LENGTH)
    legalName?: string;

    @Trimmed()
    @IsOptional()
    @ValidateIf((_, value: unknown) => value !== null)
    @IsString()
    @MaxLength(INVOICE_CORRECTION_MAX_LENGTH)
    vatId?: string | null;

    @Trimmed()
    @IsOptional()
    @ValidateIf((_, value: unknown) => value !== null)
    @IsString()
    @MaxLength(INVOICE_CORRECTION_MAX_LENGTH)
    taxNumber?: string | null;

    @Trimmed()
    @IsOptional()
    @ValidateIf((_, value: unknown) => value !== null)
    @IsString()
    @MaxLength(INVOICE_CORRECTION_MAX_LENGTH)
    addressLine1?: string | null;

    @Trimmed()
    @IsOptional()
    @ValidateIf((_, value: unknown) => value !== null)
    @IsString()
    @MaxLength(INVOICE_CORRECTION_MAX_LENGTH)
    addressLine2?: string | null;

    @Trimmed()
    @IsOptional()
    @ValidateIf((_, value: unknown) => value !== null)
    @IsString()
    @MaxLength(INVOICE_CORRECTION_MAX_LENGTH)
    postalCode?: string | null;

    @Trimmed()
    @IsOptional()
    @ValidateIf((_, value: unknown) => value !== null)
    @IsString()
    @MaxLength(INVOICE_CORRECTION_MAX_LENGTH)
    city?: string | null;

    @Trimmed()
    @IsOptional()
    @ValidateIf((_, value: unknown) => value !== null)
    @IsString()
    @MaxLength(INVOICE_CORRECTION_MAX_LENGTH)
    country?: string | null;
}

/**
 * A line of the cancelled invoice that is not owed, or not in full: its
 * position and what is still owed of it, net. Held to numbers here; whether
 * the line may be corrected, and to what, the cancellation settles against
 * what the line stands at, and refuses naming both.
 */
export class InvoiceLineOwedDto implements InvoiceLineOwed {
    @IsInt()
    position!: number;

    @IsNumber({ allowNaN: false, allowInfinity: false })
    owed!: number;
}

/**
 * `POST admin/tenants/:slug/invoices/:invoiceId/cancellation` and its
 * `…/preview` — what the operator gives a cancellation (`SC-ADM-020`).
 */
export class CancelInvoiceDto implements InvoiceCancellationRequest {
    @Trimmed()
    @IsString()
    @Matches(NOT_BLANK, { message: 'reason must say why the invoice is cancelled' })
    @MaxLength(INVOICE_CANCELLATION_REASON_MAX_LENGTH)
    reason!: string;

    @IsOptional()
    @IsObject()
    @ValidateNested()
    @Nested(() => InvoiceSubscriberCorrectionsDto)
    corrections?: InvoiceSubscriberCorrectionsDto;

    @Trimmed()
    @IsOptional()
    @ValidateIf((_, value: unknown) => value !== null)
    @IsString()
    @MaxLength(MAX_ADDRESS_LENGTH)
    deliverTo?: string | null;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Nested(() => InvoiceLineOwedDto)
    lines?: InvoiceLineOwedDto[];

    @IsOptional()
    @IsString()
    @Matches(DIGEST_PATTERN, { message: 'previewDigest must be the digest a preview answered' })
    previewDigest?: string;
}

export interface InvoiceCancellationModuleOptions {
    /** The same chain the tenant routes of the administration run behind. */
    guards: Array<Type<CanActivate>>;
    /**
     * Must bring `InvoiceCancellationService` into scope — the module that
     * already provides it, passed as the very object the application imports.
     * The `RlsBypassPort` and the second factor have to be visible too;
     * `SaaSiCatModule` provides them globally.
     */
    imports: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
}

function buildInvoiceCancellationController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin')
    @AllowDuringMaintenance()
    @UseRouteGuards(...guards)
    class GeneratedInvoiceCancellationController {
        constructor(
            @Inject(InvoiceCancellationService)
            private readonly cancellations: InvoiceCancellationService,
            @Inject(WebAuditLogger)
            private readonly audit: WebAuditLogger,
            // Required: without it the reads would run in the request's
            // row-level scope, and an invoice a policy hides would read as none.
            @Inject(RLS_BYPASS_PORT_TOKEN)
            private readonly rlsBypass: RlsBypassPort,
        ) {}

        /**
         * The invoice with its lines, each with what its charge stands at and
         * whether the cancellation may correct it, so the cancel dialog offers
         * what the cancellation accepts (`SC-ADM-035`). Keyed by the invoice
         * alone, so an invoice of a tenant deleted since is reached as well.
         */
        @Get('invoices/:invoiceId')
        invoice(@Param('invoiceId') invoiceId: string): Promise<AdminInvoice> {
            return this.rlsBypass.runWithBypass(() => this.cancellations.invoiceOf(invoiceId));
        }

        /**
         * What cancelling the invoice would write — the cancellation invoice,
         * the replacement and what moves onto it —, computed as the
         * cancellation computes it and refused as it is; nothing is written,
         * so the confirmation shows what the cancellation will do
         * (`SC-UI-017`).
         */
        @Post('invoices/:invoiceId/cancellation/preview')
        @HttpCode(200)
        preview(
            @Param('invoiceId') invoiceId: string,
            @Body() body: CancelInvoiceDto,
        ): Promise<InvoiceCancellationPlan> {
            return this.rlsBypass.runWithBypass(() => this.cancellations.preview(invoiceId, body));
        }

        /**
         * Cancels the invoice by a cancellation invoice and its replacement,
         * with the second factor (`SC-ADM-019`), and records it in the audit
         * log under the operator (`SC-ADM-020`).
         */
        @Post('invoices/:invoiceId/cancellation')
        @HttpCode(200)
        @EnforceMfa()
        cancel(
            @Param('invoiceId') invoiceId: string,
            @Body() body: CancelInvoiceDto,
            @Req() request: unknown,
        ): Promise<CancelledInvoice> {
            return this.rlsBypass.runWithBypass(async () => {
                const cancelled = await this.cancellations.cancel(
                    invoiceId,
                    body,
                    this.audit.actorTagFromRequest(request),
                );
                const { entity, entityId, action, changes } = invoiceCancellationAudit(cancelled);
                await this.audit.logFromRequest(request, entity, entityId, action, changes);
                return cancelled;
            });
        }
    }

    return GeneratedInvoiceCancellationController;
}

/**
 * The operator's cancellation of an issued invoice, with its preview and the
 * read of the invoice's lines it starts from, each reached by the invoice's
 * own id. Mounted where the platform shows tenants and serves the invoices'
 * documents: an invoice is cancelled only once its document is archived.
 */
@Module({})
export class InvoiceCancellationModule {
    static forRoot(options: InvoiceCancellationModuleOptions): DynamicModule {
        return {
            module: InvoiceCancellationModule,
            imports: options.imports,
            providers: [WebAuditLogger],
            controllers: [buildInvoiceCancellationController(options.guards)],
        };
    }
}
