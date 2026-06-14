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
  // (구) 대분류 — 옛 데이터 호환용 유지
  calc: '다항식·계산',
  factor: '인수분해',
  complex: '복소수',
  equation: '방정식·근의 성질',
  function: '이차함수',
  application: '활용·종합',
  inequality: '부등식',
  // 공통수학1 중단원 (교재·기출 공통)
  calc_mul: '다항식-곱셈공식·변형',
  calc_div: '다항식-나눗셈·조립제법',
  calc_rem: '다항식-나머지·인수정리',
  calc_id: '다항식-항등식·미정계수',
  calc_etc: '다항식-수의 계산·이항',
  complex_op: '복소수-연산·켤레·i',
  complex_root: '복소수-방정식 허근',
  eq_quad: '방정식-이차(근과계수·판별식)',
  eq_cubic: '방정식-삼차',
  eq_quartic: '방정식-사차',
  eq_sys: '방정식-연립',
  fn_graph: '이차함수-그래프·최대최소·접선',
  fn_ineq: '이차함수-부등식',
  fn_abs: '이차함수-절댓값',
  mat_op: '행렬-연산·상등·성분',
  mat_pow: '행렬-거듭제곱·케일리해밀턴',
  cnt_perm: '경우의수-순열',
  cnt_comb: '경우의수-조합',
  cnt_dist: '경우의수-분배·중복',
  cnt_case: '경우의수-경우의 수 종합',
  // 미적분Ⅰ 중단원
  diff_tan: '미분-접선',
  diff_ext: '미분-극값·그래프',
  diff_app: '미분-방정식·부등식·실근',
  diff_rate: '미분-속도·가속도',
  integ_calc: '적분-부정·정적분 계산',
  integ_def: '적분-정적분으로 정의된 함수',
  integ_area: '적분-넓이',
  integ_dist: '적분-속도와 거리',
  integ_app: '적분-종합·함수결정',
  // 대수 중단원 (교재·기출 통합: 지수로그·삼각함수·수열)
  exp_calc: '지수-거듭제곱근·지수 계산',
  exp_fn: '지수함수-그래프·점·최대최소',
  exp_eq: '지수-방정식·부등식',
  log_calc: '로그-로그 계산·상용로그',
  log_fn: '로그함수-그래프·점·최대최소',
  log_eq: '로그-방정식·부등식',
  explog_compare: '지수로그-대소비교',
  explog_app: '지수로그-실생활 활용',
  trig_basic: '삼각함수-각·동경·부채꼴',
  trig_id: '삼각함수-삼각비·항등식',
  trig_graph: '삼각함수-그래프·주기·최대최소',
  trig_eq: '삼각함수-방정식·부등식',
  trig_law: '삼각함수-사인·코사인법칙·삼각형',
  seq_basic: '수열-등차·등비 기본',
  seq_sum: '수열-수열의 합(Σ)',
  seq_gen: '수열-귀납적 정의·일반항',
  seq_app: '수열-활용·종합',
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
