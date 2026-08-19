// ------------------------------------------------------------------
// dashboard.html logic
// ------------------------------------------------------------------

renderSidebar('dashboard');

const PAGE_BY_SYSTEM = { AG: 'ag.html', NCMC: 'ncmc.html', QR: 'qr.html' };
let LAST_DASHBOARD_DATA = null; // populated on every successful load, used by "Download Report"

async function loadDashboard() {
  const grid = document.getElementById('stat-grid');
  try {
    const data = await Api.getDashboard();
    LAST_DASHBOARD_DATA = data;
    renderStatGrid(data);
    renderStationTable(data.stationWise);
    renderStatusMonitoring(data);
    renderCounterTable(data.counterWise);
    renderRecent(data.recentlyUpdated);
  } catch (err) {
    showError(grid, err);
  }
}

// "Download Report" - a multi-sheet Excel workbook covering everything
// on this page: overall totals, the Station-wise breakdown, the
// Counter-wise (TOM/EFO) breakdown, and the Recently Updated list.
function exportDashboardReport() {
  if (!LAST_DASHBOARD_DATA) {
    toast('Dashboard data is still loading - try again in a moment.', 'error');
    return;
  }
  const data = LAST_DASHBOARD_DATA;
  const cw = data.counterWise || { TOM: { NCMC: 0, QR: 0 }, EFO: { NCMC: 0, QR: 0 } };
  const ncmcSets = (cw.TOM.NCMC || 0) + (cw.EFO.NCMC || 0);
  const qrSets = (cw.TOM.QR || 0) + (cw.EFO.QR || 0);

  const summaryRows = [
    { metric: 'Total Assets', value: data.total },
    { metric: 'AG (devices)', value: data.perSystem.AG },
    { metric: 'NCMC (equipment / Sets)', value: `${data.perSystem.NCMC} / ${ncmcSets}` },
    { metric: 'QR (equipment / Sets)', value: `${data.perSystem.QR} / ${qrSets}` },
    { metric: 'Operational', value: data.operational.Operational || 0 },
    { metric: 'Staff', value: data.operational.Staff || 0 },
    { metric: 'Non Operational', value: data.operational['Non Operational'] || 0 },
    { metric: 'NMS Disconnected', value: data.nmsDisconnected || 0 }
  ];

  const counterRows = ['TOM', 'EFO'].map((t) => {
    const c = (data.counterWise && data.counterWise[t]) || { NCMC: 0, QR: 0, Total: 0 };
    return { counterType: t, ncmc: c.NCMC, qr: c.QR, total: c.Total };
  });

  const ok = downloadWorkbook([
    { name: 'Summary', rows: summaryRows, columns: [{ key: 'metric', label: 'Metric' }, { key: 'value', label: 'Value' }] },
    {
      name: 'Station-wise', rows: data.stationWise || [],
      columns: [
        { key: 'station', label: 'Station' }, { key: 'AG', label: 'AG' },
        { key: 'NCMC', label: 'NCMC (Sets)' }, { key: 'QR', label: 'QR (Sets)' }, { key: 'Total', label: 'Total' }
      ]
    },
    {
      name: 'Counter-wise (TOM-EFO)', rows: counterRows,
      columns: [
        { key: 'counterType', label: 'Counter Type' }, { key: 'ncmc', label: 'NCMC' },
        { key: 'qr', label: 'QR' }, { key: 'total', label: 'Total' }
      ]
    },
    {
      name: 'Recently Updated', rows: data.recentlyUpdated || [],
      columns: [
        { key: 'system', label: 'System' }, { key: 'assetId', label: 'Asset ID' },
        { key: 'station', label: 'Station' }, { key: 'lastUpdated', label: 'Last Updated' }
      ]
    }
  ], 'AFC_dashboard_report');

  if (ok) toast('Report downloaded', 'success');
}

function renderStatGrid(data) {
  const grid = document.getElementById('stat-grid');
  const nonOp = data.operational['Non Operational'] || 0;
  const cw = data.counterWise || { TOM: { NCMC: 0, QR: 0 }, EFO: { NCMC: 0, QR: 0 } };
  const ncmcSets = (cw.TOM.NCMC || 0) + (cw.EFO.NCMC || 0);
  const qrSets = (cw.TOM.QR || 0) + (cw.EFO.QR || 0);
  grid.innerHTML = `
    <div class="stat-card accent-blue">
      <div class="label">Total Assets</div>
      <div class="value">${data.total}</div>
      <div class="small text-muted" style="margin-top:4px;">AG ${data.perSystem.AG} &middot; NCMC ${data.perSystem.NCMC} &middot; QR ${data.perSystem.QR} (equipment)</div>
    </div>
    <div class="stat-card"><div class="label">AG</div><div class="value">${data.perSystem.AG}</div></div>
    <div class="stat-card"><div class="label">NCMC</div><div class="value">${ncmcSets}</div></div>
    <div class="stat-card"><div class="label">QR</div><div class="value">${qrSets}</div></div>
    <div class="stat-card accent-green"><div class="label">Operational</div><div class="value">${data.operational.Operational || 0}</div></div>
    <div class="stat-card accent-red"><div class="label">Non-Operational</div><div class="value">${nonOp}</div></div>
  `;
}

function renderStationTable(stationWise) {
  const body = document.getElementById('station-table-body');
  if (!stationWise.length) {
    body.innerHTML = '<tr><td colspan="5" class="empty-row">No assets recorded yet.</td></tr>';
    return;
  }
  body.innerHTML = stationWise
    .sort((a, b) => b.Total - a.Total)
    .map((s) => `
      <tr>
        <td><a href="sle.html?station=${encodeURIComponent(s.station)}">${escapeHtml(s.station)}</a></td>
        <td>${s.AG}</td><td>${s.NCMC}</td><td>${s.QR}</td><td><strong>${s.Total}</strong></td>
      </tr>`)
    .join('');
}

function renderCounterTable(counterWise) {
  const body = document.getElementById('counter-table-body');
  if (!body) return;
  const types = ['TOM', 'EFO'];
  const allZero = types.every((t) => !counterWise || !counterWise[t] || counterWise[t].Total === 0);
  if (allZero) {
    body.innerHTML = '<tr><td colspan="4" class="empty-row">No NCMC/QR devices have a Counter set yet.</td></tr>';
    return;
  }
  body.innerHTML = types.map((t) => {
    const c = (counterWise && counterWise[t]) || { NCMC: 0, QR: 0, Total: 0 };
    return `<tr><td>${t}</td><td>${c.NCMC}</td><td>${c.QR}</td><td><strong>${c.Total}</strong></td></tr>`;
  }).join('');
}

function renderStatusMonitoring(data) {
  const el = document.getElementById('status-monitoring');
  const op = data.operational;
  el.innerHTML = `
    <div class="view-grid">
      <div><div class="k">Operational</div><div class="v">${statusBadge('Operational')} ${op.Operational || 0}</div></div>
      <div><div class="k">Staff</div><div class="v">${statusBadge('Staff')} ${op.Staff || 0}</div></div>
      <div><div class="k">Non Operational</div><div class="v">${statusBadge('Non Operational')} ${op['Non Operational'] || 0}</div></div>
      <div><div class="k">NMS Disconnected</div><div class="v">${statusBadge('Not Connected')} ${data.nmsDisconnected}</div></div>
    </div>`;
}

function renderRecent(recent) {
  const body = document.getElementById('recent-table-body');
  if (!recent.length) {
    body.innerHTML = '<tr><td colspan="5" class="empty-row">No activity yet.</td></tr>';
    return;
  }
  body.innerHTML = recent
    .map((r) => `
      <tr>
        <td>${r.system}</td>
        <td>${escapeHtml(r.assetId)}</td>
        <td>${escapeHtml(r.station)}</td>
        <td>${escapeHtml(r.lastUpdated)}</td>
        <td><a class="link-btn" href="${PAGE_BY_SYSTEM[r.system]}?view=${encodeURIComponent(r.assetId)}">View</a></td>
      </tr>`)
    .join('');
}

async function populateStationFilter() {
  const select = document.getElementById('search-station');
  try {
    const settings = await Api.getSettings();
    (settings.Stations || []).forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      select.appendChild(opt);
    });
  } catch (err) {
    // non-fatal - station filter just stays "All"
  }
}

async function runSearch() {
  const table = document.getElementById('search-results-table');
  const body = document.getElementById('search-results-body');
  const placeholder = document.getElementById('search-placeholder');
  const params = {
    q: document.getElementById('search-q').value,
    system: document.getElementById('search-system').value,
    station: document.getElementById('search-station').value,
    status: document.getElementById('search-status').value
  };
  placeholder.textContent = 'Searching...';
  placeholder.style.display = 'block';
  table.style.display = 'none';
  try {
    const results = await Api.search(params);
    if (!results.length) {
      placeholder.textContent = 'No matching assets found.';
      return;
    }
    body.innerHTML = results
      .map((r) => `
        <tr>
          <td>${r._system}</td>
          <td>${escapeHtml(r.AssetID)}</td>
          <td>${escapeHtml(r.Station)}</td>
          <td>${statusBadge(r.OperationalStatus)}</td>
          <td>${escapeHtml(r.LastUpdated)}</td>
          <td><a class="link-btn" href="${PAGE_BY_SYSTEM[r._system]}?view=${encodeURIComponent(r.AssetID)}">View</a></td>
        </tr>`)
      .join('');
    table.style.display = 'table';
    placeholder.style.display = 'none';
  } catch (err) {
    placeholder.textContent = 'Search failed: ' + err.message;
  }
}

document.getElementById('search-btn').addEventListener('click', runSearch);
document.getElementById('search-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });
const downloadReportBtn = document.getElementById('download-report-btn');
if (downloadReportBtn) downloadReportBtn.addEventListener('click', exportDashboardReport);

loadDashboard();
populateStationFilter();
