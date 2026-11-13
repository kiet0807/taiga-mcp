import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { answer, assignee, line, plural, status } from '../format.js';
import type { TaigaClient } from '../taiga/client.js';
import type { Listing } from '../taiga/types.js';
import { project, READ_ONLY } from './shared.js';
import { wikiLine } from './wiki.js';

const DEFAULT_EACH = 5;
const MAX_EACH = 20;

interface Found {
  readonly ref: number;
  readonly subject: string;
  readonly status: string;
  readonly closed: boolean;
  readonly assignee: string | undefined;
}

export function registerSearch(server: McpServer, taiga: TaigaClient): void {
  server.registerTool(
    'search',
    {
      title: 'Search a project',
      description:
        'Search one Taiga project for words, in everything at once: user stories, tasks, issues, epics and ' +
        'wiki pages. Answers with how many of each kind match and the first few of each. Use it when the ' +
        'user describes something without saying what kind of item it is ("anything about the bank ' +
        'sandbox", "where did we write down the release steps"). An item must contain every word; a word ' +
        'also matches the beginning of a longer one. When you know the kind, or need more filters or all ' +
        "the matches, use that kind's list tool with `search`.",
      inputSchema: {
        project,
        words: z.string().trim().min(1).max(200).describe('The words to look for, e.g. "bank sandbox".'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_EACH)
          .default(DEFAULT_EACH)
          .describe(`Most matches to show of each kind (default ${DEFAULT_EACH}, at most ${MAX_EACH}).`),
      },
      annotations: READ_ONLY,
    },
    answer(async (args) => {
      const filters = { search: args.words, limit: args.limit };
      const [stories, tasks, issues, epics, wiki] = await Promise.allSettled([
        taiga.listUserStories(args.project, filters),
        taiga.listTasks(args.project, filters),
        taiga.listIssues(args.project, filters),
        taiga.listEpics(args.project, filters),
        taiga.searchWiki(args.project, args.words),
      ]);
      // A wrong project fails every part the same way: say it once.
      if (stories.status === 'rejected') throw stories.reason;

      const sections = [
        section('User stories', ['user story', 'user stories'], 'list_user_stories', stories),
        section('Tasks', ['task', 'tasks'], 'list_tasks', tasks),
        section('Issues', ['issue', 'issues'], 'list_issues', issues),
        section('Epics', ['epic', 'epics'], 'list_epics', epics),
        wiki.status === 'rejected'
          ? {
              count: 'wiki pages not searched',
              body: `Wiki pages: could not be searched (${reason(wiki.reason)}).`,
            }
          : {
              count: plural(wiki.value.length, 'wiki page'),
              body:
                wiki.value.length === 0
                  ? undefined
                  : `Wiki pages (${wiki.value.length}; read one with get_wiki_page):\n` +
                    wiki.value.slice(0, args.limit).map(wikiLine).join('\n'),
            },
      ];
      return [
        `${stories.value.project} · matching "${args.words}": ${sections.map((s) => s.count).join(', ')}.`,
        ...sections.flatMap((s) => (s.body === undefined ? [] : [s.body])),
      ].join('\n\n');
    }),
  );
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

function section(
  title: string,
  noun: readonly [string, string],
  tool: string,
  result: PromiseSettledResult<Listing<Found>>,
): { count: string; body: string | undefined } {
  if (result.status === 'rejected') {
    return {
      count: `${noun[1]} not searched`,
      body: `${title}: could not be searched (${reason(result.reason)}).`,
    };
  }
  const { items, total } = result.value;
  if (items.length === 0) return { count: `0 ${noun[1]}`, body: undefined };
  const heading =
    items.length < total
      ? `${title} (${items.length} of ${total} shown; for all of them call ${tool} with \`search\`):`
      : `${title} (${total}):`;
  return {
    count: plural(total, ...noun),
    body: `${heading}\n${items.map((item) => line(item.ref, item.subject, status(item), assignee(item.assignee))).join('\n')}`,
  };
}
