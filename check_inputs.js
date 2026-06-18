#!/usr/bin/env node
/*
 * 출석생 입력 누락 점검 → 텔레그램 알림
 *
 * 동작:
 *   오늘 출석(O)·지각(T)·보강(B)으로 기록된 학생을 찾아,
 *   각 학생에게 오늘 날짜의 진도 / 숙제 / 테스트 입력이 있는지 점검하고,
 *   하나라도 빠진 학생이 있으면 선생님 텔레그램으로 정리해 보낸다.
 *
 * 필요한 환경변수 (GitHub Actions Secrets로 주입):
 *   FB_DB_URL        - 예: https://kimbjmath-default-rtdb.firebaseio.com
 *   FB_DB_SECRET     - Firebase DB 비밀키(레거시 토큰) 또는 액세스 토큰
 *   TELEGRAM_TOKEN   - 텔레그램 봇 토큰
 *   TELEGRAM_CHAT_ID - 선생님 chat_id
 *   (선택) TARGET_DATE - 'YYYY-MM-DD' 지정 시 그 날짜로 점검(테스트용). 없으면 한국시간 오늘.
 */

const https = require('https');

const FB_DB_URL = process.env.FB_DB_URL;
const FB_DB_SECRET = process.env.FB_DB_SECRET || '';
const TG_TOKEN = process.env.TELEGRAM_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;

function fail(msg){ console.error('[오류]', msg); process.exit(1); }
if(!FB_DB_URL) fail('FB_DB_URL 환경변수가 없습니다');
if(!TG_TOKEN || !TG_CHAT) fail('TELEGRAM_TOKEN / TELEGRAM_CHAT_ID 환경변수가 없습니다');

// 한국시간(KST) 기준 오늘 날짜 YYYY-MM-DD
function todayKST(){
  if(process.env.TARGET_DATE) return process.env.TARGET_DATE;
  const now = new Date(Date.now() + 9*60*60*1000); // UTC+9
  return now.toISOString().slice(0,10);
}

function getJSON(url){
  return new Promise((resolve, reject)=>{
    https.get(url, (res)=>{
      let data='';
      res.on('data', c=> data+=c);
      res.on('end', ()=>{
        if(res.statusCode>=400) return reject(new Error('HTTP '+res.statusCode+': '+data.slice(0,200)));
        try{ resolve(JSON.parse(data||'null')); }catch(e){ reject(e); }
      });
    }).on('error', reject);
  });
}

// Firebase 경로 읽기 (bjm_ 접두사 경로)
function fbRead(key){
  let url = FB_DB_URL.replace(/\/$/,'') + '/' + key + '.json';
  if(FB_DB_SECRET) url += '?auth=' + encodeURIComponent(FB_DB_SECRET);
  return getJSON(url);
}

function sendTelegram(text){
  return new Promise((resolve, reject)=>{
    const payload = JSON.stringify({ chat_id: TG_CHAT, text: text, parse_mode: 'HTML', disable_web_page_preview: true });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: '/bot' + TG_TOKEN + '/sendMessage',
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, (res)=>{
      let data=''; res.on('data', c=>data+=c);
      res.on('end', ()=> res.statusCode<400 ? resolve(data) : reject(new Error('텔레그램 전송 실패: '+data.slice(0,200))));
    });
    req.on('error', reject);
    req.write(payload); req.end();
  });
}

function asArray(v){
  if(!v) return [];
  if(Array.isArray(v)) return v.filter(Boolean);
  return Object.values(v); // Firebase가 객체로 줄 때
}

(async ()=>{
  const date = todayKST();
  try{
    const [students, attendance, progress, homework, tests] = await Promise.all([
      fbRead('bjm_students'), fbRead('bjm_attendance'), fbRead('bjm_progress'),
      fbRead('bjm_homework'), fbRead('bjm_tests')
    ]);

    const S = asArray(students);
    const A = asArray(attendance);
    const P = asArray(progress);
    const H = asArray(homework);
    const T = asArray(tests);

    // 오늘 출석/지각/보강인 학생 id
    const presentIds = A
      .filter(r => r.date===date && (r.status==='O' || r.status==='T' || r.status==='B'))
      .map(r => r.sid);
    const uniquePresent = [...new Set(presentIds)];

    if(!uniquePresent.length){
      console.log(date, '— 오늘 등원(출석/지각/보강) 학생이 없어 알림을 보내지 않습니다.');
      return;
    }

    // 학생별 점검
    const missing = [];
    uniquePresent.forEach(sid=>{
      const stu = S.find(x=>x && x.id===sid);
      if(!stu) return;
      const hasProgress = P.some(p => p.sid===sid && p.date===date);
      // 숙제: 오늘 등록(또는 오늘 마감)된 숙제가 이 학생에게 있는지. createdAt/date/due 중 오늘인 것.
      const hasHomework = H.some(h => h.sid===sid && (
        (h.due===date) ||
        (h.createdAt && String(h.createdAt).slice(0,10)===date) ||
        (h.date===date)
      ));
      const hasTest = T.some(t => t.sid===sid && t.date===date);

      if(!hasProgress || !hasHomework || !hasTest){
        missing.push({
          name: stu.name || '(이름없음)',
          grade: stu.grade || '',
          progress: hasProgress, homework: hasHomework, test: hasTest
        });
      }
    });

    if(!missing.length){
      console.log(date, '— 등원생', uniquePresent.length, '명 모두 진도·숙제·테스트 입력 완료. 알림 없음.');
      return;
    }

    // 메시지 구성
    const mark = b => b ? '✅' : '❌';
    let msg = '<b>📋 입력 누락 알림</b> ('+date+')\n';
    msg += '오늘 등원한 학생 중 입력이 빠진 항목이 있어요.\n\n';
    missing.forEach(m=>{
      msg += '<b>'+m.name+'</b> '+(m.grade?'('+m.grade+')':'')+'\n';
      msg += '  진도 '+mark(m.progress)+'  숙제 '+mark(m.homework)+'  테스트 '+mark(m.test)+'\n';
    });
    msg += '\n총 '+missing.length+'명 확인 필요';

    await sendTelegram(msg);
    console.log(date, '— 알림 전송 완료 ('+missing.length+'명)');
  }catch(e){
    // 에러도 텔레그램으로 알려서 조용히 실패하지 않게
    try{ await sendTelegram('⚠️ 입력 점검 스크립트 오류: '+(e.message||e)); }catch(_){}
    fail(e.message||e);
  }
})();
