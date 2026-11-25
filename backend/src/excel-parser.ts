import zlib from 'node:zlib';

export interface RawImportRow {
  rowNumber: number;
  employeeCode: string;
  fullName: string;
  hireDate: string;
  birthDate: string | null;
  phone: string | null;
  personalEmail: string | null;
  address: string | null;
  departmentCode: string | null;
  positionCode: string | null;
}

const employeeTemplateHeaders = [
  'Mã nhân viên (bắt buộc)*',
  'Họ và tên (bắt buộc)*',
  'Ngày vào làm (YYYY-MM-DD)*',
  'Ngày sinh (YYYY-MM-DD)',
  'Số điện thoại',
  'Email cá nhân',
  'Địa chỉ',
  'Mã phòng ban',
  'Mã chức danh',
];

const employeeTemplateGuide = [
  ['HƯỚNG DẪN NHẬP DANH SÁCH NHÂN VIÊN'],
  ['Nhập dữ liệu trong sheet Danh sách nhân viên từ dòng 2. Giữ nguyên tên và thứ tự các cột.'],
  [
    'Các cột có dấu * là bắt buộc. Ngày nhập theo YYYY-MM-DD; mã và số điện thoại được lưu dạng văn bản để giữ số 0 đầu.',
  ],
  ['Cột', 'Bắt buộc', 'Định dạng', 'Ví dụ', 'Ghi chú'],
  [
    'Mã nhân viên',
    'Có',
    'Chữ, số, dấu gạch dưới/chấm/gạch ngang',
    'NV001',
    'Không trùng trong tổ chức',
  ],
  ['Họ và tên', 'Có', 'Văn bản', 'Nguyễn Văn A', ''],
  ['Ngày vào làm', 'Có', 'YYYY-MM-DD', '2026-01-15', 'Không được ở tương lai'],
  ['Ngày sinh', 'Không', 'YYYY-MM-DD', '1995-06-20', 'Để trống nếu chưa có'],
  ['Số điện thoại', 'Không', 'Văn bản', '0912345678', 'Giữ số 0 ở đầu'],
  ['Email cá nhân', 'Không', 'Địa chỉ email', 'nhanvien@example.com', ''],
  ['Địa chỉ', 'Không', 'Văn bản', 'Hà Nội, Việt Nam', ''],
  ['Mã phòng ban', 'Không', 'Mã phòng ban đang hoạt động', 'PB_KT', 'Để trống nếu chưa phân công'],
  ['Mã chức danh', 'Không', 'Mã chức danh đang hoạt động', 'CD_DEV', 'Để trống nếu chưa phân công'],
];

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

  const centralDirectory = Buffer.concat(centralRecords);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(files.length, 8);
  endRecord.writeUInt16LE(files.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localRecords, centralDirectory, endRecord]);
}

function worksheetXml(
  rows: string[][],
  indexes: Map<string, number>,
  importSheet: boolean,
): string {
  const sheetRows = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, columnIndex) => {
          let column = columnIndex + 1;
          let columnName = '';
          while (column > 0) {
            const remainder = (column - 1) % 26;
            columnName = String.fromCharCode(65 + remainder) + columnName;
            column = Math.floor((column - 1) / 26);
          }
          return `<c r="${columnName}${rowIndex + 1}" t="s"><v>${indexes.get(value)}</v></c>`;
        })
        .join('');
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join('');
  const views = importSheet
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>'
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  const columns = importSheet
    ? '<cols><col min="1" max="9" width="24" customWidth="1" style="1"/></cols>'
    : '';
  const filter = importSheet ? '<autoFilter ref="A1:I1"/>' : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${views}<sheetFormatPr defaultRowHeight="15"/>${columns}<sheetData>${sheetRows}</sheetData>${filter}</worksheet>`;
}

export function generateEmployeeTemplate(employeeRows: string[][] = []): Buffer {
  const sheets = [
    {
      name: 'Danh sách nhân viên',
      rows: [employeeTemplateHeaders, ...employeeRows],
      importSheet: true,
    },
    { name: 'Hướng dẫn', rows: employeeTemplateGuide, importSheet: false },
  ];
  const strings = [...new Set(sheets.flatMap((sheet) => sheet.rows.flat()))];
  const indexes = new Map(strings.map((value, index) => [value, index]));
  const cellCount = sheets.reduce(
    (count, sheet) => count + sheet.rows.reduce((total, row) => total + row.length, 0),
    0,
  );
  const sharedStrings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${cellCount}" uniqueCount="${strings.length}">${strings.map((value) => `<si><t>${xmlEscape(value)}</t></si>`).join('')}</sst>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`;
  const workbookRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="0"/><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
  const rootRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  return createZip([
    ['[Content_Types].xml', contentTypes],
    ['_rels/.rels', rootRelationships],
    ['xl/workbook.xml', workbook],
    ['xl/_rels/workbook.xml.rels', workbookRelationships],
    ['xl/styles.xml', styles],
    ['xl/sharedStrings.xml', sharedStrings],
    ...sheets.map((sheet, index): [string, string] => [
      `xl/worksheets/sheet${index + 1}.xml`,
      worksheetXml(sheet.rows, indexes, sheet.importSheet),
    ]),
  ]);
}

export function parseCSV(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let insideQuotes = false;

  // Auto-detect delimiter from the first line
  const firstLine = clean.split(/\r\n|\r|\n/)[0] || '';
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const delimiter =
    tabCount > commaCount && tabCount > semicolonCount
      ? '\t'
      : semicolonCount > commaCount
        ? ';'
        : ',';

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    const nextChar = clean[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentField += '"';
        i++; // skip escaped quote
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === delimiter && !insideQuotes) {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !insideQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++; // handle \r\n
      }
      currentRow.push(currentField.trim());
      currentField = '';
      if (currentRow.some((c) => c.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
    } else {
      currentField += char;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((c) => c.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

// Simple PKZip reader for XLSX
export function extractFilesFromZip(buffer: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let offset = 0;

  while (offset + 30 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) break; // Local file header signature

    const compressionMethod = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraFieldLength = buffer.readUInt16LE(offset + 28);

    const fileName = buffer.toString('utf8', offset + 30, offset + 30 + fileNameLength);
    const dataOffset = offset + 30 + fileNameLength + extraFieldLength;

    if (dataOffset + compressedSize > buffer.length) break;

    const compressedData = buffer.subarray(dataOffset, dataOffset + compressedSize);
    let fileData: Buffer;

    if (compressionMethod === 0) {
      fileData = compressedData;
    } else if (compressionMethod === 8) {
      try {
        fileData = zlib.inflateRawSync(compressedData);
      } catch {
        // Fallback or skip corrupted stream
        fileData = Buffer.alloc(0);
      }
    } else {
      fileData = Buffer.alloc(0);
    }

    if (uncompressedSize === 0 || fileData.length > 0) {
      files.set(fileName, fileData);
    }

    offset = dataOffset + compressedSize;
  }

  return files;
}

export function parseXLSX(buffer: Buffer): string[][] {
  const zip = extractFilesFromZip(buffer);
  const sharedStringsXml = zip.get('xl/sharedStrings.xml')?.toString('utf8');
  const sheet1Xml = zip.get('xl/worksheets/sheet1.xml')?.toString('utf8');

  if (!sheet1Xml) {
    return [];
  }

  // Parse shared strings table
  const sharedStrings: string[] = [];
  if (sharedStringsXml) {
    const stringMatches = sharedStringsXml.matchAll(/<si>(.*?)<\/si>/gs);
    for (const match of stringMatches) {
      const textMatches = match[1].matchAll(/<t[^>]*>(.*?)<\/t>/gs);
      let text = '';
      for (const tm of textMatches) {
        text += tm[1];
      }
      sharedStrings.push(
        text
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"'),
      );
    }
  }

  // Parse worksheet rows
  const grid: string[][] = [];
  const rowMatches = sheet1Xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>(.*?)<\/row>/gs);

  for (const rMatch of rowMatches) {
    const rowContent = rMatch[2];
    const cells: string[] = [];
    const cellMatches = rowContent.matchAll(
      /<c[^>]*r="([A-Z]+)\d+"(?:[^>]*t="([^"]*)")?[^>]*>(?:<v>([^<]*)<\/v>)?<\/c>/gs,
    );

    for (const cMatch of cellMatches) {
      const colLetter = cMatch[1];
      const type = cMatch[2];
      const rawValue = cMatch[3] ?? '';

      // Convert column letters (A, B, C...) to index (0, 1, 2...)
      let colIndex = 0;
      for (let j = 0; j < colLetter.length; j++) {
        colIndex = colIndex * 26 + (colLetter.charCodeAt(j) - 64);
      }
      colIndex -= 1;

      let val = rawValue;
      if (type === 's' && rawValue !== '') {
        const idx = parseInt(rawValue, 10);
        val = sharedStrings[idx] ?? '';
      }

      while (cells.length < colIndex) {
        cells.push('');
      }
      cells[colIndex] = val.trim();
    }

    if (cells.some((c) => c.length > 0)) {
      grid.push(cells);
    }
  }

  return grid;
}

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

export function parseEmployeeImportFile(buffer: Buffer, declaredMime: string): RawImportRow[] {
  let grid: string[][] = [];

  const isZip = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (isZip || declaredMime.includes('spreadsheetml')) {
    grid = parseXLSX(buffer);
  }

  if (grid.length === 0) {
    const text = buffer.toString('utf8');
    grid = parseCSV(text);
  }

  if (grid.length < 2) {
    return [];
  }

  const rawHeaders = grid[0];
  const headerMap: Record<number, keyof RawImportRow> = {};

  rawHeaders.forEach((h, index) => {
    const norm = normalizeHeader(h);
    if (
      norm.includes('ma_nv') ||
      norm.includes('ma_nhan_vien') ||
      norm.includes('employee_code') ||
      norm === 'code'
    ) {
      headerMap[index] = 'employeeCode';
    } else if (
      norm.includes('ho_va_ten') ||
      norm.includes('ho_ten') ||
      norm.includes('full_name') ||
      norm === 'name'
    ) {
      headerMap[index] = 'fullName';
    } else if (norm.includes('ngay_vao_lam') || norm.includes('hire_date')) {
      headerMap[index] = 'hireDate';
    } else if (norm.includes('ngay_sinh') || norm.includes('birth_date') || norm === 'dob') {
      headerMap[index] = 'birthDate';
    } else if (norm.includes('dien_thoai') || norm.includes('phone') || norm.includes('sdt')) {
      headerMap[index] = 'phone';
    } else if (norm.includes('email') || norm.includes('personal_email')) {
      headerMap[index] = 'personalEmail';
    } else if (norm.includes('dia_chi') || norm.includes('address')) {
      headerMap[index] = 'address';
    } else if (norm.includes('phong_ban') || norm.includes('department')) {
      headerMap[index] = 'departmentCode';
    } else if (norm.includes('chuc_danh') || norm.includes('position')) {
      headerMap[index] = 'positionCode';
    }
  });

  // Default fallback if headers did not match names: positional fallback
  if (!Object.values(headerMap).includes('employeeCode') && rawHeaders.length >= 3) {
    headerMap[0] = 'employeeCode';
    headerMap[1] = 'fullName';
    headerMap[2] = 'hireDate';
    if (rawHeaders.length > 3) headerMap[3] = 'birthDate';
    if (rawHeaders.length > 4) headerMap[4] = 'phone';
    if (rawHeaders.length > 5) headerMap[5] = 'personalEmail';
    if (rawHeaders.length > 6) headerMap[6] = 'address';
    if (rawHeaders.length > 7) headerMap[7] = 'departmentCode';
    if (rawHeaders.length > 8) headerMap[8] = 'positionCode';
  }

  const result: RawImportRow[] = [];

  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    if (!row || !row.some((cell) => cell.length > 0)) continue;

    const item: RawImportRow = {
      rowNumber: r + 1,
      employeeCode: '',
      fullName: '',
      hireDate: '',
      birthDate: null,
      phone: null,
      personalEmail: null,
      address: null,
      departmentCode: null,
      positionCode: null,
    };

    row.forEach((val, idx) => {
      const field = headerMap[idx];
      if (field) {
        const cleanVal = val.trim();
        if (
          field === 'birthDate' ||
          field === 'phone' ||
          field === 'personalEmail' ||
          field === 'address' ||
          field === 'departmentCode' ||
          field === 'positionCode'
        ) {
          item[field] = cleanVal ? cleanVal : null;
        } else if (field === 'employeeCode' || field === 'fullName' || field === 'hireDate') {
          item[field] = cleanVal;
        }
      }
    });

    result.push(item);
  }

  return result;
}
