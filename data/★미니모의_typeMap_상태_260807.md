# 미니모의 typeMap — 배선 완료 (2026-08-07 08:00)

## 상태

```
데일리_공수1_미니모의_typeMap.json   09주차 12문항          ✅ 유효 · 05 통과 즉시 사용
데일리_공수2_미니모의_typeMap.json   31·32주차 각 12문항     ✅ 유효
index.html                          미니모의 전용 연결 시공   ✅
typemap.js                          DAILY_TYPEMAP_PATH 2줄   ✅ master 반영됨
```

## 왜 데일리 경로를 못 쓰는가

```
onTestNameChange()   미니모의고사를 고르면 unitRow(과목·단원 행)를 숨긴다
                     데일리 유형표는 「단원」 드롭다운을 갈아끼우는 방식이라 성립 안 함
maybeFillDailyUnits  onSubjectChange 에서만 불린다. 미니모의고사는 그 경로를 안 탄다
```
→ **대상(miniTarget) + 주차(week) 로 직접 조회하는 전용 경로를 만들었다.**

## 붙인 곳 (index.html)

```
MINI_TARGET_SUBJECT     '공수1'→'공통수학1' 등 매핑표. MINI_TARGETS 표기와 유형표 키가 다르다
miniTestByWeek()        '9' · '09' · '9주차' 를 숫자로 맞춰 찾는다
maybeFillMiniFromTypeMap()  대상·주차가 정해지면 전체 문항수 자동 입력 + 오답 그리드 생성
syncWeekLabel()         끝에서 호출 (대상·주차·연도 onchange 가 이미 걸려 있다)
onTestNameChange()      미니모의고사 분기에서 한 번 더 (기록을 다시 열 때)
collectTestData()       data.dailyKey 저장 — 유형분석용. 저장 구조(mini||…)는 그대로다
```

## 유형표가 없는 대상은 지금까지처럼 수동 입력

`중1~중3`·`기하`·`확률과 통계` 등은 `DAILY_TYPEMAP_PATH` 에 키가 없어 `null` 이 오고
**아무 일도 하지 않는다.** 문항수를 손으로 넣으면 된다. **하위호환된다.**
