---
name: submit-client
description: >-
  참가자가 제작한 웹 클라이언트 번들과 프리뷰 썸네일을 호스트 클라이언트 아카이브(http://34.158.215.133:8081/)에
  1인 1항목 Upsert 방식으로 제출할 때 활성화합니다. 제출 전 XSS와 샌드박스 우회 취약점을 자체 검토하고 수정하며,
  게임 서버 인증 토큰을 검증해 브라우저 플레이어 이름(codename)과 제출자 이름을 일치시킵니다.
---

# 클라이언트 아카이브 제출 스킬

작성한 웹 클라이언트를 [submit-client.mjs](./scripts/submit-client.mjs) 스크립트로 호스트 전용 클라이언트 아카이브(`http://34.158.215.133:8081/api/gallery/submit`)에 업로드합니다. 아카이브 웹 화면 열람과 실행은 발표자 전용이며, 참가자는 업로드 API로 작품을 등록하고 갱신합니다.

## 동작 규칙

1. 1인 1항목 갱신
   - 같은 플레이어(`codename`)가 다시 제출하면 새 항목이 추가되지 않고 기존 번들, 제목, 썸네일이 갱신되며 `revision` 번호가 올라갑니다.
2. 게임 인증 토큰 연동
   - 제출자 이름은 직접 입력받지 않고, 게임 서버(`http://34.158.215.133:8080/api/auth/verify`)에서 `token`을 검증해 반환된 `codename`과 `verifyCode`를 사용합니다.
   - 브라우저에서 플레이 중인 캐릭터 이름과 맞추려면 브라우저 `localStorage`의 `bbl_player_identity_v1` 안 `token` 값을 `--token` 인자로 전달하거나 `.bbl-identity.json`에 저장합니다.
   - 스크립트가 먼저 `.bbl-identity.json`을 발급한 경우에는 클라이언트가 URL 쿼리 `?token=<TOKEN>`을 읽어 `localStorage`에 저장하도록 작성하면 같은 이름이 유지됩니다.
3. 프리뷰 썸네일 캡처
   - 로컬에 Chrome, Chromium, Edge가 설치되어 있으면 격리된 임시 프로필(`--incognito`, 임시 `--user-data-dir`)로 빌드된 클라이언트를 띄워 `800x500` PNG 프리뷰를 촬영해 함께 업로드합니다.
   - 처음 발급된 토큰으로 열릴 때는 `me.classChosen === false` 상태이므로, 불투명한 전체 화면 직업 선택 창으로 던전을 가리면 썸네일에 모달만 찍힙니다. 배경에 던전 화면이 보이게 구성하거나 `--thumbnail <파일경로>`로 플레이 화면 이미지를 지정합니다.

## 보안 점검 절차

에이전트는 `submit-client.mjs` 실행 전과 서버 응답 수신 후에 아래 절차를 수행합니다.

1. 제출 전 코드 보안 검토 및 수정
   - HTML과 SVG 내부의 인라인 이벤트 핸들러(`onload=`, `onerror=`, `onclick=` 등), `javascript:` URI, `<iframe>`, `<object>`, `<embed>`, `<base>`, `<meta http-equiv="refresh">`를 제거하고 JS `addEventListener`로 교체합니다.
   - JS 코드에서 동적 코드 실행(`eval`, `new Function`, 문자열 `setTimeout`), `document.write`, `document.cookie`, 상위 프레임 접근(`window.parent`, `window.top`, `opener`, `frameElement`), `navigator.serviceWorker`, `SharedWorker`, `navigator.sendBeacon`을 사용하지 않도록 수정합니다.
   - 네트워크 요청(`fetch`, `WebSocket`, `XMLHttpRequest`)은 라이브 게임 서버(`http://34.158.215.133:8080`, `ws://34.158.215.133:8080/ws`)만 호출하도록 유지하고, JS 코드 내부에 임의의 외부 URL을 두지 않습니다.
   - 아카이브 서브경로(`/play/<codename>/`)와 격리 샌드박스에서 정적 에셋이 정상 로드되도록 번들러는 상대 경로(`base: './'`)로 설정하고, 사용하는 라이브러리와 폰트는 로컬 번들에 포함합니다.
   - 채팅이나 닉네임, 아이템명 등 외부 문자열을 DOM에 넣을 때는 `innerHTML` 대신 `textContent` 또는 HTML 이스케이프를 사용합니다.
2. 스크립트 자동 정화 및 사전 차단
   - `submit-client.mjs`는 업로드 전에 HTML과 SVG 위험 속성 및 태그를 자동 정화(`autoFix`)하고, 금지된 JS 패턴이 남아 있으면 파일과 라인, 수정 방법을 출력하며 업로드를 중단합니다.
3. 서버 거절(`HTTP 422 SECURITY_POLICY_VIOLATION`) 수신 시 수정 및 재제출
   - 아카이브 서버가 보안 위반을 감지해 거부하면 응답의 `violations` 배열(`file`, `line`, `column`, `ruleId`, `snippet`, `reason`, `suggestion`)이 출력됩니다.
   - 에이전트는 보고된 파일과 라인을 열어 안전한 코드로 수정한 뒤 빌드를 다시 수행하고 재제출합니다.

## 실행 방법

리포지토리 루트(`build-beyond-limits/`)에서 [submit-client.mjs](./scripts/submit-client.mjs)를 실행합니다.

```bash
node .agents/skills/submit-client/scripts/submit-client.mjs \
  --title "심연의 픽셀 로그라이크" \
  --dir ./client \
  --desc "방향성 투사체 패링과 4룬 퍼즐 미니맵 구현"
```

브라우저에서 이미 발급받은 토큰으로 제출할 때:

```bash
node .agents/skills/submit-client/scripts/submit-client.mjs \
  --title "심연의 픽셀 로그라이크" \
  --dir ./client \
  --token "<브라우저_localStorage_token>"
```

## 지원 인자

| 인자 | 구분 | 기본값 | 설명 |
| :--- | :---: | :--- | :--- |
| `--title` | 지정 필요 | - | 아카이브 카드에 표시할 작품 제목, 최대 80자 |
| `--dir` | 선택 | `./client`, `./my-client`, 또는 `.` | 클라이언트 프로젝트 루트 디렉터리 (`dist/index.html` 또는 `index.html` 포함) |
| `--token` | 선택 | `.bbl-identity.json` | 게임 서버 `POST /api/register`에서 발급된 비밀 `token` |
| `--desc` | 선택 | `""` | 작품 한 줄 설명, 최대 240자 |
| `--thumbnail` | 선택 | 자동 캡처 | 커스텀 프리뷰 이미지 경로 (`.png`, `.jpg`, `.webp`, `.svg`) |
| `--no-headless` | 선택 | `false` | Headless 브라우저 자동 썸네일 촬영 생략 |
| `--skip-checks` | 선택 | `false` | `npm test` 실행 생략 |
| `--no-autofix` | 선택 | `false` | HTML 및 SVG 위험 요소 자동 정화 비활성화 |
| `--game-server` | 선택 | `http://34.158.215.133:8080` | 게임 인증 서버 URL |
| `--gallery-server` | 선택 | `http://34.158.215.133:8081` | 아카이브 게이트웨이 서버 URL |

## 제출 전 확인 사항

- [ ] 클라이언트 코드가 맵 지형이나 몬스터 동작을 로컬에 하드코딩하지 않고 `map_init`과 `20Hz state` 패킷만으로 동작하는지 확인하기
- [ ] 금지된 DOM 및 네트워크 패턴(`eval`, `document.cookie`, `window.parent`, `window.top`, 인라인 `on*=`, 외부 도메인 통신)이 없는지 확인하기
- [ ] 클라이언트 코드가 `?token=` URL 파라미터와 `localStorage`의 `bbl_player_identity_v1`을 연동해 같은 `codename`을 유지하는지 확인하기
- [ ] 번들러 출력 경로가 상대 경로(`./`)로 되어 있고, `package.json`의 `test` 스크립트가 Node 환경에서 실패하지 않는지 확인하기(브라우저 전용 테스트는 `--skip-checks` 사용)
- [ ] `.bbl-identity.json` 파일이 Git에 커밋되지 않도록 `.gitignore`에 추가되어 있는지 확인하기

## 제출 완료 후 사용자 안내

제출이 성공하면 참가자가 본인 작품을 증명하고 브라우저에서도 같은 캐릭터로 접속할 수 있도록 아래 항목을 응답에 포함해 안내합니다. (`.bbl-identity.json` 파일을 Git 원격 저장소에 커밋하는 것만 금지하며, 참가자 본인에게는 토큰을 그대로 알려줍니다.)

- 제출된 작품 제목과 리비전(`REV.N`)
- 제출자 이름(`codename`) 및 확인 코드(`#verifyCode`)
- 플레이어 인증 토큰(`token`)과 로컬 저장 경로(`.bbl-identity.json`)
- 브라우저 동일 계정 접속용 쿼리 예시(`?token=<TOKEN>`)
