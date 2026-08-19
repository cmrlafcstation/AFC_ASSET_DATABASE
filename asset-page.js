// ------------------------------------------------------------------
// Generic list + CRUD engine, driven by a page's SYSTEM_CONFIG.
// Used by ag.html, ncmc.html, qr.html, zone-store.html (and any
// future page - just define a new SYSTEM_CONFIG and reuse this file).
//
// SYSTEM_CONFIG options beyond key/title/subtitle/listColumns/sections:
//   groupField: { name, label, settingsKeys: [...] }
//     Which column groups/filters rows (defaults to Station, sourced
//     from Settings.Stations). Zone Store uses Location, sourced from
//     both Settings.Zones and Settings.Stations combined.
//   statusField: 'ColumnName' | null
//     Which column drives the Status badge/filter (defaults to
//     'OperationalStatus'). Set to null to hide the Status column and
//     filter entirely (Zone Store has no operational status).
//   idLabel: string (default 'Asset ID')
//   itemLabel / itemLabelPlural: string (default 'Asset' / 'Assets')
//     Used in modal titles, toasts, and empty-state text.
//   addHelpText / editHelpText: string, shown above the Add/Edit form.
// Field options (within sections[].fields[]) also accept settingsKeys
// (array) instead of settingsKey (single string) to combine dropdown
// values from more than one Settings column.
//
// A section may also carry showIf: { field: 'OtherFieldName', equals: 'Value' }
// (or equalsAny: ['A','B']) to only appear when that other field
// currently has a matching value - e.g. AG's "FEIG Reader 2" / "QR
// Scanner 2" sections only show when Gate Type = "Bi-directional". In
// the Add/Edit form this toggles live as the controlling field
// changes; in the View modal, non-matching sections are simply left
// out based on the saved row's value.
// ------------------------------------------------------------------

let SETTINGS_CACHE = null;
let CURRENT_ROWS = [];
// Which Counter Number "box" is currently selected in the picker below
// the Station + Counter Type filters (ncmc.html/qr.html only). Reset
// to null whenever the Station or Counter Type filter changes.
let SELECTED_COUNTER_NUMBER = null;
// Exactly what's currently rendered in the table body - may be a
// subset of CURRENT_ROWS once the Counter Number picker narrows it
// further. "Download Excel" exports this, not CURRENT_ROWS, so it
// always matches what's actually on screen.
let LAST_RENDERED_ROWS = [];

const GROUP_FIELD = SYSTEM_CONFIG.groupField || { name: 'Station', label: 'Station', settingsKeys: ['Stations'] };
const STATUS_FIELD = Object.prototype.hasOwnProperty.call(SYSTEM_CONFIG, 'statusField') ? SYSTEM_CONFIG.statusField : 'OperationalStatus';
const ID_LABEL = SYSTEM_CONFIG.idLabel || 'Asset ID';
const ITEM_LABEL = SYSTEM_CONFIG.itemLabel || 'Asset';
const ITEM_LABEL_PLURAL = SYSTEM_CONFIG.itemLabelPlural || ITEM_LABEL + 's';

function allFields() {
  return SYSTEM_CONFIG.sections.flatMap((s) => s.fields);
}

async function init() {
  renderSidebar(SYSTEM_CONFIG.key.toLowerCase());
  document.getElementById('page-title').textContent = SYSTEM_CONFIG.title;
  document.getElementById('page-subtitle').textContent = SYSTEM_CONFIG.subtitle;
  buildTableHead();

  try {
    SETTINGS_CACHE = await Api.getSettings();
  } catch (err) {
    toast('Could not load dropdown settings: ' + err.message, 'error');
    SETTINGS_CACHE = {};
  }

  populateGroupFilter();
  populateCounterTypeFilter();

  const groupParam = getQueryParam('station');
  if (groupParam) document.getElementById('filter-station').value = groupParam;
  const counterParam = getQueryParam('counterType');
  const counterTypeSelect = document.getElementById('filter-counter-type');
  if (counterParam && counterTypeSelect) counterTypeSelect.value = counterParam;

  document.getElementById('add-btn').addEventListener('click', () => openAssetModal());
  const downloadBtn = document.getElementById('download-excel-btn');
  if (downloadBtn) downloadBtn.addEventListener('click', exportCurrentList);
  document.getElementById('filter-search').addEventListener('input', debounce(loadList, 250));
  document.getElementById('filter-station').addEventListener('change', () => { SELECTED_COUNTER_NUMBER = null; loadList(); });
  if (counterTypeSelect) counterTypeSelect.addEventListener('change', () => { SELECTED_COUNTER_NUMBER = null; loadList(); });
  const statusSelect = document.getElementById('filter-status');
  if (statusSelect) statusSelect.addEventListener('change', loadList);

  // Run the asset list and the Station-wise (TOM/EFO) summary as two
  // independent parallel requests instead of one-after-the-other, so
  // the page isn't stuck waiting on both sequentially.
  await Promise.all([loadList(), loadCounterSummary()]);

  const viewParam = getQueryParam('view');
  if (viewParam) {
    const row = CURRENT_ROWS.find((r) => r.AssetID === viewParam);
    if (row) openViewModal(row);
  }
}

// Station-wise TOM/EFO Set summary - only present on ncmc.html/qr.html
// (the panel + #counter-summary-body only exist in those two pages'
// markup), so this is a no-op everywhere else (AG, Zone Store).
async function loadCounterSummary() {
  const body = document.getElementById('counter-summary-body');
  if (!body) return;
  try {
    const rows = await Api.getStationCounterSummary(SYSTEM_CONFIG.key);
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="4" class="empty-row">No Counter (TOM/EFO) data recorded yet.</td></tr>';
      return;
    }
    body.innerHTML = rows
      .slice()
      .sort((a, b) => b.Total - a.Total)
      .map((r) => `
        <tr>
          <td>${escapeHtml(r.station)}</td>
          <td>${r.TOM ? `<span class="link-btn" onclick="filterByStationCounter('${escapeAttr(r.station)}','TOM')">${r.TOM}</span>` : 0}</td>
          <td>${r.EFO ? `<span class="link-btn" onclick="filterByStationCounter('${escapeAttr(r.station)}','EFO')">${r.EFO}</span>` : 0}</td>
          <td><strong>${r.Total}</strong></td>
        </tr>`)
      .join('');
  } catch (err) {
    showError(body, err);
  }
}

// Click a Station's TOM/EFO Set count in the summary table above to
// jump straight to that station + counter's equipment in the list
// below - Station -> TOM/EFO -> the installed equipment.
function filterByStationCounter(station, counterType) {
  document.getElementById('filter-station').value = station;
  const counterTypeSelect = document.getElementById('filter-counter-type');
  if (counterTypeSelect) counterTypeSelect.value = counterType;
  SELECTED_COUNTER_NUMBER = null;
  loadList();
  const picker = document.getElementById('counter-number-picker');
  const target = picker || document.getElementById('table-body');
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function populateGroupFilter() {
  const select = document.getElementById('filter-station');
  const keys = GROUP_FIELD.settingsKeys || ['Stations'];
  const values = [];
  keys.forEach((k) => (SETTINGS_CACHE[k] || []).forEach((v) => values.push(v)));
  values.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    select.appendChild(opt);
  });
}

// Counter Type (TOM/EFO) filter - only present on ncmc.html/qr.html
// (#filter-counter-type only exists in those two pages' markup), so
// this is a no-op everywhere else (AG, Zone Store).
function populateCounterTypeFilter() {
  const select = document.getElementById('filter-counter-type');
  if (!select) return;
  (SETTINGS_CACHE.CounterTypes || []).forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    select.appendChild(opt);
  });
}

function buildTableHead() {
  const head = document.getElementById('table-head');
  const cols = [ID_LABEL, GROUP_FIELD.label, ...SYSTEM_CONFIG.listColumns.map((c) => c.label)];
  if (STATUS_FIELD) cols.push('Status');
  cols.push('Last Updated', '');
  head.innerHTML = '<tr>' + cols.map((c) => `<th>${c}</th>`).join('') + '</tr>';
}

async function loadList() {
  const body = document.getElementById('table-body');
  showLoading(body);
  const statusSelect = document.getElementById('filter-status');
  const counterTypeSelect = document.getElementById('filter-counter-type');
  const stationValue = document.getElementById('filter-station').value;
  const counterTypeValue = counterTypeSelect ? counterTypeSelect.value : '';
  const filters = {
    station: stationValue,
    counterType: counterTypeValue,
    status: STATUS_FIELD && statusSelect ? statusSelect.value : '',
    q: document.getElementById('filter-search').value
  };
  try {
    const rows = await Api.listAssets(SYSTEM_CONFIG.key, filters);
    CURRENT_ROWS = rows;
    renderCounterNumberPicker(stationValue);
  } catch (err) {
    showError(body, err);
  }
}

function tableColCount() {
  return 2 + SYSTEM_CONFIG.listColumns.length + (STATUS_FIELD ? 1 : 0) + 2;
}

// Below the Station filter, ncmc.html/qr.html show one square "box"
// per Counter found for that Station - TOM and EFO counters together
// in the same grid (e.g. "TOM 1", "EFO 1", "TOM 2", ...), not gated
// behind picking a Counter Type first. If the Counter Type dropdown IS
// also set to TOM or EFO, the list (and so the boxes) are already
// narrowed to just that type by the server-side filter in loadList().
// Selecting a box then lists that exact counter's complete equipment
// below. #counter-number-picker only exists on ncmc.html/qr.html, so
// this is a no-op (falls straight through to the normal table)
// elsewhere (AG, Zone Store).
function renderCounterNumberPicker(station) {
  const picker = document.getElementById('counter-number-picker');
  if (!picker || !station) {
    if (picker) picker.style.display = 'none';
    SELECTED_COUNTER_NUMBER = null;
    renderTable(CURRENT_ROWS);
    return;
  }

  const counts = {}; // "TYPE|NUMBER" -> { type, number, count }
  CURRENT_ROWS.forEach((r) => {
    const type = r.CounterType || 'Other';
    // CounterNumber comes back as a JS number when the sheet cell holds
    // a plain number (not text), so coerce to a string - localeCompare
    // below (and the box label) both need a string, not a number.
    const num = (r.CounterNumber !== undefined && r.CounterNumber !== null && r.CounterNumber !== '') ? String(r.CounterNumber) : '(no number)';
    const key = type + '|' + num;
    if (!counts[key]) counts[key] = { type, number: num, count: 0 };
    counts[key].count += 1;
  });
  const keys = Object.keys(counts).sort((a, b) => {
    const A = counts[a], B = counts[b];
    return A.type.localeCompare(B.type) || A.number.localeCompare(B.number, undefined, { numeric: true });
  });

  if (SELECTED_COUNTER_NUMBER && !counts[SELECTED_COUNTER_NUMBER]) SELECTED_COUNTER_NUMBER = null;

  picker.style.display = 'block';
  if (!keys.length) {
    picker.innerHTML = `<div class="empty-row">No Counter (TOM/EFO) data recorded yet for ${escapeHtml(station)}.</div>`;
    renderTable([]);
    return;
  }

  picker.innerHTML = `
    <div class="small text-muted" style="margin-bottom:8px;">${escapeHtml(station)} &mdash; select a Counter (TOM/EFO) below to see its complete equipment list</div>
    <div class="counter-number-grid">
      ${keys.map((key) => {
        const c = counts[key];
        return `
        <div class="counter-number-box ${key === SELECTED_COUNTER_NUMBER ? 'selected' : ''}" onclick="selectCounterNumber('${escapeAttr(key)}')">
          <div class="counter-number-box-label">${escapeHtml(c.type)} ${escapeHtml(c.number)}</div>
          <div class="counter-number-box-count">${c.count} item${c.count === 1 ? '' : 's'}</div>
        </div>`;
      }).join('')}
    </div>`;

  if (SELECTED_COUNTER_NUMBER) {
    const sel = counts[SELECTED_COUNTER_NUMBER];
    renderTable(CURRENT_ROWS.filter((r) => {
      const rNum = (r.CounterNumber !== undefined && r.CounterNumber !== null && r.CounterNumber !== '') ? String(r.CounterNumber) : '(no number)';
      return (r.CounterType || 'Other') === sel.type && rNum === sel.number;
    }));
  } else {
    const body = document.getElementById('table-body');
    body.innerHTML = `<tr><td colspan="${tableColCount()}" class="empty-row">Select a Counter above to see its complete equipment list.</td></tr>`;
  }
}

function selectCounterNumber(key) {
  SELECTED_COUNTER_NUMBER = key;
  renderCounterNumberPicker(document.getElementById('filter-station').value);
}

function exportCurrentList() {
  if (!LAST_RENDERED_ROWS.length) {
    toast('Nothing to export - the list is empty.', 'error');
    return;
  }
  const columns = [
    { key: 'AssetID', label: ID_LABEL },
    { key: GROUP_FIELD.name, label: GROUP_FIELD.label },
    ...SYSTEM_CONFIG.listColumns,
    ...(STATUS_FIELD ? [{ key: STATUS_FIELD, label: 'Status' }] : []),
    { key: 'LastUpdated', label: 'Last Updated' }
  ];
  const ok = exportRowsToExcel(LAST_RENDERED_ROWS, columns, SYSTEM_CONFIG.title, SYSTEM_CONFIG.key + '_export');
  if (ok) toast(`Exported ${LAST_RENDERED_ROWS.length} row(s) to Excel`, 'success');
}

function renderTable(rows) {
  LAST_RENDERED_ROWS = rows; // tracked so "Download Excel" exports exactly what's on screen right now
  const body = document.getElementById('table-body');
  const colCount = tableColCount();
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="${colCount}" class="empty-row">No ${ITEM_LABEL_PLURAL.toLowerCase()} found. Click "+ Add" above to create one.</td></tr>`;
    return;
  }
  body.innerHTML = rows.map((r) => `
    <tr>
      <td><strong>${escapeHtml(r.AssetID)}</strong></td>
      <td>${escapeHtml(r[GROUP_FIELD.name])}</td>
      ${SYSTEM_CONFIG.listColumns.map((c) => `<td>${escapeHtml(r[c.key])}</td>`).join('')}
      ${STATUS_FIELD ? `<td>${statusBadge(r[STATUS_FIELD])}</td>` : ''}
      <td>${escapeHtml(r.LastUpdated)}</td>
      <td>
        <span class="link-btn" onclick="viewById('${escapeAttr(r.AssetID)}')">View</span>
        <span class="link-btn" onclick="editById('${escapeAttr(r.AssetID)}')">Edit</span>
        <span class="link-btn danger" onclick="deleteById('${escapeAttr(r.AssetID)}')">Delete</span>
      </td>
    </tr>`).join('');
}

function viewById(assetId) {
  const row = CURRENT_ROWS.find((r) => r.AssetID === assetId);
  if (row) openViewModal(row);
}
function editById(assetId) {
  const row = CURRENT_ROWS.find((r) => r.AssetID === assetId);
  if (row) openAssetModal(row);
}
async function deleteById(assetId) {
  if (!confirm(`Delete ${ITEM_LABEL.toLowerCase()} ${assetId}? This cannot be undone.`)) return;
  try {
    await Api.deleteAsset(SYSTEM_CONFIG.key, assetId);
    toast(ITEM_LABEL + ' deleted', 'success');
    loadList();
  } catch (err) {
    toast('Delete failed: ' + err.message, 'error');
  }
}

// ---------- View modal ----------

function sectionApplies(sec, row) {
  if (!sec.showIf) return true;
  const val = row[sec.showIf.field];
  if (sec.showIf.equals !== undefined) return val === sec.showIf.equals;
  if (sec.showIf.equalsAny) return sec.showIf.equalsAny.includes(val);
  return true;
}

function openViewModal(row) {
  const sectionsHtml = SYSTEM_CONFIG.sections.filter((sec) => sectionApplies(sec, row)).map((sec) => `
    <h3>${sec.title}</h3>
    <div class="view-grid">
      ${sec.fields.map((f) => `
        <div>
          <div class="k">${f.label}</div>
          <div class="v">${f.type === 'select' && ['Yes', 'No'].includes(String(row[f.name])) ? row[f.name] : (row[f.name] ? escapeHtml(row[f.name]) : '&mdash;')}</div>
        </div>`).join('')}
    </div>`).join('');

  openModal(`
    <h2>${escapeHtml(row.AssetID)} <span class="text-muted small">&middot; ${escapeHtml(row[GROUP_FIELD.name])}</span></h2>
    ${sectionsHtml}
    <div class="modal-actions">
      <button class="btn secondary" onclick="closeModal()">Close</button>
      <button class="btn" onclick="editById('${escapeAttr(row.AssetID)}'); ">Edit</button>
    </div>
  `);
}

// ---------- Add / Edit modal ----------

function fieldOptions(f) {
  if (f.type !== 'select') return [];
  if (f.settingsKeys) return f.settingsKeys.flatMap((k) => SETTINGS_CACHE[k] || []);
  return (SETTINGS_CACHE[f.settingsKey] || []);
}

function renderField(f, value) {
  const val = value !== undefined && value !== null ? value : '';
  if (f.type === 'select') {
    const opts = fieldOptions(f).map((o) => `<option value="${escapeAttr(o)}" ${o === val ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('');
    return `<select id="field-${f.name}" ${f.required ? 'required' : ''}>
      <option value="">-- Select --</option>${opts}
    </select>`;
  }
  if (f.type === 'textarea') {
    return `<textarea id="field-${f.name}" rows="2">${escapeHtml(val)}</textarea>`;
  }
  if (f.type === 'date') {
    return `<input type="date" id="field-${f.name}" value="${escapeAttr(val)}" />`;
  }
  if (f.type === 'number') {
    return `<input type="number" id="field-${f.name}" value="${escapeAttr(val)}" step="any" ${f.required ? 'required' : ''} />`;
  }
  return `<input type="text" id="field-${f.name}" value="${escapeAttr(val)}" ${f.required ? 'required' : ''} />`;
}

function openAssetModal(existing) {
  const isEdit = !!existing;
  // Only sections with a showIf get wrapped in a "display:contents" div -
  // that gives us a single element to show/hide as a unit based on
  // another field's live value (e.g. FEIG Reader 2 / QR Scanner 2 only
  // when Gate Type = Bi-directional), while its fields still lay out as
  // direct .form-grid children (matching the grid CSS). Sections without
  // a showIf stay unwrapped, exactly as before, so the existing
  // ".form-section-title:first-child" no-top-border CSS rule (which
  // relies on DOM parent/child position, unaffected by display:contents)
  // still only matches the true first section of the form.
  const formHtml = SYSTEM_CONFIG.sections.map((sec, idx) => {
    const inner = `
      <div class="form-section-title">${sec.title}</div>
      ${sec.fields.map((f) => `
        <div class="form-field ${f.full ? 'full' : ''}">
          <label>${f.label}${f.required ? ' *' : ''}</label>
          ${renderField(f, existing ? existing[f.name] : '')}
        </div>`).join('')}
    `;
    return sec.showIf ? `<div class="form-section" data-section-idx="${idx}" style="display:contents;">${inner}</div>` : inner;
  }).join('');

  const helpText = isEdit ? SYSTEM_CONFIG.editHelpText : SYSTEM_CONFIG.addHelpText;

  openModal(`
    <h2>${isEdit ? 'Edit ' + ITEM_LABEL + ' - ' + escapeHtml(existing.AssetID) : 'Add New ' + ITEM_LABEL}</h2>
    ${helpText ? `<p class="text-muted small" style="margin:-10px 0 16px;">${helpText}</p>` : ''}
    <div class="form-grid">${formHtml}</div>
    <div class="modal-actions">
      <button class="btn secondary" onclick="closeModal()">Cancel</button>
      <button class="btn" id="save-asset-btn">${isEdit ? 'Save Changes' : 'Add ' + ITEM_LABEL}</button>
    </div>
  `);

  document.getElementById('save-asset-btn').addEventListener('click', () => saveAsset(isEdit ? existing.AssetID : null));

  wireConditionalSections();
}

function wireConditionalSections() {
  const seenControls = new Set();
  SYSTEM_CONFIG.sections.forEach((sec, idx) => {
    if (!sec.showIf) return;
    updateSectionVisibility(idx, sec.showIf);
    const controlEl = document.getElementById('field-' + sec.showIf.field);
    if (controlEl && !seenControls.has(sec.showIf.field)) {
      seenControls.add(sec.showIf.field);
      controlEl.addEventListener('change', () => {
        SYSTEM_CONFIG.sections.forEach((s, i) => {
          if (s.showIf && s.showIf.field === sec.showIf.field) updateSectionVisibility(i, s.showIf);
        });
      });
    }
  });
}

function updateSectionVisibility(idx, showIf) {
  const controlEl = document.getElementById('field-' + showIf.field);
  const sectionEl = document.querySelector(`.form-section[data-section-idx="${idx}"]`);
  if (!controlEl || !sectionEl) return;
  const val = controlEl.value;
  const match = showIf.equals !== undefined ? val === showIf.equals : (showIf.equalsAny || []).includes(val);
  sectionEl.style.display = match ? 'contents' : 'none';
}

async function saveAsset(existingAssetId) {
  const data = {};
  allFields().forEach((f) => {
    const el = document.getElementById('field-' + f.name);
    if (el) data[f.name] = el.value;
  });

  const required = allFields().filter((f) => f.required);
  for (const f of required) {
    if (!data[f.name]) {
      toast(`"${f.label}" is required`, 'error');
      return;
    }
  }

  const btn = document.getElementById('save-asset-btn');
  btn.disabled = true;
  btn.textContent = 'Saving...';
  try {
    if (existingAssetId) {
      await Api.updateAsset(SYSTEM_CONFIG.key, existingAssetId, data);
      toast(ITEM_LABEL + ' updated', 'success');
    } else {
      const result = await Api.addAsset(SYSTEM_CONFIG.key, data);
      toast(ITEM_LABEL + (result.toppedUp ? ' topped up (' + result.AssetID + ', now ' + result.newQuantity + ')' : ' added as ' + result.AssetID), 'success');
    }
    closeModal();
    loadList();
  } catch (err) {
    toast('Save failed: ' + err.message, 'error');
    btn.disabled = false;
    btn.textContent = existingAssetId ? 'Save Changes' : 'Add ' + ITEM_LABEL;
  }
}

init();
