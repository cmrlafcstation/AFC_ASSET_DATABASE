// ------------------------------------------------------------------
// AFC Asset Dashboard - shared UI helpers (sidebar, toast, modal)
// ------------------------------------------------------------------

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', href: 'dashboard.html', icon: '&#9635;' },
  {
    id: 'sle', label: 'SLE (Stations)', href: 'sle.html', icon: '&#9737;',
    children: [
      { id: 'ag', label: 'AG System', href: 'ag.html' },
      { id: 'ncmc', label: 'NCMC System', href: 'ncmc.html' },
      { id: 'qr', label: 'QR System', href: 'qr.html' }
    ]
  },
  {
    id: 'inventory', label: 'Spares Inventory', href: 'zone-store.html', icon: '&#9632;',
    children: [
      { id: 'spare', label: 'Zone Store', href: 'zone-store.html' },
      { id: 'movement', label: 'Spare Movement', href: 'spare-movement.html' }
    ]
  }
];

function renderSidebar(activeId) {
  const root = document.getElementById('sidebar-root');
  if (!root) return;

  let html = `
    <div class="sidebar-brand">
      <span class="sidebar-brand-mark">AFC</span>
      <span class="sidebar-brand-text">Asset Management</span>
    </div>
    <nav class="sidebar-nav">`;

  NAV_ITEMS.forEach((item) => {
    const isActive = item.id === activeId;
    const childActive = item.children && item.children.some((c) => c.id === activeId);
    html += `<a class="nav-link ${isActive ? 'active' : ''}" href="${item.href}">
        <span class="nav-icon">${item.icon}</span> ${item.label}
      </a>`;
    if (item.children) {
      html += `<div class="nav-children ${childActive || isActive ? 'open' : ''}">`;
      item.children.forEach((c) => {
        html += `<a class="nav-link nav-sublink ${c.id === activeId ? 'active' : ''}" href="${c.href}">${c.label}</a>`;
      });
      html += `</div>`;
    }
  });

  html += `</nav>
    <div class="sidebar-footer">
      <a href="index.html" class="nav-link nav-exit">&#8592; Home</a>
    </div>`;

  root.innerHTML = html;
  setupMobileSidebar();
}

// Small-screen off-canvas sidebar: a floating hamburger button (hidden
// above the CSS breakpoint) toggles a `sidebar-open` class on <body>;
// a backdrop click, an Escape press, or tapping a nav link closes it
// again. Safe to call more than once (e.g. if renderSidebar() ever
// runs twice) - it reuses the same #sidebar-toggle-btn/#sidebar-backdrop
// elements instead of creating duplicates.
function setupMobileSidebar() {
  let toggleBtn = document.getElementById('sidebar-toggle-btn');
  let backdrop = document.getElementById('sidebar-backdrop');

  if (!toggleBtn) {
    toggleBtn = document.createElement('button');
    toggleBtn.id = 'sidebar-toggle-btn';
    toggleBtn.className = 'sidebar-toggle-btn';
    toggleBtn.setAttribute('aria-label', 'Toggle menu');
    toggleBtn.textContent = '☰';
    toggleBtn.addEventListener('click', () => document.body.classList.toggle('sidebar-open'));
    document.body.appendChild(toggleBtn);
  }

  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'sidebar-backdrop';
    backdrop.className = 'sidebar-backdrop';
    backdrop.addEventListener('click', () => document.body.classList.remove('sidebar-open'));
    document.body.appendChild(backdrop);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') document.body.classList.remove('sidebar-open');
    });
  }

  // Tapping any nav link on a small screen should close the drawer
  // instead of leaving it open over the page that just loaded.
  document.querySelectorAll('.sidebar .nav-link').forEach((el) => {
    el.addEventListener('click', () => document.body.classList.remove('sidebar-open'));
  });
}

function toast(message, type = 'info') {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

function openModal(innerHtml) {
  let overlay = document.getElementById('modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'modal-overlay';
    overlay.className = 'modal-overlay';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `<div class="modal-box">${innerHtml}</div>`;
  overlay.classList.add('open');
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.classList.remove('open');
}

function statusBadge(status) {
  if (!status) return '<span class="badge badge-muted">-</span>';
  const cls = {
    Operational: 'badge-green',
    Working: 'badge-green',
    Connected: 'badge-green',
    Yes: 'badge-green',
    Staff: 'badge-amber',
    'Under Repair': 'badge-amber',
    'Non Operational': 'badge-red',
    'Not Working': 'badge-red',
    'Not Connected': 'badge-red',
    No: 'badge-red'
  }[status] || 'badge-muted';
  return `<span class="badge ${cls}">${status}</span>`;
}

function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return String(str === undefined || str === null ? '' : str).replace(/'/g, "\\'");
}

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(null, args), wait);
  };
}

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function showLoading(el) {
  el.innerHTML = '<div class="loading-row"><span class="spinner"></span> Loading&hellip;</div>';
}

function showError(el, err) {
  el.innerHTML = `<div class="error-row">Could not load data: ${escapeHtml(err.message || err)}</div>`;
}
