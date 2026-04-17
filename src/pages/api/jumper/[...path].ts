import type { NextApiRequest, NextApiResponse } from 'next';

const JUMPER_UPSTREAM = 'https://api.jumper.xyz/pipeline/v1';

const UPSTREAM_TIMEOUT_MS = 20_000;
const MAX_REQUEST_BODY_BYTES = 1_000_000;
const MAX_RESPONSE_BODY_BYTES = 5_000_000;

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

// content-length is stripped because Node's fetch auto-decodes gzip/br responses;
// the upstream value no longer matches the decoded buffer we forward.
const STRIP_RESPONSE_HEADERS = new Set(['content-encoding', 'transfer-encoding', 'content-length']);

export const config = {
  api: {
    bodyParser: false,
  },
};

class BodyTooLargeError extends Error {}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const pathSegments = Array.isArray(req.query.path) ? req.query.path : [req.query.path ?? ''];

  if (pathSegments.some((s) => s === '..' || s === '.' || s.includes('/'))) {
    res.status(400).json({ error: 'invalid_path' });
    return;
  }

  const search = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const upstreamUrl = `${JUMPER_UPSTREAM}/${pathSegments.join('/')}${search}`;

  const headers: Record<string, string> = { ...SPOOFED_HEADERS };
  for (const [name, value] of Object.entries(req.headers)) {
    if (!FORWARD_REQUEST_HEADERS.has(name.toLowerCase())) continue;
    if (typeof value === 'string') headers[name] = value;
    else if (Array.isArray(value)) headers[name] = value.join(', ');
  }

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  let body: Buffer | undefined;
  try {
    body = hasBody ? await readBody(req, MAX_REQUEST_BODY_BYTES) : undefined;
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      res.status(413).json({ error: 'request_body_too_large' });
    } else {
      res.status(400).json({ error: 'invalid_request_body' });
    }
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body,
      signal: controller.signal,
    });

    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) return;
      res.setHeader(key, value);
    });

    const arrayBuffer = await upstream.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_RESPONSE_BODY_BYTES) {
      res.status(502).json({ error: 'upstream_response_too_large' });
      return;
    }
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      res.status(504).json({ error: 'upstream_timeout' });
    } else {
      res.status(502).json({ error: 'upstream_failed' });
    }
  } finally {
    clearTimeout(timeout);
  }
}

function readBody(req: NextApiRequest, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    req.on('data', (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      received += buf.length;
      if (received > limit) {
        reject(new BodyTooLargeError());
        req.destroy();
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
