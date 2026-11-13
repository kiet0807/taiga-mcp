import type { WriteResult } from '../taiga/types.js';

const KIND = { story: 'user story', issue: 'issue', epic: 'epic', task: 'task' } as const;

/** The answer to a create, a change or a comment: what was done, to which item, and where to see it. */
export function written(done: 'Created' | 'Changed' | 'Commented on', result: WriteResult): string {
  const item = `${KIND[result.kind]} #${result.ref} "${result.subject}" in ${result.project}`;
  const version = result.version === undefined ? '' : ` It is now at version ${result.version}.`;
  if (done === 'Changed' && result.changed.length === 0) {
    return `Nothing to change: ${item} already has those values.`;
  }
  const lines = [
    `${done} ${item}.${done === 'Commented on' ? '' : version}`,
    ...result.changed.map(([label, before, after]) => `- ${label}: ${before} → ${after}`),
    ...result.facts.map(([label, value]) => `${label}: ${value}`),
  ];
  if (result.url !== undefined) lines.push(`Open in Taiga: ${result.url}`);
  return lines.join('\n');
}
