// ------------------------------------------------------------------
// Shared Excel export helper (SheetJS) - powers every "Download
// Excel"/"Download Report" button across the site. Requires the
// SheetJS CDN <script> to already be loaded on the page (same one
// bulk-upload.js uses for reading files, used here to write them).
// ------------------------------------------------------------------

function timestampForFilename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

// columns: [{ key, label }]; rows: array of plain objects keyed by `key`.
function rowsToSheet(rows, columns) {
  const aoa = [columns.map((c) => c.label)];
  rows.forEach((r) => {
    aoa.push(columns.map((c) => {
      const v = r[c.key];
      return v === undefined || v === null ? '' : v;
    }));
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Reasonable default column widths so the file doesn't open with
  // every column squeezed to fit its header text.
  ws['!cols'] = columns.map((c) => ({ wch: Math.max(12, c.label.length + 2) }));
  return ws;
}

// sheets: [{ name, rows, columns }]
function downloadWorkbook(sheets, filenamePrefix) {
  if (typeof XLSX === 'undefined') {
    toast('The Excel export library did not load - check your internet connection and try again.', 'error');
    return false;
  }
  const wb = XLSX.utils.book_new();
  sheets.forEach((s) => {
    const ws = rowsToSheet(s.rows, s.columns);
    // Sheet names are capped at 31 characters and can't contain []:*?/\
    const safeName = s.name.replace(/[\[\]:*?/\\]/g, ' ').slice(0, 31) || 'Sheet';
    XLSX.utils.book_append_sheet(wb, ws, safeName);
  });
  XLSX.writeFile(wb, `${filenamePrefix}_${timestampForFilename()}.xlsx`);
  return true;
}

// Single-sheet convenience wrapper for the per-system list pages.
function exportRowsToExcel(rows, columns, sheetName, filenamePrefix) {
  return downloadWorkbook([{ name: sheetName, rows, columns }], filenamePrefix);
}
