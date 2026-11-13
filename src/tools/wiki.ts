import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { answer, list, plural, truncate } from '../format.js';
import type { TaigaClient } from '../taiga/client.js';
import type { WikiPageSummary } from '../taiga/types.js';
import { limit, page, project, READ_ONLY } from './shared.js';

/** A wiki page can be a whole handbook; this is about a dozen screens of text. */
const PAGE_MAX = 12_000;

/** One wiki page in a list: its slug, then what helps to pick the right one. */
export function wikiLine(page: WikiPageSummary): string {
  return [
    `- ${page.slug}`,
    page.title && `"${page.title}"`,
    page.modified && `changed ${page.modified}`,
    page.edits > 0 && plural(page.edits, 'edit'),
    page.length > 0 && `${page.length} characters`,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function registerWiki(server: McpServer, taiga: TaigaClient): void {
  server.registerTool(
    'list_wiki_pages',
    {
      title: 'List wiki pages',
      description:
        'List the wiki pages of a Taiga project, most recently changed first: slug, title, when it last ' +
        'changed and how long it is. The wiki holds what the team wrote down outside stories: guides, ' +
        'conventions, meeting notes. Read one page with get_wiki_page; to find pages by their text use search.',
      inputSchema: { project, limit, page },
      annotations: READ_ONLY,
    },
    answer(async (args) => {
      const pages = await taiga.listWikiPages(args.project, args);
      return list({
        scope: [pages.project],
        noun: ['wiki page', 'wiki pages'],
        total: pages.total,
        limit: args.limit,
        page: args.page,
        lines: pages.items.map(wikiLine),
      });
    }),
  );

  server.registerTool(
    'get_wiki_page',
    {
      title: 'Read one wiki page',
      description:
        'Read the text of one wiki page of a Taiga project, with who changed it last and when. ' +
        'Name the page by its slug from list_wiki_pages or search, or by its title in the wiki menu.',
      inputSchema: {
        project,
        page: z.string().min(1).describe('Slug of the page, e.g. "home", or its title in the wiki menu.'),
      },
      annotations: READ_ONLY,
    },
    answer(async (args) => {
      const wiki = await taiga.getWikiPage(args.project, args.page);
      const facts = [
        wiki.modified && `Last changed: ${wiki.modified}${wiki.modifiedBy ? ` by ${wiki.modifiedBy}` : ''}`,
        wiki.created && `Created: ${wiki.created}`,
        wiki.edits > 0 && `Edits: ${wiki.edits}`,
      ].filter(Boolean);
      return [
        `Wiki page ${wiki.title ? `"${wiki.title}" (slug: ${wiki.slug})` : wiki.slug} of ${wiki.project}`,
        facts.join('\n'),
        wiki.content ? truncate(wiki.content, PAGE_MAX) : '(empty)',
      ]
        .filter(Boolean)
        .join('\n\n');
    }),
  );
}
