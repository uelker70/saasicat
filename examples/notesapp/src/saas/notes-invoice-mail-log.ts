import { Injectable, Logger } from '@nestjs/common';
import type {
    ContractConfirmationMail,
    InvoiceDocument,
    InvoiceMail,
    InvoiceMailPort,
    InvoiceNoticeMail,
} from '@saasicat/core';

/**
 * The notes app's invoice mail: where an archived invoice, a notice about
 * collecting it and a contract's confirmation leave for the subscriber.
 *
 * The notes app sends no e-mail, so it writes each one to its log — which
 * invoice or contract, whose, and the name and size of each file it would
 * attach, and whether it is a test document, as a real message has to say. Not
 * the file, which is the subscriber's invoice, and not the address, so the log
 * carries nobody's e-mail; the platform records where each went.
 * A real app words the message in the subscriber's language and sends it
 * with its own mail infrastructure, attaching the files; a rejection there is
 * what makes the platform show the failure and try again on its next run.
 */
@Injectable()
export class NotesInvoiceMailLog implements InvoiceMailPort {
    private readonly logger = new Logger(NotesInvoiceMailLog.name);

    async deliver(mail: InvoiceMail): Promise<void> {
        const { invoice } = mail;
        const what = invoice.testOperation ? 'Test invoice' : 'Invoice';
        this.logger.log(
            `${what} ${invoice.number} to the invoice email of subscriber ${invoice.subscriberId}, ` +
                `attaching ${described(mail.document)}.`,
        );
    }

    async tell(mail: InvoiceNoticeMail): Promise<void> {
        const { notice } = mail;
        this.logger.log(
            `Notice ${notice.kind} about invoice ${notice.invoiceNumber} to the invoice email of ` +
                `subscriber ${notice.subscriberId}.`,
        );
    }

    async deliverConfirmation(mail: ContractConfirmationMail): Promise<void> {
        const { contract } = mail;
        const what = mail.testOperation ? 'Test confirmation' : 'Confirmation';
        this.logger.log(
            `${what} of contract ${contract.id} to the invoice email of subscriber ` +
                `${contract.subscriberId}, attaching ${mail.documents.map(described).join(' and ')}.`,
        );
    }
}

/** A file as the log names it: its name and its size, never its content. */
function described(document: InvoiceDocument): string {
    return `${document.fileName} (${document.content.byteLength} bytes)`;
}
