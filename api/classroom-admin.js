const crypto = require('crypto');
const https = require('https');

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
      if (data.length > 6 * 1024 * 1024) {
        reject(new Error('payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
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

function b64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
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

function requireText(value, label, max) {
  const text = String(value || '').trim();
  if (!text) throw new Error(label + ' required');
  if (text.length > max) throw new Error(label + ' too long');
  return text;
}

function requireFullAdmin(auth) {
  if (!auth || auth.role !== 'admin') throw new Error('admin token required');
}

function requireStaff(auth) {
  if (!auth || (auth.role !== 'admin' && auth.role !== 'assistant')) {
    throw new Error('staff token required');
  }
}

function needsFullAdmin(action) {
  return [
    'createClass',
    'assignToClass',
    'rejectSignup',
    'removeMember',
    'moveMember',
    'setPlannerShare',
    'renameClass',
    'deleteClass'
  ].includes(action);
}

async function handleAction(body, credential, auth) {
  const prefix = cleanPrefix(body.prefix);
  const action = body.action;

  if (action === 'createClass') {
    requireFullAdmin(auth);
    const name = requireText(body.name, 'name', 80);
    const cid = 'c' + Date.now();
    await fbRequest('PUT', cp(prefix, 'class_classes/' + cid), credential, {
      name,
      createdAt: new Date().toISOString(),
      members: {}
    });
    return { cid };
  }

  if (action === 'createPost') {
    requireStaff(auth);
    const cid = requireText(body.cid, 'cid', 80);
    const id = 'p' + Date.now();
    const post = body.post || {};
    const type = post.type === 'qna' ? 'qna' : 'feed';
    await fbRequest('PUT', cp(prefix, 'class_posts/' + cid + '/' + id), credential, {
      uid: auth.uid || auth.role,
      author: auth.name || post.author || auth.role,
      role: auth.role,
      type,
      text: String(post.text || '').slice(0, 5000),
      imgs: Array.isArray(post.imgs) ? post.imgs : null,
      file: post.file || null,
      createdAt: new Date().toISOString()
    });
    return { id };
  }

  if (action === 'deletePost') {
    requireStaff(auth);
    const cid = requireText(body.cid, 'cid', 80);
    const pid = requireText(body.pid, 'pid', 120);
    await fbRequest('DELETE', cp(prefix, 'class_posts/' + cid + '/' + pid), credential);
    return {};
  }

  if (action === 'editPostText') {
    requireStaff(auth);
    const cid = requireText(body.cid, 'cid', 80);
    const pid = requireText(body.pid, 'pid', 120);
    const text = String(body.text || '').slice(0, 5000);
    await fbRequest('PUT', cp(prefix, 'class_posts/' + cid + '/' + pid + '/text'), credential, text);
    return {};
  }

  if (action === 'saveAnswer') {
    requireStaff(auth);
    const cid = requireText(body.cid, 'cid', 80);
    const pid = requireText(body.pid, 'pid', 120);
    const answer = body.answer || {};
    await fbRequest('PUT', cp(prefix, 'class_posts/' + cid + '/' + pid + '/answer'), credential, {
      text: String(answer.text || '').slice(0, 5000),
      by: auth.name || answer.by || auth.role,
      at: new Date().toISOString(),
      imgs: Array.isArray(answer.imgs) ? answer.imgs : null,
      file: answer.file || null
    });
    return {};
  }

  if (action === 'assignToClass') {
    requireFullAdmin(auth);
    const key = requireText(body.key, 'key', 120);
    const cid = requireText(body.cid, 'cid', 80);
    const signup = await fbRequest('GET', cp(prefix, 'class_signups/' + key), credential);
    if (!signup) throw new Error('signup not found');
    await fbRequest('PUT', cp(prefix, 'class_classes/' + cid + '/members/' + key), credential, {
      name: signup.name || key,
      uid: signup.uid || null
    });
    await fbRequest('DELETE', cp(prefix, 'class_signups/' + key), credential);
    return { name: signup.name || key };
  }

  if (action === 'rejectSignup') {
    requireFullAdmin(auth);
    const key = requireText(body.key, 'key', 120);
    await fbRequest('DELETE', cp(prefix, 'class_signups/' + key), credential);
    return {};
  }

  if (action === 'removeMember') {
    requireFullAdmin(auth);
    const cid = requireText(body.cid, 'cid', 80);
    const key = requireText(body.key, 'key', 120);
    await fbRequest('DELETE', cp(prefix, 'class_classes/' + cid + '/members/' + key), credential);
    return {};
  }

  if (action === 'moveMember') {
    requireFullAdmin(auth);
    const fromCid = requireText(body.fromCid, 'fromCid', 80);
    const toCid = requireText(body.toCid, 'toCid', 80);
    const key = requireText(body.key, 'key', 120);
    const member = await fbRequest('GET', cp(prefix, 'class_classes/' + fromCid + '/members/' + key), credential);
    if (!member) throw new Error('member not found');
    await fbRequest('PUT', cp(prefix, 'class_classes/' + toCid + '/members/' + key), credential, {
      name: member.name || key,
      uid: member.uid || null
    });
    await fbRequest('DELETE', cp(prefix, 'class_classes/' + fromCid + '/members/' + key), credential);
    return { name: member.name || key };
  }

  if (action === 'setPlannerShare') {
    requireFullAdmin(auth);
    const cid = requireText(body.cid, 'cid', 80);
    await fbRequest('PUT', cp(prefix, 'class_classes/' + cid + '/plannerShare'), credential, !!body.value);
    return {};
  }

  if (action === 'renameClass') {
    requireFullAdmin(auth);
    const cid = requireText(body.cid, 'cid', 80);
    const name = requireText(body.name, 'name', 80);
    await fbRequest('PUT', cp(prefix, 'class_classes/' + cid + '/name'), credential, name);
    return {};
  }

  if (action === 'deleteClass') {
    requireFullAdmin(auth);
    const cid = requireText(body.cid, 'cid', 80);
    await fbRequest('DELETE', cp(prefix, 'class_classes/' + cid), credential);
    await fbRequest('DELETE', cp(prefix, 'class_posts/' + cid), credential);
    return {};
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
    if (needsFullAdmin(body.action) && auth.role !== 'admin') {
      json(res, 401, { ok: false, error: 'admin token required' });
      return;
    }

    const credential = await firebaseSignIn();
    const result = await handleAction(body, credential, auth);
    json(res, 200, Object.assign({ ok: true }, result));
  } catch (err) {
    json(res, 500, { ok: false, error: err.message || 'admin action failed' });
  }
};
