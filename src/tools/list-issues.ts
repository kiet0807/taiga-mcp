import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { answer, assignee, closedScope, line, list, status } from '../format.js';
import type { TaigaClient } from '../taiga/client.js';
import { assignedToMe, closed, limit, project, READ_ONLY, statusName } from './shared.js';

export function registerListIssues(server: McpServer, taiga: TaigaClient): void {
  server.registerTool(
    'list_issues',
    {
      title: 'List issues',
      description:
        'List issues (bugs, questions, enhancement requests) of a Taiga project, most recently created first: ' +
        'reference number, type, title, status, severity, priority and assignee. ' +
        'Filter by status, open or closed, severity, priority, or the signed-in user. ' +
        'Planned work is user stories: use list_user_stories. ' +
        'For the description and comments of one issue use get_item.',
      inputSchema: {
        project,
        status: statusName('Needs Info'),
        closed,
        severity: z
          .string()
          .min(1)
          .optional()
          .describe('Exact severity name, e.g. "Critical". A wrong name is answered with the valid ones.'),
        priority: z
          .string()
          .min(1)
          .optional()
          .describe('Exact priority name, e.g. "High". A wrong name is answered with the valid ones.'),
        assigned_to_me: assignedToMe,
        limit,
      },
      annotations: READ_ONLY,
    },
    answer(async (args) => {
      const issues = await taiga.listIssues(args.project, {
        status: args.status,
        closed: args.closed,
        severity: args.severity,
        priority: args.priority,
        assignedToMe: args.assigned_to_me,
        limit: args.limit,
      });
      return list({
        scope: [
          issues.project,
          args.status && `status "${args.status}"`,
          closedScope(args.closed),
          args.severity && `severity "${args.severity}"`,
          args.priority && `priority "${args.priority}"`,
          args.assigned_to_me ? 'assigned to me' : undefined,
        ],
        noun: ['issue', 'issues'],
        total: issues.total,
        lines: issues.items.map((issue) =>
          line(
            issue.ref,
            issue.type ? `[${issue.type}] ${issue.subject}` : issue.subject,
            status(issue),
            issue.severity && `severity ${issue.severity}`,
            issue.priority && `priority ${issue.priority}`,
            assignee(issue.assignee),
            issue.blocked && 'BLOCKED',
          ),
        ),
      });
    }),
  );
}
