import { z } from 'zod';
import { DEFAULT_LIMIT, MAX_LIMIT } from '../format.js';

/** Every tool only reads, and reads a system outside this process. */
export const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

/* Arguments that several tools share, described once so the model reads the same words everywhere. */

export const project = z
  .string()
  .min(1)
  .describe('Project slug as given by list_projects, e.g. "acme-billing". Not the display name.');

export const limit = z
  .number()
  .int()
  .min(1)
  .max(MAX_LIMIT)
  .default(DEFAULT_LIMIT)
  .describe(
    `Most items to return (default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}). The answer says how many more exist.`,
  );

export const closed = z
  .boolean()
  .optional()
  .describe(
    'false: only items still open ("not done yet", "remaining"). true: only closed ones. Leave out for both.',
  );

export const assignedToMe = z
  .boolean()
  .optional()
  .describe('true: only items assigned to the signed-in user ("my stories", "assigned to me").');

export const statusName = (example: string) =>
  z
    .string()
    .min(1)
    .optional()
    .describe(
      `Exact status name, e.g. "${example}". Each project defines its own; a wrong name is answered with the valid ones. ` +
        'For "open" or "done" in general use `closed` instead.',
    );
