// ------------------------------------------------------------------
// AFC Asset Dashboard - API wrapper around the Apps Script Web App
// ------------------------------------------------------------------
// NOTE: POST requests are sent with Content-Type: text/plain on
// purpose. Apps Script Web Apps do not handle CORS preflight (OPTIONS)
// requests, so we keep the request a "simple request" (no custom
// headers that would trigger a preflight) and just JSON.stringify the
// body ourselves. The server (Code.gs) parses it with JSON.parse
// regardless of the declared content type.
//
// CLIENT-SIDE CACHE: on top of the server's own CacheService cache,
// the "heavy"/most-often-requested GETs (settings, dashboard, the
// station counter summary) are also cached here in sessionStorage for
// a short window - so hopping between pages in the same tab (e.g.
// Dashboard -> NCMC -> Dashboard) re-renders instantly from cache
// instead of waiting on a fresh network round trip every time. Any
// write (_post) clears this cache immediately, so it never shows stale
// data after you add/edit/delete/move something yourself. sessionStorage
// (not localStorage) is used on purpose - it's automatically scoped to
// this browser tab and cleared when the tab closes, so it can never
// grow stale across days like a longer-lived cache could.

const Api = {
  _CACHEABLE_ACTIONS: ['settings', 'dashboard', 'stationCounterSummary'],
  _CACHE_TTL_MS: 30000, // 30s - short on purpose; the server-side cache (90s) is the real safety net
  _CACHE_PREFIX: 'afcCache:',

  _cacheKey(params) {
    const sortedKeys = Object.keys(params).sort();
    return this._CACHE_PREFIX + sortedKeys.map((k) => `${k}=${params[k]}`).join('&');
  },

  _readCache(key) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return undefined;
      const entry = JSON.parse(raw);
      if (Date.now() - entry.t > this._CACHE_TTL_MS) {
        sessionStorage.removeItem(key);
        return undefined;
      }
      return entry.v;
    } catch (err) {
      return undefined; // corrupt entry, storage disabled, etc. - just skip the cache
    }
  },

  _writeCache(key, value) {
    try {
      sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), v: value }));
    } catch (err) {
      // sessionStorage full or unavailable (e.g. private browsing) - non-fatal, just means no caching.
    }
  },

  // Called automatically after every successful write - keeps a
  // just-added/edited/deleted/moved record from being hidden behind a
  // stale cached dashboard/settings/summary for the rest of the TTL.
  clearCache() {
    try {
      Object.keys(sessionStorage)
        .filter((k) => k.indexOf(this._CACHE_PREFIX) === 0)
        .forEach((k) => sessionStorage.removeItem(k));
    } catch (err) {
      // non-fatal
    }
  },

  async _get(params) {
    if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.indexOf('PASTE_YOUR') !== -1) {
      throw new Error('APPS_SCRIPT_URL is not configured yet. Edit web/js/config.js.');
    }
    const cacheable = params && this._CACHEABLE_ACTIONS.indexOf(params.action) !== -1;
    const cacheKey = cacheable ? this._cacheKey(params) : null;
    if (cacheKey) {
      const cached = this._readCache(cacheKey);
      if (cached !== undefined) return cached;
    }

    const url = new URL(APPS_SCRIPT_URL);
    Object.keys(params || {}).forEach((k) => {
      if (params[k] !== undefined && params[k] !== null && params[k] !== '') {
        url.searchParams.set(k, params[k]);
      }
    });
    const res = await fetch(url.toString(), { method: 'GET' });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Request failed');

    if (cacheKey) this._writeCache(cacheKey, json.data);
    return json.data;
  },

  async _post(body) {
    if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.indexOf('PASTE_YOUR') !== -1) {
      throw new Error('APPS_SCRIPT_URL is not configured yet. Edit web/js/config.js.');
    }
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Request failed');
    this.clearCache();
    return json.data;
  },

  getSettings() {
    return this._get({ action: 'settings' });
  },
  getDashboard() {
    return this._get({ action: 'dashboard' });
  },
  getStationCounterSummary(system) {
    return this._get({ action: 'stationCounterSummary', system });
  },
  listAssets(system, filters) {
    return this._get(Object.assign({ action: 'list', system }, filters || {}));
  },
  search(filters) {
    return this._get(Object.assign({ action: 'search' }, filters || {}));
  },
  addAsset(system, data) {
    return this._post({ action: 'add', system, data });
  },
  updateAsset(system, assetId, data) {
    return this._post({ action: 'update', system, assetId, data });
  },
  deleteAsset(system, assetId) {
    return this._post({ action: 'delete', system, assetId });
  },
  moveSpare(data) {
    return this._post({ action: 'moveSpare', data });
  },
  bulkImport(system, rows) {
    return this._post({ action: 'bulkImport', system, rows });
  },
  backfillAssetIds() {
    return this._post({ action: 'backfillAssetIds' });
  }
};
