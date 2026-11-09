// Tells the tenant's access check whether an invoice is open, so a read-only
// tenant can replace its payment method while it owes something
// (`SC-ADM-024`).
//
// The check is global and composed before tenant billing, so it cannot inject
// the invoices; they answer it from here, at the start, as the invoice
// payments answer the gateway's callbacks.

import { Inject, Injectable, type OnModuleInit, Optional } from '@nestjs/common';

import { TenantAccessService } from '../../tenant-access/tenant-access.service.js';
import { TenantInvoiceService } from './tenant-invoice.service.js';

@Injectable()
export class OpenInvoicesForTenantAccess implements OnModuleInit {
    constructor(
        @Inject(TenantInvoiceService) private readonly invoices: TenantInvoiceService,
        // Absent only where tenant billing is wired by hand without
        // `SaaSiCatModule`: nothing records a reason then, so no tenant is
        // read-only and nothing has to be let through.
        @Optional()
        @Inject(TenantAccessService)
        private readonly access: TenantAccessService | null = null,
    ) {}

    onModuleInit(): void {
        this.access?.answerOpenInvoicesFrom(this.invoices);
    }
}
