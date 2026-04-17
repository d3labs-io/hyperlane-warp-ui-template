// @vitest-environment node
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../[...path]';

type MockReqOpts = {
  method?: string;
  url?: string;
  pathSegments?: string[];
  headers?: Record<string, string | string[]>;
  body?: string | Buffer;
};

function mockReq(opts: MockReqOpts = {}) {
  const chunk = opts.body ? (Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(opts.body)) : null;
  const stream = Readable.from(chunk ? [chunk] : []) as any;
  stream.method = opts.method ?? 'GET';
  stream.url = opts.url ?? '/api/jumper/quote';
  stream.headers = opts.headers ?? {};
  stream.query = { path: opts.pathSegments ?? ['quote'] };
  return stream;
}

function mockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    send: vi.fn(),
    json: vi.fn(),
  };
}

function upstreamResponse(body: BodyInit | null = 'ok', init: ResponseInit = {}) {
  return new Response(body, { status: 200, ...init });
}

function getFetchCall() {
  const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
  return { url: call[0] as string, init: call[1] as RequestInit };
}

describe('jumper proxy [...path] handler', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(upstreamResponse()));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('upstream URL construction', () => {
    it('joins path segments onto the upstream base', async () => {
      await handler(
        mockReq({ pathSegments: ['advanced', 'routes'], url: '/api/jumper/advanced/routes' }),
        mockRes() as any,
      );
      expect(getFetchCall().url).toBe('https://api.jumper.xyz/pipeline/v1/advanced/routes');
    });

    it('preserves the querystring verbatim', async () => {
      await handler(
        mockReq({ url: '/api/jumper/quote?fromChain=1&toChain=137&amount=1000' }),
        mockRes() as any,
      );
      expect(getFetchCall().url).toBe(
        'https://api.jumper.xyz/pipeline/v1/quote?fromChain=1&toChain=137&amount=1000',
      );
    });

    it('works when a single path segment arrives as a string', async () => {
      const req = mockReq({ url: '/api/jumper/quote' });
      req.query = { path: 'quote' };
      await handler(req, mockRes() as any);
      expect(getFetchCall().url).toBe('https://api.jumper.xyz/pipeline/v1/quote');
    });
  });

  describe('path validation', () => {
    it('rejects "." segments with 400 and never calls fetch', async () => {
      const res = mockRes();
      await handler(mockReq({ pathSegments: ['.', 'quote'] }), res as any);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'invalid_path' });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('rejects ".." segments with 400', async () => {
      const res = mockRes();
      await handler(mockReq({ pathSegments: ['..', 'foo'] }), res as any);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('rejects segments containing a slash', async () => {
      const res = mockRes();
      await handler(mockReq({ pathSegments: ['foo/../bar'] }), res as any);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe('request headers', () => {
    it('injects the spoofed origin, referer, and user-agent', async () => {
      await handler(mockReq(), mockRes() as any);
      const headers = getFetchCall().init.headers as Record<string, string>;
      expect(headers.origin).toBe('https://jumper.xyz');
      expect(headers.referer).toBe('https://jumper.xyz/');
      expect(headers['user-agent']).toContain('Mozilla/5.0');
    });

    it('forwards safelisted LI.FI and content headers', async () => {
      await handler(
        mockReq({
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'x-lifi-integrator': 'pruv',
            'x-lifi-widget': '3.40.12',
            'x-lifi-sdk': '3.0.0',
          },
        }),
        mockRes() as any,
      );
      const headers = getFetchCall().init.headers as Record<string, string>;
      expect(headers.accept).toBe('application/json');
      expect(headers['content-type']).toBe('application/json');
      expect(headers['x-lifi-integrator']).toBe('pruv');
      expect(headers['x-lifi-widget']).toBe('3.40.12');
      expect(headers['x-lifi-sdk']).toBe('3.0.0');
    });

    it('drops non-safelisted client headers (cookies, auth, host, etc.)', async () => {
      await handler(
        mockReq({
          headers: {
            cookie: 'session=secret',
            authorization: 'Bearer token',
            host: 'attacker.example',
            'x-forwarded-for': '1.2.3.4',
          },
        }),
        mockRes() as any,
      );
      const headers = getFetchCall().init.headers as Record<string, string>;
      expect(headers.cookie).toBeUndefined();
      expect(headers.authorization).toBeUndefined();
      expect(headers.host).toBeUndefined();
      expect(headers['x-forwarded-for']).toBeUndefined();
    });

    it('joins array-valued headers with ", "', async () => {
      await handler(
        mockReq({ headers: { 'accept-language': ['en-US', 'en;q=0.9'] } }),
        mockRes() as any,
      );
      const headers = getFetchCall().init.headers as Record<string, string>;
      expect(headers['accept-language']).toBe('en-US, en;q=0.9');
    });
  });

  describe('request body', () => {
    it('does not read a body for GET', async () => {
      await handler(mockReq({ method: 'GET' }), mockRes() as any);
      expect(getFetchCall().init.body).toBeUndefined();
    });

    it('does not read a body for HEAD', async () => {
      await handler(mockReq({ method: 'HEAD' }), mockRes() as any);
      expect(getFetchCall().init.body).toBeUndefined();
    });

    it('streams the raw body through for POST', async () => {
      const payload = JSON.stringify({ fromChainId: 1, toChainId: 137 });
      await handler(mockReq({ method: 'POST', body: payload }), mockRes() as any);
      const body = getFetchCall().init.body as Buffer;
      expect(Buffer.isBuffer(body)).toBe(true);
      expect(body.toString()).toBe(payload);
    });

    it('rejects oversized request bodies with 413 and never calls fetch', async () => {
      const big = Buffer.alloc(1_000_001, 'x');
      const res = mockRes();
      await handler(mockReq({ method: 'POST', body: big }), res as any);
      expect(res.status).toHaveBeenCalledWith(413);
      expect(res.json).toHaveBeenCalledWith({ error: 'request_body_too_large' });
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe('upstream response mirroring', () => {
    it('mirrors the status code', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(upstreamResponse('rate limited', { status: 429 })),
      );
      const res = mockRes();
      await handler(mockReq(), res as any);
      expect(res.status).toHaveBeenCalledWith(429);
    });

    it('copies safe response headers through to the caller', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          upstreamResponse('ok', {
            headers: {
              'content-type': 'application/json',
              'cache-control': 'no-store',
              'x-custom': 'keep-me',
            },
          }),
        ),
      );
      const res = mockRes();
      await handler(mockReq(), res as any);
      const headerNames = res.setHeader.mock.calls.map((c) => c[0].toLowerCase());
      expect(headerNames).toContain('content-type');
      expect(headerNames).toContain('cache-control');
      expect(headerNames).toContain('x-custom');
    });

    it('strips content-encoding, transfer-encoding, and content-length', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          upstreamResponse('ok', {
            headers: {
              'content-encoding': 'gzip',
              'transfer-encoding': 'chunked',
              'content-length': '999',
              'x-keep': 'yes',
            },
          }),
        ),
      );
      const res = mockRes();
      await handler(mockReq(), res as any);
      const headerNames = res.setHeader.mock.calls.map((c) => c[0].toLowerCase());
      expect(headerNames).not.toContain('content-encoding');
      expect(headerNames).not.toContain('transfer-encoding');
      expect(headerNames).not.toContain('content-length');
      expect(headerNames).toContain('x-keep');
    });

    it('sends the upstream body back as a Buffer', async () => {
      const payload = JSON.stringify({ routes: [] });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(upstreamResponse(payload)));
      const res = mockRes();
      await handler(mockReq(), res as any);
      const sent = res.send.mock.calls[0][0] as Buffer;
      expect(Buffer.isBuffer(sent)).toBe(true);
      expect(sent.toString()).toBe(payload);
    });

    it('rejects oversized upstream responses with 502', async () => {
      const big = Buffer.alloc(5_000_001, 'y');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(upstreamResponse(big)));
      const res = mockRes();
      await handler(mockReq(), res as any);
      expect(res.status).toHaveBeenLastCalledWith(502);
      expect(res.json).toHaveBeenCalledWith({ error: 'upstream_response_too_large' });
    });
  });

  describe('error handling', () => {
    it('returns 502 on upstream fetch failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('dns lookup failed')));
      const res = mockRes();
      await handler(mockReq(), res as any);
      expect(res.status).toHaveBeenCalledWith(502);
      expect(res.json).toHaveBeenCalledWith({ error: 'upstream_failed' });
    });

    it('returns 504 when upstream aborts (timeout)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((_url, init?: RequestInit) => {
          return new Promise((_resolve, reject) => {
            const signal = init?.signal;
            if (signal) {
              signal.addEventListener('abort', () => {
                const err = new Error('aborted');
                err.name = 'AbortError';
                reject(err);
              });
            }
          });
        }),
      );
      vi.useFakeTimers();
      const res = mockRes();
      const pending = handler(mockReq(), res as any);
      await vi.advanceTimersByTimeAsync(20_000);
      await pending;
      expect(res.status).toHaveBeenCalledWith(504);
      expect(res.json).toHaveBeenCalledWith({ error: 'upstream_timeout' });
    });
  });
});
