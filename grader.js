/*
 * grader.js — 올인원 자동채점 (kimbjmath-dashboard)
 *
 * 정답표(올인원_정답_answerKey.json)를 읽어, 학생이 입력한 답을 채점한다.
 * 채점 종류(k):
 *   mc   객관식 ①~⑤  → 보기 번호 일치
 *   int  정수        → 숫자 정규화 후 일치
 *   frac 분수        → 기약분수/소수 변환 후 값 일치
 *   self 자가채점     → 채점 보류(학생/선생님이 O/X). 정답 텍스트(a)는 화면 표시용.
 *
 * 결과 상태:
 *   'correct'  맞음
 *   'wrong'    틀림
 *   'self'     자가채점 대상(아직 O/X 안 정해짐)
 *   'blank'    입력 안 함
 */
(function(global){

  var ANSWERKEY_PATH = {
    '올인원': './data/올인원_정답_answerKey.json',
    '올인원 대수': './data/올인원대수_정답_answerKey.json',
    '온리원': './data/온리원_정답_answerKey.json'
  };
  var _cache = {};

  function loadAnswerKey(book){
    if(_cache[book]) return Promise.resolve(_cache[book]);
    var path = ANSWERKEY_PATH[book];
    if(!path) return Promise.reject(new Error('등록되지 않은 교재: '+book));
    return fetch(path).then(function(res){
      if(!res.ok) throw new Error('정답표 로드 실패: '+path+' ('+res.status+')');
      return res.json();
    }).then(function(data){ _cache[book]=data; return data; });
  }

  // 한 문항 정답 메타 가져오기 { k, a }  (없으면 null)
  function getAnswer(akData, unitKey, no){
    var u = akData.units && akData.units[unitKey];
    if(!u || !u.answers) return null;
    return u.answers[String(no)] || null;
  }

  // ── 입력 정규화 ──────────────────────────────
  // 전각/유니코드 마이너스, 공백 제거
  function normNum(s){
    if(s==null) return '';
    return String(s)
      .replace(/[\u2212\u2013\u2014\uFF0D]/g,'-')  // −, –, —, －  → -
      .replace(/[\uFF10-\uFF19]/g,function(c){ return String.fromCharCode(c.charCodeAt(0)-0xFF10+0x30); }) // 전각숫자
      .replace(/\s+/g,'')
      .trim();
  }

  // 정수 비교: 학생입력을 정수로 파싱해 정답과 일치?
  function gradeInt(ansVal, studentRaw){
    var s = normNum(studentRaw);
    if(s==='') return 'blank';
    if(!/^-?\d+$/.test(s)) return 'wrong';     // 정수 형태가 아니면 오답
    return (parseInt(s,10) === Number(ansVal)) ? 'correct' : 'wrong';
  }

  // 분수 비교: 정답은 "a/b" 또는 정수 문자열. 학생입력은 "a/b" 또는 소수 허용.
  function fracValue(str){
    var s = normNum(str);
    if(s==='') return null;
    if(s.indexOf('/')>-1){
      var p = s.split('/');
      if(p.length!==2) return null;
      var n=parseFloat(p[0]), d=parseFloat(p[1]);
      if(isNaN(n)||isNaN(d)||d===0) return null;
      return n/d;
    }
    var v=parseFloat(s);
    return isNaN(v)?null:v;
  }
  function gradeFrac(ansStr, studentRaw){
    if(normNum(studentRaw)==='') return 'blank';
    var av=fracValue(ansStr), sv=fracValue(studentRaw);
    if(av==null||sv==null) return 'wrong';
    return (Math.abs(av-sv) < 1e-9) ? 'correct' : 'wrong';
  }

  // 객관식 비교
  function gradeMc(ansNum, studentRaw){
    var s = normNum(studentRaw);
    if(s==='') return 'blank';
    // 학생입력이 ①~⑤ 기호이거나 1~5 숫자
    var map={'①':1,'②':2,'③':3,'④':4,'⑤':5};
    var pick = map[String(studentRaw).trim()] || (/^[1-5]$/.test(s)?parseInt(s,10):null);
    if(pick==null) return 'wrong';
    return (pick === Number(ansNum)) ? 'correct' : 'wrong';
  }

  // 한 문항 채점. studentRaw: 학생 입력값(객관식이면 번호/기호, 단답이면 문자열).
  // teacherMark: 선생님이 나중에 지정한 'correct'/'wrong' (자가채점/오판정 보정용)
  //
  // 미입력(blank) 처리 정책:
  //   - 자동채점 유형(mc/int/frac)에서 학생이 답을 안 적으면 → 'wrong'(틀림, X).
  //     "몰라서 비워둔 것"도 오답으로 보아 약점 분석에 반영하기 위함.
  //     단, '원래 미입력이었다'는 정보는 gradeHomework가 raw로 따로 기록(blank 배열)해 보존.
  //   - self(자가채점/서술형)는 미입력이든 아니든 항상 'self'(보류, △) → 선생님 승인 대기.
  function gradeOne(meta, studentRaw, teacherMark){
    if(!meta) return 'self'; // 정답표에 없으면 보류(△)
    // 선생님이 직접 채점한 값이 있으면 그게 최우선 (자동채점도 덮어쓸 수 있음)
    if(teacherMark==='correct'||teacherMark==='wrong') return teacherMark;
    switch(meta.k){
      case 'mc':   var rMc=gradeMc(meta.a, studentRaw);    return rMc==='blank'?'wrong':rMc;
      case 'int':  var rInt=gradeInt(meta.a, studentRaw);  return rInt==='blank'?'wrong':rInt;
      case 'frac': var rFr=gradeFrac(meta.a, studentRaw);  return rFr==='blank'?'wrong':rFr;
      case 'self': return 'self';   // 자동채점 불가 → 항상 보류(△). 선생님이 수업시간에 처리.
      default:     return 'self';
    }
  }

  // 숙제 한 건 전체 채점.
  // answers: { 번호: { raw, teacher } }  (raw=학생입력, teacher=선생님 O/X 보정)
  // 반환: { results:{번호:status}, wrong, correct, pending, blank, counts }
  //   pending = 'self' 상태(△, 아직 선생님이 채점 안 한 자동채점불가 문항)
  //   blank   = 학생이 실제로 답을 비워둔 문항 번호(미입력 정보 보존용).
  //             자동채점 유형(mc/int/frac)의 미입력은 results상 'wrong'이지만,
  //             여기 blank에도 기록되어 "오답 vs 미입력" 구분 분석이 가능하다.
  //             self의 미입력은 results가 'self'(보류)이고 blank에는 넣지 않는다.
  function gradeHomework(akData, unitKey, qStart, qEnd, answers){
    answers = answers || {};
    var results={}, wrong=[], correct=[], pending=[], blank=[];
    for(var n=qStart; n<=qEnd; n++){
      var meta = getAnswer(akData, unitKey, n);
      var inp = answers[n] || {};
      var st = gradeOne(meta, inp.raw, inp.teacher);
      results[n]=st;
      if(st==='correct') correct.push(n);
      else if(st==='wrong') wrong.push(n);
      else if(st==='self') pending.push(n);
      // 미입력 정보 보존: 자동채점 유형이고, 선생님 보정이 없고, raw가 비어 있으면 blank로도 기록.
      // (이 문항은 results상 'wrong'으로 분류되지만 원래 비워둔 것임을 남긴다.)
      var autoKind = meta && (meta.k==='mc'||meta.k==='int'||meta.k==='frac');
      var rawEmpty = normNum(inp.raw)==='';
      var noTeacher = !(inp.teacher==='correct'||inp.teacher==='wrong');
      if(autoKind && rawEmpty && noTeacher) blank.push(n);
    }
    return {
      results: results,
      wrong: wrong, correct: correct, pending: pending, blank: blank,
      counts: { total:(qEnd-qStart+1), correct:correct.length, wrong:wrong.length, pending:pending.length, blank:blank.length }
    };
  }

  var api = {
    loadAnswerKey: loadAnswerKey,
    getAnswer: getAnswer,
    gradeOne: gradeOne,
    gradeHomework: gradeHomework,
    normNum: normNum
  };
  if(typeof module!=='undefined' && module.exports) module.exports = api;
  else global.Grader = api;

})(typeof window!=='undefined'?window:this);
