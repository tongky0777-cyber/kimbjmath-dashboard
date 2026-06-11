/*
 * typemap.js — 김병진 수학연구소 오답 관리 (kimbjmath-dashboard)
 *
 * 학생이 클릭한 "틀린 문제 번호"를 "유형(소분류)"과 "대분류"로 변환하고
 * 약점을 집계하는 헬퍼. 의존성 없음. <script>로 불러도 되고 import 해도 됩니다.
 *
 * 사용 예:
 *   const tm = await loadTypeMap('올인원');          // JSON 로드
 *   const result = aggregateWrong(tm, 'unit2', [99, 100, 163, 229]);
 *   // result.byType  : { '복소수(실수·순허수 조건)': 2, ... }
 *   // result.byCat   : { complex: 3, equation: 1 }
 *   // result.details : [{ no:99, type:'...', cat:'complex', catName:'복소수' }, ...]
 */

// 교재 JSON 파일 위치 (깃허브 Pages / raw 어디서든 상대경로로 읽힘)
const TYPEMAP_PATH = {
  '올인원': './data/올인원_통합_typeMap.json',
  '올인원 대수': './data/올인원대수_통합_typeMap.json',
  '온리원': './data/온리원_통합_typeMap.json',
  // 다른 교재 추가 시 여기에 한 줄씩:
  // '자이스토리': './data/자이스토리_통합_typeMap.json',
};

// 대분류 코드 → 한글 이름 (단원 categories에 없을 때의 기본값)
const CAT_NAMES = {
  calc: '다항식·계산',
  factor: '인수분해',
  complex: '복소수',
  equation: '방정식·근의 성질',
  function: '이차함수',
  application: '활용·종합',
  inequality: '부등식',
};

// 교재 JSON을 한 번 읽어 캐시
const _cache = {};
async function loadTypeMap(book) {
  if (_cache[book]) return _cache[book];
  const path = TYPEMAP_PATH[book];
  if (!path) throw new Error('등록되지 않은 교재: ' + book);
  const res = await fetch(path);
  if (!res.ok) throw new Error('typeMap 로드 실패: ' + path + ' (' + res.status + ')');
  const data = await res.json();
  _cache[book] = data;
  return data;
}

// 특정 단원의 한 문제 번호 → { type, cat, catName }  (없으면 null)
function lookup(typeMapData, unitKey, no) {
  const unit = typeMapData.units && typeMapData.units[unitKey];
  if (!unit) return null;
  const entry = unit.typeMap[String(no)];
  if (!entry) return null;
  const catName = (unit.categories && unit.categories[entry.cat]) || CAT_NAMES[entry.cat] || entry.cat;
  return { no: Number(no), type: entry.type, cat: entry.cat, catName: catName };
}

// 틀린 번호 배열 → 유형별/대분류별 집계
function aggregateWrong(typeMapData, unitKey, wrongNumbers) {
  const byType = {};
  const byCat = {};
  const details = [];
  const unknown = []; // typeMap에 없는 번호 (범위 밖 등)

  (wrongNumbers || []).forEach(function (no) {
    const hit = lookup(typeMapData, unitKey, no);
    if (!hit) { unknown.push(Number(no)); return; }
    details.push(hit);
    byType[hit.type] = (byType[hit.type] || 0) + 1;
    byCat[hit.cat] = (byCat[hit.cat] || 0) + 1;
  });

  return { byType: byType, byCat: byCat, details: details, unknown: unknown };
}

// 한 단원에서 학생이 풀 수 있는 전체 번호 개수 (학생 화면 그릴 때 참고)
function totalCount(typeMapData, unitKey) {
  const unit = typeMapData.units && typeMapData.units[unitKey];
  return unit ? unit.totalCount : 0;
}

// 단원 탭에 보여줄 대분류 목록 [{cat, name}] (그 단원에 실제로 등장한 것만)
function unitCategories(typeMapData, unitKey) {
  const unit = typeMapData.units && typeMapData.units[unitKey];
  if (!unit || !unit.categories) return [];
  return Object.keys(unit.categories).map(function (c) {
    return { cat: c, name: unit.categories[c] };
  });
}

// 단원 목록 [{key, name}] (교재 탭 그릴 때)
function unitList(typeMapData) {
  if (!typeMapData.units) return [];
  return Object.keys(typeMapData.units).map(function (k) {
    return { key: k, name: typeMapData.units[k].unit };
  });
}

// ES module / 브라우저 전역 둘 다 지원
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { loadTypeMap, lookup, aggregateWrong, totalCount, unitCategories, unitList, CAT_NAMES };
} else if (typeof window !== 'undefined') {
  window.TypeMap = { loadTypeMap, lookup, aggregateWrong, totalCount, unitCategories, unitList, CAT_NAMES };
}
