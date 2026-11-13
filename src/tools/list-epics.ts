import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  answer,
  assignedScope,
  assignee,
  closedScope,
  dateScope,
  line,
  list,
  progress,
  searchScope,
  status,
} from '../format.js';
import type { TaigaClient } from '../taiga/client.js';
import {
  assignedTo,
  assignedToMe,
  closed,
  createdFrom,
  createdTo,
  limit,
  page,
  project,
  READ_ONLY,
  search,
  statusName,
  tag,
} from './shared.js';

export function registerListEpics(server: McpServer, taiga: TaigaClient): void {
  server.registerTool(
    'list_epics',
    {
      title: 'List epics',
      description:
        'List, search or count the epics of a Taiga project in board order: reference number, title, status, ' +
        'assignee, and how many of the user stories under each epic are done. Filter by status, open or ' +
        'closed, assignee, tag, the days they were created in, or words in the text. Use it for an overview ' +
        'of large pieces of work, to see which epics are behind (closed: false, then compare progress), or ' +
        'for "how many epics are mine" (assigned_to_me: true; the heading gives the count of all matches). ' +
        'For the stories under one epic call list_user_stories with `epic`. ' +
        'Dates kept in custom fields, the description and comments of one epic come from get_item.',
      inputSchema: {
        project,
        status: statusName('In progress'),
        closed,
        assigned_to_me: assignedToMe,
        assigned_to: assignedTo,
        tag,
        created_from: createdFrom,
        created_to: createdTo,
        search,
        limit,
        page,
      },
      annotations: READ_ONLY,
    },
    answer(async (args) => {
      const epics = await taiga.listEpics(args.project, {
        status: args.status,
        closed: args.closed,
        assignedToMe: args.assigned_to_me,
        assignedTo: args.assigned_to,
        tag: args.tag,
        createdFrom: args.created_from,
        createdTo: args.created_to,
        search: args.search,
        limit: args.limit,
        page: args.page,
      });
      return list({
        scope: [
          epics.project,
          args.status && `status "${args.status}"`,
          closedScope(args.closed),
          assignedScope(epics.assignee),
          args.tag && `tag "${args.tag}"`,
          dateScope('created', args.created_from, args.created_to),
          searchScope(args.search),
        ],
        noun: ['epic', 'epics'],
        total: epics.total,
        limit: args.limit,
        page: args.page,
        lines: epics.items.map((epic) =>
          line(
            epic.ref,
            epic.subject,
            status(epic),
            assignee(epic.assignee),
            progress(epic.storiesDone, epic.stories),
            epic.blocked && 'BLOCKED',
          ),
        ),
      });
    }),
  );
}
