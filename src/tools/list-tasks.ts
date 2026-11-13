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

export function registerListTasks(server: McpServer, taiga: TaigaClient): void {
  server.registerTool(
    'list_tasks',
    {
      title: 'List tasks',
      description:
        'List, search or count tasks of a Taiga project: the small pieces of work a user story is split ' +
        'into. Reference number, title, status, assignee, and the story and sprint each task belongs to. ' +
        'Filter by story, sprint, status, open or closed, assignee, tag, the days they were created or ' +
        'finished in, or words in the text. Use it for questions such as "what is left to do on story 42" ' +
        '(story: 42, closed: false), "what am I working on this sprint" (sprint: "current", ' +
        'assigned_to_me: true) or "how many tasks did I finish this month" (assigned_to_me: true, ' +
        'finished_from). The heading gives the count of all matches, so for "how many" a small `limit` is ' +
        'enough. A project has many tasks, so pass at least one filter. For the stories themselves use ' +
        'list_user_stories; for the description and comments of one task use get_item.',
      inputSchema: {
        project,
        story: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Reference number of a user story, without the #: only the tasks of that story.'),
        sprint: z
          .string()
          .min(1)
          .optional()
          .describe('A sprint name from list_sprints, or "current" for the sprint running today.'),
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
      const tasks = await taiga.listTasks(args.project, {
        story: args.story,
        sprint: args.sprint,
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
          tasks.project,
          args.story !== undefined && `story #${args.story}`,
          tasks.sprint,
          args.status && `status "${args.status}"`,
          closedScope(args.closed),
          assignedScope(tasks.assignee),
          args.tag && `tag "${args.tag}"`,
          dateScope('created', args.created_from, args.created_to),
          dateScope('finished', args.finished_from, args.finished_to),
          searchScope(args.search),
        ],
        noun: ['task', 'tasks'],
        total: tasks.total,
        limit: args.limit,
        page: args.page,
        lines: tasks.items.map((task) =>
          line(
            task.ref,
            task.subject,
            status(task),
            assignee(task.assignee),
            // The heading already names the story or the sprint when the list is of one.
            args.story === undefined && (task.story === undefined ? 'no story' : `story #${task.story}`),
            tasks.sprint === undefined && task.sprint,
            byFinish && task.finished && `finished ${task.finished}`,
            task.blocked && 'BLOCKED',
          ),
        ),
      });
    }),
  );
}
