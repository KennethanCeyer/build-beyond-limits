# Build Beyond Limits 전투, 직업, 스킬, 보스, 연출 명세

체력과 부활, 4종 직업과 주 무기 숙련, 강공격 차지, 방패 막기와 패링, 스킬 트리, 4등급 장비, 3단계 보스 패턴, `state.events[]` 스키마 규격입니다.

---

## 체력과 부활 규칙

- 반칸 하트 단위: `state.me.hp`와 `state.me.maxHp`는 반칸 단위입니다. 예를 들어 `hp: 6`은 하트 3칸, `hp: 5`는 2.5칸입니다.
- 레벨업: 체력이 하트 0.5칸(`+1 HP`) 회복되며, 반경 `3.8`타일 내 몬스터를 밀쳐내고 `480ms` 동안 경직시키는 충격파가 나갑니다. 능력치 포인트는 레벨당 `+1`점, 스킬 포인트는 3, 6, 9레벨처럼 3레벨마다 `+1`점 지급됩니다.
- 부활과 초기화: 탐험은 `revivesLeft: 1` 상태로 시작합니다.
  - `revivesLeft > 0`일 때 사망하면 부활 기회 1회를 쓰고 3초 뒤 성소에서 장비와 레벨을 유지한 채 부활합니다.
  - `revivesLeft === 0`일 때 사망하면 장비, 레벨, 스킬이 초기화되고 `me.classChosen = false`로 바뀌어 직업 선택 단계로 돌아갑니다. 이때 `player_death.runSummary`와 `me.lastRunSummary`에 `{ reachedLevel, mobKills, bossKills, endedAt }`이 기록됩니다(`endedAt`은 Unix 밀리초 숫자이며, JSON 모드에서는 `classId`, `className`이 함께 들어갑니다).
  - `action: "restart_run"`을 보내면 현재 탐험을 초기화하고 성소에서 직업을 다시 고를 수 있습니다.
  - 정예 몬스터나 보스가 드롭하는 불사조의 깃털(`phoenix_feather`)을 쓰면 `revivesLeft`가 최대 3까지 `+1` 늘어납니다.

---

## 4종 직업과 주 무기 숙련

| 직업 (`classId`) | 이름 | 기본 하트 | 이동 속도 | 주 무기 | 고유 특성 및 주 무기 숙련 보너스 |
| :--- | :--- | :---: | :---: | :---: | :--- |
| `knight` | 수호기사 | 4.0 (`8`) | `5.4` | `melee` | 막기 피해 감소 +15%, 패링 판정 `0.42초`, 반격 1.45배 / 숙련: 공격력 +15%, 치명타 확률 +5%, 막기 감소 +5% |
| `ranger` | 심연 사냥꾼 | 3.0 (`6`) | `6.45` | `bow` | 대시 대기시간 -30%, 기본 치명타 확률 `18%`, 대시 후 `2.2초` 내 첫 공격 확정 치명타, 차지 속도 +15% / 숙련: 공격력 +15%, 치명타 확률 +8%, 화살 속도 +20% |
| `mage` | 화염 술사 | 2.5 (`5`) | `5.75` | `staff` | 스킬 피해 +35%, 폭발 및 스킬 범위 +35%, 차지 속도 +35% / 숙련: 공격력 +18%, 폭발 반경 +20%, 스킬 대기시간 -10% |
| `berserker` | 광전사 | 3.5 (`7`) | `6.05` | `melee` | 잃은 하트 1칸당 공격력 +28% 및 이동 속도 +7%, 처치 시 25% 확률 하트 +0.5 회복, 대시 대기시간 -8%, 스킬 피해 +10%, 범위 +5%, 차지 속도 +10% / 숙련: 공격력 +20%, 공격 속도 +12% |

---

## 무기별 공격, 강공격 차지, 방패 막기와 패링

### 공격 및 서버 측 차지 타이머
- 근접 무기 (`melee`): 몸통 중심(`y - 0.3`) 기준 사거리 `2.35`타일(강공격 `2.9`), 전방 `140도`(강공격 `180도`) 부채꼴, 벽 차폐 적용. 기본 `1.0배`, 강공격 `1.9배` 피해 및 확정 치명타(`1.5배`)가 적용됩니다.
- 원거리 활 (`bow`): 화살 투사체(`kind: "arrow"`). 기본 `0.95배`, 강공격 시 `1.85배` 피해, 화살 속도 `1.25배`, 관통(`piercing: true`, 투사체 치명타 `1.45배`)이 적용됩니다.
- 마법 지팡이 (`staff`): 적중 시 `splashRadius` 반경 폭발(`kind: "arcane"`, `arcane_boom` 이벤트)을 일으키는 마법구. 기본 `1.05배`, 강공격 시 직격 `1.9배`(투사체 치명타 `1.45배`) 및 폭발 반경 `1.45배`가 적용되며 주변 폭발 피해는 직격의 `0.75배`입니다.
- 강공격 차지 규칙:
  - 공격 키를 누를 때 `{ type: "action", seq, action: "charge_start" }`, 뗄 때 `{ type: "action", seq, action: "attack", aim }`를 보냅니다.
  - 서버 기준 차지 시간은 `heavyChargeMs = 550ms`, 임계 비율은 `0.65`입니다. 클라이언트가 보낸 `charge` 값은 무시되며, 공격 대기시간이 끝난 상태에서 `charge_start` 이후 기본 약 `358ms`(심연 사냥꾼 `311ms`, 광전사 `325ms`, 화염 술사 `265ms`) 이상 지나야 `heavy: true` 강공격이 나갑니다.

### 방패 막기와 패링
- 유지형 막기: 누를 때 `{ type: "action", seq, action: "guard", active: true }`, 뗄 때 `active: false`를 보냅니다. 전방 120도 이내의 근접 및 원거리 공격(투사체는 속도 벡터 선분 충돌 및 `0.85`타일 요격)과 방향 무관 광역 패턴 피해를 줄입니다. 막기 중 이동 속도는 `52%`가 되며 피해 감소 상한은 `95%`(보스 공격은 최소 반칸 피해)입니다. 방패 장착 상태에서 일반 원거리 투사체를 막으면 `Math.floor` 내림이 적용되어 감소율 `50%` 이상에서 피해가 `0`(`BLOCKED!`)이 됩니다. 전방 120도 밖 단일 공격은 막히지 않습니다.
- 패링 (`0.32초`, 수호기사 `0.42초`): 피격 직전 `0.32초`(수호기사 `0.42초`) 안에 막기를 새로 올리면 `parry_success`가 발동합니다(재장전 대기시간 `750ms`).
  - 판정 대상: 전방 120도 이내 근접 및 원거리 공격과 광역 장판(`infernal_slam`, `abyssal_cross`, `hellfire_nova`, `ogre_slam`). 가시 함정과 대시 회피 전용 `oblivion_wave`는 제외됩니다.
  - 원거리 반사: 투사체 입사 방향(`-vx, -vy`)이 정면 120도 이내이고 방패 요격 반경(`1.05`타일)에 닿으면 같은 투사체를 발사 지점으로 `1.45배` 속도로 되돌려 보냅니다(`parry_success.reflected = true`, `140ms` 연속 반사 허용).
  - 근접 반격: 피해 0, 공격 대기시간 초기화, 근접 공격자 넉백과 기절(`1.6초`, 보스 `0.85초`), 3.5초간 취약(`vulnerable: true`, 받는 피해 `1.75배`)을 부여합니다.
- 대시 회피 무적: 대시 이동 `200ms`, 회피 무적 `280ms`(대시 `200ms` + 네트워크 유예 `80ms`). 대시 중에는 공격, 방어, 스킬, 재대시가 잠깁니다.
- 피격 무적 표시: 피격 후 무적(`invulnerable: true`) 동안에는 별도 보호막 도형 없이 캐릭터 스프라이트를 `70ms` 주기로 `globalAlpha = 0.34` 점멸합니다.

---

## 분기형 스킬 트리와 능력치 배분

### 능력치 투자 (`action: "allocate_stat"`, 레벨당 1포인트)
- `str` 힘: 공격력 `+2`, 치명타 확률 `+1%`
- `vit` 체력: `VIT` 3당 최대 하트 `+0.5칸`, 최대 `+2.0칸`
- `agi` 민첩: 이동 속도 `+2%`, 대기시간 `-3%`, 치명타 확률 `+1%`

### `[Q]` 전술 스킬 / `[R]` 궁극 스킬 (`action: "learn_skill"`, `action: "skill"`, 최대 레벨 10)
슬롯당 3종 후보 중 1종을 선택하면 해당 슬롯이 고정되며, 스킬 포인트로 최대 레벨 10까지 강화합니다.

| 슬롯 | `skillId` | 이름 | 기본 대기시간 | 효과 |
| :---: | :--- | :--- | :---: | :--- |
| `q` | `crimson_tempest` | 핏빛 선풍 | `5.2s` | 반경 `3.0`(레벨당 `+0.1`, 직업 `aoeMult` 적용)타일 360도 회전 참격 및 넉백 |
| `q` | `frost_nova` | 서리 결계 | `6.0s` | 반경 `3.4`(레벨당 `+0.12`)타일 피해, 이동 둔화(`slowed: true`, `2.4초 + 레벨×0.18초`) 및 일반 몬스터 `0.5초` 기절 |
| `q` | `phantom_lunge` | 그림자 습격 | `5.5s` | 전방 `4.2`타일 관통 돌진 참격, 대시 무적 판정 포함 |
| `r` | `abyssal_lance` | 심연의 창 | `8.5s` | 전방 `7.0`타일 관통 창, 보스와 취약 대상 확정 치명타 |
| `r` | `solar_judgment` | 성광의 심판 | `9.0s` | 전방 `3.2`타일 지점 반경 `2.8`(레벨당 `+0.1`)타일 확정 치명타 운석 폭발 및 일반 몬스터 `0.8초` 기절 |
| `r` | `soul_reaver` | 영혼 수확 | `9.5s` | 전방 `3.6`타일(`170도`) 절단 및 보스 적중 또는 적 처치 시 하트 +1칸 회복 |

---

## 4등급 장비, 방어도, 고유 효과 및 특수 아이템

- 등급 (`rarity`): `common` (`#b8b0a4` 일반), `rare` (`#5ea6e0` 희귀), `unique` (`#c278e8` 유니크), `legendary` (`#f0c456` 전설). 일반 몬스터도 전설 장비를 드롭합니다(1티어 `0.8%`, 2티어 `2.5%`, 3티어 정예 `9%`).
- 방어도 (`defBonus` -> `state.me.def`): 유니크 및 전설 등급 장비(무기, 방패, 방어구)에 방어도가 붙으며, 합산 `def` 1당 받는 피해가 최대 `45%`까지 `3%`씩 줄어듭니다.
- 고유 효과 (`effectKey`, `effectName`, `effectDesc`):
  - `quick_step` 이동 속도 +5%, `balanced_strike` 공격 대기시간 -6%, `heavy_cleave` 강공격 피해 +15~18%, `bleed_edge` 치명타 추가 피해 +25%, `executioner` 저체력 적 처형 피해 +35~45%, `vampiric` 처치 시 30% 확률 하트 +0.5칸 회복, `frostbite` 적중 시 1.4~1.8초 둔화, `chain_lightning` 적중 시 주변 적 40~45% 연쇄 피해, `pierce_volley` 일반 화살 관통 확률 35~50%, `swift_stride` 이동 속도 +8% 및 대시 대기시간 -12%, `thorns` 막기나 피격 시 근접 반사 피해, `parry_nova` 패링 시 광역 기절 충격파(전설은 하트 회복 포함), `phoenix_ward` 피격 시 30% 확률 화염 반격 충격파.
- 주사위 수치 필드: 생성 시 템플릿 범위 안에서 결정된 `rollQuality` (`0..100`), `rollGrade` (`하급`/`중급`/`상급`/`최상급`), `rollMeta` (`atkRange`, `critRange`, `defRange`, `splashRange`, `heartRange`, `blockRange`, `parryRange`)를 포함합니다.
- 특수 아이템 및 소멸:
  - `heart_pickup`: `kind: "instant_heart"`, `healHearts: 2`, `spriteKey: "ui_heart_full"`, 0.95타일 내 자동 흡수
  - `skill_book`: `kind: "consumable"`, `grantSkillPoint: 1`, `spriteKey: "item_skill_book"`
  - `phoenix_feather`: `kind: "consumable"`, `grantRevive: 1`, `spriteKey: "item_phoenix_feather"`
  - 비고정 바닥 아이템은 일반 `5초`, 전설 `12초`, 보스 드롭 `30초` 뒤 `groundItems[].fadeAlpha`(`1.0 -> 0.05`)와 함께 사라집니다.

---

## 반응형 함정 및 3단계 보스 패턴

### 반응형 압력 가시 함정 (`tid === 4`, `state.traps[]`)
1. 평상시 숨김(`floor_spikes_anim_f0`, `state.traps[]` 미포함).
2. 밟으면 `armed` (`380ms`, `frame: 1`, `trap_arm` 이벤트) -> `extended` (`950ms`, `frame: 3`, `trap_trigger` 이벤트, 피해 1.5하트 = 3 반칸) -> `cooldown` (`1350ms`, `frame: 0`).
3. 벽면 독침 발사기(`map.dartShooters[]`)는 주기적으로 독침(`kind: "dart"`, `#82d964`, 피해 1하트)을 발사합니다.

### 3단계 보스, 레이드 스케일링 및 장판 스키마
보스 처치 3분(`180,000ms`, `bossStatus.nextBossInMs`) 뒤 다음 단계 보스가 등장합니다. 4.5초 이상 비전투 상태가 이어지면 일반 몬스터는 초당 3%, 보스는 초당 5.5% 체력을 회복합니다.

- 레이드 인원 비례 강화 (`bossStatus.raidCount`): 보스 방(`bossArena`) 안이나 보스 반경 `16`타일 이내에 생존 및 접속 중인 플레이어 수(`raidCount`)가 늘어나면 추가 인원 1명당 보스 최대 체력(`maxHp`)이 최대 `3.25배`까지 `+45%`씩 증가합니다(체력 비율 유지). 공격력(`atkHearts`)은 3인 이상 `+1`반칸, 5인 이상 `+2`반칸 늘어나며 패턴 피해 상한은 `8`반칸(4하트)입니다.
- 1단계: 심연의 화신 말라코르 (`hpMult: 1.0`, 근접 `2하트`, `infernal_slam`, `abyssal_cross`, `hellfire_nova`, `oblivion_wave`)
- 2단계: 흑요석의 심판관 아자젤 (`hpMult: 1.75`, 근접 `2.5하트`, `cinder_barrage` 추가)
- 3단계: 종말의 군주 보이드로드 바알 (`hpMult: 2.7`, 근접 `3하트`, 전체 패턴 및 단축된 선딜레이 `420ms`)

| 패턴 이름 | 전송 위치 | JSON 구조 | 렌더링 및 대응 |
| :--- | :---: | :--- | :--- |
| `infernal_slam` / `ogre_slam` | `state.telegraphs[]` | `{ shape: "circle", x, y, radius, progress, damage }` | 반경 `radius` 원형 장판 + 내부 `radius * progress` 표시 |
| `abyssal_cross` | `state.telegraphs[]` | `{ shape: "cross", x, y, halfWidth: 1.45, bounds: { x1, y1, x2, y2 }, progress }` | `bounds` 전체 십자 띠 (`폭 = halfWidth * 2`) |
| `hellfire_nova` | `state.telegraphs[]` | `{ shape: "ring", x, y, innerRadius: 2.1, outerRadius: 6.2, progress }` | 중앙 `innerRadius` 안전지대, `innerRadius..outerRadius` 도넛 장판 |
| `oblivion_wave` | `state.waves[]` | `{ id, label, x, y, radius, maxRadius, bandWidth, color }` | 확장 충격파 고리 (`Shift` 대시 무적으로만 통과 가능) |
| `cinder_barrage` | `state.projectiles[]` | `aiState: "windup"`, `windupKind: "cinder_barrage"` 후 8발(2페이즈 12발) 방사 (`color: "#f0c869"`) | 시전 예고 확인 후 패링 반사 또는 이동 회피 |

---

## `state.events[]` 이벤트 카탈로그 및 오디오 연동

서버는 음원 파일 없이 `state.events[]`와 `state.me.zone`(`성소`, 일반 던전, `왕좌`)만 전송합니다. 클라이언트에서 Web Audio 신디사이저 또는 오디오 파일로 각 이벤트 효과음과 구역별 배경음악을 연결합니다.

| `event.type` | 필드 | 화면 및 오디오 처리 |
| :--- | :--- | :--- |
| `class_selected` | `playerId, classId, className, x, y` | 직업 선택 모달 닫기 |
| `slash` | `playerId, weaponClass, heavy, originX, originY, dirX, dirY, range?, arcDeg?, weaponSprite, weaponRarity` | 근접 참격 아크, 활 발사, 지팡이 시전 모션 및 공격음 |
| `arcane_boom` | `x, y, radius, color` | 마법 지팡이 광역 폭발 링 |
| `damage` | `targetId, targetKind, attackerId?, x, y, amount, hearts?, blocked?, crit, vulnerableHit?, remainingHp, maxHp, source` | 피해 숫자 팝업, 치명타 및 취약 표시, 피격 점멸과 진동, 타격 및 피격음 |
| `guard_raise` / `guard_block` | `playerId, hasShield, x, y` / `playerId, reducedTo, x, y` | 방패 자세음 / 막기 불꽃(`reducedTo === 0` 시 `BLOCKED!`) 및 막기음 |
| `parry_success` | `playerId, sourceKind, reflected?, counterDamage, x, y` | `PARRY!`(원거리 반사 시 `REFLECT!`) 팝업, 충격파 링, 반격음 |
| `dash` / `dash_dodge` | `playerId, fromX, fromY, dirX, dirY, x, y` / `playerId, x, y` | 대시 잔상과 효과음 / 보스 충격파 회피 `DODGE!` 팝업 |
| `skill_learn` / `skill_vfx` | `playerId, slot, skillId, skillName, level` / `skillId, playerId, x, y, radius?, endX?, endY?` | 스킬 습득음 / 6종 스킬 링 및 관통 빔 연출 |
| `stat_up` / `level_up` | `playerId, stat, value` / `playerId, level, spGained, skillGained, radius, knockedCount, x, y` | 능력치 팝업 / `LV.N UP!` 팝업, 반경 `3.8` 충격파 링, 레벨업음 |
| `pickup` / `equip` | `playerId, item, equipped?, slot?, x, y` | 슬롯 갱신 및 등급별 획득음 |
| `heal` / `buff` | `playerId, amount` / `buffType, durationMs` | 하트 회복(`+amount/2`) 팝업 / 버프 효과음 |
| `skill_book` / `revive_up` | `playerId, amount` / `revivesLeft` | 스킬 포인트 / 부활 횟수 증가 알림 |
| `player_death` / `respawn` | `playerId, codename, respawnAt, runReset, runSummary ({ classId, className, reachedLevel, mobKills, bossKills, endedAt } \| null), revivesLeft` | 사망 오버레이(`runReset` 시 탐험 종료 요약) / 부활음 |
| `mob_windup` / `mob_attack` | `mobId, kind ("ranged" \| "cinder_barrage"), color, x, y` / `mobId, ranged?, originX, originY, dirX, dirY, isBoss` | 시전 조준선과 충전음 / 몬스터 공격 모션 |
| `mob_death` | `mobId, name, killerId, isBoss, tier, x, y` | 처치 폭발 링, 파편 파티클, 처치음 |
| `trap_arm` / `trap_trigger` | `x, y` | 함정 작동 예고음 / 가시 돌출 표시 |
| `puzzle_step` / `puzzle_reset` / `puzzle_solved` | `runeId, progress, total` / `solver` | 룬 점등, 초기화, 봉인 해제 연출 및 효과음 |
| `boss_spawn` / `boss_phase2` / `boss_wave` / `boss_killed` | `tier, name` / `killer, bossUuid, nextBossAt, heroicItem` | 보스 등장, 광폭화, 충격파 경보음, 토벌 배너 |
| `telegraph_boom` / `pvp_toggle` | `telegraph` / `enabled` | 장판 폭발 연출과 폭발음 / PvP 상태 배지 갱신 |
