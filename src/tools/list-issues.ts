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

const nameOf = (what: string, example: string) =>
  z
    .string()
    .min(1)
    .optional()
    .describe(`Exact ${what} name, e.g. "${example}". A wrong name is answered with the valid ones.`);

export function registerListIssues(server: McpServer, taiga: TaigaClient): void {
  server.registerTool(
    'list_issues',
    {
      title: 'List issues',
      description:
        'List, search or count issues (bugs, questions, enhancement requests) of a Taiga project, most ' +
        'recently created first: reference number, type, title, status, severity, priority and assignee. ' +
        'Filter by type, status, open or closed, severity, priority, assignee, tag, the days they were ' +
        'created or closed in, or words in the text (search: "login timeout"). The heading gives the count ' +
        'of all matches. Planned work is user stories: use list_user_stories. ' +
        'For the description and comments of one issue use get_item.',
      inputSchema: {
        project,
        type: nameOf('issue type', 'Bug'),
        status: statusName('Needs Info'),
        closed,
        severity: nameOf('severity', 'Critical'),
        priority: nameOf('priority', 'High'),
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
      const issues = await taiga.listIssues(args.project, {
        type: args.type,
        status: args.status,
        closed: args.closed,
        severity: args.severity,
        priority: args.priority,
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
          issues.project,
          args.type && `type "${args.type}"`,
          args.status && `status "${args.status}"`,
          closedScope(args.closed),
          args.severity && `severity "${args.severity}"`,
          args.priority && `priority "${args.priority}"`,
          assignedScope(issues.assignee),
          args.tag && `tag "${args.tag}"`,
          dateScope('created', args.created_from, args.created_to),
          dateScope('finished', args.finished_from, args.finished_to),
          searchScope(args.search),
        ],
        noun: ['issue', 'issues'],
        total: issues.total,
        limit: args.limit,
        page: args.page,
        lines: issues.items.map((issue) =>
          line(
            issue.ref,
            issue.type ? `[${issue.type}] ${issue.subject}` : issue.subject,
            status(issue),
            issue.severity && `severity ${issue.severity}`,
            issue.priority && `priority ${issue.priority}`,
            assignee(issue.assignee),
            byFinish && issue.finished && `finished ${issue.finished}`,
            issue.blocked && 'BLOCKED',
          ),
        ),
      });
    }),
  );
}
