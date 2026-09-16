/**
 * Minimal, dependency-free writer for the Office Open XML (.xlsx) format.
 *
 * An .xlsx file is a ZIP archive holding a handful of XML parts. Only the
 * parts required for plain data sheets are emitted here, which keeps the
 * service free of a heavyweight spreadsheet dependency while still producing
 * a file Excel, Numbers, and LibreOffice open natively.
 */
import { deflateRawSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function escapeXml(value) {
  return (
    String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
      // XML-forbidden control characters and noncharacters would corrupt the file.
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
  );
}

/** Converts a zero-based column index into its spreadsheet letters (0 -> A). */
export function columnName(index) {
  let name = '';
  let remaining = index;
  do {
    name = String.fromCharCode(65 + (remaining % 26)) + name;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);
  return name;
}

/** Excel sheet names cannot exceed 31 chars or contain : \ / ? * [ ]. */
function sanitizeSheetName(name, fallback) {
  const cleaned = String(name ?? '')
    .replace(/[:\\/?*[\]]/g, ' ')
    .trim();
  return (cleaned || fallback).slice(0, 31);
}

function renderCell(reference, value) {
  if (value === null || value === undefined || value === '') return `<c r="${reference}"/>`;
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${reference}"><v>${value}</v></c>`;
  if (typeof value === 'boolean') return `<c r="${reference}" t="b"><v>${value ? 1 : 0}</v></c>`;
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function renderRow(values, rowNumber) {
  const cells = values.map((value, index) => renderCell(`${columnName(index)}${rowNumber}`, value)).join('');
  return `<row r="${rowNumber}">${cells}</row>`;
}

function renderSheet({ columns, rows }) {
  const header = renderRow(columns.map((column) => column.header ?? column.key), 1);
  const body = rows
    .map((row, index) => renderRow(columns.map((column) => row[column.key] ?? null), index + 2))
    .join('');

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>${header}${body}</sheetData></worksheet>`
  );
}

function zipEntry(name, contents, offset) {
  const nameBuffer = Buffer.from(name, 'utf8');
  const data = Buffer.from(contents, 'utf8');
  const compressed = deflateRawSync(data);
  const crc = crc32(data);

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4); // version needed to extract
  localHeader.writeUInt16LE(0, 6); // flags
  localHeader.writeUInt16LE(8, 8); // deflate
  localHeader.writeUInt16LE(0, 10); // modification time
  localHeader.writeUInt16LE(0x21, 12); // modification date (1980-01-01)
  localHeader.writeUInt32LE(crc, 14);
  localHeader.writeUInt32LE(compressed.length, 18);
  localHeader.writeUInt32LE(data.length, 22);
  localHeader.writeUInt16LE(nameBuffer.length, 26);
  localHeader.writeUInt16LE(0, 28); // extra field length

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4); // version made by
  centralHeader.writeUInt16LE(20, 6); // version needed to extract
  centralHeader.writeUInt16LE(0, 8);
  centralHeader.writeUInt16LE(8, 10);
  centralHeader.writeUInt16LE(0, 12);
  centralHeader.writeUInt16LE(0x21, 14);
  centralHeader.writeUInt32LE(crc, 16);
  centralHeader.writeUInt32LE(compressed.length, 20);
  centralHeader.writeUInt32LE(data.length, 24);
  centralHeader.writeUInt16LE(nameBuffer.length, 28);
  centralHeader.writeUInt16LE(0, 30); // extra field length
  centralHeader.writeUInt16LE(0, 32); // comment length
  centralHeader.writeUInt16LE(0, 34); // disk number
  centralHeader.writeUInt16LE(0, 36); // internal attributes
  centralHeader.writeUInt32LE(0, 38); // external attributes
  centralHeader.writeUInt32LE(offset, 42);

  return {
    local: Buffer.concat([localHeader, nameBuffer, compressed]),
    central: Buffer.concat([centralHeader, nameBuffer]),
  };
}

function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const [name, contents] of files) {
    const entry = zipEntry(name, contents, offset);
    locals.push(entry.local);
    centrals.push(entry.central);
    offset += entry.local.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // disk number
  end.writeUInt16LE(0, 6); // central directory start disk
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...locals, centralDirectory, end]);
}

/**
 * Builds an .xlsx workbook buffer.
 *
 * @param {{sheets: Array<{name?: string, columns: Array<{key: string, header?: string}>, rows?: object[]}>}} workbook
 * @returns {Buffer} the binary .xlsx document
 */
export function buildWorkbook({ sheets = [] } = {}) {
  if (sheets.length === 0) throw new TypeError('a workbook needs at least one sheet');

  const normalized = sheets.map((sheet, index) => {
    if (!Array.isArray(sheet.columns) || sheet.columns.length === 0) {
      throw new TypeError('each sheet needs at least one column');
    }

    return {
      name: sanitizeSheetName(sheet.name, `Sheet${index + 1}`),
      columns: sheet.columns,
      rows: sheet.rows ?? [],
    };
  });

  const sheetEntries = normalized.map((sheet, index) => [`xl/worksheets/sheet${index + 1}.xml`, renderSheet(sheet)]);

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    normalized
      .map(
        (_sheet, index) =>
          `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
      )
      .join('') +
    `</Types>`;

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const workbookXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
    normalized
      .map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
      .join('') +
    `</sheets></workbook>`;

  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    normalized
      .map(
        (_sheet, index) =>
          `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
      )
      .join('') +
    `</Relationships>`;

  return zip([
    ['[Content_Types].xml', contentTypes],
    ['_rels/.rels', rootRels],
    ['xl/workbook.xml', workbookXml],
    ['xl/_rels/workbook.xml.rels', workbookRels],
    ...sheetEntries,
  ]);
}

/** MIME type browsers and Excel associate with .xlsx downloads. */
export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
