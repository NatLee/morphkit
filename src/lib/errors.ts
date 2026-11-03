/**
 * A conversion failure the user can act on. `key` names an i18n message that says what went wrong
 * and what to try instead; the file card shows it in place of the generic "Conversion failed".
 * Throw it where the problem is detected (inside the conversion), so the UI needs no
 * per-format branches. Anything else that is thrown still shows the generic message.
 */
export class ConvertError extends Error {
  constructor(readonly key: string) {
    super(key);
    this.name = 'ConvertError';
  }
}
