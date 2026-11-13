import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  answer,
  assignedScope,
  assignee,
  closedScope,
  dateScope,
  line,
  list,
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
  finishedFrom,
  finishedTo,
  limit,
  page,
  project,
  READ_ONLY,
  search,
  statusName,
  tag,
} from './shared.js';

export function registerListUserStories(server: McpServer, taiga: TaigaClient): void {
  server.registerTool(
    'list_user_stories',
    {
      title: 'List user stories',
      description:
        'List, search or count user stories of a Taiga project in board order: reference number, title, ' +
        'status, assignee, points and sprint. Filter by sprint, epic, status, open or closed, assignee, tag, ' +
        'the days they were created or finished in, or words in the text. Use it for questions such as ' +
        '"what is left in the current sprint" (sprint: "current", closed: false), "what is in the backlog", ' +
        '"what is Linh working on" (assigned_to: "Linh"), "how many stories did I finish in October" ' +
        '(assigned_to_me: true, finished_from, finished_to) or "the story about PDF export" ' +
        '(search: "pdf export"). The heading gives the count of all matches, so for "how many" a small ' +
        '`limit` is enough. Bugs and requests are issues: use list_issues. The small pieces of work inside ' +
        'a story are tasks: use list_tasks. For the description and comments of one story use get_item.',
      inputSchema: {
        project,
        sprint: z
          .string()
          .min(1)
          .optional()
          .describe(
            'A sprint name from list_sprints, or "current" for the sprint running today, or "backlog" for ' +
              'stories in no sprint. Leave out for stories of every sprint and the backlog.',
          ),
        epic: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Reference number of an epic from list_epics, without the #: only the stories under it.'),
        status: statusName('In progress'),
        closed,
        assigned_to_me: assignedToMe,
        assigned_to: assignedTo,
        tag,
        created_from: createdFrom,
        created_to: createdTo,
        finished_from: finishedFrom,
        finished_to: finishedTo,
        search,
        limit,
        page,
      },
      annotations: READ_ONLY,
    },
    answer(async (args) => {
      const stories = await taiga.listUserStories(args.project, {
        sprint: args.sprint,
        epic: args.epic,
        status: args.status,
        closed: args.closed,
        assignedToMe: args.assigned_to_me,
        assignedTo: args.assigned_to,
        tag: args.tag,
        createdFrom: args.created_from,
        createdTo: args.created_to,
        finishedFrom: args.finished_from,
        finishedTo: args.finished_to,
        search: args.search,
        limit: args.limit,
        page: args.page,
      });
      const byFinish = (args.finished_from ?? args.finished_to) !== undefined;
      return list({
        scope: [
          stories.project,
          stories.sprint,
          args.epic !== undefined && `epic #${args.epic}`,
          args.status && `status "${args.status}"`,
          closedScope(args.closed),
          assignedScope(stories.assignee),
          args.tag && `tag "${args.tag}"`,
          dateScope('created', args.created_from, args.created_to),
          dateScope('finished', args.finished_from, args.finished_to),
          searchScope(args.search),
        ],
        noun: ['user story', 'user stories'],
        total: stories.total,
        limit: args.limit,
        page: args.page,
        lines: stories.items.map((story) =>
          line(
            story.ref,
            story.subject,
            status(story),
            assignee(story.assignee),
            story.points === undefined ? 'no points' : `${story.points} pts`,
            // The heading already names the sprint when the list is of one sprint.
            stories.sprint === undefined && (story.sprint ?? 'backlog'),
            byFinish && story.finished && `finished ${story.finished}`,
            story.blocked && 'BLOCKED',
          ),
        ),
      });
    }),
  );
}
