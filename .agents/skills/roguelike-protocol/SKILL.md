---
name: roguelike-protocol
description: >-
  Use this skill whenever building, customizing, or debugging a Build Beyond Limits
  roguelike client. Instructs the agent to query the bbl-roguelike MCP server for
  Protocol v2.0 contracts, sprite coordinates, live world debugging, and payload validation.
---

# Build Beyond Limits MCP 프로토콜 및 디버깅 스킬

클라이언트 구현 및 디버깅 시 워크스페이스에 연결된 **`bbl-roguelike` MCP 서버** 도구를 호출해 라이브 서버 기준 스키마와 스프라이트 좌표를 확인합니다.

## MCP 도구 활용 순서

1. **통신 규격 조회 (`get_protocol_contract`)**:
   - `topic`: `overview` | `handshake` | `binary_protocol` | `state_schema` | `events_and_telegraphs` | `combat_guard_parry` | `skills_and_tree` | `weapons_and_loot` | `bosses_and_waves` | `maze_puzzle` | `traps_and_hearts` | `tileset_sprites`
   - `binary_protocol`: 기본 전송 포맷인 `BBL-BIN v1` 바이너리 패킷 구조 및 열거형 인덱스 확인
   - `state_schema`: `me`, `players[]`, `monsters[]`, `projectiles[]`, `groundItems[]`, `leaderboard` 전체 필드 확인
   - `events_and_telegraphs`: `state.events[]` 스키마와 보스 패턴(`circle`, `cross`, `ring`, `waves[]`) 확인
2. **에셋 좌표 조회 (`get_asset_manifest`)**:
   - `category`: `heroes` | `weapons` | `armors` | `shields` | `monsters` | `walls` | `hearts` | `traps` | `puzzle` | `potions` (`item_phoenix_feather`, `item_skill_book` 포함)
   - `512×640` 통합 시트의 `(x, y, w, h)` 좌표와 그리기 기준점을 반환합니다.
3. **실시간 상태 조회 (`inspect_live_world`, `inspect_player_state`, `diagnose_server_health`)**:
   - WebSocket으로 한 번 이상 접속한 캐릭터의 공개 ID(`p_...`), 코드네임, 또는 토큰으로 서버 측 좌표, 반칸 하트 체력, 막기·패링·차지 상태, 스킬 트리, `ackSeq`를 조회합니다.
4. **페이로드 사전 검증 (`validate_client_payload`)**:
   - 송신할 WebSocket JSON 메시지를 사전 검증합니다. 유효한 최상위 `type`은 `"input"`, `"action"`, `"ping"` 3종이며, 구형 v1 형식(`type: "parry"`, `type: "move"`, `action: "parry"`, `skill: "whirlwind"`)은 거부됩니다.
5. **서버 권한 준수 및 갤러리 제출 연동**:
   - 맵 타일·구역 좌표·몬스터 동작·직업 및 스킬 카탈로그를 클라이언트에 하드코딩하지 말고 반드시 `map_init`과 `20Hz state` 패킷 데이터를 그대로 사용합니다.
   - URL 쿼리 `?token=<TOKEN>`이 주어지면 `localStorage`의 `bbl_player_identity_v1` 토큰으로 채택해 브라우저 플레이어 이름과 `submit-client` 갤러리 제출자 이름이 일치하도록 구성합니다.

## 참고 명세 문서 (`specs/`)
- [specs/PROTOCOL.md](../../../specs/PROTOCOL.md)
- [specs/COMBAT_AND_VFX.md](../../../specs/COMBAT_AND_VFX.md)
- [specs/TILESET_AND_RENDERING.md](../../../specs/TILESET_AND_RENDERING.md)
