import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// Read .env without adding a dependency.
try {
  const envText = await readFile(path.join(ROOT, '.env'), 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch {}

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);
const LLM_BASE_URL = (process.env.LLM_BASE_URL || 'http://127.0.0.1:8080/v1').replace(/\/+$/, '');
const LLM_MODEL = process.env.LLM_MODEL || 'local-model';
const LLM_API_KEY = process.env.LLM_API_KEY || '';
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || '';
const MAX_OUTPUT_TOKENS = Math.max(128, Math.min(8192, Number(process.env.MAX_OUTPUT_TOKENS || 2048)));
const MAX_BODY_BYTES = 15 * 1024 * 1024;
const INDEX = await readFile(path.join(ROOT, 'index.html'));

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"
  });
  res.end(body);
}
function json(res, status, data) { send(res, status, JSON.stringify(data)); }
function authorized(req) {
  if (!ACCESS_TOKEN) return true;
  const got = req.headers.authorization || '';
  return got === `Bearer ${ACCESS_TOKEN}`;
}
async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('حجم الطلب أكبر من الحد المسموح (15MB).'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('صيغة الطلب غير صحيحة.'), { status: 400 }); }
}
function upstreamHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (LLM_API_KEY) h.Authorization = `Bearer ${LLM_API_KEY}`;
  return h;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    return send(res, 200, INDEX, 'text/html; charset=utf-8');
  }
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(res, 200, { ok: true, modelServer: LLM_BASE_URL, model: LLM_MODEL, accessTokenRequired: Boolean(ACCESS_TOKEN) });
  }
  if (url.pathname.startsWith('/api/')) {
    if (!authorized(req)) return json(res, 401, { error: 'يلزم رمز الوصول. أضف الرمز في إعدادات المنصة.' });
  }
  if (req.method === 'GET' && url.pathname === '/api/models') {
    try {
      const r = await fetch(`${LLM_BASE_URL}/models`, { headers: LLM_API_KEY ? { Authorization: `Bearer ${LLM_API_KEY}` } : {}, signal: AbortSignal.timeout(10000) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return json(res, 502, { error: data.error?.message || `خادم النموذج ردّ برمز ${r.status}` });
      return json(res, 200, { models: data.data || [] });
    } catch (e) {
      return json(res, 503, { error: `تعذر الاتصال بخادم النموذج المحلي على ${LLM_BASE_URL}. شغّل خادم النموذج أولاً.`, details: String(e.message || e) });
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    let input;
    try { input = await readJson(req); }
    catch (e) { return json(res, e.status || 400, { error: e.message || 'طلب غير صالح.' }); }
    if (!Array.isArray(input.messages) || input.messages.length === 0) return json(res, 400, { error: 'أرسل رسالة واحدة على الأقل.' });
    const messages = input.messages.slice(-40).map(m => {
      const role = ['user', 'assistant', 'system'].includes(m.role) ? m.role : 'user';
      let content = m.content;
      if (typeof content === 'string') content = content.slice(0, 30000);
      else if (Array.isArray(content)) {
        content = content.filter(p => p && (p.type === 'text' || p.type === 'image_url')).map(p => {
          if (p.type === 'text') return { type: 'text', text: String(p.text || '').slice(0, 30000) };
          const u = p.image_url?.url;
          if (typeof u === 'string' && /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(u)) return { type: 'image_url', image_url: { url: u } };
          return null;
        }).filter(Boolean);
      } else content = String(content ?? '').slice(0, 30000);
      return { role, content };
    });
    try {
      const upstream = await fetch(`${LLM_BASE_URL}/chat/completions`, {
        method: 'POST', headers: upstreamHeaders(),
        body: JSON.stringify({ model: input.model || LLM_MODEL, messages, stream: true, temperature: 0.7, max_tokens: MAX_OUTPUT_TOKENS }),
        signal: AbortSignal.timeout(180000)
      });
      if (!upstream.ok) {
        const detail = await upstream.text().catch(() => '');
        return json(res, 502, { error: `خادم النموذج رفض الطلب (${upstream.status}).`, details: detail.slice(0, 1500) });
      }
      if (!upstream.body) return json(res, 502, { error: 'خادم النموذج لم يرجع بثّاً للنتيجة.' });
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'X-Content-Type-Options': 'nosniff'
      });
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!res.write(decoder.decode(value, { stream: true }))) await new Promise(resolve => res.once('drain', resolve));
        }
        const tail = decoder.decode(); if (tail) res.write(tail);
        res.end();
      } catch (e) { if (!res.destroyed) res.end(`data: ${JSON.stringify({ error: 'انقطع الاتصال أثناء توليد الإجابة.' })}\n\n`); }
      return;
    } catch (e) {
      return json(res, 503, { error: `تعذر الاتصال بالنموذج. تأكد أن خادم النموذج يعمل على ${LLM_BASE_URL}.`, details: String(e.message || e) });
    }
  }
  if (req.method === 'GET' && url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
  return json(res, 404, { error: 'المسار غير موجود.' });
});
server.listen(PORT, HOST, () => {
  console.log(`Qasim AI: http://${HOST}:${PORT}`);
  console.log(`Model endpoint: ${LLM_BASE_URL}`);
  if (!ACCESS_TOKEN && HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1') {
    console.warn('WARNING: ACCESS_TOKEN is empty while listening on a public interface. Set ACCESS_TOKEN before exposing this server.');
  }
});
