#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const CLASSROOM = process.env.CLASSROOM_DIR || path.resolve(ROOT, '..', 'classroom');

const checks = [];

function ok(name, message) {
  checks.push({ name, ok: true, message });
}

function fail(name, message) {
  checks.push({ name, ok: false, message });
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function label(file) {
  const rootRel = path.relative(ROOT, file);
  if (!rootRel.startsWith('..') && !path.isAbsolute(rootRel)) return 'dashboard/' + rootRel;
  const classRel = path.relative(CLASSROOM, file);
  if (!classRel.startsWith('..') && !path.isAbsolute(classRel)) return 'classroom/' + classRel;
  return file;
}

function nodeCheck(file) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status === 0) ok('syntax: ' + label(file));
  else fail('syntax: ' + label(file), (result.stderr || result.stdout || '').trim());
}

function htmlScriptCheck(file) {
  const html = read(file);
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  scripts.forEach((script, index) => {
    try {
      new Function(script);
    } catch (err) {
      fail('html script: ' + label(file) + ' #' + (index + 1), err.message || String(err));
    }
  });
  if (!checks.some((c) => c.name.startsWith('html script: ' + label(file)) && !c.ok)) {
    ok('html script: ' + label(file));
  }
}

function runAioCheck() {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'sync_classroom_aio.js')], {
    encoding: 'utf8'
  });
  if (result.status === 0) ok('AIO textbook/answer-key sync');
  else fail('AIO textbook/answer-key sync', (result.stderr || result.stdout || '').trim());
}

function runAioDataValidation() {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'validate_aio_data.js')], {
    encoding: 'utf8'
  });
  const output = (result.stdout || result.stderr || '').trim();
  if (result.status === 0) {
    const warningLine = output.split(/\r?\n/).filter((line) => line.startsWith('WARN ')).join('\n     ');
    ok('AIO active data validation', warningLine || '');
  } else {
    fail('AIO active data validation', output);
  }
}

function walk(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    if (['.git', 'node_modules', '.vercel'].includes(entry.name)) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  });
}

function secretScan() {
  const files = [];
  [ROOT, CLASSROOM].forEach((dir) => {
    if (fs.existsSync(dir)) walk(dir, files);
  });

  const risky = [];
  const tokenLike = /\b\d{6,}:[A-Za-z0-9_-]{25,}\b/g;
  const legacyTelegramConst = /\bTG_(TOKEN|CHAT_ID)\s*=\s*['"][^'"]+['"]/g;

  files.forEach((file) => {
    if (!/\.(html|js|json|md|txt|css)$/i.test(file)) return;
    const text = read(file);
    if (tokenLike.test(text) || legacyTelegramConst.test(text)) {
      risky.push(path.relative(ROOT, file));
    }
  });

  if (risky.length) fail('secret scan', 'Possible hardcoded secret in: ' + risky.join(', '));
  else ok('secret scan');
}

function main() {
  if (!fs.existsSync(CLASSROOM)) {
    fail('classroom folder', 'Not found: ' + CLASSROOM);
  } else {
    ok('classroom folder');
  }

  [
    path.join(ROOT, 'api', 'classroom-admin.js'),
    path.join(ROOT, 'api', 'classroom-auth.js'),
    path.join(ROOT, 'api', 'classroom-push.js'),
    path.join(ROOT, 'api', 'telegram.js'),
    path.join(ROOT, 'sync_classroom_aio.js'),
    path.join(ROOT, 'validate_aio_data.js')
  ].forEach(nodeCheck);

  [
    path.join(CLASSROOM, 'app.html'),
    path.join(CLASSROOM, 'index.html'),
    path.join(ROOT, 'index.html')
  ].forEach(htmlScriptCheck);

  runAioCheck();
  runAioDataValidation();
  secretScan();

  const failed = checks.filter((c) => !c.ok);
  checks.forEach((c) => {
    console.log((c.ok ? 'OK   ' : 'FAIL ') + c.name + (c.message ? '\n     ' + c.message : ''));
  });

  if (failed.length) {
    console.error('\nUpload check failed: ' + failed.length + ' issue(s).');
    process.exit(1);
  }
  console.log('\nUpload check OK');
}

main();
