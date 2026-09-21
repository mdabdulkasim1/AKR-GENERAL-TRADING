/* Thin fetch wrapper. Every call returns parsed JSON or throws an Error whose
   message is the server's own human-readable reason. */
(function () {
  'use strict';

  let token = localStorage.getItem('akr_token') || null;

  /*
   * The platform restarts the container on every deploy, and a request caught
   * in that second comes back 502, 503 or 504 from the edge — the application
   * never saw it. It is not an error anybody can act on, and it left a screen
   * stuck on "Could not load this page" until somebody reloaded by hand.
   *
   * So a read that lands in that window waits and asks again. Only a read: a
   * write may well have been carried out before the connection dropped, and
   * sending it twice could raise two orders.
   */
  const GATEWAY = [502, 503, 504];
  const pause = (ms) => new Promise((done) => setTimeout(done, ms));

  async function request(method, path, body, opts = {}) {
    const headers = { 'Content-Type': opts.contentType || 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;

    const send = () => fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined
        : (opts.contentType === 'text/csv' ? body : JSON.stringify(body)),
    });

    let res = await send();
    if (method === 'GET' && GATEWAY.includes(res.status)) {
      for (const wait of [400, 1200, 2500]) {
        await pause(wait);
        res = await send();
        if (!GATEWAY.includes(res.status)) break;
      }
    }

    if (res.status === 401 && !path.includes('/auth/')) {
      API.setToken(null);
      window.dispatchEvent(new CustomEvent('akr:unauthorised'));
      throw new Error('Your session has expired. Please sign in again.');
    }

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    if (!res.ok) {
      const err = new Error((data && data.error)
        || (GATEWAY.includes(res.status)
          ? 'The server is restarting — this usually clears in a few seconds.'
          : `Request failed (${res.status})`));
      err.status = res.status;
      err.details = data && data.details;
      err.payload = data;
      throw err;
    }
    return data;
  }

  const API = {
    get: (p) => request('GET', p),
    post: (p, b, o) => request('POST', p, b || {}, o),
    patch: (p, b) => request('PATCH', p, b || {}),
    put: (p, b) => request('PUT', p, b || {}),
    del: (p) => request('DELETE', p),
    getToken: () => token,
    setToken(value) {
      token = value;
      if (value) localStorage.setItem('akr_token', value);
      else localStorage.removeItem('akr_token');
    },
    /** Open a download that needs the bearer token. */
    async download(path, filename) {
      const headers = {};
      if (token) headers.Authorization = 'Bearer ' + token;
      const res = await fetch(path, { headers, credentials: 'same-origin' });
      if (!res.ok) throw new Error(`Could not download (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    qs(params) {
      const parts = Object.entries(params || {})
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
      return parts.length ? '?' + parts.join('&') : '';
    },
  };

  window.API = API;
})();
