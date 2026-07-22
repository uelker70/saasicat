// Placeholder interpolation for catalog messages: `{name}` is replaced with
// `params.name`. Unknown placeholders stay verbatim so a missing param is
// visible in the UI instead of silently disappearing.

export type MessageParams = Record<string, string | number>;

export function formatMessage(template: string, params: MessageParams): string {
    return template.replace(/\{(\w+)\}/g, (match, name: string) => {
        const value = params[name];
        return value === undefined ? match : String(value);
    });
}
