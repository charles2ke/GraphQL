import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { inflateRawSync } from 'node:zlib';

import { createStore } from '../src/data/store.js';
import { loadDataset, datasetNames } from '../src/export/datasets.js';
import { createExportRouter } from '../src/export/router.js';
import { buildWorkbook, columnName, XLSX_CONTENT_TYPE } from '../src/export/xlsx.js';
import { createFinanceService } from '../src/services/financeService.js';

/** Reads the entries of a ZIP archive produced by the workbook writer. */
function readZip(buffer) {
  const entries = new Map();
  let offset = 0;

  while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString('utf8', offset + 30, offset + 30 + nameLength);
    const dataStart = offset + 30 + nameLength + extraLength;
    entries.set(name, inflateRawSync(buffer.subarray(dataStart, dataStart + compressedSize)).toString('utf8'));
    offset = dataStart + compressedSize;
  }

  return entries;
}

/** Minimal express-like harness so the router can be exercised without a port. */
async function callRouter(router, { path, query = {} }) {
  const headers = {};
  const response = {
    statusCode: 200,
    body: undefined,
    set(name, value) {
      headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.finish();
      return this;
    },
    send(payload) {
      this.body = payload;
      this.finish();
      return this;
    },
  };

  return new Promise((resolve, reject) => {
    response.finish = () => resolve({ status: response.statusCode, headers, body: response.body });
    router.handle({ method: 'GET', url: path, query, params: {} }, response, (error) =>
      error ? reject(error) : resolve({ status: 404, headers, body: undefined })
    );
  });
}

describe('xlsx writer', () => {
  it('names columns beyond Z', () => {
    assert.equal(columnName(0), 'A');
    assert.equal(columnName(25), 'Z');
    assert.equal(columnName(26), 'AA');
    assert.equal(columnName(27), 'AB');
  });

  it('produces a readable workbook with typed cells', () => {
    const buffer = buildWorkbook({
      sheets: [
        {
          name: 'Sheet [1]: data',
          columns: [
            { key: 'symbol', header: 'Symbol' },
            { key: 'quantity', header: 'Quantity' },
            { key: 'note', header: 'Note' },
          ],
          rows: [{ symbol: 'ACME', quantity: 12.5, note: 'buy & hold <fast>' }],
        },
      ],
    });

    assert.equal(buffer.readUInt32LE(0), 0x04034b50);

    const entries = readZip(buffer);
    assert.ok(entries.has('[Content_Types].xml'));
    assert.ok(entries.has('xl/workbook.xml'));

    const sheet = entries.get('xl/worksheets/sheet1.xml');
    assert.match(sheet, /<c r="A1" t="inlineStr"><is><t xml:space="preserve">Symbol<\/t>/);
    assert.match(sheet, /<c r="B2"><v>12.5<\/v><\/c>/);
    assert.match(sheet, /buy &amp; hold &lt;fast&gt;/);
    // Illegal sheet-name characters are stripped.
    assert.match(entries.get('xl/workbook.xml'), /name="Sheet  1   data"/);
  });

  it('writes empty cells for missing values', () => {
    const entries = readZip(
      buildWorkbook({ sheets: [{ columns: [{ key: 'a' }, { key: 'b' }], rows: [{ a: 'x' }] }] })
    );

    assert.match(entries.get('xl/worksheets/sheet1.xml'), /<c r="B2"\/>/);
  });

  it('removes XML-forbidden noncharacters from strings', () => {
    const entries = readZip(
      buildWorkbook({ sheets: [{ columns: [{ key: 'a' }], rows: [{ a: 'bad\ufffegap\uffffend' }] }] })
    );

    const sheet = entries.get('xl/worksheets/sheet1.xml');
    assert.match(sheet, /badgapend/);
    assert.doesNotMatch(sheet, /\ufffe|\uffff/);
  });

  it('rejects workbooks without sheets or columns', () => {
    assert.throws(() => buildWorkbook({ sheets: [] }), TypeError);
    assert.throws(() => buildWorkbook({ sheets: [{ columns: [] }] }), TypeError);
  });
});

describe('export datasets', () => {
  let store;
  let finance;

  beforeEach(() => {
    store = createStore();
    finance = createFinanceService();
  });

  it('exposes the expected dataset names', () => {
    assert.deepEqual(datasetNames, ['users', 'posts', 'portfolio', 'trades', 'tax-estimate']);
  });

  it('exports users with their post counts', async () => {
    const { sheets } = await loadDataset('users', {}, { store, finance });

    assert.equal(sheets.length, 1);
    assert.equal(sheets[0].rows.length, 2);
    assert.equal(sheets[0].rows[0].postCount, 1);
  });

  it('exports posts with the resolved author name', async () => {
    const { sheets } = await loadDataset('posts', {}, { store, finance });

    assert.equal(sheets[0].rows[0].authorName, 'Ada Lovelace');
  });

  it('exports portfolio, trade, and tax data', async () => {
    const portfolio = await loadDataset('portfolio', {}, { store, finance });
    const trades = await loadDataset('trades', { limit: '1' }, { store, finance });
    const tax = await loadDataset('tax-estimate', { taxYear: '2024' }, { store, finance });

    assert.deepEqual(portfolio.sheets.map((sheet) => sheet.name), ['Accounts', 'Positions', 'Performance']);
    assert.equal(trades.sheets[0].rows.length, 1);
    assert.deepEqual(tax.sheets.map((sheet) => sheet.name), ['Summary', 'Tax Events']);
    assert.equal(tax.sheets[0].rows[0].taxYear, 2024);
  });

  it('requires a tax year for the tax estimate export', async () => {
    await assert.rejects(() => loadDataset('tax-estimate', {}, { store, finance }), /taxYear/);
  });

  it('rejects invalid finance query parameters before loading data', async () => {
    const calls = [];
    finance = {
      portfolioOverview: async () => {
        calls.push('portfolio');
      },
      tradeHistory: async () => {
        calls.push('trades');
      },
      taxEstimate: async () => {
        calls.push('tax');
      },
    };

    await assert.rejects(() => loadDataset('trades', { limit: 'abc' }, { store, finance }), { statusCode: 400 });
    await assert.rejects(() => loadDataset('trades', { limit: '2.5' }, { store, finance }), { statusCode: 400 });
    await assert.rejects(() => loadDataset('trades', { offset: '-1' }, { store, finance }), { statusCode: 400 });
    await assert.rejects(() => loadDataset('portfolio', { from: 'not-a-date' }, { store, finance }), { statusCode: 400 });
    await assert.rejects(() => loadDataset('tax-estimate', { taxYear: '2024x' }, { store, finance }), { statusCode: 400 });

    assert.deepEqual(calls, []);
  });

  it('rejects unknown datasets', async () => {
    await assert.rejects(() => loadDataset('nope', {}, { store, finance }), (error) => {
      assert.equal(error.statusCode, 404);
      return true;
    });
  });
});

describe('export router', () => {
  let router;

  beforeEach(() => {
    router = createExportRouter({ store: createStore(), finance: createFinanceService() });
  });

  it('lists available datasets', async () => {
    const response = await callRouter(router, { path: '/' });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { datasets: datasetNames, format: 'xlsx' });
  });

  it('downloads a workbook for a dataset', async () => {
    const response = await callRouter(router, { path: '/users.xlsx' });

    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], XLSX_CONTENT_TYPE);
    assert.equal(response.headers['content-disposition'], 'attachment; filename="users.xlsx"');
    assert.match(readZip(response.body).get('xl/worksheets/sheet1.xml'), /Ada Lovelace/);
  });

  it('rejects invalid query parameters and oversized exports', async () => {
    const invalidLimit = await callRouter(router, { path: '/trades', query: { limit: 'abc' } });
    const tinyRouter = createExportRouter({ store: createStore(), finance: createFinanceService(), maxExportRows: 1 });
    const tooLarge = await callRouter(tinyRouter, { path: '/users' });

    assert.equal(invalidLimit.status, 400);
    assert.match(invalidLimit.body.error, /limit/);
    assert.equal(tooLarge.status, 413);
    assert.match(tooLarge.body.error, /exceeds the limit/);
  });

  it('returns 404 for unknown datasets and 400 for missing parameters', async () => {
    const unknown = await callRouter(router, { path: '/unknown' });
    const missingYear = await callRouter(router, { path: '/tax-estimate' });

    assert.equal(unknown.status, 404);
    assert.deepEqual(unknown.body.datasets, datasetNames);
    assert.equal(missingYear.status, 400);
    assert.match(missingYear.body.error, /taxYear/);
  });
});
