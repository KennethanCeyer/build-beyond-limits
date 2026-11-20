# Build Beyond Limits 워크스페이스 에이전트 규칙

이 리포지토리는 참가자가 라이브 게임 서버(`http://34.158.215.133:8080`)에 접속하는 웹 로그라이크 클라이언트를 직접 구현하는 핸즈온 워크스페이스입니다. 리포지토리에는 서버나 클라이언트 소스코드가 포함되어 있지 않습니다.

## 1. 작업 디렉터리 및 아키텍처 원칙

- 신규 클라이언트는 사용자가 별도 경로를 지정하지 않으면 `./client/` 또는 `./my-client/` 디렉터리 아래에 작성합니다. 기존 `specs/`, `.agents/`, `mcp-server/`, `assets/` 파일을 임의로 삭제하거나 덮어쓰지 않습니다.
- 서버 권위 데이터 준수: 던전 타일 배열(`72x52`), 구역(`zones`) 좌표, 룬 발판과 봉인문 좌표, 몬스터 AI 동작, 직업(`classCatalog`) 및 스킬(`skillCatalog`) 정의를 클라이언트에 하드코딩하지 않습니다. 모든 월드, 규칙, 상태 정보는 WebSocket `map_init`과 `20Hz state` 패킷에서 수신한 값만 사용합니다.
- 프레임워크는 순수 HTML5 Canvas와 ES Module 또는 Vite, React, PixiJS 등 참가자가 원하는 웹 기술 스택을 자유롭게 사용할 수 있습니다.

## 2. 코드 작성 전 조회 순서

추측으로 패킷 필드나 스프라이트 좌표를 작성하지 말고, 구현 전에 아래 명세서와 로컬 MCP 서버(`bbl-roguelike`) 도구를 먼저 확인합니다.

1. 서버 연결 진단: `diagnose_server_health` 도구로 라이브 서버 응답 및 맵, 스프라이트 수를 확인합니다.
2. 네트워크 및 바이너리 패킷(`BBL-BIN v1`): [`specs/PROTOCOL.md`](./specs/PROTOCOL.md) 및 `get_protocol_contract`(`handshake`, `binary_protocol`, `state_schema`, `events_and_telegraphs`)를 참조합니다.
3. 타일셋(`512x640`) 및 2.5D 벽과 모서리 렌더링: [`specs/TILESET_AND_RENDERING.md`](./specs/TILESET_AND_RENDERING.md) 및 `get_asset_manifest`(`heroes`, `weapons`, `armors`, `shields`, `monsters`, `walls`, `hearts`, `traps`, `puzzle`, `potions`)를 참조합니다.
4. 전투, 패링, 스킬, 보스 패턴, 퍼즐 규칙: [`specs/COMBAT_AND_VFX.md`](./specs/COMBAT_AND_VFX.md) 및 `get_protocol_contract`(`combat_guard_parry`, `skills_and_tree`, `bosses_and_waves`, `maze_puzzle`)를 참조합니다.
5. 송신 페이로드 및 실시간 상태 검증: 액션 전송 코드는 `validate_client_payload`로 사전 검증하고, 접속 후 캐릭터 동기화 확인은 `inspect_player_state`를 사용합니다.

## 3. 구현 확인 사항

- 플레이어 인증 및 `?token=` 동기화
  - 최초 실행 시 URL 쿼리에 `?token=<TOKEN>`이 있으면 `POST /api/auth/verify`로 검증한 뒤 `localStorage['bbl_player_identity_v1']`에 저장해 최우선 사용합니다.
  - 저장된 토큰이 없을 때만 `POST http://34.158.215.133:8080/api/register`를 호출해 `{ codename, token, verifyCode, preferredSkin }`을 발급받아 `localStorage['bbl_player_identity_v1']`에 보관합니다.
  - 비밀 토큰이 담긴 `.bbl-identity.json` 파일은 절대 Git에 커밋하지 않습니다.
- WebSocket 연결 및 `BBL-BIN v1` 디코딩
  - `new WebSocket('ws://34.158.215.133:8080/ws?token=' + encodeURIComponent(token))` 연결 직후 `ws.binaryType = 'arraybuffer'`를 설정합니다.
  - 초기 `map_init`, `welcome` 메시지는 텍스트 JSON(`typeof ev.data === 'string'`)으로 수신되며, 이후 `0x81 S2C_STATE` 및 `0x8F S2C_PONG`은 바이너리 `ArrayBuffer`로 수신됩니다. 초기 구조 확인이 필요할 때만 `&encoding=json` 쿼리를 임시로 사용합니다.
  - `0x81 S2C_STATE` 바이너리 디코더를 작성할 때는 파싱 종료 오프셋이 `byteLength`와 일치하는지 단위 테스트나 검증 스크립트로 확인합니다.
- 픽셀 아트 타일셋 렌더링
  - 타일셋 이미지를 로드할 때 `img.src` 대입 전에 `img.crossOrigin = 'anonymous'`를 설정하고, `tileset.sheetUrl`이 `/assets/...` 상대 경로이면 `http://34.158.215.133:8080`과 결합합니다.
  - 캔버스 컨텍스트에 `ctx.imageSmoothingEnabled = false`를 지정하고 정수 배율(권장 `3x`)로 렌더링해 타일 경계 번짐을 방지합니다.
  - 정적 바닥과 2.5D 벽(Pass 1 남향 벽면, Pass 2 상단 석재 테두리와 모서리 캡)은 오프스크린 캔버스에 캐싱하고, 가시 함정, 용암, 치유의 샘, 봉인의 문(`state.puzzle.gateOpen`)만 매 프레임 갱신합니다.

## 4. 보안 정책 및 클라이언트 아카이브 제출 (`submit-client`)

완성한 클라이언트를 클라이언트 아카이브(`http://34.158.215.133:8081/api/gallery/submit`)에 제출할 때는 `submit-client` 스킬([`.agents/skills/submit-client/SKILL.md`](./.agents/skills/submit-client/SKILL.md))을 따르며, 아래 보안 제약을 코드 작성 단계부터 준수합니다.

- 금지 패턴: `eval()`, `new Function()`, 문자열 `setTimeout` 및 `setInterval`, `document.write()`, `document.cookie`, 상위 프레임 접근(`window.parent`, `window.top`, `opener`, `frameElement`), `navigator.serviceWorker`, `SharedWorker`, `navigator.sendBeacon()`, 인라인 이벤트 속성(`onload=`, `onclick=`, `onerror=` 등), `javascript:` URI, `<iframe>`, `<object>`, `<embed>`, `<base>` 태그 사용 금지.
- 네트워크 도메인 제한: 클라이언트 런타임의 `fetch` 및 `WebSocket` 호출은 게임 서버(`http://34.158.215.133:8080`, `ws://34.158.215.133:8080`)로만 수행합니다.
- 안전한 DOM 렌더링: 플레이어 코드네임, 아이템명, 이벤트 로그 등 외부 데이터를 DOM에 표시할 때는 `innerHTML` 대신 `textContent` 또는 이스케이프 유틸리티를 사용합니다.
- 제출 시 `HTTP 422 SECURITY_POLICY_VIOLATION` 응답이 반환되면 출력된 `violations` 목록의 파일, 라인, 수정 안내를 확인해 코드를 수정한 뒤 다시 제출합니다.
