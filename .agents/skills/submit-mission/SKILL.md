---
name: submit-mission
description: >-
  Use this skill when the participant asks to validate and automatically submit
  their Build Beyond Limits hands-on mission implementation (mission-1, mission-2,
  mission-3, or mission-4) to the live roguelike game server leaderboard.
---

# Build Beyond Limits 자동 미션 검증 및 제출 스킬

이 스킬은 핸즈온 참가자가 직접 구현한 클라이언트를 검증한 뒤, 실시간 게임 서버의 미션 리더보드에 제출하고 순위와 검증 코드를 확인합니다.

## 실행 절차

1. 사용자가 지정한 미션 ID(`mission-1`, `mission-2`, `mission-3`, `mission-4`)와 클라이언트 폴더 경로(예: `client`, `my-client`)를 확인합니다.
2. 아래 자동 검증 및 제출 스크립트를 실행합니다.
   ```bash
   node .agents/skills/submit-mission/scripts/submit.mjs --mission <mission-id> --dir <클라이언트_폴더> --style "<렌더링 스타일 설명>" --note "<한 줄 구현 요약>"
   ```
3. 스크립트는 다음 단계를 자동으로 수행합니다.
   - 클라이언트 폴더에 `package.json`이 있으면 `npm test`와 `npm run build`를 실행하고, 정적 HTML/JS 프로젝트라면 `node --check`로 문법을 검증합니다.
   - 라이브 서버(`/api/health`) 연결 상태를 확인합니다.
   - 고유 코드네임을 발급받거나 로컬 `.bbl-identity.json`을 재사용합니다.
   - `/api/submit` API로 검증 결과를 자동 전송합니다.
4. 출력된 **미션 제출 순위(#Rank)**, **고유 코드네임**, **검증 코드(`#XXXXXX`)**를 사용자에게 안내합니다.

## 실패 시 대응

- 테스트·빌드 또는 문법 검사가 실패하면 오류 로그를 확인해 클라이언트 코드를 수정한 뒤 다시 제출 스크립트를 실행합니다.
- 서버 연결이 실패하면 환경 변수 `BBL_SERVER_URL` 또는 네트워크 상태를 점검합니다.
