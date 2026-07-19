# 업로드 전 확인

업로드하기 전에 대시보드 폴더에서 아래 명령을 한 번 실행합니다.

```bash
node verify_before_upload.js
```

마지막 줄이 `Upload check OK`이면 업로드해도 됩니다.

현재 자동채점 데이터 점검에서 아래 항목은 경고로만 표시됩니다.

- `Only one 공수2 / unit_prop` 42번, 48번, 51번
- 자가채점 문항의 표시용 정답이 비어 있음
- 자동채점 자체는 막히지 않지만, 확인 화면에 보여줄 정답 설명이 부족할 수 있음

## 대시보드에 업로드할 파일

- `api/classroom-admin.js`
- `api/classroom-auth.js`
- `api/classroom-push.js`
- `api/telegram.js`
- `index.html`
- `sync_classroom_aio.js`
- `validate_aio_data.js`
- `verify_before_upload.js`
- `DEPLOY_ENV.md`
- `FIREBASE_RULES_DRAFT.md`
- `UPLOAD_GUIDE.md`

## 클래스룸에 업로드할 파일

- `app.html`
- `index.html`
- `data/올인원_정답_answerKey.json`
- `data/올인원미적분1_정답_answerKey.json`

## 대시보드 배포 환경변수

대시보드 Vercel 프로젝트에는 최소한 아래 환경변수가 필요합니다.

- `FB_API_KEY`
- `FB_DB_URL`
- `FIREBASE_SERVICE_ACCOUNT_JSON` 권장
- `CLASSROOM_AUTH_SECRET`
- `CLASSROOM_ADMIN_PW_HASH`
- `CLASSROOM_ASSIST_PW_HASH`
- `CLASSROOM_ALLOWED_ORIGINS` 또는 `NOTIFY_ALLOWED_ORIGINS`
- `TELEGRAM_TOKEN`
- `TELEGRAM_CHAT_ID`
- `VAPID_PRIVATE_KEY`

자세한 설명은 `DEPLOY_ENV.md`를 확인합니다.
