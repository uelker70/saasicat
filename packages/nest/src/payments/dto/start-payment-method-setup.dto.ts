import { IsUrl, MaxLength } from 'class-validator';

/** Where the gateway's form sends the person — `POST /billing/payment-method/setup`. */
export class StartPaymentMethodSetupDto {
    @IsUrl({ require_tld: false, require_protocol: true, protocols: ['https', 'http'] })
    @MaxLength(500)
    successUrl!: string;

    @IsUrl({ require_tld: false, require_protocol: true, protocols: ['https', 'http'] })
    @MaxLength(500)
    cancelUrl!: string;
}
