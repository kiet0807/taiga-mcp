import { describe, expect, it } from 'vitest';
import { csvSheet, readFile, type FileContent } from '../src/taiga/files.js';
import { BUDGET, parseRange, view } from '../src/tools/file-view.js';
import { docx, pdfWith, PNG, pptx, xlsx } from './fake-files.js';

const text = (value: string) => new TextEncoder().encode(value);

type Readable = Exclude<FileContent, { kind: 'image' } | { kind: 'unreadable' }>;
const readable = (content: FileContent): Readable => {
  if (content.kind === 'image' || content.kind === 'unreadable') throw new Error(`not text: ${content.kind}`);
  return content;
};

describe('reading a file', () => {
  it('passes images on as they are, also without a telling name', async () => {
    expect(await readFile('screen.PNG', PNG)).toEqual({ kind: 'image', mimeType: 'image/png', data: PNG });
    expect(await readFile('upload', PNG)).toMatchObject({ kind: 'image', mimeType: 'image/png' });
  });

  it('reads a PDF page by page', async () => {
    const pdf = await readFile('plan.pdf', pdfWith(['Retry plan', 'Rollback: revert the tag']));
    expect(pdf).toEqual({
      kind: 'pages',
      from: 'PDF, 2 pages',
      unit: 'page',
      pages: ['Retry plan', 'Rollback: revert the tag'],
      totalPages: 2,
    });
  });

  it('says so when a PDF is damaged', async () => {
    const broken = await readFile('broken.pdf', text('%PDF-1.4\nnot really'));
    expect(broken.kind).toBe('unreadable');
  });

  it('reads a Word document as lines, a table row on one line', async () => {
    const document = readable(await readFile('plan.docx', docx()));
    expect(document).toEqual({
      kind: 'lines',
      from: 'Word document',
      lines: [
        'Release plan',
        'Step\tone & two',
        'Owner | Date',
        'Linh | 2026-03-12',
        'Chạy kiểm tra thanh toán',
      ],
    });
  });

  it('reads a workbook as sheets of numbered rows, keeping empty columns in place', async () => {
    const book = readable(await readFile('budget.xlsx', xlsx()));
    expect(book).toEqual({
      kind: 'sheets',
      from: 'spreadsheet, 2 sheets; formulas show their last value',
      sheets: [
        {
          name: 'Budget',
          totalRows: 3,
          rows: [
            { n: 1, cells: ['Item', '', 'Cost (VND)'] },
            { n: 2, cells: ['Bank <sandbox>', '', '1500000'] },
            { n: 4, cells: ['Paid', 'TRUE'] },
          ],
        },
        { name: 'Notes & links', totalRows: 1, rows: [{ n: 1, cells: ['See wiki'] }] },
      ],
    });
  });

  it('reads the slides of a presentation in order', async () => {
    expect(await readFile('review.pptx', pptx())).toEqual({
      kind: 'pages',
      from: 'presentation, 2 slides',
      unit: 'slide',
      pages: ['Card payments\nQ2 review', 'Next steps'],
      totalPages: 2,
    });
  });

  it('says so when an Office file is not really one', async () => {
    expect(await readFile('fake.xlsx', text('hello'))).toEqual({
      kind: 'unreadable',
      reason: 'The .xlsx file is damaged or is not really a .xlsx file.',
    });
  });

  it('reads CSV with quoted separators, quotes and line breaks, and semicolons when Excel used them', async () => {
    const csv = csvSheet('t.csv', 'name,note\n"Linh, Tran","said ""ok""\non two lines"\n\n,\nKiet,done\n');
    expect(csv).toEqual({
      name: 't.csv',
      totalRows: 3,
      rows: [
        { n: 1, cells: ['name', 'note'] },
        { n: 2, cells: ['Linh, Tran', 'said "ok" on two lines'] },
        { n: 5, cells: ['Kiet', 'done'] },
      ],
    });
    const semicolons = readable(await readFile('export.csv', text('a;b\n1,5;2\n')));
    expect(semicolons).toMatchObject({
      kind: 'sheets',
      sheets: [{ rows: [{ cells: ['a', 'b'] }, { cells: ['1,5', '2'] }] }],
    });
  });

  it('reads text files, and text without a telling name, as lines', async () => {
    expect(await readFile('query.sql', text('SELECT 1;\r\nSELECT 2;\n'))).toEqual({
      kind: 'lines',
      from: 'text file (sql)',
      lines: ['SELECT 1;', 'SELECT 2;'],
    });
    expect(await readFile('README', text('plain words'))).toMatchObject({
      kind: 'lines',
      lines: ['plain words'],
    });
  });

  it('explains what it cannot read', async () => {
    expect(await readFile('old.xls', text('x'))).toMatchObject({
      kind: 'unreadable',
      reason: /old binary Office format/,
    });
    expect(await readFile('archive.zip', new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0xff]))).toMatchObject({
      kind: 'unreadable',
      reason: '.zip files cannot be read as text or as an image.',
    });
  });
});

describe('showing part of a file', () => {
  it('reads ranges like "120-300", "5" and "40-", and refuses the rest', () => {
    expect(parseRange('120-300', 'rows')).toEqual({ from: 120, to: 300 });
    expect(parseRange(' 5 ', 'rows')).toEqual({ from: 5, to: 5 });
    expect(parseRange('40-', 'pages')).toEqual({ from: 40, to: Number.POSITIVE_INFINITY });
    expect(() => parseRange('all', 'rows')).toThrow(
      '`rows` takes numbers like "120-300", "5" or "40-"; not "all".',
    );
    expect(() => parseRange('9-3', 'rows')).toThrow(/not a range/);
  });

  it('shows a small workbook whole', async () => {
    const answer = view(readable(await readFile('b.xlsx', xlsx())), {});
    expect(answer).toBe(
      [
        'Read as: spreadsheet, 2 sheets; formulas show their last value. Each line is "row number: cells split by |".',
        '',
        '=== Sheet "Budget" ===',
        '1: Item |  | Cost (VND)',
        '2: Bank <sandbox> |  | 1500000',
        '4: Paid | TRUE',
        '',
        '=== Sheet "Notes & links" ===',
        '1: See wiki',
      ].join('\n'),
    );
  });

  describe('a large workbook', () => {
    const big = async () => readable(await readFile('big.xlsx', xlsx(3000)));

    it('comes as an overview first, within the budget', async () => {
      const answer = view(await big(), {});
      expect(answer.length).toBeLessThan(BUDGET);
      expect(answer).toContain('Too large to show at once');
      expect(answer).toContain('=== Sheet "Budget": 3003 rows with data, up to 3 columns ===');
      expect(answer).toContain('5: Line 5 |  | 0');
      expect(answer).toContain('… 2993 more rows');
      expect(answer).not.toContain('Line 100 ');
      expect(answer).toMatch(/`sheet` with `rows`.*`find`/);
    });

    it('shows the rows asked for, with the header above them', async () => {
      const answer = view(await big(), { sheet: 'budget', rows: '100-102' });
      expect(answer.split('\n\n')[1]).toBe(
        [
          '(header) 1: Item |  | Cost (VND)',
          '100: Line 100 |  | 95',
          '101: Line 101 |  | 96',
          '102: Line 102 |  | 97',
        ].join('\n'),
      );
      expect(answer).not.toContain('Continue with');
    });

    it('stops at the budget and says where to go on', async () => {
      const answer = view(await big(), { sheet: '1', rows: '5-' });
      expect(answer.length).toBeLessThan(BUDGET + 500);
      expect(answer).toMatch(/Continue with `rows`: "\d+-3004"\./);
    });

    it('finds rows by their words, whatever the case and accents', async () => {
      const answer = view(await big(), { find: 'line 2999' });
      // Row 3004 holds the number 2999 in its last cell, so it matches too.
      expect(answer).toContain('Rows containing "line 2999": 2.');
      expect(answer).toContain('"Budget" 3004: Line 3004 |  | 2999');
      expect(answer).toContain('"Budget" 2999: Line 2999 |  | 2994');
    });

    it('needs a sheet for rows when there are several, and names the sheets', async () => {
      expect(() => view(xlsxContent, { rows: '1-5' })).toThrow(
        'The file has 2 sheets: name one with `sheet` ("Budget", "Notes & links").',
      );
      expect(() => view(xlsxContent, { sheet: 'Sheet9' })).toThrow(
        'No sheet "Sheet9". Sheets: 1. "Budget", 2. "Notes & links".',
      );
    });
  });

  it('shows the pages asked for, or the lines with the words', async () => {
    const pdf = readable(
      await readFile('p.pdf', pdfWith(['Intro', 'Retry plan', 'Rollback: revert the tag'])),
    );
    expect(view(pdf, { pages: '2-3' })).toBe(
      'Read as: PDF, 3 pages.\nPages 2 to 3.\n\n--- Page 2 ---\nRetry plan\n--- Page 3 ---\nRollback: revert the tag',
    );
    expect(view(pdf, { find: 'REVERT' })).toContain('Page 3: Rollback: revert the tag');
    expect(() => view(pdf, { pages: '7' })).toThrow('The file has 3 pages.');
    expect(() => view(pdf, { rows: '1-2', sheet: 'x' })).toThrow(/`sheet` is for spreadsheets/);
  });

  it('shows a large PDF as the first line of each page, then page 1', () => {
    const pages = Array.from({ length: 40 }, (_, i) => `Chapter ${i + 1}\n${'word '.repeat(200)}`);
    const answer = view({ kind: 'pages', from: 'PDF, 40 pages', unit: 'page', pages, totalPages: 40 }, {});
    expect(answer).toContain('Page 40: Chapter 40');
    expect(answer).toContain('--- Page 1 ---\nChapter 1');
    expect(answer).toMatch(/`pages` \(e\.g\. "2-6"\)/);
    expect(answer.length).toBeLessThan(BUDGET);
  });

  it('shows the lines of a large text in numbered parts', () => {
    const lines = Array.from({ length: 5000 }, (_, i) => `${i + 1} thanh toán ${'x'.repeat(30)}`);
    const content = { kind: 'lines', from: 'text file (log)', lines } as const;
    const overview = view(content, {});
    expect(overview).toContain('these are the first 60 lines, numbered');
    expect(view(content, { rows: '4000-4001' })).toContain(`4000: 4000 thanh toán`);
    expect(view(content, { find: 'thanh toan 4999' })).toContain('Lines containing "thanh toan 4999": 1.');
  });

  it('cuts a single very long line rather than blowing the budget', () => {
    const answer = view({ kind: 'lines', from: 'text', lines: ['y'.repeat(50_000)] }, {});
    expect(answer.length).toBeLessThan(BUDGET);
  });
});

const xlsxContent = readable(await readFile('b.xlsx', xlsx()));
