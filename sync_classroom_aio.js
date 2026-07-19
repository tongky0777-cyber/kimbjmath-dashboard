#!/usr/bin/env node
/*
 * 대시보드의 자체교재 자동채점 설정을 클래스룸과 비교한다.
 *
 * 기본 실행은 점검만 한다.
 *   node sync_classroom_aio.js
 *
 * 실제 동기화가 필요할 때:
 *   node sync_classroom_aio.js --write
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const CLASSROOM = process.env.CLASSROOM_DIR || path.resolve(ROOT, '..', 'classroom');
const WRITE = process.argv.includes('--write');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function sameJson(a, b) {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

function extractObjectSource(text, varName) {
  const start = text.indexOf('var ' + varName);
  if (start < 0) throw new Error(varName + ' 선언을 찾을 수 없습니다.');
  const eq = text.indexOf('=', start);
  const brace = text.indexOf('{', eq);
  let depth = 0;
  for (let i = brace; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (depth === 0) return text.slice(brace, i + 1);
  }
  throw new Error(varName + ' 객체 끝을 찾을 수 없습니다.');
}

function evalObject(source) {
  return vm.runInNewContext('(' + source + ')', {});
}

function dashboardBooks() {
  return evalObject(extractObjectSource(read(path.join(ROOT, 'index.html')), 'AIO_BOOKS'));
}

function classroomBooks() {
  return evalObject(extractObjectSource(read(path.join(CLASSROOM, 'app.html')), 'AIO_BOOKS'));
}

function toClassroomBooks(books) {
  const out = {};
  Object.keys(books).forEach((book) => {
    const cfg = books[book];
    const units = {};
    (cfg.units || []).forEach((unit) => {
      units[unit.key] = unit.name;
    });
    out[book] = { tmKey: cfg.tmKey, units };
  });
  return out;
}

function formatObject(value, indent) {
  if (Array.isArray(value)) {
    return '[' + value.map((v) => formatObject(v, indent)).join(', ') + ']';
  }
  if (value && typeof value === 'object') {
    const entries = Object.keys(value).map((key) => {
      return quoteKey(key) + ':' + formatObject(value[key], indent);
    });
    return '{ ' + entries.join(', ') + ' }';
  }
  return JSON.stringify(value);
}

function quoteKey(key) {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}

function formatClassroomBooks(books) {
  const lines = ['var AIO_BOOKS={'];
  const names = Object.keys(books);
  names.forEach((name, idx) => {
    lines.push('  ' + quoteKey(name) + ':' + formatObject(books[name]) + (idx < names.length - 1 ? ',' : ''));
  });
  lines.push('};');
  return lines.join('\n');
}

function replaceClassroomBooks(books) {
  const appPath = path.join(CLASSROOM, 'app.html');
  const original = read(appPath);
  const start = original.indexOf('var AIO_BOOKS=');
  if (start < 0) throw new Error('classroom app.html의 AIO_BOOKS 선언을 찾을 수 없습니다.');
  const after = original.indexOf('\n// 전 교재 단원명 통합', start);
  if (after < 0) throw new Error('AIO_BOOKS 선언 이후 기준 주석을 찾을 수 없습니다.');
  const next = formatClassroomBooks(books);
  fs.writeFileSync(appPath, original.slice(0, start) + next + original.slice(after), 'utf8');
}

function answerKeyMap() {
  const source = extractObjectSource(read(path.join(ROOT, 'grader.js')), 'ANSWERKEY_PATH');
  return evalObject(source);
}

function compareAnswerKeys(map) {
  const mismatches = [];
  Object.values(map).forEach((rel) => {
    const name = path.basename(rel);
    const dashPath = path.join(ROOT, 'data', name);
    const classPath = path.join(CLASSROOM, 'data', name);
    if (!fs.existsSync(classPath)) {
      mismatches.push({ name, reason: 'classroom missing' });
      return;
    }
    const dash = JSON.parse(read(dashPath));
    const cls = JSON.parse(read(classPath));
    if (!sameJson(dash, cls)) mismatches.push({ name, reason: 'different' });
  });
  return mismatches;
}

function backupPath(label) {
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  return path.join(CLASSROOM, label + '_' + stamp);
}

function syncAnswerKeys(map, mismatches) {
  if (!mismatches.length) return null;
  const dir = backupPath('data/_backup_aio_sync');
  fs.mkdirSync(dir, { recursive: true });
  mismatches.forEach(({ name }) => {
    const dashPath = path.join(ROOT, 'data', name);
    const classPath = path.join(CLASSROOM, 'data', name);
    if (fs.existsSync(classPath)) fs.copyFileSync(classPath, path.join(dir, name));
    fs.copyFileSync(dashPath, classPath);
  });
  return dir;
}

function main() {
  if (!fs.existsSync(CLASSROOM)) throw new Error('classroom 폴더를 찾을 수 없습니다: ' + CLASSROOM);

  const wantedBooks = toClassroomBooks(dashboardBooks());
  const currentBooks = classroomBooks();
  const booksDiffer = !sameJson(wantedBooks, currentBooks);
  const map = answerKeyMap();
  const answerMismatches = compareAnswerKeys(map);

  if (WRITE) {
    let appBackup = null;
    if (booksDiffer) {
      appBackup = backupPath('_backup_aio_sync_app.html');
      fs.copyFileSync(path.join(CLASSROOM, 'app.html'), appBackup);
      replaceClassroomBooks(wantedBooks);
    }
    const dataBackup = syncAnswerKeys(map, answerMismatches);
    console.log('AIO sync complete');
    if (appBackup) console.log('app backup:', appBackup);
    if (dataBackup) console.log('data backup:', dataBackup);
    return;
  }

  if (!booksDiffer && !answerMismatches.length) {
    console.log('AIO sync check OK');
    return;
  }

  if (booksDiffer) console.log('AIO_BOOKS differs between dashboard and classroom.');
  answerMismatches.forEach((m) => console.log('answerKey differs:', m.name, '(' + m.reason + ')'));
  process.exitCode = 1;
}

try {
  main();
} catch (err) {
  console.error('[AIO sync error]', err.message || err);
  process.exit(1);
}
