const crypto = require('crypto');
const https = require('https');

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
      if (data.length > 20000) {
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
  return payload.role === 'parent' ? payload : null;
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

function arr(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'object') return Object.values(value).filter(Boolean);
  return [];
}

function cleanText(value, max) {
  return String(value || '').trim().slice(0, max);
}

function ymd(value) {
  const text = cleanText(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('date required');
  return text;
}

function slotAllowsGroup(slot, group) {
  if (!slot || slot.closed) return false;
  if (!group) return false;
  if (slot.scope === 'groups') return (slot.groupIds || []).includes(group.id);
  if (slot.scope === 'subject') return !slot.subject || slot.subject === group.subject;
  return true;
}

function slotLabel(slot) {
  if (!slot) return '';
  return [slot.date || '', (slot.start || '') + (slot.end ? '-' + slot.end : '')].filter(Boolean).join(' ');
}

function publicRequest(r) {
  return {
    id: r.id,
    sid: r.sid,
    studentName: r.studentName || '',
    groupId: r.groupId || '',
    groupName: r.groupName || '',
    absentDate: r.absentDate || '',
    slotId: r.slotId || '',
    requestedSlotLabel: r.requestedSlotLabel || '',
    customTime: r.customTime || '',
    reason: r.reason || '',
    status: r.status || 'pending',
    finalDate: r.finalDate || '',
    finalTime: r.finalTime || '',
    createdAt: r.createdAt || ''
  };
}

async function loadPortal(auth, credential) {
  if (!auth.portalId || !auth.sid) throw new Error('invalid token');
  const portal = await fbRequest('GET', 'bjm_parentPortals/' + auth.portalId, credential);
  if (!portal || portal.enabled === false || portal.sid !== auth.sid) throw new Error('invalid portal');
  return portal;
}

async function snapshot(auth, credential) {
  const portal = await loadPortal(auth, credential);
  const groups = Array.isArray(portal.groups) ? portal.groups : [];
  const groupIds = new Set(groups.map((g) => g.id));
  const slots = arr(await fbRequest('GET', 'bjm_makeupSlots', credential))
    .filter((slot) => !slot.closed && (!slot.date || slot.date >= new Date().toISOString().slice(0, 10)))
    .filter((slot) => groups.some((g) => groupIds.has(g.id) && slotAllowsGroup(slot, g)))
    .map((slot) => ({
      id: slot.id,
      date: slot.date || '',
      start: slot.start || '',
      end: slot.end || '',
      label: slotLabel(slot),
      scope: slot.scope || 'all',
      subject: slot.subject || ''
    }));
  const requests = arr(await fbRequest('GET', 'bjm_parentMakeupRequests/' + auth.sid, credential)).map(publicRequest);
  return { student: portal.student, groups, slots, requests };
}

async function submit(body, auth, credential) {
  const portal = await loadPortal(auth, credential);
  const groups = Array.isArray(portal.groups) ? portal.groups : [];
  const group = groups.find((g) => g.id === cleanText(body.groupId, 80));
  if (!group) throw new Error('group not allowed');
  if (group.makeupPolicy === 'blocked') throw new Error('makeup blocked');

  const slots = arr(await fbRequest('GET', 'bjm_makeupSlots', credential));
  const slotId = cleanText(body.slotId, 120);
  const slot = slotId ? slots.find((s) => s.id === slotId) : null;
  if (slotId && !slotAllowsGroup(slot, group)) throw new Error('slot not allowed');

  const now = new Date().toISOString();
  const id = 'pmr_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
  const request = {
    id,
    sid: auth.sid,
    portalId: auth.portalId,
    source: 'parentPortal',
    studentName: portal.student && portal.student.name || '',
    groupId: group.id,
    groupName: group.name || '',
    absentDate: ymd(body.absentDate),
    slotId: slot ? slot.id : '',
    requestedSlotLabel: slot ? slotLabel(slot) : '',
    customTime: cleanText(body.customTime, 120),
    reason: cleanText(body.reason, 500),
    status: 'pending',
    createdAt: now,
    updatedAt: now
  };

  if (!request.slotId && !request.customTime) throw new Error('requested time required');
  await fbRequest('PUT', 'bjm_parentMakeupRequests/' + auth.sid + '/' + id, credential, request);
  await fbRequest('PUT', 'bjm_parentMakeupInbox/' + id, credential, request);
  return { request: publicRequest(request) };
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
    const auth = verifyToken(body.token);
    if (!auth) {
      json(res, 401, { ok: false, error: 'invalid token' });
      return;
    }

    const credential = await firebaseSignIn();
    if (body.action === 'snapshot') {
      json(res, 200, Object.assign({ ok: true }, await snapshot(auth, credential)));
      return;
    }
    if (body.action === 'submit') {
      json(res, 200, Object.assign({ ok: true }, await submit(body, auth, credential)));
      return;
    }
    json(res, 400, { ok: false, error: 'unknown action' });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message || 'parent makeup failed' });
  }
};
