# 배포 환경변수

대시보드와 클래스룸을 배포한 뒤, 대시보드 Vercel 프로젝트에 아래 환경변수를 설정해야 한다.

## 클래스룸 관리자 로그인

- `FB_API_KEY`
  - Firebase Web API Key.
  - 관리자 반 관리 API가 Firebase에 안전하게 요청할 때 사용한다.
- `FB_DB_URL`
  - Firebase Realtime Database URL.
  - 예: `https://kimbjmath-default-rtdb.firebaseio.com`
- `FIREBASE_SERVICE_ACCOUNT_JSON`
  - 선택값이지만 강력 권장.
  - 대시보드 서버 API가 Firebase에 서비스 계정으로 접근할 때 사용한다.
  - Vercel 환경변수에는 서비스 계정 JSON 전체를 넣거나, JSON을 base64로 바꾼 값을 넣을 수 있다.
  - 이 값이 없으면 기존처럼 익명 Firebase 로그인으로 동작한다.
- `CLASSROOM_AUTH_SECRET`
  - 관리자 로그인 토큰 서명용 긴 임의 문자열.
  - 예: 32자 이상 무작위 문자열.
- `CLASSROOM_ADMIN_PW_HASH`
  - 클래스룸 관리자 비밀번호 해시.
  - `kbjm.classroom.v1|비밀번호`를 SHA-256으로 해시한 값.
- `CLASSROOM_ASSIST_PW_HASH`
  - 클래스룸 조교 비밀번호 해시.
  - `kbjm.classroom.v1|비밀번호`를 SHA-256으로 해시한 값.
- `CLASSROOM_ADMIN_ID`
  - 선택값. 기본값은 `김병진`.
- `CLASSROOM_ASSIST_ID`
  - 선택값. 기본값은 `조교`.
- `CLASSROOM_ALLOWED_ORIGINS`
  - 권장값. 클래스룸 사이트 주소.
  - `NOTIFY_ALLOWED_ORIGINS`에 같은 주소가 들어 있으면 생략 가능.

## 텔레그램 알림

- `TELEGRAM_TOKEN`
  - 텔레그램 봇 토큰.
- `TELEGRAM_CHAT_ID`
  - 알림을 받을 채팅 ID.
- `NOTIFY_ALLOWED_ORIGINS`
  - 필수값. 클래스룸 사이트 주소를 쉼표로 구분해서 입력.
  - 예: `https://classroom.example.com,https://kimbjmath-classroom.vercel.app`

`NOTIFY_ALLOWED_ORIGINS` 또는 `CLASSROOM_ALLOWED_ORIGINS`가 설정되지 않으면, 보안상 알림 API와 관리자 로그인 API가 외부 요청을 받지 않는다.

## 해시 만들기

로컬에서 아래 명령의 `새비밀번호`만 바꿔 실행하면 해시를 만들 수 있다.

```bash
node -e "const crypto=require('crypto'); console.log(crypto.createHash('sha256').update('kbjm.classroom.v1|'+'새비밀번호').digest('hex'))"
```

## 학생 웹 푸시 알림

- `VAPID_PRIVATE_KEY`
  - 학생 브라우저 푸시 알림을 보낼 때 필요한 비밀키.
  - GitHub에 올리는 파일에는 저장하지 말고, Vercel 환경변수에만 넣는다.
- `VAPID_SUBJECT`
  - 선택값. 기본값으로도 동작한다.
  - 예: `mailto:teacher@example.com`

학생이 클래스룸에서 `알림 켜기`를 누르면 구독 정보가 Firebase `push_subscriptions`에 저장된다. 이후 선생님/조교가 클래스룸 공지·자료를 올리면 반 학생에게 브라우저 푸시 알림을 보낼 수 있고, 질문 답변을 저장하면 질문한 학생에게 알림을 보낼 수 있다.
