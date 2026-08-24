/**
 * The tones `.sp-badge` paints, as a type.
 *
 * Named here rather than spelled out at each prop, because the components that
 * DERIVE a tone (a subscription status, a plan-change type) and the stylesheet
 * that paints it are in different files — and the pairing that went wrong
 * before was a Quasar colour name that happened to match four of five.
 */
export type BadgeTone = 'neutral' | 'positive' | 'negative' | 'warning' | 'info';
