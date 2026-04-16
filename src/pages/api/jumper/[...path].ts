import type { NextApiRequest, NextApiResponse } from 'next';

const JUMPER_UPSTREAM = 'https://api.jumper.xyz/pipeline/v1';

// Browsers forbid setting Origin / Referer / User-Agent on outbound fetches,
// but Jumper's edge rate-limits requests that don't look like they came from
// jumper.xyz. This proxy rewrites those headers server-side.
const SPOOFED_HEADERS = {
  origin: 'https://jumper.xyz',
  referer: 'https://jumper.xyz/',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

const FORWARD_REQUEST_HEADERS = new Set([
  'accept',
  'accept-language',
  'content-type',
  'x-lifi-integrator',
  'x-lifi-widget',
  'x-lifi-sdk',
]);

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const pathSegments = Array.isArray(req.query.path) ? req.query.path : [req.query.path ?? ''];
  const search = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const upstreamUrl = `${JUMPER_UPSTREAM}/${pathSegments.join('/')}${search}`;

  const headers: Record<string, string> = { ...SPOOFED_HEADERS };
  for (const [name, value] of Object.entries(req.headers)) {
    if (!FORWARD_REQUEST_HEADERS.has(name.toLowerCase())) continue;
    if (typeof value === 'string') headers[name] = value;
    else if (Array.isArray(value)) headers[name] = value.join(', ');
  }

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const body = hasBody ? await readBody(req) : undefined;

  const upstream = await fetch(upstreamUrl, {
    method: req.method,
    headers,
    body,
  });

  res.status(upstream.status);
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === 'content-encoding' || lower === 'transfer-encoding') return;
    res.setHeader(key, value);
  });

  const buf = Buffer.from(await upstream.arrayBuffer());
  res.send(buf);
}

function readBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
