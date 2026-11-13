import { unzipSync } from 'fflate';

/**
 * Turns an attached file into something a model can read: an image it can look at, or text kept
 * in its natural parts (the rows of a sheet, the pages of a PDF, the lines of a document), so that
 * a large file can be read a part at a time instead of all at once.
 *
 * Office files are zip archives of XML, so their text is taken from the XML; PDFs go through
 * pdf.js. Anything else is described, not read.
 */

/** One row of a sheet: its row number in the file, and its cells. */
export interface Row {
  readonly n: number;
  readonly cells: readonly string[];
}

export interface Sheet {
  readonly name: string;
  readonly rows: readonly Row[];
  /** Rows with data in the file, also those past the limit read. */
  readonly totalRows: number;
}

/** What became of a file. */
export type FileContent =
  | { readonly kind: 'image'; readonly mimeType: string; readonly data: Uint8Array }
  | { readonly kind: 'sheets'; readonly from: string; readonly sheets: readonly Sheet[] }
  | {
      readonly kind: 'pages';
      readonly from: string;
      readonly unit: 'page' | 'slide';
      readonly pages: readonly string[];
      /** Pages in the file, also those past the limit read. */
      readonly totalPages: number;
    }
  | { readonly kind: 'lines'; readonly from: string; readonly lines: readonly string[] }
  | { readonly kind: 'unreadable'; readonly reason: string };

/** Images models take as they are. */
const IMAGES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/** Files that are text already: notes, logs, data, code. */
const TEXT = new Set(
  (
    'txt text md markdown log json jsonl xml yaml yml toml ini cfg conf env sql html htm css js mjs cjs ts tsx ' +
    'jsx py rb php java kt swift go rs c h cpp cs sh bash zsh ps1 bat gradle properties srt vtt diff patch har'
  ).split(' '),
);

/** Office files and what they hold. */
const OFFICE = { docx: 'Word document', xlsx: 'spreadsheet', pptx: 'presentation' } as const;

/** More than this unpacked from one archive is not a document but a trap. */
const UNZIPPED_MAX = 40 * 1024 * 1024;
const PDF_PAGES_MAX = 300;
/** Rows read from one sheet; beyond this a sheet is a database export, not something to read. */
const ROWS_MAX = 50_000;

const extension = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';

/** Read a file by its name, falling back to the type the server gave and to its first bytes. */
export async function readFile(name: string, bytes: Uint8Array, contentType?: string): Promise<FileContent> {
  const ext = extension(name);
  const type = contentType?.split(';')[0]?.trim().toLowerCase() ?? '';

  const image = IMAGES[ext] ?? (Object.values(IMAGES).includes(type) ? type : undefined) ?? sniffImage(bytes);
  if (image !== undefined) return { kind: 'image', mimeType: image, data: bytes };

  if (ext === 'pdf' || type === 'application/pdf' || startsWith(bytes, '%PDF')) return readPdf(bytes);
  if (ext in OFFICE) return readOffice(ext as keyof typeof OFFICE, bytes);
  if (ext === 'csv' || ext === 'tsv' || type === 'text/csv') {
    const text = decodeText(bytes);
    const separator =
      ext === 'tsv' || (!text.includes(',') && text.includes('\t')) ? '\t' : guessSeparator(text);
    return { kind: 'sheets', from: `${ext || 'csv'} table`, sheets: [csvSheet(name, text, separator)] };
  }
  if (TEXT.has(ext) || type.startsWith('text/') || type === 'application/json') {
    return { kind: 'lines', from: `text file (${ext || type})`, lines: splitLines(decodeText(bytes)) };
  }
  if (['doc', 'xls', 'ppt'].includes(ext)) {
    return {
      kind: 'unreadable',
      reason: `.${ext} is the old binary Office format, which this server cannot read. Saved as .${ext}x it can be read.`,
    };
  }
  // Text that came without a telling name: no NUL bytes and valid UTF-8 in the first part.
  if (looksLikeText(bytes)) return { kind: 'lines', from: 'text', lines: splitLines(decodeText(bytes)) };
  return {
    kind: 'unreadable',
    reason: `${ext ? `.${ext} files` : 'This kind of file'} cannot be read as text or as an image.`,
  };
}

function startsWith(bytes: Uint8Array, text: string): boolean {
  return [...text].every((char, i) => bytes[i] === char.charCodeAt(0));
}

function sniffImage(bytes: Uint8Array): string | undefined {
  if (bytes[0] === 0x89 && startsWith(bytes.subarray(1), 'PNG')) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (startsWith(bytes, 'GIF8')) return 'image/gif';
  if (startsWith(bytes, 'RIFF') && startsWith(bytes.subarray(8), 'WEBP')) return 'image/webp';
  return undefined;
}

function decodeText(bytes: Uint8Array): string {
  // A byte-order mark says UTF-16; everything else is read as UTF-8.
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  return new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
}

function looksLikeText(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 4096);
  if (head.includes(0)) return false;
  try {
    // A cut in the middle of a character at the very end is fine.
    new TextDecoder('utf-8', { fatal: true }).decode(head.subarray(0, Math.max(0, head.length - 4)));
    return true;
  } catch {
    return false;
  }
}

const splitLines = (text: string) => text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');

/* ----------------------------------- CSV ----------------------------------- */

/** Comma, unless semicolons are clearly what the first line is split by (as Excel saves in many countries). */
function guessSeparator(text: string): string {
  const first = text.slice(0, text.indexOf('\n') === -1 ? undefined : text.indexOf('\n'));
  return (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
}

/** RFC 4180: quoted fields may hold separators, quotes ("") and line breaks. */
export function csvSheet(name: string, text: string, separator = ','): Sheet {
  const rows: Row[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let n = 1;
  let total = 0;
  const endRow = () => {
    cells.push(cell);
    if (cells.some((c) => c.trim() !== '')) {
      total++;
      if (rows.length < ROWS_MAX) rows.push({ n, cells: cells.map((c) => c.replace(/\s+/g, ' ').trim()) });
    }
    cells = [];
    cell = '';
    n++;
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === separator) {
      cells.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else cell += char;
  }
  if (cell !== '' || cells.length > 0) endRow();
  return { name, rows, totalRows: total };
}

/* ----------------------------------- PDF ----------------------------------- */

async function readPdf(bytes: Uint8Array): Promise<FileContent> {
  try {
    // pdf.js is large: load it only when a PDF is read.
    const { extractText, getDocumentProxy } = await import('unpdf');
    // pdf.js may take ownership of the buffer it is given, so it gets a copy.
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    return {
      kind: 'pages',
      from: `PDF, ${totalPages} ${totalPages === 1 ? 'page' : 'pages'}`,
      unit: 'page',
      pages: text.slice(0, PDF_PAGES_MAX).map((page) => page.trim()),
      totalPages,
    };
  } catch (error) {
    return {
      kind: 'unreadable',
      reason: `The PDF could not be read (${error instanceof Error ? error.message : String(error)}).`,
    };
  }
}

/* ---------------------------------- Office ---------------------------------- */

function readOffice(ext: keyof typeof OFFICE, bytes: Uint8Array): FileContent {
  let files: Record<string, Uint8Array>;
  try {
    let unpacked = 0;
    files = unzipSync(bytes, {
      filter: (file) => {
        if (!wanted(ext, file.name)) return false;
        unpacked += file.originalSize;
        return unpacked <= UNZIPPED_MAX;
      },
    });
  } catch {
    return { kind: 'unreadable', reason: `The .${ext} file is damaged or is not really a .${ext} file.` };
  }
  const xml = (path: string) =>
    files[path] === undefined ? undefined : new TextDecoder().decode(files[path]);
  if (ext === 'docx') {
    const document = xml('word/document.xml');
    return document === undefined
      ? { kind: 'unreadable', reason: 'The .docx file has no document in it.' }
      : { kind: 'lines', from: 'Word document', lines: splitLines(docxText(document)) };
  }
  if (ext === 'xlsx') return xlsxSheets(xml);
  return pptxSlides(files);
}

function wanted(ext: keyof typeof OFFICE, path: string): boolean {
  if (ext === 'docx') return path === 'word/document.xml';
  if (ext === 'xlsx') {
    return (
      path === 'xl/workbook.xml' ||
      path === 'xl/_rels/workbook.xml.rels' ||
      path === 'xl/sharedStrings.xml' ||
      /^xl\/worksheets\/[^/]+\.xml$/.test(path)
    );
  }
  return /^ppt\/slides\/slide\d+\.xml$/.test(path);
}

/** XML text with its five entities and numeric references turned back into characters. */
export function unescapeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, code: string) => {
    const lower = code.toLowerCase();
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[lower] ?? whole;
  });
}

const tidy = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** Paragraphs become lines; a table row becomes one line with its cells split by " | ". */
export function docxText(xml: string): string {
  let out = '';
  let cellDepth = 0;
  const token = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>|<w:tc[\s>]|<\/w:tc>|<\/w:tr>|<\/w:p>/g;
  for (const match of xml.matchAll(token)) {
    const [whole, text] = match;
    if (text !== undefined) out += unescapeXml(text);
    else if (whole === '<w:tab/>') out += '\t';
    else if (whole === '<w:br/>') out += '\n';
    else if (whole.startsWith('<w:tc')) cellDepth++;
    else if (whole === '</w:tc>') {
      cellDepth--;
      out = `${out.trimEnd()} | `;
    } else if (whole === '</w:tr>') out = `${out.replace(/ \| $/, '')}\n`;
    // Inside a table cell a paragraph ends with a space, so the row stays on one line.
    else out += cellDepth > 0 ? ' ' : '\n';
  }
  return tidy(out);
}

/** "AB" → 27: the column of a cell reference, counted from 0. */
function columnOf(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  return [...letters].reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

const textRuns = (xml: string) =>
  [...xml.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map(([, t = '']) => t).join('');

function xlsxSheets(xml: (path: string) => string | undefined): FileContent {
  const workbook = xml('xl/workbook.xml');
  if (workbook === undefined) return { kind: 'unreadable', reason: 'The .xlsx file has no workbook in it.' };

  // Shared strings: each <si> is one string, possibly in several formatted runs.
  const shared = [...(xml('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(
    ([, si = '']) => unescapeXml(textRuns(si)),
  );
  const rels = new Map(
    [...(xml('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b[^>]*>/g)].map(([tag]) => [
      /\bId="([^"]+)"/.exec(tag)?.[1],
      /\bTarget="([^"]+)"/.exec(tag)?.[1]?.replace(/^\/?(xl\/)?/, 'xl/'),
    ]),
  );
  const sheets: Sheet[] = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map(([tag]) => {
    const name = unescapeXml(/\bname="([^"]*)"/.exec(tag)?.[1] ?? 'Sheet');
    const path = rels.get(/\br:id="([^"]+)"/.exec(tag)?.[1]);
    const sheet = path === undefined ? undefined : xml(path);
    const rows: Row[] = [];
    let total = 0;
    let n = 0;
    for (const [, attrs = '', cells = ''] of (sheet ?? '').matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      n = Number(/\br="(\d+)"/.exec(attrs)?.[1] ?? n + 1);
      const values: string[] = [];
      for (const [, cellAttrs = '', inner = ''] of cells.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /\br="([A-Z]+\d+)"/.exec(cellAttrs)?.[1];
        const type = /\bt="([^"]+)"/.exec(cellAttrs)?.[1];
        const raw = /<v>([^<]*)<\/v>/.exec(inner)?.[1];
        const value =
          type === 's'
            ? (shared[Number(raw)] ?? '')
            : type === 'inlineStr'
              ? unescapeXml(textRuns(inner))
              : type === 'b'
                ? raw === '1'
                  ? 'TRUE'
                  : 'FALSE'
                : unescapeXml(raw ?? '');
        values[ref === undefined ? values.length : columnOf(ref)] = value.replace(/\s+/g, ' ').trim();
      }
      const filled = Array.from(values, (value) => value ?? '');
      while (filled.length > 0 && filled.at(-1) === '') filled.pop();
      if (filled.length === 0) continue;
      total++;
      if (rows.length < ROWS_MAX) rows.push({ n, cells: filled });
    }
    return { name, rows, totalRows: total };
  });
  return {
    kind: 'sheets',
    from: `spreadsheet, ${sheets.length} ${sheets.length === 1 ? 'sheet' : 'sheets'}; formulas show their last value`,
    sheets,
  };
}

function pptxSlides(files: Record<string, Uint8Array>): FileContent {
  const slides = Object.keys(files)
    .map((path) => ({ path, n: Number(/slide(\d+)\.xml$/.exec(path)?.[1]) }))
    .sort((a, b) => a.n - b.n);
  if (slides.length === 0) return { kind: 'unreadable', reason: 'The .pptx file has no slides in it.' };
  const pages = slides.map(({ path }) => {
    const xml = new TextDecoder().decode(files[path]);
    let out = '';
    for (const [whole, t] of xml.matchAll(/<a:t>([^<]*)<\/a:t>|<\/a:p>/g)) {
      out += t === undefined ? (whole === '</a:p>' ? '\n' : '') : unescapeXml(t);
    }
    return tidy(out);
  });
  return {
    kind: 'pages',
    from: `presentation, ${slides.length} slides`,
    unit: 'slide',
    pages,
    totalPages: slides.length,
  };
}
