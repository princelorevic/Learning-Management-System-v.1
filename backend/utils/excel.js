// ============================================================
// Excel export helper
// Builds a formatted .xlsx workbook from column definitions +
// row data, and streams it straight to the HTTP response.
// ============================================================
const ExcelJS = require('exceljs');

/**
 * @param {import('express').Response} res
 * @param {string} filename - without extension
 * @param {string} sheetName
 * @param {Array<{header: string, key: string, width?: number}>} columns
 * @param {Array<object>} rows
 */
async function sendExcelReport(res, filename, sheetName, columns, rows) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Enterprise LMS';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width || 22 }));

  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
  sheet.getRow(1).alignment = { vertical: 'middle' };

  rows.forEach((row) => sheet.addRow(row));

  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } }
      };
    });
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);

  await workbook.xlsx.write(res);
  res.end();
}

module.exports = { sendExcelReport };
