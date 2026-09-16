import express from 'express';

import { loadDataset, datasetNames } from './datasets.js';
import { buildWorkbook, XLSX_CONTENT_TYPE } from './xlsx.js';

const ERROR_COLUMNS = [
  { key: 'source', header: 'Source' },
  { key: 'code', header: 'Code' },
  { key: 'category', header: 'Category' },
  { key: 'status', header: 'Status' },
  { key: 'retryable', header: 'Retryable' },
  { key: 'message', header: 'Message' },
];
const DEFAULT_MAX_EXPORT_ROWS = 10000;

function countRows(sheets) {
  return sheets.reduce((total, sheet) => total + (sheet.rows?.length ?? 0), 0);
}

/**
 * Express router exposing spreadsheet downloads.
 *
 * `GET /export` lists the datasets, `GET /export/:dataset(.xlsx)` streams the
 * workbook. Finance datasets accept the same filter/pagination query
 * parameters as their GraphQL counterparts.
 */
export function createExportRouter({ store, finance, logger, maxExportRows = DEFAULT_MAX_EXPORT_ROWS } = {}) {
  const router = express.Router();

  router.get('/', (_req, res) => {
    res.json({ datasets: datasetNames, format: 'xlsx' });
  });

  router.get('/:dataset', async (req, res) => {
    // Accept both /export/users and /export/users.xlsx.
    const name = req.params.dataset.replace(/\.xlsx$/i, '');

    try {
      const { filename, sheets, errors = [] } = await loadDataset(name, req.query, { store, finance });
      // Partial finance results carry upstream errors; surface them in the
      // workbook instead of silently shipping incomplete data.
      const allSheets = errors.length > 0 ? [...sheets, { name: 'Errors', columns: ERROR_COLUMNS, rows: errors }] : sheets;
      const rowCount = countRows(allSheets);
      if (rowCount > maxExportRows) {
        throw Object.assign(new Error(`export contains ${rowCount} rows, which exceeds the limit of ${maxExportRows}`), { statusCode: 413 });
      }
      const workbook = buildWorkbook({ sheets: allSheets });

      res.set('content-type', XLSX_CONTENT_TYPE);
      res.set('content-disposition', `attachment; filename="${filename}.xlsx"`);
      res.set('content-length', String(workbook.length));
      res.send(workbook);
    } catch (error) {
      const statusCode = error?.statusCode ?? 500;
      if (statusCode >= 500) {
        logger?.error('export failed', { dataset: name, error: error?.message ?? String(error) });
      }
      res.status(statusCode).json({
        error: statusCode >= 500 ? 'export failed' : error.message,
        ...(error?.datasets ? { datasets: error.datasets } : {}),
      });
    }
  });

  return router;
}
