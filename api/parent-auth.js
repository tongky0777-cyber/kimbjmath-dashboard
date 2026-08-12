const crypto = require('crypto');
const https = require('https');

const CODE_SALT = 'kbjm.parent.v1|';
const TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 20;
const loginAttempts = new Map();
let serviceAccessToken = null;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function sameOrigin(req, origin) {
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch (err) { return false; }
}

function allowedOrigin(req) {
  const origin = req.headers.origin || '';
  if (sameOrigin(req, origin)) return origin;
  const raw = process.env.NOTIFY_ALLOWED_ORIGINS || process.env.CLASSROOM_ALLOWED_ORIGINS || '';
  const list = raw.split(',').map((v) => v.trim()).filter(Boolean);
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

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function clientIp(req) {
  const raw = req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '';
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
  rec.count += 1;
  loginAttempts.set(ip, rec);
  return rec.count > LOGIN_MAX_ATTEMPTS;
}

function clearAttempts(req) {
  loginAttempts.delete(clientIp(req));
}

function b64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function sign(payload) {
  const secret = process.env.CLASSROOM_AUTH_SECRET;
  if (!secret) throw new Error('CLASSROOM_AUTH_SECRET env missing');
  const body = b64urlJson(payload);
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return body + '.' + sig;
}

function verifyToken(token) {
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

function postJSON(hostname, path, bodyObj) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(bodyObj);
    const req = https.request({
      hostname,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error('HTTP ' + res.statusCode + ': ' + data.slice(0, 300)));
          return;
        }
        try { resolve(JSON.parse(data || 'null')); } catch (err) { resolve(data); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function postForm(hostname, path, formObj) {
  return new Promise((resolve, reject) => {
    const payload = new URLSearchParams(formObj).toString();
    const req = https.request({
      hostname,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error('HTTP ' + res.statusCode + ': ' + data.slice(0, 300)));
          return;
        }
        try { resolve(JSON.parse(data || 'null')); } catch (err) { resolve(data); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function serviceAccountFromEnv() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '';
  if (!raw.trim()) return null;
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  const account = JSON.parse(text);
  if (!account.client_email || !account.private_key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is missing client_email/private_key');
  }
  return account;
}

function serviceJwt(account) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64urlJson({ alg: 'RS256', typ: 'JWT' }) + '.' + b64urlJson({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  });
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(account.private_key).toString('base64url');
  return unsigned + '.' + sig;
}

function serviceSignIn() {
  const account = serviceAccountFromEnv();
  if (!account) return Promise.resolve(null);
  if (serviceAccessToken && Date.now() < serviceAccessToken.expiresAt - 60000) {
    return Promise.resolve(serviceAccessToken.token);
  }
  return postForm('oauth2.googleapis.com', '/token', {
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: serviceJwt(account)
  }).then((r) => {
    if (!r || !r.access_token) throw new Error('Firebase service account sign-in failed');
    serviceAccessToken = {
      token: r.access_token,
      expiresAt: Date.now() + Math.max(60, Number(r.expires_in || 3600)) * 1000
    };
    return serviceAccessToken.token;
  });
}

function anonSignIn() {
  const apiKey = process.env.FB_API_KEY;
  if (!apiKey) throw new Error('FB_API_KEY env missing');
  return postJSON('identitytoolkit.googleapis.com',
    '/v1/accounts:signUp?key=' + encodeURIComponent(apiKey),
    { returnSecureToken: true }
  ).then((r) => {
    if (!r || !r.idToken) throw new Error('Firebase anonymous sign-in failed');
    return r.idToken;
  });
}

function firebaseSignIn() {
  return serviceSignIn().then((accessToken) => {
    if (accessToken) return { param: 'access_token', token: accessToken };
    return anonSignIn().then((idToken) => ({ param: 'auth', token: idToken }));
  });
}

function dbUrl(dbPath, credential) {
  const root = process.env.FB_DB_URL;
  if (!root) throw new Error('FB_DB_URL env missing');
  const clean = dbPath.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  return root.replace(/\/$/, '') + '/' + clean + '.json?' + credential.param + '=' + encodeURIComponent(credential.token);
}

function fbRequest(method, dbPath, credential, value) {
  return new Promise((resolve, reject) => {
    const url = new URL(dbUrl(dbPath, credential));
    const payload = value === undefined ? '' : JSON.stringify(value);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: payload ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      } : {}
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error('Firebase HTTP ' + res.statusCode + ': ' + data.slice(0, 300)));
          return;
        }
        try { resolve(JSON.parse(data || 'null')); } catch (err) { resolve(data); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allow = allowedOrigin(req);
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
  if (!allow && origin) {
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

    if (body.action === 'verify') {
      const auth = verifyToken(body.token);
      json(res, auth && auth.role === 'parent' ? 200 : 401, auth && auth.role === 'parent' ? { ok: true, student: auth.student } : { ok: false, error: 'invalid token' });
      return;
    }

    if (body.action !== 'login') {
      json(res, 400, { ok: false, error: 'unknown action' });
      return;
    }
    if (tooManyAttempts(req)) {
      json(res, 429, { ok: false, error: 'too many attempts' });
      return;
    }

    const code = String(body.code || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (code.length < 6 || code.length > 16) {
      json(res, 401, { ok: false, error: 'invalid login' });
      return;
    }

    const portalId = sha256(CODE_SALT + code);
    const credential = await firebaseSignIn();
    const portal = await fbRequest('GET', 'bjm_parentPortals/' + portalId, credential);
    if (!portal || portal.enabled === false || !portal.sid || !portal.student) {
      json(res, 401, { ok: false, error: 'invalid login' });
      return;
    }

    clearAttempts(req);
    const payload = {
      role: 'parent',
      sid: portal.sid,
      portalId,
      student: portal.student,
      exp: Date.now() + TOKEN_TTL_MS
    };
    json(res, 200, {
      ok: true,
      token: sign(payload),
      student: portal.student,
      groups: Array.isArray(portal.groups) ? portal.groups : []
    });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message || 'parent auth failed' });
  }
};
