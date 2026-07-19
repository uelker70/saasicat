// qrcode-terminal liefert keine eigenen Typen — minimale Deklaration für die
// einzige Funktion, die `admin mfa-setup` braucht.
declare module 'qrcode-terminal' {
    export function generate(
        text: string,
        opts?: { small?: boolean },
        cb?: (qrcode: string) => void,
    ): void;
    const _default: { generate: typeof generate };
    export default _default;
}
