import zlib from 'node:zlib';
import type { ReportExecutionResult, ResultColumn } from './report-builder-engine.js';

export type ExportFormat = 'CSV' | 'EXCEL' | 'PDF';

export interface GeneratedExportFile {
  fileName: string;
  contentType: string;
  buffer: Buffer;
  rowCount: number;
}

/**
 * Neutralize spreadsheet formula injection (=, +, -, @, tab, CR) before writing to CSV or XLSX.
 * Preserves numeric values when stored as actual numbers in XLSX, and prefixes string cells.
 */
export function sanitizeSpreadsheetText(raw: string): string {
  if (!raw) return '';
  if (/^[=+\-@\t\r]/.test(raw)) {
    return `'${raw}`;
  }
  return raw;
}

function formatCellValue(value: unknown, col: ResultColumn, locale: 'vi' | 'en'): string {
  if (value === null || value === undefined) return '';
  if (col.format === 'boolean') {
    const truthy = value === true || value === 'true';
    return locale === 'en' ? (truthy ? 'Yes' : 'No') : truthy ? 'Có' : 'Không';
  }
  if (col.format === 'percent' && typeof value === 'number') {
    return `${value.toLocaleString(locale === 'en' ? 'en-US' : 'vi-VN', {
      maximumFractionDigits: 2,
    })}%`;
  }
  if (col.format === 'currency') {
    const num = Number(value);
    if (Number.isFinite(num)) {
      return `${num.toLocaleString(locale === 'en' ? 'en-US' : 'vi-VN', {
        maximumFractionDigits: 2,
      })} VND`;
    }
  }
  if (col.format === 'number') {
    const num = Number(value);
    if (Number.isFinite(num)) {
      return num.toLocaleString(locale === 'en' ? 'en-US' : 'vi-VN', {
        maximumFractionDigits: 2,
      });
    }
  }
  if (col.format === 'date') {
    const raw = String(value);
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString(locale === 'en' ? 'en-US' : 'vi-VN');
    }
  }
  return String(value);
}

function escapeCsvCell(val: string): string {
  const safe = sanitizeSpreadsheetText(val);
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function safeFileSlug(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return slug || 'custom_report';
}

function buildFlatRowsForExport(
  result: ReportExecutionResult,
  locale: 'vi' | 'en',
): { headers: string[]; rows: Array<Array<string | number>>; totalRow?: Array<string | number> } {
  if (result.mode === 'PIVOT' && result.pivot) {
    const p = result.pivot;
    const headers: string[] = p.rowDimensions.map((d) => d.label);
    for (const pk of p.pivotKeys) {
      for (const m of p.measures) {
        headers.push(p.measures.length > 1 ? `${pk} · ${m.label}` : pk);
      }
    }
    for (const m of p.measures) {
      headers.push(
        p.measures.length > 1
          ? `${locale === 'en' ? 'Total' : 'Tổng'} · ${m.label}`
          : locale === 'en'
            ? 'Total'
            : 'Tổng cộng',
      );
    }

    const rows: Array<Array<string | number>> = p.rows.map((r) => {
      const line: Array<string | number> = p.rowDimensions.map((d) => r.dimensions[d.key] ?? '—');
      for (const pk of p.pivotKeys) {
        for (const m of p.measures) {
          line.push(r.cells[pk]?.[m.id] ?? 0);
        }
      }
      for (const m of p.measures) {
        line.push(r.rowTotals[m.id] ?? 0);
      }
      return line;
    });

    const totalRow: Array<string | number> = p.rowDimensions.map((_, idx) =>
      idx === 0 ? (locale === 'en' ? 'Grand Total' : 'Tổng cộng') : '',
    );
    for (const pk of p.pivotKeys) {
      for (const m of p.measures) {
        totalRow.push(p.columnTotals[pk]?.[m.id] ?? 0);
      }
    }
    for (const m of p.measures) {
      totalRow.push(p.grandTotals[m.id] ?? 0);
    }

    return { headers, rows, totalRow };
  }

  const headers = result.columns.map((c) => c.label);
  const rows = result.rows.map((row) =>
    result.columns.map((col) => {
      const raw = row[col.key];
      if (
        (col.dataType === 'number' || col.dataType === 'currency') &&
        raw !== null &&
        raw !== undefined &&
        raw !== '' &&
        Number.isFinite(Number(raw))
      ) {
        return Number(raw);
      }
      return formatCellValue(raw, col, locale);
    }),
  );

  let totalRow: Array<string | number> | undefined;
  if (result.totals && result.columns.length > 0) {
    totalRow = result.columns.map((col, idx) => {
      if (idx === 0 && result.totals?.[col.key] === undefined) {
        return locale === 'en' ? 'Grand Total' : 'Tổng cộng';
      }
      const val = result.totals?.[col.key];
      if (val === null || val === undefined) return '';
      return Number.isFinite(Number(val)) ? Number(val) : String(val);
    });
  }

  return { headers, rows, totalRow };
}

function generateCsvBuffer(
  reportName: string,
  result: ReportExecutionResult,
  locale: 'vi' | 'en',
): Buffer {
  const { headers, rows, totalRow } = buildFlatRowsForExport(result, locale);
  const lines: string[] = [];
  lines.push(escapeCsvCell(reportName));
  lines.push(
    escapeCsvCell(
      `${locale === 'en' ? 'Generated at' : 'Thời điểm xuất'}: ${new Date().toISOString()}`,
    ),
  );
  lines.push('');
  lines.push(headers.map(escapeCsvCell).join(','));

  for (const row of rows) {
    lines.push(
      row
        .map((cell, idx) => {
          if (typeof cell === 'number') {
            const col = result.columns[idx];
            return col ? escapeCsvCell(formatCellValue(cell, col, locale)) : String(cell);
          }
          return escapeCsvCell(String(cell));
        })
        .join(','),
    );
  }

  if (totalRow) {
    lines.push(
      totalRow
        .map((cell, idx) => {
          if (typeof cell === 'number') {
            const col = result.columns[idx];
            return col ? escapeCsvCell(formatCellValue(cell, col, locale)) : String(cell);
          }
          return escapeCsvCell(String(cell));
        })
        .join(','),
    );
  }

  return Buffer.from('\uFEFF' + lines.join('\r\n'), 'utf8');
}

const xmlEscape = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZip(files: Array<[string, string]>): Buffer {
  const localRecords: Buffer[] = [];
  const centralRecords: Buffer[] = [];
  let localOffset = 0;

  for (const [fileName, content] of files) {
    const name = Buffer.from(fileName, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const compressed = zlib.deflateRawSync(data);
    const checksum = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(0x0021, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localRecords.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0x0021, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralRecords.push(centralHeader, name);

    localOffset += localHeader.length + name.length + compressed.length;
  }

  const centralBuffer = Buffer.concat(centralRecords);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(files.length, 8);
  endRecord.writeUInt16LE(files.length, 10);
  endRecord.writeUInt32LE(centralBuffer.length, 12);
  endRecord.writeUInt32LE(localOffset, 16);

  return Buffer.concat([...localRecords, centralBuffer, endRecord]);
}

function columnLetters(index: number): string {
  let result = '';
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function buildXlsxRowXml(rowNum: number, values: Array<string | number>, styleId = 0): string {
  const cells = values
    .map((val, colIdx) => {
      const ref = `${columnLetters(colIdx)}${rowNum}`;
      if (typeof val === 'number' && Number.isFinite(val)) {
        return `<c r="${ref}" s="${styleId}"><v>${val}</v></c>`;
      }
      const safe = sanitizeSpreadsheetText(String(val ?? ''));
      return `<c r="${ref}" t="inlineStr" s="${styleId}"><is><t>${xmlEscape(safe)}</t></is></c>`;
    })
    .join('');
  return `<row r="${rowNum}">${cells}</row>`;
}

function generateExcelBuffer(
  reportName: string,
  result: ReportExecutionResult,
  locale: 'vi' | 'en',
): Buffer {
  const { headers, rows, totalRow } = buildFlatRowsForExport(result, locale);

  const sheetRows: string[] = [];
  sheetRows.push(buildXlsxRowXml(1, [reportName], 1));
  sheetRows.push(
    buildXlsxRowXml(
      2,
      [`${locale === 'en' ? 'Exported at' : 'Thời điểm xuất'}: ${new Date().toISOString()}`],
      0,
    ),
  );
  sheetRows.push(buildXlsxRowXml(4, headers, 1));

  let rowIdx = 5;
  for (const row of rows) {
    sheetRows.push(buildXlsxRowXml(rowIdx, row, 0));
    rowIdx++;
  }
  if (totalRow) {
    sheetRows.push(buildXlsxRowXml(rowIdx, totalRow, 1));
  }

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${sheetRows.join('')}</sheetData>
</worksheet>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="2">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
  </fills>
  <borders count="1"><border/></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/>
  </cellXfs>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  return createZip([
    ['[Content_Types].xml', contentTypesXml],
    ['_rels/.rels', rootRelsXml],
    ['xl/workbook.xml', workbookXml],
    ['xl/_rels/workbook.xml.rels', workbookRelsXml],
    ['xl/styles.xml', stylesXml],
    ['xl/worksheets/sheet1.xml', sheetXml],
  ]);
}

function pdfSafeText(text: string): string {
  const ascii = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^\x20-\x7E]/g, ' ');
  return ascii.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function generatePdfBuffer(
  reportName: string,
  result: ReportExecutionResult,
  locale: 'vi' | 'en',
): Buffer {
  const { headers, rows, totalRow } = buildFlatRowsForExport(result, locale);
  const maxCols = Math.min(headers.length, 8);
  const colHeaders = headers.slice(0, maxCols);

  const linesPerPage = 42;
  const formattedRows: string[] = [];

  const padCell = (val: unknown, width = 16) => {
    const s = String(val ?? '');
    return s.length > width ? s.slice(0, width - 2) + '..' : s.padEnd(width, ' ');
  };

  const colWidth = Math.max(10, Math.floor(105 / Math.max(1, maxCols)));
  formattedRows.push(colHeaders.map((h) => padCell(h, colWidth)).join(' | '));
  formattedRows.push('-'.repeat(Math.min(115, maxCols * (colWidth + 3))));

  for (const r of rows) {
    formattedRows.push(
      r
        .slice(0, maxCols)
        .map((c, i) => {
          const formatted =
            typeof c === 'number' && result.columns[i]
              ? formatCellValue(c, result.columns[i], locale)
              : String(c ?? '');
          return padCell(formatted, colWidth);
        })
        .join(' | '),
    );
  }
  if (totalRow) {
    formattedRows.push('-'.repeat(Math.min(115, maxCols * (colWidth + 3))));
    formattedRows.push(
      totalRow
        .slice(0, maxCols)
        .map((c, i) => {
          const formatted =
            typeof c === 'number' && result.columns[i]
              ? formatCellValue(c, result.columns[i], locale)
              : String(c ?? '');
          return padCell(formatted, colWidth);
        })
        .join(' | '),
    );
  }

  const pageChunks: string[][] = [];
  for (let i = 0; i < formattedRows.length; i += linesPerPage) {
    pageChunks.push(formattedRows.slice(i, i + linesPerPage));
  }
  if (pageChunks.length === 0) pageChunks.push(['(No records)']);

  // Build valid PDF 1.4 objects
  const objects: string[] = [];
  // 1: Catalog, 2: Pages, 3: Font (Courier for aligned columns), 4: Bold Font
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  const pageObjNums: number[] = [];
  const baseObjNum = 5;
  pageChunks.forEach((_, idx) => {
    pageObjNums.push(baseObjNum + idx * 2);
  });

  objects.push(
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageObjNums.length} >>\nendobj\n`,
  );
  objects.push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n');
  objects.push('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n');

  pageChunks.forEach((chunk, idx) => {
    const pageObj = baseObjNum + idx * 2;
    const contentObj = pageObj + 1;
    const streamLines: string[] = [];
    streamLines.push('BT');
    streamLines.push('/F2 13 Tf');
    streamLines.push('36 805 Td');
    streamLines.push(`(${pdfSafeText(reportName)}) Tj`);
    streamLines.push('/F1 8 Tf');
    streamLines.push('0 -16 Td');
    streamLines.push(
      `(${pdfSafeText(
        `ManagerHR Report Builder | Page ${idx + 1}/${pageChunks.length} | Rows: ${rows.length}`,
      )}) Tj`,
    );
    streamLines.push('0 -18 Td');
    for (const line of chunk) {
      streamLines.push(`(${pdfSafeText(line)}) Tj`);
      streamLines.push('0 -14 Td');
    }
    streamLines.push('ET');
    const streamContent = streamLines.join('\n');

    objects.push(
      `${pageObj} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObj} 0 R >>\nendobj\n`,
    );
    objects.push(
      `${contentObj} 0 obj\n<< /Length ${Buffer.byteLength(streamContent, 'utf8')} >>\nstream\n${streamContent}\nendstream\nendobj\n`,
    );
  });

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, 'utf8');
}

export function renderReportExport(
  reportName: string,
  format: ExportFormat,
  result: ReportExecutionResult,
  locale: 'vi' | 'en',
): GeneratedExportFile {
  const slug = safeFileSlug(reportName);
  const stamp = new Date().toISOString().slice(0, 10);
  const rowCount =
    result.mode === 'PIVOT' && result.pivot ? result.pivot.rows.length : result.rows.length;

  if (format === 'EXCEL') {
    return {
      fileName: `${slug}_${stamp}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: generateExcelBuffer(reportName, result, locale),
      rowCount,
    };
  }

  if (format === 'PDF') {
    return {
      fileName: `${slug}_${stamp}.pdf`,
      contentType: 'application/pdf',
      buffer: generatePdfBuffer(reportName, result, locale),
      rowCount,
    };
  }

  return {
    fileName: `${slug}_${stamp}.csv`,
    contentType: 'text/csv; charset=utf-8',
    buffer: generateCsvBuffer(reportName, result, locale),
    rowCount,
  };
}
