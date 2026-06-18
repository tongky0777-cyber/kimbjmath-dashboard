#!/usr/bin/env node
/*
 * 출석생 입력 누락 점검 → 텔레그램 알림 (익명 로그인 방식)
 *
 * 인증: 클래스룸과 동일하게 Firebase 익명 로그인 사용 → Firebase 콘솔 별도 설정 불필요.
 *
 * 필요한 환경변수 (GitHub Actions Secrets):
 *   FB_API_KEY, FB_DB_URL, TELEGRAM_TOKEN, TELEGRAM_CHAT_ID
 *   (선택) TARGET_DATE - 'YYYY-MM-DD' 지정 시 그 날짜로 점검. 없으면 한국시간 오늘.
 */

const https = require('https');

const FB_API_KEY = process.env.FB_API_KEY;
const FB_DB_URL = process.env.FB_DB_URL;
const TG_TOKEN = process.env.TELEGRAM_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;

function fail(msg){ console.error('[오류]', msg); process.exit(1); }
if(!FB_API_KEY) fail('FB_API_KEY 환경변수가 없습니다');
if(!FB_DB_URL) fail('FB_DB_URL 환경변수가 없습니다');
if(!TG_TOKEN || !TG_CHAT) fail('TELEGRAM_TOKEN / TELEGRAM_CHAT_ID 환경변수가 없습니다');

function todayKST(){
  if(process.env.TARGET_DATE) return process.env.TARGET_DATE;
  const now = new Date(Date.now() + 9*60*60*1000);
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

function postJSON(hostname, path, bodyObj){
  return new Promise((resolve, reject)=>{
    const payload = JSON.stringify(bodyObj);
    const req = https.request({
      hostname: hostname, path: path, method:'POST',
      headers:{ 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, (res)=>{
      let data=''; res.on('data', c=>data+=c);
      res.on('end', ()=>{
        if(res.statusCode>=400) return reject(new Error('HTTP '+res.statusCode+': '+data.slice(0,300)));
        try{ resolve(JSON.parse(data||'null')); }catch(e){ resolve(data); }
      });
    });
    req.on('error', reject);
    req.write(payload); req.end();
  });
}

function anonSignIn(){
  return postJSON('identitytoolkit.googleapis.com',
    '/v1/accounts:signUp?key='+encodeURIComponent(FB_API_KEY),
    { returnSecureToken: true }
  ).then(r=>{
    if(!r || !r.idToken) throw new Error('익명 로그인 실패(idToken 없음)');
    return r.idToken;
  });
}

function fbRead(key, idToken){
  const url = FB_DB_URL.replace(/\/$/,'') + '/' + key + '.json?auth=' + encodeURIComponent(idToken);
  return getJSON(url);
}

function sendTelegram(text){
  return postJSON('api.telegram.org', '/bot'+TG_TOKEN+'/sendMessage',
    { chat_id: TG_CHAT, text: text, parse_mode:'HTML', disable_web_page_preview:true });
}

function asArray(v){
  if(!v) return [];
  if(Array.isArray(v)) return v.filter(Boolean);
  return Object.values(v);
}

(async ()=>{
  const date = todayKST();
  try{
    const idToken = await anonSignIn();
    const [students, attendance, progress, homework, tests] = await Promise.all([
      fbRead('bjm_students', idToken), fbRead('bjm_attendance', idToken),
      fbRead('bjm_progress', idToken), fbRead('bjm_homework', idToken), fbRead('bjm_tests', idToken)
    ]);

    const S = asArray(students), A = asArray(attendance), P = asArray(progress),
          H = asArray(homework), T = asArray(tests);

    const presentIds = A
      .filter(r => r.date===date && (r.status==='O' || r.status==='T' || r.status==='B'))
      .map(r => r.sid);
    const uniquePresent = [...new Set(presentIds)];

    if(!uniquePresent.length){
      console.log(date, '— 오늘 등원 학생이 없어 알림을 보내지 않습니다.');
      return;
    }

    const missing = [];
    uniquePresent.forEach(sid=>{
      const stu = S.find(x=>x && x.id===sid);
      if(!stu) return;
      const hasProgress = P.some(p => p.sid===sid && p.date===date);
      const hasHomework = H.some(h => h.sid===sid && (
        (h.due===date) ||
        (h.createdAt && String(h.createdAt).slice(0,10)===date) ||
        (h.date===date)
      ));
      const hasTest = T.some(t => t.sid===sid && t.date===date);
      if(!hasProgress || !hasHomework || !hasTest){
        missing.push({ name: stu.name||'(이름없음)', grade: stu.grade||'', progress:hasProgress, homework:hasHomework, test:hasTest });
      }
    });

    if(!missing.length){
      console.log(date, '— 등원생', uniquePresent.length, '명 모두 입력 완료. 알림 없음.');
      return;
    }

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
    try{ await sendTelegram('⚠️ 입력 점검 스크립트 오류: '+(e.message||e)); }catch(_){}
    fail(e.message||e);
  }
})();
