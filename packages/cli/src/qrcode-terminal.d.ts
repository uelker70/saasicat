// qrcode-terminal ships no types of its own — minimal declaration for the
// only function that `admin mfa-setup` needs.
declare module 'qrcode-terminal' {
    export function generate(
        text: string,
        opts?: { small?: boolean },
        cb?: (qrcode: string) => void,
    ): void;
    const _default: { generate: typeof generate };
    export default _default;
}
