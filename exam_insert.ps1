$f = 'C:\Users\김병진\kimbjmath-dashboard\index.html'
$lines = Get-Content $f -Encoding UTF8

$viewHtml = @'
<!-- 시험 일정 뷰 -->
<div class="view" id="view-exam">
  <div class="sec-hd"><h2>📝 학교 시험 일정</h2><div class="actions"><button class="btn-sm" onclick="openExamModal()">+ 시험 추가</button></div></div>
  <div id="exam-calendar" style="margin-bottom:20px;"></div>
  <div class="sec-hd" style="margin-top:8px;"><h2 style="font-size:14px;">전체 목록</h2></div>
  <div id="exam-list"></div>
</div>

<!-- 모달: 시험 일정 -->
<div class="modal-bg" id="modal-exam">
  <div class="modal">
    <div class="modal-hd"><h3>시험 일정 추가</h3><button class="modal-close" onclick="closeModal('modal-exam')">x</button></div>
    <div class="modal-body">
      <div class="form-row">
        <div class="form-group"><label>학교명 *</label><input id="exam-school" placeholder="예) 경북고등학교"></div>
        <div class="form-group"><label>시험 종류</label><select id="exam-type"><option value="mid">중간고사</option><option value="final">기말고사</option><option value="mock">모의고사</option><option value="other">기타</option></select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>시작일 *</label><input type="date" id="exam-start"></div>
        <div class="form-group"><label>종료일 *</label><input type="date" id="exam-end"></div>
      </div>
      <div class="form-group full"><label>메모</label><input id="exam-memo" placeholder="추가 메모"></div>
    </div>
    <div class="modal-ft"><button class="btn-cancel" onclick="closeModal('modal-exam')">취소</button><button class="btn-save" onclick="saveExam()">저장</button></div>
  </div>
</div>
'@

$jsCode = @'

// ===== 시험 일정 =====
function openExamModal(id) {
  openModal('modal-exam');
  ['exam-school','exam-memo'].forEach(function(i){ document.getElementById(i).value=''; });
  document.getElementById('exam-type').value='mid';
  document.getElementById('exam-start').value='';
  document.getElementById('exam-end').value='';
  document.getElementById('modal-exam').dataset.editId = id||'';
}

function saveExam() {
  var school = document.getElementById('exam-school').value.trim();
  var type   = document.getElementById('exam-type').value;
  var start  = document.getElementById('exam-start').value;
  var end    = document.getElementById('exam-end').value;
  var memo   = document.getElementById('exam-memo').value.trim();
  if(!school||!start||!end){ toast('학교명, 시작일, 종료일은 필수입니다'); return; }
  if(start>end){ toast('종료일이 시작일보다 빠릅니다'); return; }
  var exams = DB.get('exams')||[];
  var editId = document.getElementById('modal-exam').dataset.editId;
  if(editId){
    exams = exams.map(function(e){ return e.id===editId?{id:editId,school:school,type:type,startDate:start,endDate:end,memo:memo}:e; });
  } else {
    exams.push({id:Date.now().toString(),school:school,type:type,startDate:start,endDate:end,memo:memo});
  }
  localStorage.setItem('bjm_exams', JSON.stringify(exams));
  closeModal('modal-exam');
  renderExam();
  toast('저장됐습니다');
}

function deleteExam(id) {
  if(!confirm('삭제할까요?')) return;
  var exams = (DB.get('exams')||[]).filter(function(e){ return e.id!==id; });
  localStorage.setItem('bjm_exams', JSON.stringify(exams));
  renderExam();
  toast('삭제됐습니다');
}

function renderExam() {
  var exams = (DB.get('exams')||[]).sort(function(a,b){ return a.startDate.localeCompare(b.startDate); });
  var typeLabel = {mid:'중간고사',final:'기말고사',mock:'모의고사',other:'기타'};
  var typeColor = {mid:'var(--red)',final:'var(--blue)',mock:'var(--gold)',other:'var(--muted)'};
  var typeBg    = {mid:'var(--red-bg)',final:'var(--blue-bg)',mock:'var(--gold-bg)',other:'var(--bg2)'};

  // 달력 (현재 월 기준 3개월)
  var cal = document.getElementById('exam-calendar');
  if(!cal) return;
  var today = new Date();
  var calHtml = '<div style="display:flex;gap:12px;flex-wrap:wrap;">';
  for(var m=0; m<3; m++) {
    var d = new Date(today.getFullYear(), today.getMonth()+m, 1);
    var year = d.getFullYear();
    var month = d.getMonth();
    var firstDay = new Date(year,month,1).getDay();
    var lastDate = new Date(year,month+1,0).getDate();
    calHtml += '<div style="flex:1;min-width:220px;background:var(--white);border:1px solid var(--line);border-radius:10px;padding:14px;">';
    calHtml += '<div style="font-size:13px;font-weight:700;margin-bottom:10px;color:var(--ink);">'+(month+1)+'월 '+year+'</div>';
    calHtml += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center;">';
    ['일','월','화','수','목','금','토'].forEach(function(day,i){
      calHtml += '<div style="font-size:10px;font-weight:700;color:'+(i===0?'var(--red)':i===6?'var(--blue)':'var(--muted)')+';">'+day+'</div>';
    });
    for(var i=0;i<firstDay;i++) calHtml += '<div></div>';
    for(var day=1;day<=lastDate;day++){
      var dateStr = year+'-'+(month+1<10?'0':'')+(month+1)+'-'+(day<10?'0':'')+day;
      var examOnDay = exams.filter(function(e){ return dateStr>=e.startDate&&dateStr<=e.endDate; });
      var isToday = dateStr===today.toISOString().slice(0,10);
      var dotHtml = examOnDay.length ? '<div style="width:6px;height:6px;border-radius:50%;background:'+typeColor[examOnDay[0].type]+';margin:0 auto;"></div>' : '';
      var bg = examOnDay.length ? typeBg[examOnDay[0].type] : 'transparent';
      calHtml += '<div style="font-size:11px;padding:3px 1px;border-radius:4px;background:'+bg+';'+(isToday?'font-weight:700;border:1px solid var(--navy);':'')+'">'+day+dotHtml+'</div>';
    }
    calHtml += '</div></div>';
  }
  calHtml += '</div>';
  cal.innerHTML = calHtml;

  // 리스트
  var list = document.getElementById('exam-list');
  if(!list) return;
  if(!exams.length){
    list.innerHTML = '<div class="empty">등록된 시험 일정이 없습니다</div>';
    return;
  }
  list.innerHTML = exams.map(function(e){
    return '<div style="background:var(--white);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:10px;display:flex;align-items:center;gap:12px;">'
      +'<div style="padding:4px 10px;border-radius:100px;font-size:11px;font-weight:700;background:'+typeBg[e.type]+';color:'+typeColor[e.type]+';white-space:nowrap;">'+(typeLabel[e.type]||'기타')+'</div>'
      +'<div style="flex:1;">'
      +'<div style="font-size:14px;font-weight:700;color:var(--ink);">'+e.school+'</div>'
      +'<div style="font-size:12px;color:var(--muted);margin-top:2px;">'+e.startDate+' ~ '+e.endDate+(e.memo?' · '+e.memo:'')+'</div>'
      +'</div>'
      +'<button class="btn-sm" onclick="openExamModal(\''+e.id+'\')" style="margin-right:4px;">수정</button>'
      +'<button class="btn-sm" onclick="deleteExam(\''+e.id+'\')" style="background:var(--red-bg);color:var(--red);">삭제</button>'
      +'</div>';
  }).join('');
}
// ===== 시험 일정 끝 =====
'@

# view HTML을 624번 줄 다음에 삽입
$viewLines = $viewHtml -split "`n"
$new1 = $lines[0..623] + $viewLines + $lines[624..($lines.Length-1)]

# JS를 showView 함수 바로 앞에 삽입 (961번 -> 삽입 후 줄번호 변경됨)
$showViewLine = ($new1 | Select-String -Pattern "function showView").LineNumber - 1
$jsLines = $jsCode -split "`n"
$new2 = $new1[0..($showViewLine-1)] + $jsLines + $new1[$showViewLine..($new1.Length-1)]

$new2 | Set-Content $f -Encoding UTF8
Write-Host "완료!"
