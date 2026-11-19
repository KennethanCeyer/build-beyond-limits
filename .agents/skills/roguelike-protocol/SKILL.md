---
name: roguelike-protocol
description: >-
  Use this skill whenever building, customizing, or debugging a Build Beyond Limits
  roguelike client. Instructs the agent to query the bbl-roguelike MCP server for
  exact Protocol v2.0 contracts, sprite coordinates, live world debugging, and
  payload validation.
---

# Build Beyond Limits MCP 프로토콜 및 디버깅 스킬

클라이언트를 구현하거나 버그를 수정할 때는 추측하지 말고, 워크스페이스에 연결된 **`bbl-roguelike` MCP 서버** 도구를 먼저 호출해 라이브 서버 기준 계약과 스프라이트 좌표를 확인하세요.

## MCP 도구 활용 순서

1. **세부 통신 규격 조회 (`get_protocol_contract`)**:
   - `topic`: `overview` | `handshake` | `binary_protocol` | `state_schema` | `events_and_telegraphs` | `combat_guard_parry` | `skills_and_tree` | `weapons_and_loot` | `bosses_and_waves` | `maze_puzzle` | `traps_and_hearts` | `tileset_sprites`
   - `binary_protocol`에서 기본 전송 포맷인 `BBL-BIN v1` 바이너리 패킷 구조와 열거형 인덱스를 확인할 수 있습니다.
   - `state_schema`에서 `me`, `players[]`, `monsters[]`, `projectiles[]`, `groundItems[]`, `leaderboard`의 전체 필드를 확인할 수 있습니다.
   - `events_and_telegraphs`에서 `mob_death`, `parry_success` 등 모든 `state.events[]` 이벤트와 보스 장판(`circle`, `cross`, `ring`, `waves[]`) 스키마를 확인할 수 있습니다.
2. **에셋 아틀라스 좌표 조회 (`get_asset_manifest`)**:
   - `category`: `heroes` | `weapons` | `shields` | `monsters` | `walls` | `hearts` | `traps` | `puzzle` | `potions` (`item_phoenix_feather`, `item_skill_book` 포함)
   - `512×640` 통합 시트의 정확한 `(x, y, w, h)`와 그리기 기준 좌표를 가져옵니다.
3. **실시간 상태 점검 (`inspect_live_world`, `inspect_player_state`, `diagnose_server_health`)**:
   - 내 코드네임이나 토큰으로 서버 측 좌표, 반칸 하트 체력, 막기·패링·차지 상태, 스킬 트리 레벨, 최신 `ackSeq`를 실시간 조회합니다.
4. **페이로드 사전 검증 (`validate_client_payload`)**:
   - 클라이언트가 보낼 WebSocket 메시지를 서버 검사기로 미리 확인합니다. 폐기된 v1 형식(`action: "parry"`, `skill: "whirlwind"`)은 오류로 차단됩니다.

## 참고 명세 문서 (`specs/`)
- [specs/PROTOCOL.md](../../../specs/PROTOCOL.md)
- [specs/COMBAT_AND_VFX.md](../../../specs/COMBAT_AND_VFX.md)
- [specs/TILESET_AND_RENDERING.md](../../../specs/TILESET_AND_RENDERING.md)
