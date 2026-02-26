// Cloudflare Pages Function — CORS proxy
// Route: /api/proxy?url=<encoded_url>
// Only allows whitelisted target domains to prevent open proxy abuse

const ALLOWED_HOSTS = [
  'mis.twse.com.tw',
  'mis.taifex.com.tw',
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
  'finnhub.io',
  'www.taifex.com.tw',
];

export async function onRequest(context) {
  const { request } = context;

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  const url = new URL(request.url);
  const target = url.searchParams.get('url');
  if (!target) {
    return jsonError(400, 'Missing ?url= parameter');
  }

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    return jsonError(400, 'Invalid URL');
  }

  // Whitelist check
  if (!ALLOWED_HOSTS.includes(targetUrl.hostname)) {
    return jsonError(403, `Host not allowed: ${targetUrl.hostname}`);
  }

  try {
    // Forward the request method and body (for POST to TAIFEX)
    const fetchOpts = {
      method: request.method,
      headers: {},
    };

    // Forward content-type for POST requests
    const ct = request.headers.get('content-type');
    if (ct) fetchOpts.headers['Content-Type'] = ct;
    if (request.method === 'POST') {
      fetchOpts.body = await request.text();
    }

    // Add common headers to look like a browser
    fetchOpts.headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    fetchOpts.headers['Accept'] = 'application/json, text/plain, */*';

    const resp = await fetch(target, fetchOpts);
    const body = await resp.arrayBuffer();

    return new Response(body, {
      status: resp.status,
      headers: {
        ...corsHeaders(request),
        'Content-Type': resp.headers.get('Content-Type') || 'application/json',
        'Cache-Control': 'public, max-age=30',
      },
    });
  } catch (e) {
    return jsonError(502, `Fetch failed: ${e.message}`);
  }
}

function corsHeaders(request) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
