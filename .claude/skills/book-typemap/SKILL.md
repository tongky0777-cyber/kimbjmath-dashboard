---
name: book-typemap
description: 새 교재를 자동채점·오답분석 대상으로 추가하거나(5단계), 교재 PDF를 받아 문항별 유형(typeMap)·정답표(answerKey) JSON을 만들 때 사용. "교재 추가", "typeMap 만들어줘", "유형 분류", 교재 PDF 업로드와 함께 오는 요청이면 이 절차를 따른다.
---

# 교재 추가 · 유형 분류 절차

## A. 교재 추가 5단계 (자동채점까지)
1. **typeMap JSON** 생성 → `data/<교재>_통합_typeMap.json` (아래 C 분류 규칙)
2. **answerKey JSON** 생성 → `data/<교재>_정답_answerKey.json` — 자동채점 원하면 필수. 채점 종류: `mc`(객관식 1~5), `int`(정수), `frac`("a/b"), `self`(자동채점 불가 △: 무리수·복수답·부등식·서술형·함수식)
3. `typemap.js` `TYPEMAP_PATH` + `grader.js` `ANSWERKEY_PATH`에 경로 한 줄씩. **grader.js는 대시보드·클래스룸 양쪽 저장소 모두.**
4. `index.html`·클래스룸 `app.html`의 `AIO_BOOKS`에 항목 추가 + `index.html` BOOKLIST에 교재명. subject는 CURRICULUM 키와 글자까지 일치(CLAUDE.md 참조).
5. 파일 업로드: typeMap은 대시보드 `data/`만, answerKey는 **양쪽** `data/`.

자동채점 없이 숙제 드롭다운에만 넣을 교재는: BOOKLIST 추가 + `BOOK_SUBJECT_ONLY`에 과목 연결. 끝.

## B. 단원 키(unitKey) 규칙
- 공수1: `unit1`~`unit4` · 공수2/대수 등: `unit<대단원>_<소단원>` (예: unit1_1) · 미적분1: `unit_limit`/`unit_diff`/`unit_integ`
- 한 교재(tmKey 1개) = 파일 1개, `units` 객체 안에 여러 단원.

## C. 유형 분류 원칙
1. **문제와 해설을 함께 읽고**, 해설에서 실제 쓰인 핵심 개념으로 분류 (겉모습 X)
2. **한 문항 = 대표 유형 1개** (복합 개념이면 가장 결정적인 단계 하나)
3. `type`=소분류(학생 약점을 콕 집게), `cat`=중단원 단위 코드. 학생·학부모 화면엔 cat으로 묶어 표시됨.
4. **빠진 번호 없이** 1번~마지막까지. 애매한 번호는 `uncertain` 배열에.
5. PDF는 `pdftoppm -png -r 150`으로 이미지 렌더 후 판독 (텍스트 추출 불가).

## D. 출력 형식
```json
{ "book": "교재명",
  "units": { "unit1_1": {
    "book":"교재명", "unit":"단원명", "unitKey":"unit1_1", "totalCount":78,
    "categories": {"cat코드":"중단원 이름"},
    "typeMap": { "1": {"type":"소분류명","cat":"cat코드"} },
    "uncertain": [], "typeList": ["소분류명", "..."] } } }
```
answerKey는 동일 구조에 `typeMap` 대신 `answers`, 항목은 `{"k":"mc","a":3}` / `{"k":"int","a":12}` / `{"k":"frac","a":"23/3"}` / `{"k":"self","a":"정답텍스트"}`.

## E. 4조건 검증 (Python으로, 통과 전 납품 금지)
① 1~totalCount 누락 없음 ② 범위 초과 없음 ③ 모든 항목에 type·cat 존재 ④ cat 코드 전부 categories에 정의됨. answerKey는 추가로 mc 답이 1~5인지.

## F. 병합
단원별로 나눠 작업했으면 최종은 교재 단위 한 파일로 units를 합친다 (OrderedDict로 단원 순서 유지).
