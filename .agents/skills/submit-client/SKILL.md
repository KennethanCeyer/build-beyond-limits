---
name: submit-client
description: 참가자가 제작한 웹 클라이언트 번들과 프리뷰 썸네일을 호스트 쇼케이스 갤러리(http://34.158.215.133:8081/)에 1인 1항목 Upsert 방식으로 제출할 때 활성화합니다. 게임 서버 인증 토큰을 검증하여 브라우저 플레이어 이름(codename)과 갤러리 제출자 이름을 일치시킵니다.
---

# 클라이언트 갤러리 제출 스킬 (`submit-client`)

작성한 웹 클라이언트를 호스트 쇼케이스 갤러리(`http://34.158.215.133:8081/`)에 업로드합니다.

## 동작 규칙

1. 1인 1항목 갱신 (Upsert)
   - 같은 플레이어(`codename`)가 다시 제출하면 새 항목이 추가되지 않고 기존 번들, 제목, 썸네일이 갱신되며 `revision` 번호가 증가합니다.
2. 게임 인증 토큰 연동
   - 제출자 이름은 직접 입력받지 않고, 게임 서버(`http://34.158.215.133:8080/api/auth/verify`)에서 `token`을 검증해 반환된 `codename`과 `verifyCode`를 사용합니다.
   - 브라우저에서 플레이 중인 캐릭터 이름과 맞추려면 브라우저 `localStorage`의 `bbl_player_identity_v1` 안 `token` 값을 `--token` 인자로 전달하거나 `.bbl-identity.json`에 저장합니다.
   - 스크립트가 먼저 `.bbl-identity.json`을 발급한 경우에는 클라이언트가 URL 쿼리 `?token=<TOKEN>`을 읽어 `localStorage`에 저장하도록 작성하면 같은 이름이 유지됩니다.
3. 프리뷰 썸네일 캡처
   - 로컬에 Chrome, Chromium, Edge가 설치되어 있으면 빌드된 클라이언트를 임시 서버로 띄워 `800x500` PNG 프리뷰를 촬영해 함께 업로드합니다.
   - 별도 이미지를 쓰려면 `--thumbnail <파일경로>`를 지정합니다.

## 실행 방법

```bash
node .agents/skills/submit-client/scripts/submit-client.mjs \
  --title "심연의 픽셀 로그라이크" \
  --dir ./my-client \
  --desc "방향성 투사체 패링과 4룬 퍼즐 미니맵 HUD 구현"
```

브라우저에서 이미 발급받은 토큰으로 제출할 때:

```bash
node .agents/skills/submit-client/scripts/submit-client.mjs \
  --title "심연의 픽셀 로그라이크" \
  --dir ./my-client \
  --token "<브라우저_localStorage_token>"
```

## 지원 인자

| 인자 | 필수 | 기본값 | 설명 |
| :--- | :---: | :--- | :--- |
| `--title` | 필수 | - | 호스트 갤러리 카드에 표시할 작품 제목 (최대 80자) |
| `--dir` | 선택 | `./my-client` 또는 `.` | 클라이언트 프로젝트 루트 디렉터리 (`dist/index.html` 또는 `index.html` 포함) |
| `--token` | 선택 | `.bbl-identity.json` | 게임 서버 `POST /api/register`에서 발급된 비밀 `token` |
| `--desc` | 선택 | `""` | 작품 한 줄 설명 (최대 240자) |
| `--thumbnail` | 선택 | 자동 캡처 | 커스텀 프리뷰 이미지 경로 (`.png`, `.jpg`, `.webp`, `.svg`) |
| `--no-headless` | 선택 | `false` | Headless 브라우저 자동 썸네일 촬영 생략 |
| `--skip-checks` | 선택 | `false` | `npm test` 실행 생략 |
| `--game-server` | 선택 | `http://34.158.215.133:8080` | 게임 인증 서버 URL |
| `--gallery-server` | 선택 | `http://34.158.215.133:8081` | 갤러리 게이트웨이 서버 URL |

## 제출 전 확인 사항

- [ ] 클라이언트 코드가 맵 지형이나 몬스터 동작을 로컬에 하드코딩하지 않고 `map_init`과 `20Hz state` 패킷만으로 동작하는지 확인하기
- [ ] 클라이언트 코드가 `?token=` URL 파라미터와 `localStorage`의 `bbl_player_identity_v1`을 연동해 동일한 `codename`을 유지하는지 확인하기
- [ ] `.bbl-identity.json` 파일이 Git에 커밋되지 않도록 `.gitignore`에 추가되어 있는지 확인하기
