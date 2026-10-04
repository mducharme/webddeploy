import { hintFor, hintForStatus, type Hint } from '@webddeploy/shared';
import { ApiError } from './api.ts';

/** The message to show for an error, and what to do about it when it's something known. */
export function explainError(error: unknown): { message: string; hint: Hint | null } {
  const message = error instanceof Error ? error.message : String(error);
  // fetch() itself failing (network down, server gone) is a TypeError.
  if (error instanceof TypeError && /fetch|network|load failed/i.test(message)) {
    return { message: "Couldn't reach the web UI's server", hint: hintForStatus(null, null) };
  }
  const hint = hintFor(message) ?? (error instanceof ApiError ? hintForStatus(error.status, error.code) : null);
  return { message, hint };
}
