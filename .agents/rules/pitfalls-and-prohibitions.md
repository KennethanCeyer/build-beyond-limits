---
trigger: always_on
description: "클라이언트 구현 시 금지 사항과 프로토콜, 렌더링, UI, 번들링 과정에서 자주 발생하는 런타임 오류 예방 규칙"
---

# 금지 사항 및 개발 중 주의할 문제

클라이언트를 작성하거나 수정할 때는 아래 금지 사항과 런타임 오류 예방 기준을 지킵니다.

## 1. 하지 말아야 할 것

- 워크스페이스 기존 파일 수정 금지: `specs/`, `.agents/`, `mcp-server/`, `assets/`, `AGENTS.md`, `README.md`를 임의로 덮어쓰거나 삭제하지 않고 `./client/` 또는 `./my-client/` 아래에 클라이언트 코드를 작성합니다. 발급받은 `.bbl-identity.json` 토큰 파일은 Git에 커밋하지 않습니다.
- 서버 데이터 하드코딩 금지: `72x52` 타일 배열, 구역 범위, 룬 발판과 봉인문 좌표, 독침 발사기 위치, 몬스터 AI 동작, 직업(`classCatalog`)과 스킬(`skillCatalog`) 수치를 클라이언트에 하드코딩하지 않습니다.
- 폐기되었거나 지원하지 않는 패킷 전송 금지: `type: "move"`, `type: "parry"`, `action: "parry"`, `skill: "whirlwind"` 같은 구형 메시지와 플레이어 좌표 직접 전송은 서버에서 거부됩니다. 송신 JSON `type`은 `"input"`, `"action"`, `"ping"`만 사용하며, 강공격 여부는 클라이언트 `charge` 필드가 아니라 `charge_start` 이후 서버 측 경과 시간으로만 판정됩니다.
- 아카이브 보안 정책 위반 패턴 사용 금지: `eval()`, `new Function()`, 문자열 `setTimeout` 및 `setInterval`, `document.write()`, `document.cookie`, 상위 프레임 접근(`window.parent`, `window.top`, `opener`, `frameElement`), `navigator.serviceWorker`, `SharedWorker`, `navigator.sendBeacon()`, HTML 및 SVG 인라인 이벤트 속성(`onclick=`, `onload=`, `onerror=` 등), `javascript:` URI, `<iframe>`, `<object>`, `<embed>`, `<base>` 태그를 사용하지 않습니다.
- 외부 도메인 통신 및 `innerHTML` 문자열 삽입 금지: 런타임 `fetch`, `WebSocket`, `XMLHttpRequest`와 JS 내부 URL은 게임 서버(`http://34.158.215.133:8080`, `ws://34.158.215.133:8080/ws`)만 대상으로 하며, 코드네임이나 아이템명, 로그 문자열을 DOM에 넣을 때는 `innerHTML` 대신 `textContent` 또는 캔버스 텍스트 렌더링을 사용합니다.

## 2. 개발 과정에서 문제가 되기 쉬운 부분

- 초당 패킷 제한(60개/초) 초과: `requestAnimationFrame` 루프마다 같은 이동 벡터를 반복 전송하면 서버 속도 제한에 걸립니다. 이동 패킷(`input`, `0x01`)은 입력 방향이 바뀔 때만 보내거나 전송 주기를 제한합니다.
- 공격 대기시간 중 `charge_start` 유실: 공격 재사용 대기시간(`atkCdMs > 0`)이나 대시 진행 구간(`200ms`)에 보낸 `charge_start`는 서버에서 무시됩니다. 공격 키를 길게 누르고 있을 때는 대기시간이 끝난 직후 `charge_start`가 전송되도록 처리해야 연속 전투 중에도 강공격이 나갑니다.
- 20Hz 상태 갱신으로 인한 버튼 클릭 씹힘: `50ms`마다 도착하는 `state` 패킷마다 가방 슬롯, 스킬 트리, 능력치 투자 버튼 DOM을 매번 지우고 다시 만들면 `mousedown`과 `mouseup` 사이에 노드가 교체되어 클릭이 무시됩니다. 상태 요약 문자열을 비교해 값이 실제로 바뀌었을 때만 DOM을 다시 그립니다.
- 체력 단위 및 미선택 직업 값 처리: `hp`와 `maxHp`는 하트 개수가 아니라 반칸 단위(`1하트 = 2 HP`)입니다. 또한 `0x81 S2C_STATE` 바이너리 패킷에서 직업을 고르기 전에도 `me.classIdx`는 기본값 `0`(`knight`)으로 들어오므로, 직업 미선택 여부는 `me.classIdx`가 아니라 반드시 `meFlags` `bit0`(`me.classChosen === false`)으로 판별해 직업 선택 모달을 띄웁니다.
- 타일셋 미로드 상태 `drawImage` 호출: 이미지 로드가 끝나기 전에 `ctx.drawImage`를 호출하면 예외가 나거나 `ctx.save()`와 `ctx.restore()` 짝이 어긋납니다. `img.crossOrigin = 'anonymous'`를 먼저 지정하고 그리기 전에 `img.complete && img.naturalWidth > 0`을 확인합니다.
- 브라우저 오디오 자동 재생 제한: 페이지 로드 직후 생성한 `AudioContext`는 `suspended` 상태로 묶여 소리가 나지 않을 수 있으므로, 첫 키 입력이나 마우스 클릭 시점에 `audioCtx.resume()`을 호출합니다.
- HUD 텍스트 넘침과 격자 정렬 깨짐: 두세 자리 공격력, 방어도, 치명타 확률이나 긴 장비 이름이 상태창 테두리 밖으로 삐져나오지 않도록 격자 배치나 줄바꿈, `min-width: 0`을 적용하고 `<input>` 요소에는 `appearance: none`을 지정해 기본 테두리 깨짐을 막습니다. 문자 격자(TUI) 렌더링 시에는 한글 전각 문자 폭(2칸)을 계산해 우측 테두리가 밀리지 않게 맞춥니다.
- 번들러 절대 경로 및 테스트 스크립트 중단: 아카이브 하위 경로(`/play/<codename>/`)에서 스크립트와 스타일시트가 `404`로 깨지지 않도록 번들러에 상대 경로(`base: './'`)를 지정하고 폰트와 라이브러리는 로컬에 번들링합니다. `npm init -y`로 남은 실패용 `test` 스크립트나 브라우저 전용 테스트가 제출을 막지 않도록 정리합니다.
