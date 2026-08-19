// ------------------------------------------------------------------
// spare-movement.html logic
// ------------------------------------------------------------------

renderSidebar('movement');

let SETTINGS_CACHE = {};
let SEARCH_RESULTS = []; // merged list: spare stock rows + AG/NCMC/QR device rows
let SELECTED_SOURCE = null; // null | {type:'STOCK'} | {type:'ASSET', system, assetId, component}
let LAST_MOVEMENTS = []; // rows currently shown in the Recent Movements table, for "Download Excel"

function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function init() {
  try {
    SETTINGS_CACHE = await Api.getSettings();
  } catch (err) {
    toast('Could not load dropdown settings: ' + err.message, 'error');
    SETTINGS_CACHE = {};
  }
  populateLocationSelects();
  document.getElementById('move-date').value = todayStr();

  document.getElementById('move-form').addEventListener('submit', onSubmitMovement);
  document.getElementById('from-location').addEventListener('change', onFromLocationChanged);
  document.getElementById('to-location').addEventListener('change', refreshAvailable);
  document.getElementById('spare-name').addEventListener('change', onSpareNameEdited);
  document.getElementById('spare-name').addEventListener('blur', refreshAvailable);

  document.getElementById('stock-search').addEventListener('input', debounce(loadStockSearch, 250));
  document.getElementById('stock-search-location').addEventListener('change', loadStockSearch);

  const downloadBtn = document.getElementById('download-excel-btn');
  if (downloadBtn) downloadBtn.addEventListener('click', exportMovements);

  // Any AG/NCMC/QR row missing an Asset ID (e.g. pasted straight into
  // the sheet, bypassing the app) can't otherwise be selected for a
  // movement - silently backfill one for every such row before the
  // search below loads, so a missing Asset ID never blocks a movement.
  try {
    await Api.backfillAssetIds();
  } catch (err) {
    // non-fatal - the "Needs Asset ID" fallback in renderStockSearchResults
    // still protects against selecting a row that somehow still has none.
  }

  loadRecentMovements();
  refreshSpareNameSuggestions();
  loadStockSearch();
}

function populateLocationSelects() {
  const zones = SETTINGS_CACHE.Zones || [];
  const stations = SETTINGS_CACHE.Stations || [];
  const all = zones.concat(stations);

  ['from-location', 'to-location', 'stock-search-location'].forEach((id) => {
    const select = document.getElementById(id);
    all.forEach((loc) => {
      const opt = document.createElement('option');
      opt.value = loc;
      opt.textContent = loc;
      select.appendChild(opt);
    });
  });

  const categorySelect = document.getElementById('move-category');
  (SETTINGS_CACHE.SpareCategories || []).forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    categorySelect.appendChild(opt);
  });
}

async function refreshSpareNameSuggestions() {
  try {
    const rows = await Api.listAssets('SPARE', {});
    const names = Array.from(new Set(rows.map((r) => r.SparePartName).filter(Boolean)));
    const list = document.getElementById('spare-name-list');
    list.innerHTML = names.map((n) => `<option value="${escapeAttr(n)}"></option>`).join('');
  } catch (err) {
    // non-fatal - suggestions are a nicety, not required
  }
}

// ---------- Step 1: search & select existing spare stock OR an installed device ----------

async function loadStockSearch() {
  const body = document.getElementById('stock-search-body');
  showLoading(body);
  const q = document.getElementById('stock-search').value;
  const station = document.getElementById('stock-search-location').value;
  const filters = { q, station };

  try {
    const [stockRows, agRows, ncmcRows, qrRows] = await Promise.all([
      Api.listAssets('SPARE', filters),
      Api.listAssets('AG', filters),
      Api.listAssets('NCMC', filters),
      Api.listAssets('QR', filters)
    ]);

    const items = [];

    stockRows.forEach((r) => items.push({
      kind: 'STOCK', id: r.AssetID, name: r.SparePartName, category: r.Category,
      location: r.Location, qtyLabel: `${r.Quantity} ${r.Unit || ''}`.trim(), raw: r
    }));

    agRows.forEach((r) => {
      const qtyLabel = r.AssetID ? `1 (installed on ${r.AssetID})` : '1 (installed)';
      if (r.FEIG_Availability === 'Yes') {
        items.push({ kind: 'AG-FEIG', id: r.AssetID, name: 'FEIG Reader', category: 'AG', location: r.Station, qtyLabel, raw: r });
      }
      if (r.QR_Availability === 'Yes') {
        items.push({ kind: 'AG-QR', id: r.AssetID, name: 'QR Scanner', category: 'AG', location: r.Station, qtyLabel, raw: r });
      }
      // Bi-directional gates carry a second FEIG reader + QR scanner.
      if (r.FEIG2_Availability === 'Yes') {
        items.push({ kind: 'AG-FEIG2', id: r.AssetID, name: 'FEIG Reader 2', category: 'AG', location: r.Station, qtyLabel, raw: r });
      }
      if (r.QR2_Availability === 'Yes') {
        items.push({ kind: 'AG-QR2', id: r.AssetID, name: 'QR Scanner 2', category: 'AG', location: r.Station, qtyLabel, raw: r });
      }
    });

    ncmcRows.forEach((r) => items.push({
      kind: 'NCMC', id: r.AssetID, name: r.EquipmentType || 'NCMC Equipment', category: 'NCMC',
      location: r.Station, qtyLabel: `1 (installed, ${r.OperationalStatus || 'status unknown'})`, raw: r
    }));

    qrRows.forEach((r) => items.push({
      kind: 'QR', id: r.AssetID, name: r.EquipmentType || 'QR Equipment', category: 'QR',
      location: r.Station, qtyLabel: `1 (installed, ${r.OperationalStatus || 'status unknown'})`, raw: r
    }));

    SEARCH_RESULTS = items;
    renderStockSearchResults(items);
  } catch (err) {
    showError(body, err);
  }
}

const KIND_LABELS = {
  STOCK: 'Spare Stock', 'AG-FEIG': 'AG Device', 'AG-QR': 'AG Device',
  'AG-FEIG2': 'AG Device', 'AG-QR2': 'AG Device', NCMC: 'NCMC Device', QR: 'QR Device'
};

function renderStockSearchResults(items) {
  const body = document.getElementById('stock-search-body');
  if (!items.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty-row">No spare stock or installed devices found.</td></tr>';
    return;
  }
  body.innerHTML = items.map((it, idx) => {
    const missingId = !it.id;
    const idCell = missingId
      ? `<span class="text-muted">(no Asset ID)</span> <span class="badge badge-muted">${KIND_LABELS[it.kind]}</span>`
      : `<strong>${escapeHtml(it.id)}</strong> <span class="badge badge-muted">${KIND_LABELS[it.kind]}</span>`;
    const actionCell = missingId
      ? `<span class="small text-muted" title="This record still has no Asset ID - reload the page to retry the automatic backfill, or open it on its system page and Save to assign one.">Needs Asset ID</span>`
      : `<span class="link-btn" onclick="selectSearchItem(${idx})">Select &rarr;</span>`;
    return `
    <tr>
      <td>${idCell}</td>
      <td>${escapeHtml(it.name)}</td>
      <td>${escapeHtml(it.category)}</td>
      <td>${escapeHtml(it.location)}</td>
      <td>${escapeHtml(it.qtyLabel)}</td>
      <td>${actionCell}</td>
    </tr>`;
  }).join('');
}

function selectSearchItem(idx) {
  const it = SEARCH_RESULTS[idx];
  if (!it) return;
  if (!it.id) {
    toast('This record still has no Asset ID - reload the page to retry the automatic backfill.', 'error');
    return;
  }

  document.getElementById('spare-name').value = it.name || '';
  document.getElementById('move-category').value = it.category || '';
  document.getElementById('from-location').value = it.location || '';

  const qtyField = document.getElementById('move-qty');
  const banner = document.getElementById('selected-stock-banner');

  if (it.kind === 'STOCK') {
    SELECTED_SOURCE = { type: 'STOCK' };
    qtyField.readOnly = false;
    qtyField.value = '';
    banner.innerHTML = `Selected: <strong>${escapeHtml(it.name)}</strong> stock at <strong>${escapeHtml(it.location)}</strong> (${escapeHtml(it.id)}) &mdash; <span class="link-btn" style="margin:0;" onclick="clearSelection()">clear</span>`;
  } else {
    const AG_COMPONENT_BY_KIND = { 'AG-FEIG': 'FEIG', 'AG-QR': 'QR', 'AG-FEIG2': 'FEIG2', 'AG-QR2': 'QR2' };
    const system = it.kind.startsWith('AG-') ? 'AG' : it.kind;
    const component = AG_COMPONENT_BY_KIND[it.kind] || null;
    SELECTED_SOURCE = { type: 'ASSET', system, assetId: it.id, component };
    qtyField.value = 1;
    qtyField.readOnly = true;
    banner.innerHTML = `Selected: <strong>${escapeHtml(it.name)}</strong> installed on <strong>${escapeHtml(it.id)}</strong> at <strong>${escapeHtml(it.location)}</strong> &mdash; choose a To Location below to see what this move will do. <span class="link-btn" style="margin:0;" onclick="clearSelection()">clear</span>`;
  }

  refreshAvailable();
  qtyField.focus();
  qtyField.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function clearSelection() {
  SELECTED_SOURCE = null;
  document.getElementById('spare-name').value = '';
  document.getElementById('move-category').value = '';
  document.getElementById('from-location').value = '';
  document.getElementById('available-hint').textContent = '';
  const qtyField = document.getElementById('move-qty');
  qtyField.readOnly = false;
  qtyField.value = '';
  document.getElementById('selected-stock-banner').textContent = 'No stock or device selected yet — pick one above, or fill in the fields manually.';
}

function onSpareNameEdited() {
  // Manually editing the Spare Part Name means we're no longer tied to
  // whatever was selected above (falls back to a plain stock move).
  if (SELECTED_SOURCE && SELECTED_SOURCE.type === 'ASSET') {
    SELECTED_SOURCE = null;
    document.getElementById('move-qty').readOnly = false;
    document.getElementById('selected-stock-banner').textContent = 'No stock or device selected yet — pick one above, or fill in the fields manually.';
  }
  refreshAvailable();
}

function onFromLocationChanged() {
  if (SELECTED_SOURCE && SELECTED_SOURCE.type === 'ASSET') {
    // Changing From away from the device's own station invalidates the selection.
    clearSelection();
  }
  refreshAvailable();
}

// ---------- Step 2: movement form ----------

async function refreshAvailable() {
  const name = document.getElementById('spare-name').value.trim();
  const from = document.getElementById('from-location').value;
  const to = document.getElementById('to-location').value;
  const hint = document.getElementById('available-hint');

  if (SELECTED_SOURCE && SELECTED_SOURCE.type === 'ASSET') {
    const isNcmcOrQr = SELECTED_SOURCE.system === 'NCMC' || SELECTED_SOURCE.system === 'QR';
    if (!to) {
      hint.textContent = `Pick a To Location to see what happens to ${SELECTED_SOURCE.assetId}.`;
    } else if (isNcmcOrQr) {
      hint.textContent = `This will RELOCATE the device: ${SELECTED_SOURCE.assetId} is removed from ${from} and re-created as a new asset record at ${to} with a new Asset ID (works the same whether ${to} is a station or a Zone). No spare stock is created.`;
    } else {
      const AG_COMPONENT_LABELS = { FEIG: 'FEIG Reader', QR: 'QR Scanner', FEIG2: 'FEIG Reader 2', QR2: 'QR Scanner 2' };
      const compLabel = AG_COMPONENT_LABELS[SELECTED_SOURCE.component] || 'component';
      hint.textContent = `This will mark the ${compLabel} on ${SELECTED_SOURCE.assetId} unavailable and create/top-up spare stock at ${to} (AG components live inside a shared gate record, so they can't be relocated as their own row).`;
    }
    return;
  }
  if (!name || !from) {
    hint.textContent = '';
    return;
  }
  try {
    const rows = await Api.listAssets('SPARE', { station: from, q: name });
    const match = rows.find((r) => r.SparePartName === name && r.Location === from);
    hint.textContent = match
      ? `Available at ${from}: ${match.Quantity} ${match.Unit || ''}`.trim()
      : `No stock of "${name}" recorded at ${from} yet — this movement will fail unless there's stock there.`;
  } catch (err) {
    hint.textContent = '';
  }
}

async function onSubmitMovement(e) {
  e.preventDefault();

  const data = {
    Date: document.getElementById('move-date').value,
    SparePartName: document.getElementById('spare-name').value.trim(),
    Category: document.getElementById('move-category').value,
    Quantity: document.getElementById('move-qty').value,
    FromLocation: document.getElementById('from-location').value,
    ToLocation: document.getElementById('to-location').value,
    HandledBy: document.getElementById('handled-by').value,
    Remarks: document.getElementById('move-remarks').value
  };

  if (SELECTED_SOURCE && SELECTED_SOURCE.type === 'ASSET') {
    data.SourceType = 'ASSET';
    data.SourceSystem = SELECTED_SOURCE.system;
    data.SourceAssetId = SELECTED_SOURCE.assetId;
    data.SourceComponent = SELECTED_SOURCE.component;
  }

  if (!data.SparePartName || !data.FromLocation || !data.ToLocation || !data.Quantity) {
    toast('Please fill in Spare Part, Quantity, From and To locations.', 'error');
    return;
  }
  if (data.FromLocation === data.ToLocation) {
    toast('From and To locations must be different.', 'error');
    return;
  }

  const btn = document.getElementById('move-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Recording...';
  try {
    const result = await Api.moveSpare(data);
    toast(`Movement ${result.MovementID} recorded (${result.MovementType})`, 'success');
    document.getElementById('move-form').reset();
    document.getElementById('move-date').value = todayStr();
    clearSelection();
    loadRecentMovements();
    refreshSpareNameSuggestions();
    loadStockSearch();
  } catch (err) {
    toast('Movement failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Record Movement';
  }
}

async function loadRecentMovements() {
  const body = document.getElementById('movement-table-body');
  showLoading(body);
  try {
    const rows = await Api.listAssets('MOVEMENT', {});
    rows.sort((a, b) => String(b.LastUpdated).localeCompare(String(a.LastUpdated)));
    const recent = rows.slice(0, 100);
    LAST_MOVEMENTS = recent;
    if (!recent.length) {
      body.innerHTML = '<tr><td colspan="8" class="empty-row">No movements recorded yet.</td></tr>';
      return;
    }
    body.innerHTML = recent.map((r) => {
      const badges = [
        r.SourceAssetID ? `<span class="badge badge-muted">from ${escapeHtml(r.SourceAssetID)}</span>` : '',
        r.DestinationAssetID ? `<span class="badge badge-muted">now ${escapeHtml(r.DestinationAssetID)}</span>` : ''
      ].join(' ');
      return `
      <tr>
        <td><strong>${escapeHtml(r.AssetID)}</strong></td>
        <td>${escapeHtml(r.Date)}</td>
        <td>${escapeHtml(r.SparePartName)} ${badges}</td>
        <td>${escapeHtml(r.Category)}</td>
        <td>${escapeHtml(r.Quantity)}</td>
        <td>${escapeHtml(r.FromLocation)} &rarr; ${escapeHtml(r.ToLocation)}</td>
        <td>${escapeHtml(r.MovementType)}</td>
        <td>${escapeHtml(r.HandledBy)}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    showError(body, err);
  }
}

function exportMovements() {
  if (!LAST_MOVEMENTS.length) {
    toast('Nothing to export - no movements recorded yet.', 'error');
    return;
  }
  const columns = [
    { key: 'AssetID', label: 'Movement ID' },
    { key: 'Date', label: 'Date' },
    { key: 'SparePartName', label: 'Spare Part / Device' },
    { key: 'Category', label: 'Category' },
    { key: 'Quantity', label: 'Quantity' },
    { key: 'FromLocation', label: 'From' },
    { key: 'ToLocation', label: 'To' },
    { key: 'MovementType', label: 'Type' },
    { key: 'HandledBy', label: 'Handled By' },
    { key: 'SourceAssetID', label: 'Source Asset ID' },
    { key: 'DestinationAssetID', label: 'Destination Asset ID' },
    { key: 'Remarks', label: 'Remarks' },
    { key: 'LastUpdated', label: 'Last Updated' }
  ];
  const ok = exportRowsToExcel(LAST_MOVEMENTS, columns, 'Recent Movements', 'spare_movements_export');
  if (ok) toast(`Exported ${LAST_MOVEMENTS.length} movement(s) to Excel`, 'success');
}

init();
