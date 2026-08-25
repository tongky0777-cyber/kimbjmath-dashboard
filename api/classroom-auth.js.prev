const crypto = require('crypto');

const PW_SALT = 'kbjm.classroom.v1|';
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 12;
const loginAttempts = new Map();

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function allowedOrigin(origin) {
  const raw = process.env.NOTIFY_ALLOWED_ORIGINS || process.env.CLASSROOM_ALLOWED_ORIGINS || '';
  const list = raw.split(',').map((v) => v.trim()).filter(Boolean);
  if (!list.length) return '';
  return list.includes(origin) ? origin : '';
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 12000) {
        reject(new Error('payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function clientIp(req) {
  const raw = req.headers['x-forwarded-for'] || req.socket && req.socket.remoteAddress || '';
  return String(raw).split(',')[0].trim() || 'unknown';
}

function tooManyAttempts(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const rec = loginAttempts.get(ip) || { count: 0, resetAt: now + LOGIN_WINDOW_MS };
  if (now > rec.resetAt) {
    rec.count = 0;
    rec.resetAt = now + LOGIN_WINDOW_MS;
  }
  rec.count++;
  loginAttempts.set(ip, rec);
  return rec.count > LOGIN_MAX_ATTEMPTS;
}

function clearAttempts(req) {
  loginAttempts.delete(clientIp(req));
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payload) {
  const secret = process.env.CLASSROOM_AUTH_SECRET;
  if (!secret) throw new Error('CLASSROOM_AUTH_SECRET env missing');
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return body + '.' + sig;
}

function verify(token) {
  const secret = process.env.CLASSROOM_AUTH_SECRET;
  if (!secret) throw new Error('CLASSROOM_AUTH_SECRET env missing');
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  const expected = crypto.createHmac('sha256', secret).update(parts[0]).digest('base64url');
  if (!safeEqual(parts[1], expected)) return null;
  const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

function login(body) {
  const id = String(body.id || '').trim();
  const pw = String(body.pw || '');
  const hash = sha256(PW_SALT + pw);
  const adminId = process.env.CLASSROOM_ADMIN_ID || '김병진';
  const assistId = process.env.CLASSROOM_ASSIST_ID || '조교';
  const adminHash = process.env.CLASSROOM_ADMIN_PW_HASH || '';
  const assistHash = process.env.CLASSROOM_ASSIST_PW_HASH || '';

  let role = '';
  let name = '';
  if (id === adminId && adminHash && safeEqual(hash, adminHash)) {
    role = 'admin';
    name = adminId;
  } else if (id === assistId && assistHash && safeEqual(hash, assistHash)) {
    role = 'assistant';
    name = assistId;
  } else {
    return { ok: false };
  }

  const payload = {
    role,
    name,
    uid: role,
    key: name,
    exp: Date.now() + TOKEN_TTL_MS
  };
  return Object.assign({ ok: true, token: sign(payload) }, payload);
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allow = allowedOrigin(origin);
  if (allow) {
    res.setHeader('Access-Control-Allow-Origin', allow);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = allow ? 204 : 403;
    res.end();
    return;
  }
  if (!allow) {
    json(res, 403, { ok: false, error: 'origin not allowed' });
    return;
  }
  if (req.method !== 'POST') {
    json(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }

  try {
    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : {};
    if (body.action === 'login') {
      if (tooManyAttempts(req)) {
        json(res, 429, { ok: false, error: 'too many attempts' });
        return;
      }
      const result = login(body);
      if (result.ok) clearAttempts(req);
      json(res, result.ok ? 200 : 401, result.ok ? result : { ok: false, error: 'invalid login' });
      return;
    }
    if (body.action === 'verify') {
      const payload = verify(body.token);
      json(res, payload ? 200 : 401, payload ? Object.assign({ ok: true }, payload) : { ok: false, error: 'invalid token' });
      return;
    }
    json(res, 400, { ok: false, error: 'unknown action' });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message || 'auth failed' });
  }
};
