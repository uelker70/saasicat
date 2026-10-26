// Copying a value the operator asked for — a contract's id, a version's — to
// the clipboard, and saying whether it worked. A browser refuses the clipboard
// outside a secure context or without the page's focus, and saying nothing
// would leave the operator pasting whatever was there before.

import { formatMessage } from '../client/i18n/format.js';
import type { UiNotify } from './ui-notify.js';
import { report } from './report.js';
import { useSaMessages } from './use-super-admin-i18n.js';

export interface CopyTextPorts {
    notify: UiNotify;
    /** Where the text is written; the browser's clipboard unless a test says otherwise. */
    clipboard?: Pick<Clipboard, 'writeText'> | null;
}

export interface CopyText {
    /** Copies `text`, and tells the operator whether it worked; a failure is notified, not thrown. */
    copy(text: string): Promise<void>;
}

export function useCopyText(ports: CopyTextPorts): CopyText {
    const common = useSaMessages('common');
    async function copy(text: string): Promise<void> {
        const clipboard =
            ports.clipboard === undefined
                ? (globalThis.navigator?.clipboard ?? null)
                : ports.clipboard;
        try {
            if (!clipboard) throw new Error('This browser offers no clipboard.');
            await clipboard.writeText(text);
        } catch {
            // The reason is the browser's — no secure context, no focus, no
            // clipboard — and the operator can do nothing with it but copy by hand.
            report(() => ports.notify('negative', common.value.copyFailed));
            return;
        }
        report(() => ports.notify('positive', formatMessage(common.value.copiedText, { text })));
    }
    return { copy };
}
