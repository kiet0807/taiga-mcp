import { fold, plural } from '../format.js';
import type { FileContent, Row, Sheet } from '../taiga/files.js';
import { TaigaError } from '../taiga/http.js';

/**
 * What part of a file to show. A small file is shown whole; a large one first as an overview,
 * then by the part the model asks for: a sheet and its rows, pages, or the lines with some words.
 * One answer stays under BUDGET characters (some 5,000 tokens), whatever the file.
 */
export interface Selection {
  /** A sheet by name or number. */
  readonly sheet?: string | undefined;
  /** Rows of a sheet (their numbers in the file) or lines of a text, e.g. "120-300". */
  readonly rows?: string | undefined;
  /** Pages of a PDF or slides of a presentation, e.g. "3-5". */
  readonly pages?: string | undefined;
  /** Only the rows, lines or page lines that contain every one of these words. */
  readonly find?: string | undefined;
}

type Readable = Exclude<FileContent, { kind: 'image' } | { kind: 'unreadable' }>;

export const BUDGET = 20_000;
const LINE_MAX = 2_000;
const PREVIEW_ROWS = 10;
const PREVIEW_LINES = 60;
const OUTLINE_PAGES = 100;
const FIRST_PAGE_MAX = 3_000;

const clip = (line: string) => (line.length <= LINE_MAX ? line : `${line.slice(0, LINE_MAX)}… [line cut]`);

/** "120-300", "120", "120-": the numbers asked for, both ends included. */
export function parseRange(text: string, what: string): { from: number; to: number } {
  const match = /^\s*(\d+)\s*(?:[-–]\s*(\d*)\s*)?$/.exec(text);
  if (match === null)
    throw new TaigaError(`\`${what}\` takes numbers like "120-300", "5" or "40-"; not "${text}".`);
  const from = Number(match[1]);
  const to = match[2] === undefined ? from : match[2] === '' ? Number.POSITIVE_INFINITY : Number(match[2]);
  if (from < 1 || to < from)
    throw new TaigaError(`\`${what}\` "${text}" is not a range: it must count up from 1.`);
  return { from, to };
}

/** Lines added one by one until the budget is spent; says where it stopped. */
class Out {
  readonly lines: string[] = [];
  #size = 0;
  full = false;
  add(line: string): boolean {
    const text = clip(line);
    if (this.#size + text.length + 1 > BUDGET) {
      this.full = true;
      return false;
    }
    this.lines.push(text);
    this.#size += text.length + 1;
    return true;
  }
  get size() {
    return this.#size;
  }
}

const matcher = (find: string) => {
  const words = fold(find).split(/\s+/).filter(Boolean);
  return (text: string) => {
    const folded = fold(text);
    return words.every((word) => folded.includes(word));
  };
};

export function view(content: Readable, selection: Selection): string {
  if (selection.sheet !== undefined && content.kind !== 'sheets') {
    throw new TaigaError('`sheet` is for spreadsheets and CSV files. This file has no sheets.');
  }
  if (selection.pages !== undefined && content.kind !== 'pages') {
    throw new TaigaError(
      `\`pages\` is for PDFs and presentations. ${content.kind === 'sheets' ? 'Use `sheet` and `rows`' : 'Use `rows` for lines'} here.`,
    );
  }
  if (content.kind === 'sheets') return viewSheets(content, selection);
  if (content.kind === 'pages') return viewPages(content, selection);
  return viewLines(content, selection);
}

/* ---------------------------------- sheets ---------------------------------- */

const rowText = (row: Row) => `${row.n}: ${row.cells.join(' | ')}`;

function pickSheets(sheets: readonly Sheet[], wanted: string | undefined): readonly Sheet[] {
  if (wanted === undefined) return sheets;
  const byNumber = /^\d+$/.test(wanted.trim()) ? sheets[Number(wanted) - 1] : undefined;
  const byName = sheets.find((sheet) => fold(sheet.name) === fold(wanted));
  const found = byName ?? byNumber;
  if (found === undefined) {
    throw new TaigaError(
      `No sheet "${wanted}". Sheets: ${sheets.map((sheet, i) => `${i + 1}. "${sheet.name}"`).join(', ')}.`,
    );
  }
  return [found];
}

function columns(sheet: Sheet): number {
  return sheet.rows.reduce((max, row) => Math.max(max, row.cells.length), 0);
}

function viewSheets(content: Extract<Readable, { kind: 'sheets' }>, selection: Selection): string {
  const sheets = pickSheets(content.sheets, selection.sheet);
  const out = new Out();
  const head = `Read as: ${content.from}. Each line is "row number: cells split by |".`;

  if (selection.find !== undefined) {
    const fits = matcher(selection.find);
    let found = 0;
    let shown = 0;
    for (const sheet of sheets) {
      for (const row of sheet.rows) {
        if (!fits(row.cells.join(' '))) continue;
        found++;
        if (!out.full && out.add(`${sheets.length > 1 ? `"${sheet.name}" ` : ''}${rowText(row)}`)) shown++;
      }
    }
    return [
      `${head}\nRows containing "${selection.find}": ${found}${shown < found ? `, the first ${shown} shown` : ''}.`,
      out.lines.join('\n'),
      shown < found ? 'Narrow `find` with more words, or pick a `sheet`.' : undefined,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  if (selection.rows !== undefined) {
    if (sheets.length > 1) {
      throw new TaigaError(
        `The file has ${sheets.length} sheets: name one with \`sheet\` (${sheets.map((s) => `"${s.name}"`).join(', ')}).`,
      );
    }
    const [sheet] = sheets as [Sheet];
    const { from, to } = parseRange(selection.rows, 'rows');
    const header = sheet.rows[0];
    const wanted = sheet.rows.filter((row) => row.n >= from && row.n <= to);
    if (header !== undefined && header.n < from) out.add(`(header) ${rowText(header)}`);
    let last: number | undefined;
    for (const row of wanted) {
      if (!out.add(rowText(row))) break;
      last = row.n;
    }
    const lastInFile = sheet.rows.at(-1)?.n ?? 0;
    const end = Number.isFinite(to) ? to : lastInFile;
    // Rows asked for that did not fit in this answer.
    const next = wanted.find((row) => last === undefined || row.n > last);
    const more = next === undefined ? undefined : `Continue with \`rows\`: "${next.n}-${end}".`;
    return [
      `${head}\nSheet "${sheet.name}", rows ${from} to ${end}: ${wanted.length} with data${next === undefined ? '' : `, up to row ${last ?? from} shown`}.`,
      out.lines.join('\n') || '(no rows with data here)',
      more,
      cutNote(sheet),
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  // Everything, when it fits.
  const whole = sheets.flatMap((sheet) => [`=== Sheet "${sheet.name}" ===`, ...sheet.rows.map(rowText), '']);
  if (
    whole.every((line) => out.add(line)) &&
    sheets.every((sheet) => sheet.rows.length === sheet.totalRows)
  ) {
    return `${head}\n\n${out.lines.join('\n').trim()}`;
  }

  // An overview, and how to read the rest.
  const overview = sheets.map((sheet) => {
    const preview = sheet.rows.slice(0, PREVIEW_ROWS).map(rowText);
    return [
      `=== Sheet "${sheet.name}": ${plural(sheet.totalRows, 'row')} with data, up to ${plural(columns(sheet), 'column')} ===`,
      preview.length === 0 ? '(empty)' : preview.join('\n'),
      sheet.rows.length > PREVIEW_ROWS ? `… ${sheet.totalRows - PREVIEW_ROWS} more rows` : undefined,
      cutNote(sheet),
    ]
      .filter(Boolean)
      .join('\n');
  });
  return [
    `${head}\nToo large to show at once; this is an overview with the first ${PREVIEW_ROWS} rows of each sheet.`,
    clipBudget(overview.join('\n\n')),
    'To read more: `sheet` with `rows` (e.g. "11-300"), or `find` with words to get only the rows that contain them.',
  ].join('\n\n');
}

const cutNote = (sheet: Sheet) =>
  sheet.rows.length < sheet.totalRows
    ? `Only the first ${sheet.rows.length} of ${sheet.totalRows} rows of "${sheet.name}" can be read; use \`find\` to reach the rest.`
    : undefined;

const clipBudget = (text: string) =>
  text.length <= BUDGET ? text : `${text.slice(0, BUDGET)}… [overview cut; pick a \`sheet\`]`;

/* ---------------------------------- pages ---------------------------------- */

function viewPages(content: Extract<Readable, { kind: 'pages' }>, selection: Selection): string {
  const { pages, unit, totalPages } = content;
  const Unit = unit === 'page' ? 'Page' : 'Slide';
  const out = new Out();
  const head = `Read as: ${content.from}.`;
  const unread =
    pages.length < totalPages ? `Pages after ${pages.length} cannot be read by this server.` : undefined;

  if (selection.find !== undefined) {
    const fits = matcher(selection.find);
    let found = 0;
    let shown = 0;
    pages.forEach((page, i) => {
      for (const line of page.split('\n')) {
        if (!fits(line)) continue;
        found++;
        if (!out.full && out.add(`${Unit} ${i + 1}: ${line.trim()}`)) shown++;
      }
    });
    return [
      `${head}\nLines containing "${selection.find}": ${found}${shown < found ? `, the first ${shown} shown` : ''}.`,
      out.lines.join('\n'),
      found > 0 ? `Read a whole ${unit} with \`pages\`.` : undefined,
      unread,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  const render = (from: number, to: number) => {
    let last = from - 1;
    for (let n = from; n <= Math.min(to, pages.length); n++) {
      const block = [
        `--- ${Unit} ${n} ---`,
        ...(pages[n - 1] || `(no text on this ${unit}${unit === 'page' ? '; it may be a scan' : ''})`).split(
          '\n',
        ),
      ];
      // A page is shown whole or not at all, unless it alone is larger than the budget.
      const fits = block.reduce((sum, line) => sum + clip(line).length + 1, 0) + out.size <= BUDGET;
      if (!fits && last >= from) break;
      for (const line of block) if (!out.add(line)) break;
      last = n;
      if (out.full) break;
    }
    return last;
  };

  if (selection.pages !== undefined) {
    const { from, to } = parseRange(selection.pages, 'pages');
    if (from > pages.length) {
      throw new TaigaError(
        `The file has ${totalPages} ${unit}s${unread ? `, of which ${pages.length} can be read` : ''}.`,
      );
    }
    const last = render(from, to);
    const end = Math.min(to, pages.length);
    return [
      `${head}\n${Unit}s ${from} to ${last}${last < end ? ` of the ${from}-${end} asked for` : ''}.`,
      out.lines.join('\n'),
      last < end ? `Continue with \`pages\`: "${last + 1}-${end}".` : undefined,
      unread,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  const total = pages.reduce((sum, page) => sum + page.length + 20, 0);
  if (total <= BUDGET && pages.length === totalPages) {
    render(1, pages.length);
    return `${head}\n\n${out.lines.join('\n')}`;
  }

  const outline = pages
    .slice(0, OUTLINE_PAGES)
    .map(
      (page, i) =>
        `${Unit} ${i + 1}: ${(page.split('\n').find((line) => line.trim()) ?? '(no text)').slice(0, 80)}`,
    );
  const first = pages[0] ?? '';
  return [
    `${head}\nToo large to show at once; this is the first line of each ${unit}${pages.length > OUTLINE_PAGES ? ` (the first ${OUTLINE_PAGES})` : ''}, then ${Unit.toLowerCase()} 1.`,
    outline.join('\n'),
    `--- ${Unit} 1 ---\n${first.length > FIRST_PAGE_MAX ? `${first.slice(0, FIRST_PAGE_MAX)}… [${unit} cut]` : first || '(no text)'}`,
    `To read more: \`pages\` (e.g. "2-6"), or \`find\` with words to get only the lines that contain them.`,
    unread,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/* ---------------------------------- lines ---------------------------------- */

function viewLines(content: Extract<Readable, { kind: 'lines' }>, selection: Selection): string {
  const { lines } = content;
  const out = new Out();
  const head = `Read as: ${content.from}, ${lines.length} lines.`;

  if (selection.find !== undefined) {
    const fits = matcher(selection.find);
    let found = 0;
    let shown = 0;
    lines.forEach((line, i) => {
      if (!fits(line)) return;
      found++;
      if (!out.full && out.add(`${i + 1}: ${line}`)) shown++;
    });
    return [
      `${head}\nLines containing "${selection.find}": ${found}${shown < found ? `, the first ${shown} shown` : ''}.`,
      out.lines.join('\n'),
      found > 0 ? 'Read the lines around one with `rows`.' : undefined,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  const render = (from: number, to: number) => {
    let last = from - 1;
    for (let n = from; n <= Math.min(to, lines.length); n++) {
      if (!out.add(`${n}: ${lines[n - 1] ?? ''}`)) break;
      last = n;
    }
    return last;
  };

  if (selection.rows !== undefined) {
    const { from, to } = parseRange(selection.rows, 'rows');
    if (from > lines.length) throw new TaigaError(`The file has ${lines.length} lines.`);
    const last = render(from, to);
    const end = Math.min(to, lines.length);
    return [
      `${head}\nLines ${from} to ${last}.`,
      out.lines.join('\n'),
      last < end ? `Continue with \`rows\`: "${last + 1}-${end}".` : undefined,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  const total = lines.reduce((sum, line) => sum + clip(line).length + 1, 0);
  if (total <= BUDGET) return `${head}\n\n${lines.map(clip).join('\n')}`;

  render(1, PREVIEW_LINES);
  return [
    `${head}\nToo large to show at once (${total} characters); these are the first ${out.lines.length} lines, numbered.`,
    out.lines.join('\n'),
    'To read more: `rows` for a range of lines (e.g. "61-400"), or `find` with words to get only the lines that contain them.',
  ].join('\n\n');
}
