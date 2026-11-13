import { zipSync } from 'fflate';

/** Small files of each kind the server reads, made here so that no binary is committed. */

const encode = (text: string) => new TextEncoder().encode(text);

/** A PDF with one line of text on each page (ASCII only, standard Helvetica). */
export function pdfWith(pages: readonly string[]): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  pages.forEach((text, i) => {
    const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = out.length;
  out +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return encode(out);
}

/** A Word document: paragraphs, then a two-row table. */
export function docx(): Uint8Array {
  const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const cell = (text: string) => `<w:tc><w:tcPr/>${p(text)}</w:tc>`;
  const document =
    '<?xml version="1.0"?><w:document xmlns:w="w"><w:body>' +
    p('Release plan') +
    '<w:p><w:r><w:t>Step</w:t></w:r><w:r><w:tab/><w:t>one &amp; two</w:t></w:r></w:p>' +
    `<w:tbl><w:tr>${cell('Owner')}${cell('Date')}</w:tr><w:tr>${cell('Linh')}${cell('2026-03-12')}</w:tr></w:tbl>` +
    p('Chạy kiểm tra thanh toán') +
    '</w:body></w:document>';
  return zipSync({ 'word/document.xml': encode(document), '[Content_Types].xml': encode('<Types/>') });
}

/**
 * A workbook with two sheets. "Budget" has a gap in its columns (A and C), a gap in its rows
 * (1, 2, then 4), shared and inline strings, a number and a boolean.
 */
export function xlsx(extraRows = 0): Uint8Array {
  const workbook =
    '<workbook xmlns:r="r"><sheets>' +
    '<sheet name="Budget" sheetId="1" r:id="rId1"/><sheet name="Notes &amp; links" sheetId="2" r:id="rId2"/>' +
    '</sheets></workbook>';
  const rels =
    '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>';
  const shared =
    '<sst><si><t>Item</t></si><si><r><t>Cost</t></r><r><t> (VND)</t></r></si><si><t>Bank &lt;sandbox&gt;</t></si></sst>';
  const more = Array.from(
    { length: extraRows },
    (_, i) =>
      `<row r="${i + 5}"><c r="A${i + 5}" t="inlineStr"><is><t>Line ${i + 5}</t></is></c><c r="C${i + 5}"><v>${i}</v></c></row>`,
  ).join('');
  const sheet1 =
    '<worksheet><sheetData>' +
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
    '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>1500000</v></c></row>' +
    '<row r="3"><c r="A3"/></row>' +
    '<row r="4"><c r="A4" t="inlineStr"><is><t>Paid</t></is></c><c r="B4" t="b"><v>1</v></c></row>' +
    more +
    '</sheetData></worksheet>';
  const sheet2 =
    '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>See wiki</t></is></c></row></sheetData></worksheet>';
  return zipSync({
    'xl/workbook.xml': encode(workbook),
    'xl/_rels/workbook.xml.rels': encode(rels),
    'xl/sharedStrings.xml': encode(shared),
    'xl/worksheets/sheet1.xml': encode(sheet1),
    'xl/worksheets/sheet2.xml': encode(sheet2),
  });
}

/** A presentation whose slide files are numbered 2 and 10, to check they are put in order. */
export function pptx(): Uint8Array {
  const slide = (...paragraphs: string[]) =>
    `<p:sld><p:txBody>${paragraphs.map((text) => `<a:p><a:r><a:t>${text}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sld>`;
  return zipSync({
    'ppt/slides/slide10.xml': encode(slide('Next steps')),
    'ppt/slides/slide2.xml': encode(slide('Card payments', 'Q2 review')),
  });
}

/** The first bytes of a PNG: enough for the server to know it is one. */
export const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
]);
