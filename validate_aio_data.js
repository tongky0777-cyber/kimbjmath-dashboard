#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const CLASSROOM = process.env.CLASSROOM_DIR || path.resolve(ROOT, '..', 'classroom');

const errors = [];
const warnings = [];
let checkedProblems = 0;
let checkedUnits = 0;

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function rel(file) {
  const rootRel = path.relative(ROOT, file);
  if (!rootRel.startsWith('..') && !path.isAbsolute(rootRel)) return 'dashboard/' + rootRel;
  const classRel = path.relative(CLASSROOM, file);
  if (!classRel.startsWith('..') && !path.isAbsolute(classRel)) return 'classroom/' + classRel;
  return file;
}

function addError(scope, message) {
  errors.push(scope + ': ' + message);
}

function addWarning(scope, message) {
  warnings.push(scope + ': ' + message);
}

function extractObjectSource(text, declaration) {
  const start = text.indexOf(declaration);
  if (start < 0) throw new Error('Cannot find declaration: ' + declaration);
  const eq = text.indexOf('=', start);
  const brace = text.indexOf('{', eq);
  if (eq < 0 || brace < 0) throw new Error('Cannot find object body: ' + declaration);

  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = brace; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (depth === 0) return text.slice(brace, i + 1);
  }
  throw new Error('Cannot find object end: ' + declaration);
}

function evalObject(source) {
  return vm.runInNewContext('(' + source + ')', {});
}

function loadObject(file, declaration) {
  return evalObject(extractObjectSource(read(file), declaration));
}

function jsonFileFromMap(map, key, scope) {
  const value = map[key];
  if (!value) {
    addError(scope, '경로 매핑이 없습니다: ' + key);
    return null;
  }
  const file = path.join(ROOT, value.replace(/^\.\//, ''));
  if (!fs.existsSync(file)) {
    addError(scope, '파일이 없습니다: ' + rel(file));
    return null;
  }
  try {
    return { file, data: JSON.parse(read(file)) };
  } catch (err) {
    addError(scope, 'JSON을 읽을 수 없습니다: ' + rel(file) + ' / ' + err.message);
    return null;
  }
}

function numberKeys(obj) {
  return Object.keys(obj || {}).filter((key) => /^\d+$/.test(key)).map(Number).sort((a, b) => a - b);
}

function findMissing(keys, total) {
  const set = new Set(keys);
  const missing = [];
  for (let i = 1; i <= total; i++) {
    if (!set.has(i)) missing.push(i);
  }
  return missing;
}

function compactList(values) {
  if (!values.length) return '';
  const first = values.slice(0, 12).join(', ');
  return first + (values.length > 12 ? ' 외 ' + (values.length - 12) + '개' : '');
}

function validateAnswer(scope, no, meta) {
  if (!meta || typeof meta !== 'object') {
    addError(scope, no + '번 정답 형식이 비어 있습니다.');
    return;
  }
  const kind = meta.k;
  if (!['mc', 'int', 'frac', 'self'].includes(kind)) {
    addError(scope, no + '번 정답 유형이 잘못되었습니다: ' + kind);
    return;
  }
  if (kind === 'mc') {
    if (![1, 2, 3, 4, 5].includes(Number(meta.a))) {
      addError(scope, no + '번 객관식 정답은 1~5 중 하나여야 합니다.');
    }
  } else if (kind === 'int') {
    if (!/^-?\d+$/.test(String(meta.a))) {
      addError(scope, no + '번 정수형 정답이 정수 형식이 아닙니다.');
    }
  } else if (kind === 'frac') {
    if (!/^-?\d+(\/-?\d+)?$/.test(String(meta.a))) {
      addWarning(scope, no + '번 분수형 정답 형식을 확인해 주세요: ' + meta.a);
    }
  } else if (kind === 'self') {
    if (meta.a == null || String(meta.a).trim() === '') {
      addWarning(scope, no + '번 자가채점 문항의 표시용 정답이 비어 있습니다.');
    }
  }
}

function validateTypeMapEntry(scope, no, entry, categories) {
  if (!entry || typeof entry !== 'object') {
    addError(scope, no + '번 유형표 형식이 비어 있습니다.');
    return;
  }
  if (!entry.type || !String(entry.type).trim()) {
    addError(scope, no + '번 유형명이 비어 있습니다.');
  }
  if (!entry.cat || !String(entry.cat).trim()) {
    addError(scope, no + '번 대분류 코드가 비어 있습니다.');
  } else if (categories && Object.keys(categories).length && !categories[entry.cat]) {
    addWarning(scope, no + '번 대분류가 categories에 없습니다: ' + entry.cat);
  }
}

function validateUnit(bookName, unitCfg, answerJson, typeMapJson) {
  const unitKey = unitCfg.key;
  const scope = bookName + ' / ' + unitKey;
  const answerUnit = answerJson.units && answerJson.units[unitKey];
  const typeMapUnit = typeMapJson.units && typeMapJson.units[unitKey];

  if (!answerUnit) {
    addError(scope, '정답표에 단원이 없습니다.');
    return;
  }
  if (!typeMapUnit) {
    addError(scope, '유형표에 단원이 없습니다.');
    return;
  }

  checkedUnits++;
  const answerTotal = Number(answerUnit.totalCount);
  const typeTotal = Number(typeMapUnit.totalCount);
  const total = answerTotal || typeTotal;
  if (!total) addError(scope, 'totalCount가 없습니다.');
  if (answerTotal !== typeTotal) {
    addError(scope, '정답표 totalCount와 유형표 totalCount가 다릅니다: ' + answerTotal + ' / ' + typeTotal);
  }

  const answerKeys = numberKeys(answerUnit.answers);
  const typeKeys = numberKeys(typeMapUnit.typeMap);
  if (total) {
    const missingAnswers = findMissing(answerKeys, total);
    const missingTypes = findMissing(typeKeys, total);
    const overAnswers = answerKeys.filter((no) => no > total);
    const overTypes = typeKeys.filter((no) => no > total);
    if (missingAnswers.length) addError(scope, '정답표에서 빠진 번호: ' + compactList(missingAnswers));
    if (missingTypes.length) addError(scope, '유형표에서 빠진 번호: ' + compactList(missingTypes));
    if (overAnswers.length) addError(scope, '정답표 범위 밖 번호: ' + compactList(overAnswers));
    if (overTypes.length) addError(scope, '유형표 범위 밖 번호: ' + compactList(overTypes));
  }

  const answerSet = new Set(answerKeys);
  const typeSet = new Set(typeKeys);
  const onlyAnswer = answerKeys.filter((no) => !typeSet.has(no));
  const onlyType = typeKeys.filter((no) => !answerSet.has(no));
  if (onlyAnswer.length) addError(scope, '정답표에만 있는 번호: ' + compactList(onlyAnswer));
  if (onlyType.length) addError(scope, '유형표에만 있는 번호: ' + compactList(onlyType));

  answerKeys.forEach((no) => validateAnswer(scope, no, answerUnit.answers[String(no)]));
  typeKeys.forEach((no) => validateTypeMapEntry(scope, no, typeMapUnit.typeMap[String(no)], typeMapUnit.categories || {}));
  checkedProblems += Math.max(answerKeys.length, typeKeys.length);
}

function validateActiveBooks() {
  const dashboardBooks = loadObject(path.join(ROOT, 'index.html'), 'var AIO_BOOKS');
  const answerPaths = loadObject(path.join(ROOT, 'grader.js'), 'var ANSWERKEY_PATH');
  const typeMapPaths = loadObject(path.join(ROOT, 'typemap.js'), 'const TYPEMAP_PATH');

  Object.keys(dashboardBooks).forEach((bookName) => {
    const cfg = dashboardBooks[bookName];
    const scope = bookName;
    if (!cfg || typeof cfg !== 'object') {
      addError(scope, '교재 설정 형식이 잘못되었습니다.');
      return;
    }
    if (!cfg.tmKey) {
      addError(scope, 'tmKey가 없습니다.');
      return;
    }
    if (!Array.isArray(cfg.units) || !cfg.units.length) {
      addError(scope, '단원 목록이 비어 있습니다.');
      return;
    }

    const answer = jsonFileFromMap(answerPaths, cfg.tmKey, scope + ' 정답표');
    const typeMap = jsonFileFromMap(typeMapPaths, cfg.tmKey, scope + ' 유형표');
    if (!answer || !typeMap) return;

    cfg.units.forEach((unit) => validateUnit(bookName, unit, answer.data, typeMap.data));
  });
}

function main() {
  validateActiveBooks();

  warnings.forEach((message) => console.log('WARN ' + message));
  if (errors.length) {
    errors.forEach((message) => console.error('FAIL ' + message));
    console.error('\nAIO data validation failed: ' + errors.length + ' issue(s).');
    process.exit(1);
  }

  console.log('AIO data validation OK');
  console.log('Checked ' + checkedUnits + ' units / ' + checkedProblems + ' problems');
  if (warnings.length) console.log('Warnings: ' + warnings.length);
}

main();
