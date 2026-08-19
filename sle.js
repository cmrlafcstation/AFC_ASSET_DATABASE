// ------------------------------------------------------------------
// sle.html logic - station overview
// ------------------------------------------------------------------

renderSidebar('sle');

let ALL_STATION_CARDS = [];

async function loadStations() {
  const grid = document.getElementById('station-grid');
  try {
    const [dashboard, settings] = await Promise.all([Api.getDashboard(), Api.getSettings()]);
    const known = new Map(dashboard.stationWise.map((s) => [s.station, s]));
    (settings.Stations || []).forEach((name) => {
      if (!known.has(name)) known.set(name, { station: name, AG: 0, NCMC: 0, QR: 0, Total: 0 });
    });
    ALL_STATION_CARDS = Array.from(known.values()).sort((a, b) => a.station.localeCompare(b.station));
    renderStations(ALL_STATION_CARDS);

    const highlight = getQueryParam('station');
    if (highlight) {
      setTimeout(() => {
        const el = document.getElementById('station-card-' + cssId(highlight));
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.style.outline = '2px solid var(--blue)';
        }
      }, 100);
    }
  } catch (err) {
    showError(grid, err);
  }
}

function cssId(str) {
  return String(str).replace(/[^a-z0-9]/gi, '_');
}

function renderStations(list) {
  const grid = document.getElementById('station-grid');
  if (!list.length) {
    grid.innerHTML = '<div class="empty-row">No stations configured yet. Add station names to the SETTINGS tab of your Google Sheet.</div>';
    return;
  }
  grid.innerHTML = list.map((s) => `
    <div class="station-card" id="station-card-${cssId(s.station)}">
      <h3>${escapeHtml(s.station)}</h3>
      <div class="row"><span>AG Assets</span><a href="ag.html?station=${encodeURIComponent(s.station)}">${s.AG}</a></div>
      <div class="row"><span>NCMC Assets</span><a href="ncmc.html?station=${encodeURIComponent(s.station)}">${s.NCMC}</a></div>
      <div class="row"><span>QR Assets</span><a href="qr.html?station=${encodeURIComponent(s.station)}">${s.QR}</a></div>
      <div class="row total"><span>Total Assets</span><span>${s.Total}</span></div>
    </div>`).join('');
}

document.getElementById('station-search').addEventListener('input', debounce((e) => {
  const q = e.target.value.toLowerCase().trim();
  renderStations(ALL_STATION_CARDS.filter((s) => s.station.toLowerCase().includes(q)));
}, 150));

loadStations();
