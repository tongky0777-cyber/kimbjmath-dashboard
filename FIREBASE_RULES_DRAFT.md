# Firebase Realtime Database 규칙 초안

이 파일은 바로 배포하기 위한 완성 규칙이 아니라, 현재 구조를 안전하게 바꾸기 위한 기준 문서다.

현재 대시보드와 클래스룸은 브라우저에서 Firebase Realtime Database에 직접 읽고 쓴다. 또한 익명 로그인(`signInAnonymously`)을 사용하므로, Firebase 규칙만으로 선생님/조교/학생을 완전히 구분하기 어렵다.

## 현재 가능한 1차 목표

- 알 수 없는 새 루트 경로는 기본 차단한다.
- 기존 앱이 사용하는 경로만 읽기/쓰기를 허용한다.
- 최소한 `auth != null` 조건을 유지한다.
- 데이터 구조 검증은 조심스럽게 추가한다. 기존 데이터가 배열과 객체를 섞어 쓰는 곳이 있어 과하게 검증하면 운영 중 저장이 막힐 수 있다.

## 1차 규칙 초안

Firebase 콘솔에 그대로 붙이기 전에 반드시 테스트 모드나 백업 후 확인해야 한다.

```json
{
  "rules": {
    ".read": false,
    ".write": false,

    "bjm_students": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "bjm_attendance": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "bjm_homework": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "bjm_tests": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "bjm_progress": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "bjm_groups": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "bjm_schedules": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "bjm_exams": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "bjm_memo": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "bjm_memo_todo": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "bjm_examscores": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "bjm_planner_events": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "bjm_daily_problems": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "bjm_daily_subs": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "bjm_worklog": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "bjm_backup": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "bjm_sent_reports": {
      ".read": "auth != null",
      ".write": "auth != null"
    },

    "wronganswers": {
      ".read": "auth != null",
      ".write": "auth != null"
    },

    "class_users": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "class_classes": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "class_signups": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "class_posts": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "class_hw_done": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "class_planner": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "class_cheer": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "class_reactions": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "push_subscriptions": {
      ".read": "auth != null",
      ".write": "auth != null"
    }
  }
}
```

## 다음 단계 권장 구조

1. 관리자/조교 쓰기 기능을 대시보드 API로 옮긴다.
2. 학생 제출 경로를 `class_users/{classKey}`와 연결된 경로만 쓸 수 있게 바꾼다.
3. Firebase Auth 익명 계정의 `uid`를 `class_users/{classKey}/authUid`에 저장한다.
4. 규칙에서 `auth.uid === data.child('class_users/'+$classKey+'/authUid').val()` 형태로 학생 본인 쓰기만 허용한다.
5. 대시보드 관리자는 클라이언트 직접 쓰기가 아니라 서버 API에서만 쓰도록 바꾸고, 서버는 Firebase Admin SDK로 처리한다.

이 순서로 가야 학생 제출, 알림, 대시보드 운영을 멈추지 않고 보안을 단계적으로 올릴 수 있다.

## 서비스 계정 적용 후 방향

`api/classroom-admin.js`는 `FIREBASE_SERVICE_ACCOUNT_JSON` 환경변수가 있으면 Firebase 서비스 계정으로 DB에 접근한다. 이 값을 설정한 뒤에는 선생님/조교가 처리하는 반 관리, 게시글 관리, 답변 저장은 브라우저 직접 쓰기가 아니라 대시보드 서버 API를 통해 처리할 수 있다.

권장 순서:

1. Vercel 대시보드 프로젝트에 `FIREBASE_SERVICE_ACCOUNT_JSON`을 추가한다.
2. `verify_before_upload.js` 통과 후 대시보드와 클래스룸을 배포한다.
3. 실제 화면에서 선생님 로그인, 반 배정, 답변 저장, 게시글 삭제를 확인한다.
4. 문제가 없으면 Firebase Rules에서 `class_classes`, `class_posts` 중 관리자성 쓰기 경로부터 브라우저 직접 쓰기를 줄인다.

이 단계는 운영 확인 후 적용해야 한다. Rules를 먼저 강하게 잠그면 기존 학생 제출이나 플래너 저장이 막힐 수 있다.
