const https = require('https');

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function allowedOrigin(origin) {
  const raw = process.env.NOTIFY_ALLOWED_ORIGINS || '';
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

function postTelegram(token, chatId, text) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true
    });

    const req = https.request({
      hostname: 'api.telegram.org',
      path: '/bot' + token + '/sendMessage',
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
          reject(new Error('Telegram HTTP ' + res.statusCode + ': ' + data.slice(0, 300)));
          return;
        }
        resolve();
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
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

  const token = process.env.TELEGRAM_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    json(res, 500, { ok: false, error: 'telegram env missing' });
    return;
  }

  try {
    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : {};
    const text = String(body.text || '').trim();
    if (!text) {
      json(res, 400, { ok: false, error: 'text required' });
      return;
    }
    if (text.length > 3500) {
      json(res, 400, { ok: false, error: 'text too long' });
      return;
    }

    await postTelegram(token, chatId, text);
    json(res, 200, { ok: true });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message || 'send failed' });
  }
};
