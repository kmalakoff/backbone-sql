export const CALLBACK_REQUEST_MODES = ['options-ignored', 'trailing-ignored', 'both-options', 'both-trailing', 'await-only', 'raw-observed', 'raw-ignored', 'success-throw-observed', 'error-throw-observed', 'success-throw-ignored', 'error-throw-ignored'] as const;

export type CallbackRequestMode = (typeof CALLBACK_REQUEST_MODES)[number];

export const FATAL_CALLBACK_REQUEST_MODES: ReadonlySet<CallbackRequestMode> = new Set(['raw-ignored', 'success-throw-ignored', 'error-throw-ignored']);

export function isCallbackRequestMode(value: string | undefined): value is CallbackRequestMode {
  return CALLBACK_REQUEST_MODES.some((mode) => mode === value);
}
