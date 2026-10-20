import { Inject, Injectable } from '@nestjs/common';
import { Command, CommandRunner, Option, SubCommand } from 'nest-commander';

import { InvoiceCancelCliFlow, type InvoiceCancelOptions } from './invoice-cancel-cli-flow.js';
import { OperatorCommand } from './operator-command.js';

// Shared `<app> invoices …` commands. Binds `InvoiceCancelCliFlow` to the
// nest-commander CLI; register these classes in the providers of the CLI
// module of an application that issues invoices
// (`tenantBilling.chargeJournal.invoices`) and shows tenants
// (`adminResources`), beside `InvoiceCancelCliFlow`.

interface CancelFlags extends InvoiceCancelOptions {
    output?: string;
}

@Injectable()
@SubCommand({
    name: 'cancel',
    description:
        'Cancel an issued invoice by a cancellation invoice and its replacement; shows first, writes with --apply',
})
export class InvoicesCancelCommand extends OperatorCommand<CancelFlags> {
    constructor(@Inject(InvoiceCancelCliFlow) private readonly flow: InvoiceCancelCliFlow) {
        super();
    }

    async run(_args: string[], flags: CancelFlags): Promise<void> {
        if (!flags.apply) {
            const plan = await this.flow.preview(flags);
            this.print(flags, plan, () => this.flow.formatPreview(plan));
            return;
        }
        const cancelled = await this.flow.apply(flags);
        this.print(flags, cancelled, () => this.flow.formatCancelled(cancelled));
    }

    private print(flags: CancelFlags, result: unknown, table: () => string): void {
        process.stdout.write(
            (flags.output === 'json' ? JSON.stringify(result, null, 2) : table()) + '\n',
        );
    }

    @Option({ flags: '--tenant <slug>', description: 'the tenant the invoice belongs to' })
    parseTenant(value: string): string {
        return value;
    }
    @Option({ flags: '--invoice <number>', description: 'the number on the invoice' })
    parseInvoice(value: string): string {
        return value;
    }
    @Option({ flags: '--reason <text>', description: 'why it is cancelled; both invoices name it' })
    parseReason(value: string): string {
        return value;
    }
    @Option({
        flags: '--correct <field=value>',
        description:
            'a detail of the subscriber the replacement names corrected; repeat for several',
    })
    parseCorrect(value: string, previous: string[] = []): string[] {
        return [...previous, value];
    }
    @Option({
        flags: '--deliver-to <email>',
        description:
            'where both invoices are sent; required where the record holds no invoice email',
    })
    parseDeliverTo(value: string): string {
        return value;
    }
    @Option({
        flags: '--apply',
        description: 'cancel it, with the second factor; without it nothing is written',
    })
    parseApply(): boolean {
        return true;
    }
    @Option({ flags: '-o, --output <format>', description: 'table (default) or json' })
    parseOutput(v: string): string {
        return v;
    }
}

@Injectable()
@Command({
    name: 'invoices',
    description: 'Issued invoices: cancel',
    subCommands: [InvoicesCancelCommand],
})
export class InvoicesCommands extends CommandRunner {
    async run(): Promise<void> {
        process.stderr.write('Specify a sub-command: cancel.\n');
        process.exit(2);
    }
}
