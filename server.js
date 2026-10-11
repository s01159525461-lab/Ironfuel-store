'use strict';
const http = require('node:http');
const path = require('node:path');
const { HttpError, send, readBody, serveStatic } = require('./lib/http');
const { router, loadUser, UPLOAD_DIR } = require('./lib/api');
const { rateLimit } = require('./lib/auth');
const { ensureAdmin, seedDemo } = require('./lib/seed');

try { process.loadEnvFile?.(path.join(__dirname, '.env')); } catch { /* .env اختياري */ }

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const PUBLIC = path.join(__dirname, 'public');

ensureAdmin();
seedDemo();

const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  "font-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');

function secHeaders(res, secure) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const ip = (TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';
  const secure = TRUST_PROXY ? req.headers['x-forwarded-proto'] === 'https' : !!req.socket.encrypted;
  secHeaders(res, secure);
  res.on('finish', () => { if (process.env.LOG_REQUESTS === '1') console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`); });

  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    // ---------- API ----------
    if (pathname.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store');
      if (!rateLimit(`api:${ip}`, 600, 60_000)) throw new HttpError(429, 'طلبات كتير، استنى شوية');
      const m = router.match(req.method, pathname);
      if (!m) throw new HttpError(404, 'غير موجود');

      const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
      if (isWrite) { // حماية CSRF: لازم الـ Origin يطابق الـ Host لو موجود
        const origin = req.headers.origin;
        if (origin) { let oh = ''; try { oh = new URL(origin).host; } catch {} if (oh !== req.headers.host) throw new HttpError(403, 'Origin غير مسموح'); }
      }

      const fns = m.handlers.filter((h) => typeof h === 'function');
      const opts = m.handlers.find((h) => typeof h === 'object') || {};
      const ctx = { req, res, ip, secure, params: m.params, query: Object.fromEntries(url.searchParams), body: {}, user: null, rawBody: null };
      loadUser(ctx);

      if (isWrite) {
        const isUpload = pathname === '/api/admin/upload';
        const buf = await readBody(req, isUpload ? 5_000_000 : 1_000_000);
        if (opts.raw) ctx.rawBody = buf;
        else if (buf.length) {
          if (!String(req.headers['content-type'] || '').includes('application/json')) throw new HttpError(415, 'Content-Type must be application/json');
          try { ctx.body = JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'JSON غير صالح'); }
          if (ctx.body === null || typeof ctx.body !== 'object' || Array.isArray(ctx.body)) throw new HttpError(400, 'جسم الطلب غير صالح');
        }
      }

      let result;
      for (const fn of fns) { result = await fn(ctx); if (result !== undefined) break; }
      if (res.writableEnded) return;
      return send(res, 200, result ?? { ok: true });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');

    // ---------- uploads ----------
    if (pathname.startsWith('/uploads/')) {
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      if (serveStatic(req, res, UPLOAD_DIR, pathname.slice('/uploads'.length))) return;
      return send(res, 404, 'Not found');
    }

    // ---------- pages ----------
    if (pathname.startsWith('/pay/')) { if (serveStatic(req, res, PUBLIC, '/pay.html')) return; }
    if (pathname === '/admin') { res.writeHead(302, { Location: '/admin/' }); return res.end(); }
    if (serveStatic(req, res, PUBLIC, pathname)) return;
    return send(res, 404, 'Not found');
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message, ...(e.extra || {}) });
    console.error('[error]', req.method, req.url, e);
    return send(res, 500, { error: 'حصل خطأ في السيرفر' });
  }
});

server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.listen(PORT, HOST, () => console.log(`IronFuel يعمل على http://localhost:${PORT}  (الأدمن: /admin)`));

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { console.log('إيقاف السيرفر...'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); });
module.exports = server;
