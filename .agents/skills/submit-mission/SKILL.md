---
name: submit-mission
description: >-
  Use this skill when the participant asks to validate and submit their Build Beyond
  Limits hands-on mission implementation (mission-1, mission-2, mission-3, or mission-4)
  to the live roguelike game server leaderboard.
---

# Build Beyond Limits 미션 검증 및 제출 스킬

구현한 클라이언트를 로컬에서 검증한 뒤 라이브 서버 미션 리더보드에 제출합니다.

## 실행 절차

1. 제출할 미션 ID(`mission-1` ~ `mission-4`)와 클라이언트 폴더 경로(예: `client`, `my-client`)를 확인합니다.
2. 제출 스크립트를 실행합니다.
   ```bash
   node .agents/skills/submit-mission/scripts/submit.mjs --mission <mission-id> --dir <클라이언트_폴더> --style "<렌더링 스타일>" --note "<구현 요약>"
   ```
3. 스크립트 자동 수행 항목:
   - `package.json` 존재 시 `npm test` 및 `npm run build` 실행, 정적 JS 프로젝트일 경우 `node --check` 문법 검사 실행
   - 라이브 서버(`/api/health`) 연결 확인
   - `.bbl-identity.json` 토큰 재사용 또는 `/api/register` 신규 발급
   - `POST /api/submit` 전송
4. 출력된 **순위(`#Rank`)**, **코드네임**, **검증 코드(`#XXXXXX`)**를 사용자에게 전달합니다.

## 실패 시 조치

- 테스트·빌드·문법 검사 실패 시 오류를 수정한 뒤 다시 실행합니다.
- 서버 연결 실패 시 `BBL_SERVER_URL` 환경 변수와 네트워크 상태를 확인합니다.
