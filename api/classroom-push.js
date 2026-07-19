const crypto = require('crypto');
const https = require('https');

const VAPID_PUBLIC_KEY_FALLBACK = 'BPE7ba752gziPWYhyiSNQeXLKdzI1aPdO4e28bcdTliKXzu5ZD6MfBmz9t_6j5texTdb5_9xjEFHOM3ZyLpBa6A';
let serviceAccessToken = null;

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
      if (data.length > 60000) {
        reject(new Error('payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function b64urlJson(value) {
  return b64url(JSON.stringify(value));
}

function fromB64url(value) {
  return Buffer.from(String(value || ''), 'base64url');
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
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
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };
  const unsigned = b64urlJson(header) + '.' + b64urlJson(claim);
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

function cleanPrefix(prefix) {
  const p = String(prefix || '');
  if (!/^[A-Za-z0-9_]*$/.test(p)) throw new Error('invalid prefix');
  return p;
}

function cp(prefix, rel) {
  return cleanPrefix(prefix) + rel;
}

function hkdf(secret, salt, info, length) {
  return crypto.hkdfSync('sha256', secret, salt, info, length);
}

function vapidJwt(aud) {
  const publicKey = process.env.VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY_FALLBACK;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!privateKey) throw new Error('VAPID_PRIVATE_KEY env missing');

  const pub = fromB64url(publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('invalid VAPID_PUBLIC_KEY');
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: pub.subarray(1, 33).toString('base64url'),
    y: pub.subarray(33, 65).toString('base64url'),
    d: privateKey
  };
  const key = crypto.createPrivateKey({ key: jwk, format: 'jwk' });
  const header = { typ: 'JWT', alg: 'ES256' };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    aud,
    exp: now + 12 * 60 * 60,
    sub: process.env.VAPID_SUBJECT || 'mailto:kimbjmath@example.com'
  };
  const unsigned = b64urlJson(header) + '.' + b64urlJson(claim);
  const sig = crypto.sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return {
    publicKey,
    authorization: 'vapid t=' + unsigned + '.' + sig + ', k=' + publicKey
  };
}

function encryptPushPayload(subscription, payload) {
  const userPublicKey = fromB64url(subscription.keys && subscription.keys.p256dh);
  const authSecret = fromB64url(subscription.keys && subscription.keys.auth);
  if (userPublicKey.length !== 65 || authSecret.length !== 16) {
    throw new Error('invalid subscription keys');
  }

  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const localPublicKey = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(userPublicKey);
  const salt = crypto.randomBytes(16);

  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'),
    userPublicKey,
    localPublicKey
  ]);
  const ikm = hkdf(sharedSecret, authSecret, keyInfo, 32);
  const cek = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);

  const plain = Buffer.concat([Buffer.from(payload), Buffer.from([2])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);

  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096, 0);
  return Buffer.concat([salt, rs, Buffer.from([localPublicKey.length]), localPublicKey, encrypted]);
}

function sendOne(subscription, message) {
  return new Promise((resolve) => {
    try {
      const endpoint = String(subscription.endpoint || '');
      if (!endpoint) { resolve({ ok: false, gone: true }); return; }
      const url = new URL(endpoint);
      const aud = url.origin;
      const vapid = vapidJwt(aud);
      const body = encryptPushPayload(subscription, JSON.stringify(message));
      const req = https.request({
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          TTL: '86400',
          Urgency: 'normal',
          Authorization: vapid.authorization,
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          'Content-Length': body.length
        }
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            gone: res.statusCode === 404 || res.statusCode === 410,
            status: res.statusCode,
            body: data.slice(0, 200)
          });
        });
      });
      req.on('error', (err) => resolve({ ok: false, error: err.message }));
      req.write(body);
      req.end();
    } catch (err) {
      resolve({ ok: false, error: err.message });
    }
  });
}

function requireStaff(auth) {
  if (!auth || (auth.role !== 'admin' && auth.role !== 'assistant')) {
    throw new Error('staff token required');
  }
}

function cleanKeys(keys) {
  return [...new Set((keys || []).map((k) => String(k || '').trim()).filter(Boolean))].slice(0, 150);
}

function messageFromBody(body) {
  return {
    title: String(body.title || '김병진T 알림').slice(0, 80),
    body: String(body.body || '').slice(0, 240),
    url: String(body.url || './').slice(0, 300),
    tag: String(body.tag || ('class-' + Date.now())).slice(0, 80)
  };
}

async function sendToKeys(keys, body, credential, prefix) {
  const subs = await fbRequest('GET', cp(prefix, 'push_subscriptions'), credential) || {};
  const message = messageFromBody(body);
  const targets = cleanKeys(keys).map((key) => ({ key, sub: subs[key] })).filter((row) => row.sub && row.sub.endpoint);
  const results = await Promise.all(targets.map((row) => sendOne(row.sub, message).then((r) => Object.assign({ key: row.key }, r))));
  const gone = results.filter((r) => r.gone).map((r) => r.key);
  await Promise.all(gone.map((key) => fbRequest('DELETE', cp(prefix, 'push_subscriptions/' + key), credential).catch(() => null)));
  return {
    requested: cleanKeys(keys).length,
    subscribed: targets.length,
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length
  };
}

async function handleAction(body, auth, credential) {
  requireStaff(auth);
  const prefix = cleanPrefix(body.prefix);
  const action = body.action;

  if (action === 'sendToKeys') {
    return sendToKeys(body.keys || [], body, credential, prefix);
  }

  if (action === 'sendToClass') {
    const cid = String(body.cid || '').trim();
    if (!cid) throw new Error('cid required');
    const cls = await fbRequest('GET', cp(prefix, 'class_classes/' + cid), credential);
    const keys = Object.keys(cls && cls.members || {});
    return sendToKeys(keys, body, credential, prefix);
  }

  if (action === 'sendTest') {
    return sendToKeys([auth.key || auth.name || auth.uid], body, credential, prefix);
  }

  if (action === 'sendPostOwner') {
    const cid = String(body.cid || '').trim();
    const pid = String(body.pid || '').trim();
    if (!cid || !pid) throw new Error('cid/pid required');
    const post = await fbRequest('GET', cp(prefix, 'class_posts/' + cid + '/' + pid), credential);
    let key = post && post.key;
    if (!key && post && post.uid) {
      const cls = await fbRequest('GET', cp(prefix, 'class_classes/' + cid), credential);
      const members = cls && cls.members || {};
      key = Object.keys(members).find((k) => members[k] && members[k].uid === post.uid);
    }
    return sendToKeys(key ? [key] : [], body, credential, prefix);
  }

  throw new Error('unknown action');
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
    const auth = verifyToken(body.token);
    if (!auth || (auth.role !== 'admin' && auth.role !== 'assistant')) {
      json(res, 401, { ok: false, error: 'staff token required' });
      return;
    }
    const credential = await firebaseSignIn();
    const result = await handleAction(body, auth, credential);
    json(res, 200, Object.assign({ ok: true }, result));
  } catch (err) {
    json(res, 500, { ok: false, error: err.message || 'push failed' });
  }
};
