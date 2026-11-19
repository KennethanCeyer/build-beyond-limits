# Build Beyond Limits 전투 · 직업 · 스킬 · 보스 · 연출 명세

이 문서는 체력과 부활 규칙, 4종 직업과 주 무기 숙련, 강공격 차지, 방패 막기와 전방 120도·광역 패링, 분기형 스킬 트리, 4등급 주사위 장비(방어도·고유 효과 포함), 3단계 보스 패턴, 반응형 함정, 그리고 `state.events[]` 전체 연출 매핑을 정리합니다.

---

## 체력과 부활 규칙

- **반칸 하트 단위**: `state.me.hp`와 `state.me.maxHp`는 **반칸(Half-Heart) 단위**입니다. 예를 들어 `hp: 6`은 하트 3칸, `hp: 5`는 하트 2.5칸입니다.
- **레벨업 규칙**: 레벨이 오르면 체력이 전부 회복되지 않고 **하트 +0.5칸(`+1 HP`)**만 회복되며, 반경 `3.8`타일 주변 몬스터를 밀쳐내고 `480ms` 경직시키는 충격파가 발동합니다. 능력치 포인트는 레벨당 `+1`점, 스킬 포인트는 **3레벨마다(Lv.3, 6, 9...)** `+1`점 지급됩니다.
- **부활과 초기화**: 모든 탐험은 `revivesLeft: 1`로 시작합니다.
  - `revivesLeft > 0`에서 쓰러지면 부활 기회 1회를 소모해 3초 뒤 성소에서 장비와 레벨을 유지한 채 부활합니다.
  - `revivesLeft === 0`에서 쓰러지면 장비·레벨·스킬이 초기화되고 `me.classChosen = false`, `me.lastRunSummary = { reachedLevel, mobKills, bossKills, endedAt }`가 설정되어 직업 선택 화면으로 돌아갑니다.
  - 플레이어가 원할 때 `action: "restart_run"`을 보내 탐험을 처음부터 다시 시작할 수도 있습니다(클라이언트에서 실수 방지용 확인 모달을 띄운 뒤 전송하는 것을 권장).
  - 정예 몬스터·보스에서 드물게 드롭되는 **불사조의 깃털(`phoenix_feather`)**을 사용하면 부활 기회가 `+1` 증가합니다.

---

## 4종 직업과 주 무기 숙련

| 직업 (`classId`) | 기본 하트 | 이동 속도 | 주 무기 (`preferredWeaponClass`) | 고유 능력 및 무기 숙련 |
| :--- | :---: | :---: | :---: | :--- |
| `knight` (수호기사) | 4.0 (`8`) | `5.4` | `melee` (근접 무기) | 막기 피해 감소 +15%, 패링 판정 `0.42초`, 반격 1.45배 / 숙련 시 공격력 +15%, 치명타 확률 +5%, 막기 피해 감소 +5% |
| `ranger` (심연 사냥꾼) | 3.0 (`6`) | `6.45` | `bow` (원거리 활) | 대시 대기시간 -30%, 치명타 확률 +12%, 대시 직후 첫 공격 확정 치명타(1.5배) / 숙련 시 공격력 +15%, 치명타 확률 +8%, 화살 속도 +20% |
| `mage` (화염 술사) | 2.5 (`5`) | `5.75` | `staff` (마법 지팡이) | 스킬 피해 +35%, 폭발·스킬 범위 +35%, 차지 속도 +35% / 숙련 시 공격력 +18%, 폭발 반경 +20%, 스킬 대기시간 -10% |
| `berserker` (광전사) | 3.5 (`7`) | `6.05` | `melee` (근접 무기) | 잃은 하트 1칸당 공격력 +28%·이동 속도 +7%, 처치 시 25% 확률 하트 +0.5 흡수 / 숙련 시 공격력 +20%, 공격 속도 +12% |

---

## 무기별 공격, 강공격 차지, 방패 막기와 패링

### 공격 및 서버 측 차지 타이머
- **근접 무기 (`melee`)**: 캐릭터 몸통 중심(`y - 0.3`) 대칭 판정, 사거리 `2.35`타일(강공격 `2.9`), 전방 `140도`(강공격 `180도`) 부채꼴, 벽 차폐(LoS) 적용. 치명타 발동 시 피해 `1.5배`.
- **원거리 활 (`bow`)**: 빠른 화살 투사체(`kind: "arrow"`). 강공격 시 적을 관통하는 강화 화살(`heavy: true`) 발사.
- **마법 지팡이 (`staff`)**: 적중 시 `splashRadius` 반경 광역 폭발(`kind: "arcane"`, `arcane_boom` 이벤트)을 일으키는 마법구 발사.
- **강공격 차지 규칙**:
  - 공격 키를 길게 누를 때 `{ type: "action", seq, action: "charge_start" }`를 먼저 보내고, 키를 뗄 때 `{ type: "action", seq, action: "attack", aim }`를 보냅니다.
  - 서버 기준 차지 완료 시간은 `heavyChargeMs = 550ms`, 강공격 임계 비율은 `heavyThreshold = 0.65`입니다. 클라이언트가 임의로 보낸 `charge` 값은 무시되며, 공격 대기시간이 끝난 상태에서 `charge_start`를 보낸 뒤 기본 약 `358ms`(화염 술사 약 `265ms`) 이상 지난 뒤 `attack`을 보내야 `heavy: true`(1.9배 위력)가 발동합니다.

### 방패 막기와 전방 120도·광역 패링
- **유지형 막기**: 누를 때 `{ type: "action", seq, action: "guard", active: true }`, 뗄 때 `active: false`를 보냅니다. 바라보는 방향 기준 **전방 120도 이내**의 근접·원거리 공격(원거리 투사체는 속도 벡터 기준 선분 충돌 및 전방 `0.85`타일 요격)과 **방향 무관 광역 패턴**을 막아냅니다. 막는 동안 이동 속도가 `52%`로 줄고 방패 등급과 직업 보너스만큼 피해가 줄어듭니다(최대 95%, 보스 패턴·보스 근접 공격은 최소 반칸 피해). 방패를 장착한 상태에서 일반 원거리 투사체를 막으면 `Math.floor` 경감이 적용되어 막기 감소율 `50%` 이상이면 피해 `0`(`BLOCKED!`)으로 완전히 막아냅니다. 등 뒤(전방 120도 밖)에서 들어온 단일 공격은 막히지 않습니다.
- **퍼펙트 패링 (`0.32초`, 수호기사 `0.42초`)**: 적의 공격이 닿기 직전 **0.32초 이내**(수호기사 `0.42초`)에 막기를 새로 올리면 `parry_success`가 발동합니다. 패링 재장전 대기시간은 `750ms`입니다.
  - **판정 범위**: 바라보는 방향 기준 **전방 120도** 이내에서 들어오는 근접·원거리 공격과 방향 무관 **광역 장판 공격**(`infernal_slam`, `abyssal_cross`, `hellfire_nova`, `ogre_slam`)을 방어·튕겨냅니다(바닥 가시 함정과 대시 전용 `oblivion_wave` 제외).
  - **원거리 반사**: 원거리 투사체의 입사 방향(`-vx, -vy`)이 캐릭터 정면 120도 이내이고 방패 요격 반경(`1.05`타일)에 닿으면 패링이 발동합니다. **날아온 동일한 미사일을 방패 앞쪽에서 발사 지점 방향으로 1.45배 속도로 튕겨내 반격**하며(`parry_success.reflected = true`), 연속 투사체도 `140ms` 동안 연달아 반사할 수 있습니다.
  - **근접 반격**: 피해 0 + 공격 대기시간 즉시 초기화 + 근접 공격자 넉백·기절(`1.6초`, 보스 `0.85초`) + **3.5초간 공격 취약(`vulnerable: true`, 받는 피해 1.75배)**.
- **대시 회피 무적**: 대시 지속 시간은 `200ms`, 회피 판정 무적 시간은 `280ms`(대시 `200ms` + 네트워크 유예 `80ms`)이며 대시 진행 중에는 공격·방어·스킬·재대시가 잠깁니다.
- **피격 무적 시각 연출**: 피격 후 무적(`invulnerable: true`)에는 실드 그래픽을 그리지 말고, 캐릭터 스프라이트를 `70ms` 주기로 `globalAlpha = 0.34`로 깜빡이게 표시합니다.

---

## 분기형 스킬 트리와 능력치 배분

### 능력치 투자 (`action: "allocate_stat"`, 레벨당 1포인트)
- `str` (힘): 공격력 `+2`, 치명타 확률 `+1%`
- `vit` (체력): `VIT` 3당 최대 하트 `+0.5칸` (최대 `+2.0칸`)
- `agi` (민첩): 이동 속도 `+2%`, 대기시간 `-3%`, 치명타 확률 `+1%`

### `[Q]` 전술 스킬 / `[R]` 궁극 스킬 (`action: "learn_skill"`, `action: "skill"`, 최대 레벨 10)
슬롯당 3종 후보 중 1종을 선택하면 해당 슬롯이 그 스킬로 고정되며, 이후 스킬 포인트로 최대 레벨 10까지 강화합니다.

| 슬롯 | `skillId` | 이름 | 기본 대기시간 | 효과 |
| :---: | :--- | :--- | :---: | :--- |
| `q` | `crimson_tempest` | 핏빛 선풍 | `5.2s` | 주변 360도 혈강 회전 참격과 강한 넉백 |
| `q` | `frost_nova` | 서리 결계 | `6.0s` | 주변 적 이동 둔화(`slowed: true`)와 파쇄 피해 |
| `q` | `phantom_lunge` | 그림자 습격 | `5.5s` | 전방 `4.2`타일 고속 관통 돌진 참격 |
| `r` | `abyssal_lance` | 심연의 창 | `8.5s` | 전방 `7`타일 공허 관통 창 (보스·취약 대상 확정 치명타) |
| `r` | `solar_judgment` | 성광의 심판 | `9.0s` | 전방 지점 태양 운석 폭발과 기절 |
| `r` | `soul_reaver` | 영혼 수확 | `9.5s` | 쌍검 절단과 적중 시 하트 +1칸 흡수 |

---

## 4등급 주사위 장비, 방어도, 고유 효과 및 특수 아이템

- **등급 (`rarity`)**: `common` (`#b8b0a4` 일반), `rare` (`#5ea6e0` 희귀), `unique` (`#c278e8` 유니크), `legendary` (`#f0c456` 전설). 일반 몬스터(1~2티어)도 낮은 확률(`0.8%` / `2.5%`, 3티어 정예 `9%`)로 전설 장비를 드롭합니다.
- **유니크 이상 방어도 (`defBonus` -> `state.me.def`)**: 유니크·전설 등급의 모든 장비(무기·방패·방어구)에는 주사위 방어도가 추가로 붙으며, 합산 방어도(`state.me.def`) 1당 받는 피해가 약 `3%`(최대 `45%`) 경감됩니다.
- **장비 고유 효과 (`effectKey`, `effectName`, `effectDesc`)**: 일반 이상 모든 장비에 전투 방식을 바꾸는 고유 패시브가 붙습니다.
  - `quick_step` (이동 속도 +5%), `balanced_strike` (공격 대기시간 -6%), `heavy_cleave` (강공격 피해 +15~18%), `bleed_edge` (치명타 적중 시 추가 피해 +25%), `executioner` (저체력 적 처형 피해 +35~45%), `vampiric` (처치 시 30% 확률 하트 +0.5칸 흡수), `frostbite` (적중 시 적 1.4~1.8초 둔화), `chain_lightning` (적중 시 주변 적에게 40~45% 연쇄 피해), `pierce_volley` (일반 화살 관통 확률 35~50%), `swift_stride` (이동 속도 +8%, 대시 대기시간 -12%), `thorns` (막기/피격 시 근접 반사 피해), `parry_nova` (패링 성공 시 주변 광역 기절 충격파 + 전설은 하트 회복), `phoenix_ward` (피격 시 30% 확률 화염 반격 충격파).
- **주사위 롤 필드**: 모든 장비는 템플릿의 범위 안에서 생성 시 주사위를 굴려 `rollQuality` (`0..100`), `rollGrade` (`하급`/`중급`/`상급`/`최상급`), `rollMeta` (`atkRange`, `critRange`, `defRange`, `splashRange`, `heartRange`, `blockRange`, `parryRange`)를 포함합니다.
- **특수 아이템**:
  - `heart_pickup`: `kind: "instant_heart"`, `healHearts: 2`, `spriteKey: "ui_heart_full"` (0.95타일 내 자동 흡수)
  - `skill_book`: `kind: "consumable"`, `grantSkillPoint: 1`, `spriteKey: "item_skill_book"` (전용 고대 마도서 스프라이트)
  - `phoenix_feather`: `kind: "consumable"`, `grantRevive: 1`, `spriteKey: "item_phoenix_feather"` (전용 불사조 깃털 스프라이트)
- **바닥 아이템 소멸**: 비고정 바닥 아이템은 일정 시간(일반 5초, 전설 12초, 보스 드롭 30초) 경과 시 `groundItems[].fadeAlpha`가 `1.0 -> 0.05`로 줄어들며 소멸합니다.

---

## 반응형 함정, 보스 3단계 에스컬레이션 및 장판 스키마

### 반응형 압력 가시 함정 (`tid === 4`, `state.traps[]`)
1. 평상시 숨김(`floor_spikes_anim_f0`, `state.traps[]`에 없음).
2. 밟으면 `armed` (`380ms` 예고, `frame: 1`, `trap_arm` 이벤트) -> `extended` (`950ms` 가시 돌출, `frame: 3`, `trap_trigger` 이벤트, 피해 **1.5하트 = 3 반칸**) -> `cooldown` (`1350ms`, `frame: 0`).
3. 벽면 독침 발사기(`map.dartShooters[]`)는 주기적으로 독침(`kind: "dart"`, `#82d964`, 피해 1하트)을 발사합니다.

### 3단계 에스컬레이션 보스 및 패턴
보스를 처치하면 3분(`180,000ms`, `bossStatus.nextBossInMs`) 뒤 다음 단계 보스가 등장합니다. 비전투 상태의 몬스터는 초당 3%, 보스는 초당 5.5% 체력을 회복합니다.

- **1단계**: 심연의 화신 말라코르 (`infernal_slam`, `abyssal_cross`, `hellfire_nova`, `oblivion_wave`)
- **2단계**: 흑요석의 심판관 아자젤 (`oblivion_wave`, `abyssal_cross`, `infernal_slam`, `cinder_barrage`, `hellfire_nova`)
- **3단계**: 종말의 군주 보이드로드 바알 (`oblivion_wave`, `infernal_slam`, `abyssal_cross`, `cinder_barrage`, `hellfire_nova`, 강화된 체력·피해 및 빠른 패턴 주기)

| 패턴 이름 | 전송 위치 | 정확한 JSON 형태 | 렌더링 방식 |
| :--- | :---: | :--- | :--- |
| `infernal_slam` / `ogre_slam` | `state.telegraphs[]` | `{ shape: "circle", x, y, radius, progress, damage }` | 반경 `radius` 원형 경고 장판 + 내부 `radius * progress` 차오름 |
| `abyssal_cross` | `state.telegraphs[]` | `{ shape: "cross", x, y, halfWidth: 1.45, bounds: { x1, y1, x2, y2 }, progress }` | `bounds` 전체를 가로지르는 십자 띠 (`폭 = halfWidth * 2`) |
| `hellfire_nova` | `state.telegraphs[]` | `{ shape: "ring", x, y, innerRadius: 2.1, outerRadius: 6.2, progress }` | 중앙 `innerRadius` 안전지대, `innerRadius..outerRadius` 도넛 폭발 |
| `oblivion_wave` | `state.waves[]` | `{ id, label, x, y, radius, maxRadius, bandWidth, color }` | 확장하는 치명 충격파 고리 (`Shift` 대시 무적으로만 통과 가능) |
| `cinder_barrage` | `state.projectiles[]` | 보스 시전 예고(`aiState: "windup"`, `windupKind: "cinder_barrage"`, 약 `520~650ms`) 후 8~12발 방사 (`color: "#f0c869"`) | 시전 링 예고 확인 후 패링 반사 또는 회피 |

---

## `state.events[]` 전체 이벤트 카탈로그

| `event.type` | 주요 필드 | 권장 시각·오디오 연출 |
| :--- | :--- | :--- |
| `class_selected` | `playerId, classId, className, x, y` | 직업 선택 모달 닫기 및 스폰 연출 |
| `slash` | `playerId, weaponClass, heavy, originX, originY, dirX, dirY, range?, arcDeg?, weaponSprite, weaponRarity` | 근접 참격 아크 / 활 시위 당김 / 지팡이 시전 모션 + 공격음 |
| `arcane_boom` | `x, y, radius, color` | 마법 지팡이 폭발 링 및 파편 파티클 |
| `damage` | `targetId, targetKind, attackerId?, x, y, amount, hearts?, blocked?, crit, vulnerableHit?, remainingHp, maxHp, source` | 상승 피해 숫자 팝업, 치명/취약 강조, 피격 점멸·화면 진동 |
| `guard_raise` | `playerId, hasShield, x, y` | 방패 올리기 모션 및 금속음 |
| `guard_block` | `playerId, reducedTo, x, y` | 방패 막기 불꽃(`reducedTo === 0` 시 `BLOCKED!`) 및 금속 막기음 |
| `parry_success` | `playerId, sourceKind, reflected?, counterDamage, x, y` | `PARRY!` (원거리 반사 시 `REFLECT!`) 팝업 + 청록·금색 충격파 링 + 강철 반격음 |
| `dash` | `playerId, fromX, fromY, dirX, dirY, x, y` | 대시 슬라이드 잔상 및 질주음 |
| `dash_dodge` | `playerId, x, y` | 보스 충격파 대시 회피 `DODGE!` 표시 |
| `skill_learn` | `playerId, slot, skillId, skillName, level, x, y` | 스킬 습득/강화 알림 및 효과음 |
| `skill_vfx` | `skillId, playerId, x, y, radius?, endX?, endY?, dirX?, dirY?` | 6종 스킬별 링·관통 빔·운석 폭발·쌍검 연출 |
| `stat_up` | `playerId, stat, value, x, y` | 능력치 상승 팝업 |
| `level_up` | `playerId, level, spGained, skillGained, radius, knockedCount, x, y` | `LV.N UP!` 팝업 + 반경 `3.8` 넉백 충격파 링 + 팡파르 |
| `pickup` / `equip` | `playerId, item, equipped?, slot?, x, y` | 슬롯 갱신 및 등급별 획득음 |
| `heal` / `buff` | `playerId, amount` / `buffType, durationMs` | 하트 회복(`+amount/2`) 팝업 / 버프음 |
| `skill_book` / `revive_up` | `playerId, amount` / `revivesLeft` | 스킬 포인트 / 부활 횟수 증가 연출 |
| `player_death` / `respawn` | `playerId, codename, respawnAt, runReset, runSummary, revivesLeft` | 3초 사망 오버레이(`runReset` 시 탐험 종료 표시) / 성소 부활 |
| `mob_windup` | `mobId, kind ("ranged" \| "cinder_barrage"), color, x, y` | 원거리 몬스터 시전 구체·조준선 및 보스 방사탄 충전 예고음 |
| `mob_attack` | `mobId, ranged?, originX, originY, dirX, dirY, isBoss` | 몬스터 근접 참격 궤적 및 원거리 투사체 발사 |
| `mob_death` | `mobId, name, killerId, isBoss, tier, x, y` | 몬스터 처치 폭발 링·픽셀 파편 파티클 및 처치 효과음 |
| `trap_arm` / `trap_trigger` | `x, y` | 함정 예고음 / 가시 발동 표시 |
| `puzzle_step` / `puzzle_reset` / `puzzle_solved` | `runeId, progress, total` / `solver` | 룬 점등·초기화·봉인 해제 효과음 |
| `boss_spawn` / `boss_phase2` / `boss_wave` / `boss_killed` | `tier, name` / `killer, bossUuid, nextBossAt, heroicItem` | 보스 등장·광폭화·충격파 경보·토벌 배너 |
| `telegraph_boom` | `telegraph` | 장판 폭발 이펙트 및 굉음 |
| `pvp_toggle` | `enabled` | PvP 활성화/비활성화 배지 갱신 |

---

## 오디오 및 효과음 가이드

서버는 오디오 파일을 전송하지 않고 전투·상태 이벤트(`state.events[]`)와 현재 구역(`state.me.zone`)만 전달합니다. 클라이언트에서 아래 이벤트에 맞춰 효과음과 배경음악을 붙이면 전투 타격감과 회피 타이밍 파악이 크게 좋아집니다.

- **전투 효과음 예시**: 기본 공격 휘두르기(`slash`), 강공격 묵직한 타격(`slash.heavy`), 방패 올리기(`guard_raise`), 방패 막기(`guard_block`), 패링 금속 반격음(`parry_success`), 대시 질주음(`dash`), 마법 폭발음(`arcane_boom`), 피격음과 치명타음(`damage`), 몬스터 처치음(`mob_death`).
- **경고 및 성장 효과음 예시**: 원거리 시전 충전음(`mob_windup`), 가시 함정 예고 철컥음(`trap_arm`), 보스 충격파 경보(`boss_wave`), 보스 장판 폭발(`telegraph_boom`), 룬 퍼즐 점등·초기화·해제(`puzzle_step`, `puzzle_reset`, `puzzle_solved`), 레벨업 팡파르(`level_up`), 아이템 획득·회복(`pickup`, `heal`).
- **배경음악 전환 예시**: `state.me.zone`이 `성소`일 때는 잔잔한 분위기, 일반 던전에서는 긴장감 있는 리듬, `왕좌`에서 보스가 살아 있을 때는 박진감 있는 보스 테마로 전환할 수 있습니다.

> **창작 권장 안내**: 위 항목은 참고용 예시입니다. Web Audio API 신디사이저(칩튠, FM 신스, 로파이, 앰비언트)나 직접 준비한 음원 파일, 동적 리듬 효과 등 어떤 방식이든 자유롭게 선택해 본인만의 사운드 연출을 창작해 보시길 권장합니다.
