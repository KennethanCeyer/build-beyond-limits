# Build Beyond Limits 예제 에셋 및 렌더링 명세

이 문서는 `map_init`으로 받은 `72×52` 던전 지도와 리포지토리에 포함된 CC0 예제 스프라이트 시트(`assets/tileset/dungeon_autotile_16x16.png`)를 기준으로 바닥, 2.5D 벽, 광원, 함정, 퍼즐, 캐릭터, 미니맵을 그리는 참고 규격을 정리합니다.

> **자유로운 에셋 활용 안내**: `assets/tileset/`에 포함된 픽셀 아트 타일셋은 바로 시작할 수 있도록 준비한 **예제 에셋**입니다. 이 에셋을 반드시 사용할 필요는 없으며, 다른 무료·직접 제작 에셋, 기하학적 벡터 그래픽, 네온 와이어프레임, ASCII 아트, AI 생성 스프라이트 등 참가자만의 시각 스타일로 자유롭게 구현할 수 있습니다.

---

## 통합 타일셋 아틀라스 구조 (`512×640`, 16×16 기준)

- 다운로드 URL: `httpBase + map_init.tileset.sheetUrl` (라이브 서버 기준 `http://34.158.215.133:8080/assets/tileset/dungeon_autotile_16x16.png?v=2.4`)
- 모든 스프라이트의 정확한 `{ x, y, w, h }`는 `map_init.tileset.sprites[spriteKey]` 및 `GET /api/tileset`에 포함되어 있습니다.
- 이미지 로드 시 `img.crossOrigin = 'anonymous'`를 지정하고, 캔버스 렌더링 시 `ctx.imageSmoothingEnabled = false`를 유지하세요.
- **비동기 로드 주의**: `img.onload` 완료 전 프레임에서 `ctx.drawImage(atlasImg, ...)`를 호출하면 `TypeError`가 발생해 `ctx.save()`/`restore()` 스택이 망가질 수 있습니다. `drawImage` 호출 전에 항상 `atlasImg && atlasImg.complete && atlasImg.naturalWidth > 0`을 확인하세요.

| 아틀라스 구역 | 수록 에셋 | 대표 스프라이트 키 |
| :--- | :--- | :--- |
| `y: 0..511` | 바닥, 가시 함정, 룬 버튼, 석주, 영웅 8종, 몬스터 17종, 보스, 무기, 하트, 물약, 상자 | `floor_1..8`, `floor_spikes_anim_f0..3`, `button_blue_up/down`, `ui_heart_full/half/empty`, `column`, `knight_m_*`, `big_demon_*`, `weapon_*`, `flask_*` |
| `x: 0..383, y: 512..639` | 2.5D 남향 고벽(`16×32`), 벽면 용암/치유 분수, 깃발 | `wh_single`, `wh_brick_l/m/r/alt`, `wh_lava_f0..2`, `wh_blue_f0..2`, `wh_banner_red/blue` |
| `x: 384..495, y: 512..623` | 벽면 바닥 그림자 오버레이 | `floor_shadow_0..3` |
| `x: 384..479, y: 624..639` | 다크 판타지 방패 4종, 불사조의 깃털, 고대 비전서 (`16×16`) | `shield_wood`, `shield_iron`, `shield_knight`, `shield_heroic`, `item_phoenix_feather`, `item_skill_book` |

### 스프라이트 종류별 그리기 기준 좌표 (`drawImage`)

16×16 원본 해상도의 오프스크린 버퍼에 그릴 때 타일·엔티티의 기준 좌표를 `px = Math.round(worldX * 16 - originX)`, `py = Math.round(worldY * 16 - originY)`로 잡습니다.

| 대상 | 스프라이트 키 규칙 | 크기 | `drawImage` 좌상단 `(dx, dy)` | 비고 |
| :--- | :--- | :---: | :--- | :--- |
| 일반 바닥 | `floor_1`, `floor_2`, `floor_3`, `floor_5` | `16×16` | `(x*16, y*16)` | `(x, y)` 좌표 해시로 변형 타일 혼합 |
| 남향 높은 벽 | `wh_brick_m`, `wh_brick_alt` | `16×32` | `(x*16, y*16 - 16)` | 상단 5px 석재 테두리 + 16px 벽돌면 |
| 하단 경계 턱 | `wall_top_mid` | `16×16` | `(x*16, y*16 - 16)` | 모든 석재 테두리와 동일한 `gy - 5..gy - 1` 높이로 정렬 |
| 좌·우 측면 벽 | `wall_outer_mid_left` / `right` | `16×16` | `(x*16, y*16)` | 0x72 원본 5px 석재 테두리 그대로 사용 |
| 4방향 방 모서리 | `wall_outer_top_left/right`, `wall_outer_front_left/right` | `16×16` | 상단 캡 `(x*16, y*16 - 16)`, 전면 `(x*16, y*16)` | 대각선 인접(`openSE`, `openSW`, `openNE`, `openNW`) 모서리 마감 |
| 석주 (`PILLAR`) | `column` | `16×48` | `(x*16, y*16 - 32)` | Y 정렬 순서 `sortY = (y + 0.9) * 16` |
| 반응형 가시 함정 | `floor_spikes_anim_f${frame}` | `16×16` | `(x*16, y*16)` | 기본 `f0`(숨김), `armed=f1`, `extended=f3` |
| 영웅 캐릭터 | `${p.skin}_${moving?'run':'idle'}_anim_f${0..3}` | `16×28` | `(px - 8, py - 23)` | `p.facing === 'left'`일 때 좌우 반전 |
| 피격 영웅 | `${p.skin}_hit_anim_f0` | `16×28` | `(px - 8, py - 23)` | `p.hit === true`일 때 붉은 점멸 |
| 사망 영웅 | `skull` | `16×16` | `(px - 8, py - 10)` | `!p.alive`일 때 |
| 몬스터 / 보스 | `m.singleAnim ? "${base}_anim_f${f}" : "${base}_${moving?'run':'idle'}_anim_f${f}"` | `16×16`, `16×23`, `32×36` | `(px - Math.floor(sp.w/2), py - sp.h + 5)` | `singleAnim: true` 대상은 `swampy`, `slug`, `muddy`, `ice_zombie`, `necromancer`. 보스(`big_demon`)·정예(`ogre`, `big_zombie`)는 `32×36` |
| 바닥 아이템 | `gi.item.spriteKey` | 가변 | `(ix - Math.floor(sp.w/2), iy - Math.floor(sp.h/2) + bob)` | `globalAlpha = gi.fadeAlpha ?? 1` 적용 |
| 장착 무기 | `p.weaponSprite` | 가변 | 근접: 손 회전 스윙 / 활: 조준 방향 시위 당김 / 지팡이: 캐릭터 옆 세로 직립(`6×21` 비율) | `p.weaponClass`로 모션 분기 |
| 장착 방패 | `p.shieldSprite` | `16×16` | 평소 보조 손, `p.guarding` 시 정면으로 들어 올림 | `p.parrying` 시 청록·금색 패링 아크 표시 |
| 체력 하트 | `ui_heart_full`, `ui_heart_half`, `ui_heart_empty` | `16×16` | HUD 및 캐릭터 머리 위 | 반칸(`1 HP`) 단위로 계산 |

---

## 맵 타일 ID 전체 목록 (`map.tiles[y][x]`, 72×52)

| ID | Key | 이동 가능 | 안전지대 | 렌더링 및 상호작용 규칙 |
| :---: | :--- | :---: | :---: | :--- |
| `0` | `VOID` | X | X | 던전 외부 공백 (`#0d0b0c`) |
| `1` | `FLOOR` | O | X | 일반 석재 바닥 (`floor_1..3`) |
| `2` | `WALL` | X | X | 2.5D 방향별 석벽 (오토타일 적용) |
| `3` | `FLOOR_CRACKED` | O | X | 금이 간 돌바닥 (`floor_5`) |
| `4` | `SPIKE_TRAP` | O | X | 반응형 압력 가시 함정: 평상시 `f0`로 숨어 있다가 밟으면 `state.traps[]`에 `armed(380ms, f1)` -> `extended(950ms, f3, 피해 1.5하트)` |
| `5` | `PILLAR` | X | X | 엄폐 석주 (`column`, 투사체 및 근접 LoS 차단) |
| `6` | `BOSS_FLOOR` | O | X | 보스 왕좌 바닥 (`floor_1` + 혈홍 틴트) |
| `7` | `SAFE_FLOOR` | O | O | 성소 안전지대 바닥 (`floor_1` + 푸른 틴트, PvP 비활성) |
| `8` | `TORCH_WALL` | X | X | 횃불 벽 (`wh_brick_*` + 3프레임 픽셀 불꽃 + 반경 56px 난색 광원) |
| `9` | `FOUNTAIN_HEAL` | O | O | 치유의 샘 (`wall_fountain_basin_blue_anim_f0..2` + 푸른 광원, 위에서 하트 회복) |
| `10` | `DOOR` | O | X | 구역 연결 통로 |
| `11` | `LAVA_PIT` | X | X | 용암 구덩이 (픽셀 용암 애니메이션 + 주황 광원) |
| `12` | `LAVA_WALL` | X | X | 벽면 용암 분수 (`wh_lava_f0..2` + 붉은 광원) |
| `13` | `HEAL_WALL` | X | X | 성소 벽면 치유 분수 (`wh_blue_f0..2` + 푸른 광원) |
| `14` | `SEALED_GATE` | X (`gateOpen` 시 `6`으로 변경) | X | 봉인의 문 (`map.gateTiles`, `x=52, y=8..11` 세로 4칸). `!state.puzzle.gateOpen` 동안 각 `16×16` 타일에 황금 봉인 장벽·창살을 그립니다. 퍼즐 완료 시 `gateOpen = true`가 되며 개방됩니다. |
| `15` | `RUNE_PAD` | O | X | 4룬 퍼즐 발판: 좌표와 색상(`blue`, `red`, `green`, `gold`)이 `map.runePads` 및 `state.puzzle.pads`로 전달됩니다. `floor_1` 위에 `button_blue_up/down` 또는 사각 룬 문양을 `pad.color`로 틴트해 그리고, `state.puzzle.litRunes`에 포함되면 밝은 광원을 켭니다. |

- **벽면 독침 발사기 (`map.dartShooters[]`)**: 미궁 벽면에 설치된 발사기 목록 `{ x, y, vx, vy, intervalMs }`이 `map_init.map` 및 `GET /api/map`에 포함됩니다. 인접 벽면에 작은 구멍 표시를 그리고, 날아오는 독침 투사체(`kind: "dart"`)는 녹색(`#82d964`) 화살촉 형태로 렌더링합니다.

---

## 벽 타일 및 모서리 연결 규칙

벽 타일(`tid ∈ {2, 8, 12, 13}`)은 상하좌우(`openN/S/E/W`)와 대각선 4방향(`openNE/NW/SE/SW`) 인접 타일이 열린 바닥(`open ∈ {1, 3, 4, 5, 6, 7, 9, 10, 11, 14, 15}`)인지 확인해 **2단계 패스(바탕·벽돌면 -> 지붕 석재 테두리·모서리 접합)**로 그립니다. 모든 상·하 석재 테두리는 `y = gy - 5..gy - 1`에, 좌·우 석재 테두리는 5px 폭(`x = gx + 11..15` / `gx + 0..4`)에 정렬합니다.

1. **1단계 (바탕과 남향 벽돌면)**:
   - `openS`: 전체 16px 폭의 `wh_brick_m` 또는 `wh_brick_alt`를 `(gx, gy - 16)`에 그립니다(`tid === 12`는 `wh_lava_f{0..2}`, `tid === 13`은 `wh_blue_f{0..2}` 덧그리기).
   - `!openS`: 타일 내부를 `#181415`로 채웁니다.
2. **2단계 (지붕 석재 테두리와 8방향 모서리 마감)**:
   - **돌출 문턱 모서리 (`openS && wallN`)**: `openW`이면 `wall_edge_bottom_left`를, `openE`이면 `wall_edge_bottom_right`를 `(gx, gy - 16)`에 그려 수직 테두리가 남향 벽 상단으로 매끄럽게(`└` / `┘`) 꺾이도록 연결합니다.
   - **좌·우 측면 벽 (`!openS`)**: `openE`이면 `wall_outer_mid_left`, `openW`이면 `wall_outer_mid_right`를 `(gx, gy)`에 그립니다.
   - **상단 오목 모서리 (`!openS`)**: `!openE && openSE && wallR`이면 `wall_outer_mid_left`를 `(gx, gy)`에 그려 왼쪽 수직 석재 테두리가 벽돌에 끊기지 않고 상단 `┌` 모서리(`gx + 11, gy - 5`)까지 이어지게 합니다. 우측(`!openW && openSW && wallL`)은 대칭으로 `wall_outer_mid_right`와 `┐` 모서리(`gx, gy - 5`)를 연결합니다.
   - **하단 경계 벽과 하단 모서리 (`!openS`)**: `openN`이면 `wall_top_mid`를 `(gx, gy - 16)`에 그리고, 돌출 모서리(`openW` / `openE`)와 오목 모서리(`!openN && !openE && openNE` / `!openN && !openW && openNW`)의 5×5 접합부(`#c8b8a4` 상단, `#8d7f74` 측면, `#2d2629` 외곽선)를 이어 검은 틈 없이 90도로 마감합니다.
3. **바닥 그림자**:
   - 열린 바닥 `(x, y)` 위쪽 `(x, y - 1)`이 벽이면 `floor_shadow_{0..3}`을 덧그리고, 왼쪽 `(x - 1, y)`가 벽이면 좌측 3픽셀 영역에 반투명 그림자(`rgba(8,6,7,0.34)`)를 그립니다.

---

## 던전 광원 처리

오프스크린 캔버스(`darkBuffer`)를 픽셀 버퍼와 같은 크기로 만들어 어둠 레이어를 구성합니다.

1. `darkBuffer` 전체를 `rgba(6, 5, 11, 0.62)`로 칠합니다.
2. `globalCompositeOperation`을 `destination-out`으로 바꾼 뒤, 화면에 보이는 광원마다 3단계 동심원으로 어둠을 걷어냅니다.
   - 내 캐릭터 시야: 반경 `72px` / 다른 플레이어: `44px`
   - 벽 횃불(`8`): `56px` / 용암(`11, 12`)·치유 분수(`9, 13`): `44~52px`
   - 보스(`big_demon`): `52~66px` / 점등된 룬 발판(`15`): `44px` / 투사체: `24px`
3. 메인 픽셀 버퍼 위에 `darkBuffer`를 덮고, 각 광원 위치에 따뜻한 색감 글로우를 `lighter` 블렌드로 덧그립니다.

---

## 렌더링 구성 및 최적화

1. **정적 지형 캐싱**: `map_init`을 받은 직후 `72×52` 바닥, 그림자, 정적 벽을 오프스크린 캔버스(`1152×832`)에 한 번만 그려 두고 매 프레임 뷰포트 영역만 복사합니다.
2. **이동 보간**: 서버 상태는 초당 20회 도착하므로, 렌더 프레임마다 내 캐릭터와 원격 엔티티 위치를 부드럽게 보간해 표시합니다.
3. **확대 출력과 텍스트 오버레이**: 픽셀 아트는 `imageSmoothingEnabled = false` 상태에서 정수 배율(`3배`)로 확대 출력하고, 이름표·체력 표시·피해량 숫자처럼 선명해야 하는 텍스트는 확대가 끝난 디스플레이 캔버스 위에 그립니다.
4. **미니맵**: `72×52` 정적 지형을 `scale = 3`(`216×156`) 오프스크린 버퍼에 캐싱한 뒤, 매 프레임 플레이어와 몬스터 위치 점만 갱신합니다.
