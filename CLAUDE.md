# 김병진수학연구소 대시보드 (kimbjmath-dashboard)

수학학원 관리 시스템. 선생님용 대시보드(이 저장소) + 학생용 클래스룸 앱(별도 저장소 `classroom`)이 같은 Firebase(`kimbjmath`)를 공유한다.

## 구조
- `index.html` — 대시보드 전체 (단일 파일, ~9,800줄). 학생·출결·숙제·테스트·진도·리포트·오답분석 전부 여기.
- `grader.js` — 자동채점 (answerKey 로드·채점). **클래스룸 저장소에도 같은 파일이 있어 함께 수정해야 함.**
- `typemap.js` — 오답 유형 변환 (typeMap 로드·lookup, CAT_NAMES).
- `timetable.html` — 수업 시간표 (별도 페이지, 테마는 대시보드와 동일하게 유지).
- `data/` — 교재·기출 typeMap JSON, 정답표 answerKey JSON. **한글 JSON은 반드시 이 폴더 안에** (루트에 있으면 `./data/...` 로드 실패).

## 핵심 규칙 (어길 시 버그)
- 코드 스타일: `var` 사용 (`let`/`const` 금지 — 기존 스타일 유지). 요청하지 않은 코드는 수정하지 않는다.
- localStorage 접두사 `bjm_`, Firebase 동기화는 `SYNC_KEYS` 배열에 키가 있어야 작동.
- `AIO_BOOKS[교재명].subject`는 `CURRICULUM` 객체의 키와 **글자까지 정확히** 일치해야 함. CURRICULUM은 `"미적분1"`(아라비아 숫자), 배점표용 `EXAM_SUBJECTS`는 `"미적분Ⅰ"`(로마 숫자) — 서로 다른 체계이니 혼동 금지.
- `AIO_BOOKS[교재명].tmKey`는 `typemap.js`의 `TYPEMAP_PATH` / `grader.js`의 `ANSWERKEY_PATH` 키와 일치해야 함.
- 재원생 필터는 `isActiveStudent(s)` 헬퍼 사용 (퇴원 `withdrawn` + 반이동 `moved` 제외).
- 로그인·PIN은 SHA-256 해시 상수로 보관 (`genLoginHash('새비번')`을 콘솔에서 실행해 교체). **비밀번호를 코드에 평문으로 넣지 않는다.**
- 학생·학부모가 보는 텍스트는 한자어·전문어 금지, 교과서 용어 사용. 선생님만 보는 typeMap 유형명은 전문어 그대로.

## 검증 (수정 후 필수)
```bash
# JS 문법: 인라인 스크립트 추출 후 acorn
node -e "const s=require('fs').readFileSync('index.html','utf8');const m=[...s.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)];require('fs').writeFileSync('/tmp/v.js',m.map(x=>x[1]).join('\n;\n'))" && npx acorn --ecma2020 --silent /tmp/v.js
```
동작 검증은 jsdom 시뮬레이션(Firebase는 모킹: `{apps:[],initializeApp,auth,database}`).

## 배포
git push → Vercel 자동 배포(1~2분). 반영 안 보이면 강력 새로고침(Ctrl+Shift+R). 커밋 전 사용자 확인을 받는다.

## 절차형 작업은 스킬 참조
- 기출 시험 배점표 등록 → `.claude/skills/exam-scoretable/SKILL.md`
- 교재 typeMap·정답표 추가(5단계) → `.claude/skills/book-typemap/SKILL.md`
