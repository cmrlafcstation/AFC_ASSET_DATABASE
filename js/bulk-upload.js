// ------------------------------------------------------------------
// Bulk Excel/CSV upload for AG/NCMC/QR asset pages - ADD NEW ASSETS
// ONLY. It never updates or overwrites an existing row; see
// bulkImportAssets_ in Code.gs for the server-side half of this.
//
// Requires asset-page.js to already be loaded (uses its global
// SYSTEM_CONFIG / allFields() / ITEM_LABEL_PLURAL / loadList()) and
// the SheetJS library (loaded via CDN in the page's <head>) to parse
// .xlsx/.xls/.csv files entirely in the browser - the file itself
// never goes anywhere except straight into plain JSON rows POSTed to
// the same Apps Script Web App every other action already uses.
//
// Wire-up: call initBulkUpload() once the page has a button with
// id="bulk-upload-btn" in its markup (see ag.html/ncmc.html/qr.html).
// ------------------------------------------------------------------

function initBulkUpload() {
  const btn = document.getElementById('bulk-upload-btn');
  if (!btn) return;
  btn.addEventListener('click', openBulkUploadModal);
}

function templateColumns() {
  // AssetID first (optional - leave blank in the file to auto-generate),
  // then every field this system's Add/Edit form knows about. LastUpdated
  // is deliberately excluded - it's always stamped by the server.
  return ['AssetID', ...allFields().map((f) => f.name)];
}

function csvCell(val) {
  const s = String(val === undefined || val === null ? '' : val);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function downloadBulkUploadTemplate() {
  const cols = templateColumns();
  const csv = cols.map(csvCell).join(',') + '\r\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${SYSTEM_CONFIG.key}_upload_template.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function openBulkUploadModal() {
  openModal(`
    <h2>Upload Excel &mdash; Add New ${ITEM_LABEL_PLURAL}</h2>
    <p class="text-muted small" style="margin-top:-10px;">
      This only <strong>adds new</strong> ${ITEM_LABEL_PLURAL.toLowerCase()} — it never updates or
      overwrites an existing one. Leave the Asset ID column blank to
      auto-generate IDs, or set your own (rejected if it already exists).
      Column headers must match the template; unrecognized columns are
      ignored, missing ones are left blank. Max 500 rows per upload.
    </p>
    <p class="small"><span class="link-btn" style="margin:0;" onclick="downloadBulkUploadTemplate()">&darr; Download template (.csv)</span></p>
    <div class="form-field full">
      <label>Excel / CSV file (.xlsx, .xls or .csv)</label>
      <input type="file" id="bulk-upload-file" accept=".xlsx,.xls,.csv" />
    </div>
    <div id="bulk-upload-result" class="small" style="margin-top:10px;"></div>
    <div class="modal-actions">
      <button class="btn secondary" onclick="closeModal()">Close</button>
      <button class="btn" id="bulk-upload-submit-btn">Upload</button>
    </div>
  `);
  document.getElementById('bulk-upload-submit-btn').addEventListener('click', submitBulkUpload);
}

function parseWorkbookFile(file) {
  return new Promise((resolve, reject) => {
    if (typeof XLSX === 'undefined') {
      reject(new Error('The Excel parser library did not load - check your internet connection and try again.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        // raw:false keeps values as their displayed text (so IDs like
        // "007" or "MID0012" don't get silently turned into numbers).
        const wb = XLSX.read(data, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })
          .map((row) => {
            const clean = {};
            Object.keys(row).forEach((k) => {
              clean[k.trim()] = typeof row[k] === 'string' ? row[k].trim() : row[k];
            });
            return clean;
          })
          .filter((row) => Object.values(row).some((v) => v !== ''));
        resolve(rows);
      } catch (err) {
        reject(new Error('Could not parse this file - make sure it is a valid .xlsx, .xls or .csv file.'));
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

async function submitBulkUpload() {
  const fileInput = document.getElementById('bulk-upload-file');
  const resultEl = document.getElementById('bulk-upload-result');
  const btn = document.getElementById('bulk-upload-submit-btn');
  const file = fileInput.files[0];
  if (!file) {
    resultEl.innerHTML = '<span class="text-danger">Choose a file first.</span>';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Reading file...';
  resultEl.textContent = '';

  try {
    const rows = await parseWorkbookFile(file);
    if (!rows.length) throw new Error('No data rows found in the file.');
    if (rows.length > 500) throw new Error(`This file has ${rows.length} rows - please split it into batches of 500 or fewer.`);

    btn.textContent = `Uploading ${rows.length} row(s)...`;
    const result = await Api.bulkImport(SYSTEM_CONFIG.key, rows);

    let summary = `<strong>${result.added} of ${result.total} added.</strong>`;
    if (result.errors && result.errors.length) {
      summary += `<div style="margin-top:8px; max-height:160px; overflow:auto;">`;
      summary += result.errors.map((e) => `<div class="text-danger">${escapeHtml(e)}</div>`).join('');
      summary += `</div>`;
    }
    resultEl.innerHTML = summary;
    toast(`${result.added} ${ITEM_LABEL_PLURAL.toLowerCase()} added`, result.added ? 'success' : 'error');
    if (result.added) loadList();
  } catch (err) {
    resultEl.innerHTML = `<span class="text-danger">${escapeHtml(err.message)}</span>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Upload';
  }
}

initBulkUpload();
