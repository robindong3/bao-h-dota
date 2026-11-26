const SITE = 'https://bao-h-dota.pages.dev';

export default {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/api/recognize' && request.method === 'POST') {
      return fetch(new Request(SITE + path, request), {redirect:'manual'});
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    const url = new URL(request.url);
    const upstream = new URL(SITE);
    upstream.pathname = url.pathname;
    upstream.search = url.search;
    const headers = new Headers();
    for (const name of ['accept', 'if-none-match', 'if-modified-since', 'range']) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    return fetch(upstream, { method: request.method, headers, redirect: 'manual' });
  },
};
