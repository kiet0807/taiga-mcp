import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { answer, plural } from '../format.js';
import type { TaigaClient } from '../taiga/client.js';
import type { ItemKind, Named, ProjectOverview } from '../taiga/types.js';
import { project, READ_ONLY } from './shared.js';

const KINDS: readonly (readonly [ItemKind, string])[] = [
  ['story', 'User story'],
  ['task', 'Task'],
  ['issue', 'Issue'],
  ['epic', 'Epic'],
];

export function registerGetProject(server: McpServer, taiga: TaigaClient): void {
  server.registerTool(
    'get_project',
    {
      title: 'Read a project overview',
      description:
        'Read what a Taiga project is made of: its description, its members with their roles, how many ' +
        'sprints it has, and the names its items use: the statuses of user stories, tasks, issues and epics ' +
        '(and which of them count as closed), issue types, severities, priorities, tags and custom fields. ' +
        'Use it for "who is on the project", "who is the product owner", and before filtering by a status, ' +
        'tag or person whose exact name you do not know yet.',
      inputSchema: { project },
      annotations: READ_ONLY,
    },
    answer(async (args) => describe(await taiga.getProject(args.project))),
  );
}

const names = (list: readonly Named[]) =>
  list.map((item) => (item.closed ? `${item.name} (closed)` : item.name)).join(', ') || 'none';

function describe(overview: ProjectOverview): string {
  const custom = KINDS.flatMap(([kind, label]) =>
    overview.customFields[kind].length === 0
      ? []
      : [`${label} custom fields: ${overview.customFields[kind].join(', ')}`],
  );
  return [
    [
      `Project: ${overview.name} (slug: ${overview.slug}) · ${overview.isPrivate ? 'private' : 'public'}`,
      `Description: ${overview.description || '(empty)'}`,
      `Switched on: ${overview.modules.join(', ') || 'nothing'}`,
      `Sprints: ${overview.openSprints} open, ${overview.closedSprints} closed`,
    ].join('\n'),
    `Members (${overview.members.length}):\n` +
      (overview.members
        .map((member) => `- ${member.name} (${member.username})${member.role ? ` · ${member.role}` : ''}`)
        .join('\n') || '- none'),
    [
      ...KINDS.map(([kind, label]) => `${label} statuses: ${names(overview.statuses[kind])}`),
      `Issue types: ${names(overview.issueTypes)}`,
      `Severities: ${names(overview.severities)}`,
      `Priorities: ${names(overview.priorities)}`,
      `Tags (${plural(overview.tags.length, 'tag')}): ${overview.tags.join(', ') || 'none'}`,
      ...custom,
    ].join('\n'),
  ].join('\n\n');
}
