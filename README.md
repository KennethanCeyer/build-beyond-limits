<p align="center">
  <img src="./assets/logo.png" alt="Build Beyond Limits Logo" width="160" />
</p>

<h1 align="center">Build Beyond Limits</h1>

<p align="center">
  Google Antigravity(`agy`)와 Gemini 4 모델로 로그라이크 게임 클라이언트를 구현해 Google Cloud 실시간 멀티플레이어 던전을 공략하는 핸즈온 가이드입니다.
</p>

---

## 실습 개요 및 동작 구조

이 리포지토리에는 명세서(`specs/`), 에이전트 스킬(`.agents/skills/`), 로컬 MCP 서버(`mcp-server/`), 예제 에셋(`assets/tileset/`)만 포함되어 있으며 완성된 클라이언트나 서버 소스코드는 들어 있지 않습니다. 참가자는 원하는 기술 스택으로 클라이언트를 직접 구현해 라이브 서버에 접속합니다.

- **라이브 게임 서버 (Google Cloud, 20Hz)**: 참가자의 이동·충돌, 공격·막기·패링 판정, 몬스터 AI, 동적 보스 레이드 스케일링, 아이템 드롭, 리더보드를 계산해 브로드캐스트합니다.
- **참가자 클라이언트 (로컬 PC)**: `POST /api/register`로 코드네임·토큰을 발급받고 `/ws`로 `map_init`(1회)과 `state`(초당 20회)를 수신해 화면에 그리며, 키·마우스 입력 메시지만 서버로 보냅니다(맵 지형·몬스터 동작 로컬 하드코딩 금지).
- **Antigravity(`agy`) 및 MCP**: `bbl-roguelike` MCP 서버로 라이브 서버 스키마·스프라이트 좌표를 조회하고, `submit-client` 스킬로 완성한 클라이언트 번들과 프리뷰 썸네일을 호스트 쇼케이스 갤러리(`http://34.158.215.133:8081/`)에 1인 1항목 Upsert 방식으로 제출합니다.

```mermaid
flowchart LR
  A["참가자 클라이언트\n(렌더링 · 입력 전송)"] <-->|"WebSocket (20Hz)"| B["Google Cloud 게임 서버\n(전투 판정 · 몬스터 · 순위표)"]
  C["Antigravity CLI (agy)\n(코드 작성 · MCP 조회 · 갤러리 제출)"] -->|"클라이언트 구현"| A
  C -->|"계약 조회 · 토큰 검증"| B
  C -->|"Upsert 번들 · 썸네일 제출"| G["호스트 쇼케이스 갤러리\nhttp://34.158.215.133:8081"]
  B -->|"실시간 관전"| D["중계 화면 및 순위표\nhttp://34.158.215.133:8080"]
```

<details>
<summary><strong>통신 순서 다이어그램 보기</strong></summary>

```mermaid
sequenceDiagram
  autonumber
  participant C as 참가자 클라이언트
  participant S as 라이브 게임 서버 (:8080)
  participant G as 호스트 갤러리 서버 (:8081)
  participant B as 실시간 중계 화면

  C->>S: POST /api/register 요청
  S-->>C: codename, token, verifyCode 응답
  C->>S: WebSocket 연결 (ws://.../ws?token=...)
  S-->>C: map_init 전송 (72x52 맵 배열, 스프라이트 좌표, 게임 규칙)
  S-->>C: welcome 전송 (playerId, codename, skin 확인)

  loop 초당 20회 상태 동기화
    C->>S: 이동 및 행동 메시지 전송 (input, action)
    S-->>C: state 전송 (me, players, monsters, projectiles, events)
    S-->>B: 전체 던전 상태와 3대 부문 리더보드 갱신
  end

  C->>G: POST /api/gallery/submit (token, title, thumbnailDataUrl, files)
  G->>S: POST /api/auth/verify (token 검증 -> 공식 codename 확인)
  G-->>C: 1인 1항목 Upsert 저장 완료 (호스트 갤러리에서 즉시 실행 가능)
```

</details>

---

## 핵심 도구 안내 (Antigravity · Gemini 4 · MCP · 스킬)

각 도구가 익숙하다면 다음 설치 단계로 바로 넘어가도 됩니다.

<details>
<summary><strong>Google Antigravity와 Gemini 4 모델군 비교 (Carbon, Argon, Neon, Hydrogen · Orchestrator)</strong></summary>

### Google Antigravity 개요

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/logos/antigravity-logo-dark.svg" />
    <img src="./assets/logos/antigravity-logo.svg" alt="Google Antigravity Logo" width="340" />
  </picture>
</p>

Google Antigravity는 데스크톱 앱(Antigravity App), standalone IDE, 에디터 확장, 터미널 클라이언트인 **Antigravity CLI (`agy`)**, Python SDK를 포괄하는 에이전트 중심 개발 플랫폼입니다. 이 핸즈온에서는 터미널에서 자연어로 파일 탐색, 코드 작성, 테스트·빌드 실행을 수행하는 `agy`를 사용합니다.

- 공식 문서 홈: [https://antigravity.google/docs](https://antigravity.google/docs)
- 모델 및 요금제 안내: [https://antigravity.google/docs/models](https://antigravity.google/docs/models)
- CLI 레퍼런스: [https://antigravity.google/docs/cli/reference](https://antigravity.google/docs/cli/reference)
- CLI 활용 가이드: [https://antigravity.google/docs/cli/best-practices](https://antigravity.google/docs/cli/best-practices)

`agy`는 Google **Gemini 4 모델군(`Neon`, `Carbon`, `Argon`, `Hydrogen`)**과 플래너·실행기 자동 협업 모드인 **`Orchestrator`**, 그리고 `Gemini 3.8 Flash`, `Claude Opus/Sonnet 5.5`, `GPT-OSS 120B` 등을 지원합니다. `agy models`로 현재 계정에서 사용 가능한 모델 목록을 조회할 수 있습니다.

### Gemini 4 모델군 및 Orchestrator 비교

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/logos/gemini-logo-dark.svg" />
    <img src="./assets/logos/gemini-logo.svg" alt="Google Gemini Logo" width="230" />
  </picture>
</p>

Gemini 4 모델군 4종은 Gemini API 기준 모두 최대 **100만(1M) 토큰 통합 컨텍스트 창**을 지원합니다(단, Antigravity 제품 내 `Neon` 컨텍스트 한도는 최대 `512K` 토큰). 추론 강도(`--effort`)는 **`Neon`·`Hydrogen`이 4단계(`low`, `medium`, `high`, `xhigh`[UI 표기 `Extra`])**, **`Carbon`·`Argon`이 3단계(`low`, `medium`, `high`)**를 지원합니다.

- **Gemini 4 Carbon (`gemini-4-carbon`)**: Argon 기반 최상위 심층 추론 프론티어 모델로, 대규모 아키텍처 설계, 복합 원인 추적, 과학·수학 추론 및 사이버보안 방어에 특화되어 있습니다. *(Antigravity에서는 Google AI Ultra · Enterprise 또는 유료 Gemini API 키에서 사용 가능)*
- **Gemini 4 Argon (`gemini-4-argon`)**: Gemini 4 세대 최초의 기반 프론티어 MoE 모델로, 실무 소프트웨어 엔지니어링과 법률·금융 등 엔터프라이즈 지식 작업에 적합합니다. *(유료 Google AI Pro · Ultra · Enterprise)*
- **Gemini 4 Neon (`gemini-4-neon`)**: Carbon에서 파생해 프론티어급 추론 지능과 빠른 종단간 완료 속도·비용 효율을 결합한 주력 모델입니다. *(유료 Google AI Pro · Ultra · Enterprise의 기본 선택 모델)*
- **Gemini 4 Hydrogen (`gemini-4-hydrogen`)**: Carbon에서 경량·고속화한 일상 코딩·에이전트 실행용 고효율 모델(`Gemini 3.8 Flash` 후속)입니다. *(유료 Google AI Pro · Ultra · Enterprise / Antigravity 무료·Plus 플랜에서는 `Gemini 3.8 Flash` 제공)*
- **Orchestrator (`Orchestrator (Neon / Carbon / Argon)`)**: 단일 대화 안에서 상위 플래너 모델(`Neon`, `Carbon`, 또는 `Argon`)이 설계·검토를 수행하고 `Hydrogen`이 코드 편집·빌드·테스트 실행을 분담하는 자동 협업 모드입니다(`agy models` 식별자: `gemini-pro-orchestrator-neon`, `gemini-pro-orchestrator`, `gemini-pro-orchestrator-argon`).

### 공식 벤치마크 및 API 요금표

아래 수치는 Google DeepMind 공식 모델 카드([Carbon](https://deepmind.google/models/model-cards/gemini-4-carbon/), [Argon](https://deepmind.google/models/model-cards/gemini-4-argon/), [Neon](https://deepmind.google/models/model-cards/gemini-4-neon/), [Hydrogen](https://deepmind.google/models/model-cards/gemini-4-hydrogen/)), 공식 평가 방법론 리포트([Carbon PDF](https://deepmind.google/models/evals-methodology/gemini-4-carbon/), [Argon PDF](https://deepmind.google/models/evals-methodology/gemini-4-argon/), [Neon PDF](https://deepmind.google/models/evals-methodology/gemini-4-neon/), [Hydrogen PDF](https://deepmind.google/models/evals-methodology/gemini-4-hydrogen/)), 공식 발표 블로그([Carbon](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-4-carbon-now-available/), [Argon](https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-gemini-4-argon/), [Neon](https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-gemini-4-neon/), [Hydrogen](https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-gemini-4-hydrogen/)), 및 공식 요금 문서([Google Cloud Model Garden](https://cloud.google.com/model-garden/pricing), [Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing)) 기준입니다(미공개 항목 `-`).

> **벤치마크 비교 시 유의사항**: 모델별 출시 시점(2026년 10~11월)에 따라 평가 하네스(`mini-swe-agent` 단일 에이전트 vs 서브에이전트 팬아웃이 포함된 `Antigravity-CLI`), 벤치마크 버전(`Terminal-Bench 4.0` vs `4.1`, `CWE-bench v1` vs `v2`), 추론 강도(`high` vs `xhigh`), 보안 프로그램 권한(`Fairwind Program`)이 다르므로 조건이 다른 항목은 행을 분리하거나 괄호로 조건을 명시했습니다.

| 항목 | Gemini 4 Carbon | Gemini 4 Argon | Gemini 4 Neon | Gemini 4 Hydrogen |
| :--- | :---: | :---: | :---: | :---: |
| API 모델 식별자 | `gemini-4-carbon` | `gemini-4-argon` | `gemini-4-neon` | `gemini-4-hydrogen` |
| `agy` CLI 모델 식별자 | `gemini-4-carbon-{low,medium,high}` | `gemini-4-argon-{low,medium,high}` | `gemini-4-neon-{low,medium,high,xhigh}` | `gemini-4-hydrogen-{low,medium,high,xhigh}` |
| API 컨텍스트 창 | 100만 토큰 | 100만 토큰 | 100만 토큰 (`agy` 내 최대 512K) | 100만 토큰 |
| 지원 추론 강도 | 3단계 (`low`~`high`) | 3단계 (`low`~`high`) | 4단계 (`low`~`xhigh`) | 4단계 (`low`~`xhigh`) |
| AA Index | 59 (`v5.0`) | 50 (`v5.0`) | 61 (`v5.0.1`, `xhigh`) | 51 (`high`) / 54 (`xhigh`) |
| Vals Index v2.2 | 70.4% | 69.2% | 70.9% | - |
| SWE-sweep (`mini-swe-agent` 하네스) | 9.6% | 4.3% | 12.8% | - |
| SWE-sweep (`Antigravity-CLI` 하네스) | - | - | 39.0% (`v1.5.9`) | 13.5% (`v1.4.8`) |
| Terminal-Bench 4.0 (`AA`) | 65.2% | 57.1% | - | - |
| Terminal-Bench 4.1 (Cheating-adjusted) | - | - | 65.2% (`agy v1.5.9`, `xhigh`) | 57.0% (`mini-swe`, `high`) |
| Agents' Last Exam v1.1 (Score) | 77.4% (`ALE-Claw`) | 69.0% (`ALE-Claw`) | 75.8% (`agy v1.4.8`) | 71.6% (`agy v1.4.8`) |
| Terminal-Bench-Science 0.1 | 64.8% (`AA`) | 52.9% (`AA`) | 70.5% (자체 측정) | 51.4% (자체 측정) |
| RiemannBench | 80.0% | 76.0% | 84.0% | - |
| HLE-Diamond | - | - | 71.3% | 58.8% |
| Chartography | 72.5% | 71.6% | 73.5% | 66.6% |
| GraphWalks (`256k~1M`, BFS F1) | 96.2% | 84.2% | 95.2% | - |
| CWE-bench (`Fairwind` 보안 평가) | 71.0% (`v1`) | 68.0% (`v1`) | 70.7% (`v2`, Carbon 대비 `+3.4%`p) | - |
| SEC-bench Pro (`Fairwind` 보안 평가) | 88.2% | 83.4% | 90.5% | - |
| **API 입력 / 출력 정가** *(Global, 1M 토큰)* | **$4.00 / $20.00** *(2026.12.01~)* | **$4.00 / $20.00** *(2026.12.01~)* | **$3.00 / $15.00** | **$1.50 / $7.50** |
| **출시 프로모션 요금** *(~2026.11.30)* | $2.00 / $10.00 *(50% 크레딧 환급)* | $2.00 / $10.00 *(50% 크레딧 환급)* | 해당 없음 (정가 동일) | 해당 없음 (정가 동일) |
| **캐시 읽기 / 캐시 쓰기** *(Global, 1M 토큰)* | $0.20 *(~11.30: $0.10)* / `N/A` | $0.20 *(~11.30: $0.10)* / `N/A` | $0.15 / $3.75 | $0.075 / $1.875 |

- **요금 참고**: 모든 단가는 Global 리전 100만 토큰 기준이며(Non-global 리전은 +10%), 출력 요금에는 일반 응답뿐 아니라 **추론(Thinking) 토큰**이 포함됩니다. `Carbon`·`Argon`의 프로모션 단가는 일반 공개 모델에만 2026년 11월 30일까지 적용됩니다(`Cyber Permissive` 제외).

**Gemini 4 Neon vs 외부 모델 벤치마크 비교표 (출처: [Google Blog: Introducing Gemini 4 Neon](https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-gemini-4-neon/))**

![Gemini 4 Neon 대 Claude Opus 5.5 · GPT-6.2 Sol 공식 벤치마크 비교표](./assets/gemini-4-benchmarks.png)

</details>

<details>
<summary><strong>MCP 개요 및 `bbl-roguelike` 연동 방법</strong></summary>

### MCP 개요 및 역할

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/logos/mcp-logo-dark.svg" />
    <img src="./assets/logos/mcp-logo.svg" alt="Model Context Protocol Logo" width="96" />
  </picture>
</p>

MCP(Model Context Protocol)는 에이전트가 외부 서버나 로컬 도구와 표준 JSON-RPC 규격으로 통신하기 위한 프로토콜입니다. `bbl-roguelike` MCP 서버를 연결하면 에이전트가 다음 작업을 직접 수행합니다.

- 라이브 서버의 WebSocket 바이너리·JSON 스키마와 전투 규칙 조회
- 512×640 타일셋 내 분류별 스프라이트 `(x, y, w, h)` 좌표 조회
- 클라이언트 송신 페이로드 사전 검증(`validate_client_payload`)
- 서버에 접속 중인 내 캐릭터 좌표·체력·스킬·`ackSeq` 실시간 디버깅

### `agy`에 `bbl-roguelike` 등록하기

이 리포지토리에는 Antigravity 공식 워크스페이스 MCP 설정 파일인 [`.agents/mcp_config.json`](./.agents/mcp_config.json)이 포함되어 있어 `build-beyond-limits` 루트에서 `agy`를 실행하면 워크스페이스 범위로 자동 인식됩니다.

전역 설정(`~/.gemini/config/mcp_config.json`)에 등록해 `agy mcp list`로 상태를 확인하려면 리포지토리 루트에서 아래 명령을 실행합니다.

```bash
agy mcp add --env BBL_SERVER_URL=http://34.158.215.133:8080 bbl-roguelike node ./mcp-server/index.mjs
agy mcp list
```

설정 파일을 직접 편집할 경우 워크스페이스 전용 경로(`.agents/mcp_config.json`) 또는 전역 경로(`~/.gemini/config/mcp_config.json`, `<리포지토리_절대경로>` 치환)에 아래 항목을 추가합니다. 상세 규격은 [Antigravity MCP 문서](https://antigravity.google/docs/mcp)를 참고하세요.

```json
{
  "mcpServers": {
    "bbl-roguelike": {
      "command": "node",
      "args": ["<리포지토리_절대경로>/mcp-server/index.mjs"],
      "env": {
        "BBL_SERVER_URL": "http://34.158.215.133:8080"
      }
    }
  }
}
```

### 제공 도구 목록

| 도구 이름 | 역할 |
| :--- | :--- |
| `get_protocol_contract` | 접속 절차, 바이너리 패킷, 상태·이벤트 스키마, 전투·패링, 스킬, 장비, 보스, 퍼즐, 함정, 타일셋 규칙을 주제별로 조회 |
| `get_asset_manifest` | `heroes`, `weapons`, `armors`, `shields`, `monsters`, `walls`, `hearts`, `traps`, `puzzle`, `potions` 분류별 스프라이트 좌표 조회 |
| `inspect_live_world` | 현재 접속자 수, 활성 보스 단계·재등장 남은 시간, PvP 여부, 봉인의 제단 퍼즐 상태 조회 |
| `inspect_player_state` | 코드네임 또는 토큰으로 서버 측 내 캐릭터 좌표, 체력, 스킬 레벨, `ackSeq` 조회 |
| `validate_client_payload` | 클라이언트가 보낼 WebSocket 페이로드를 서버 규칙으로 사전 검증 |
| `diagnose_server_health` | 라이브 서버 응답 지연 시간(RTT), 맵 크기, 타일셋 응답 상태 진단 |

</details>

<details>
<summary><strong>프로젝트 내장 에이전트 스킬 (`roguelike-protocol`, `submit-client`)</strong></summary>

에이전트 스킬은 `.agents/skills/` 폴더에 정의된 작업 절차와 스크립트입니다. `build-beyond-limits` 루트에서 `agy`를 실행하면 별도 설치 없이 자동 인식됩니다([Antigravity 스킬 가이드](https://antigravity.google/docs/skills)).

- **`roguelike-protocol`** ([`SKILL.md`](./.agents/skills/roguelike-protocol/SKILL.md)): MCP 계약 조회 순서와 핵심 명세 문서 경로 안내
- **`submit-client`** ([`SKILL.md`](./.agents/skills/submit-client/SKILL.md)): 게임 인증 토큰(`token`)으로 브라우저 플레이어 이름(`codename`)을 검증한 뒤, 클라이언트 번들과 프리뷰 썸네일을 호스트 쇼케이스 갤러리(`http://34.158.215.133:8081/`)에 1인 1항목 Upsert 방식으로 제출하는 자동화 스크립트

```bash
cd build-beyond-limits
agy
# 대화창 입력 예: "제목 '심연의 픽셀 로그라이크'로 내 클라이언트를 갤러리에 제출해 줘"
```

</details>

---

## 사전 준비와 인증

실습 전 아래 2가지 도구가 설치되어 있어야 합니다.

- **Node.js 20 이상**: [다운로드](https://nodejs.org/en/download) (`node -v` 확인)
- **Git**: [다운로드](https://git-scm.com/downloads) (`git --version` 확인)

### Antigravity CLI 설치

- **macOS 및 Linux**
  ```bash
  curl -fsSL https://antigravity.google/cli/install.sh | bash
  ```
- **Windows PowerShell**
  ```powershell
  irm https://antigravity.google/cli/install.ps1 | iex
  ```
- **Windows 명령 프롬프트**
  ```cmd
  curl -fsSL https://antigravity.google/cli/install.cmd -o install.cmd && install.cmd && del install.cmd
  ```

설치 후 새 터미널에서 `agy --help`로 동작을 확인합니다.

### 인증 설정

#### 방법 A. Google 계정 OAuth 로그인
1. 터미널에서 `agy`를 실행합니다.
2. 브라우저가 열리면 Google 계정으로 로그인하고 권한을 승인합니다(운영체제 키체인에 토큰 보관).
3. 계정을 변경할 때는 `agy` 대화창에서 `/logout`을 입력합니다.

#### 방법 B. Gemini API 키 인증 (`modelProvider` + `GEMINI_API_KEY`)
원격 서버·CI 등 브라우저 OAuth 인증이 어려운 환경에서 사용합니다([공식 API 키 인증 문서](https://antigravity.google/docs/install/#using-a-gemini-api-key)).

> **중요**: `GEMINI_API_KEY` 환경 변수만 단독으로 등록하면 `agy`에서 아무런 효과가 없습니다. 반드시 `~/.gemini/antigravity-cli/settings.json`에 `"modelProvider": "gemini"`를 함께 설정해야 합니다.

**1단계. API 키 발급 ([Google AI Studio](https://aistudio.google.com/apikey))**
1. 왼쪽 메뉴 **Get API key** -> 우측 상단 **+ Create API key** 클릭
2. Google Cloud 프로젝트 선택 후 **Create API key in existing project** 클릭
3. 생성된 키 옆 **Copy key**로 `AIza...` 문자열 복사

*(아래 이미지는 클릭 순서를 안내하기 위한 개념 도해입니다.)*

![Google AI Studio API 키 발급 순서 도해](./assets/guide-aistudio-apikey.png)

<details>
<summary><strong>Google Cloud Console에서 API 키 발급하기</strong></summary>

1. [Google Cloud Console Credentials](https://console.cloud.google.com/apis/credentials) 접속 (**APIs & Services > Credentials**)
2. **+ CREATE CREDENTIALS > API key** 선택 후 키 복사
3. [Generative Language API](https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com) 사용 설정 여부 확인

*(아래 이미지는 클릭 순서를 안내하기 위한 개념 도해입니다.)*

![Google Cloud Console API 키 발급 순서 도해](./assets/guide-gcp-apikey.png)

</details>

**2단계. `settings.json`에 `"modelProvider": "gemini"` 설정 및 환경 변수 등록 (두 항목 모두 필수)**
- `~/.gemini/antigravity-cli/settings.json`에 `"modelProvider": "gemini"`를 추가합니다(기존 설정이 있다면 해당 키만 병합).
  ```json
  {
    "modelProvider": "gemini"
  }
  ```
- 터미널에 발급받은 API 키를 등록한 뒤 `agy`를 실행합니다.
  - **macOS 및 Linux**: `export GEMINI_API_KEY="복사한_API_키"`
  - **Windows PowerShell**: `$env:GEMINI_API_KEY="복사한_API_키"`
- 다시 Google 계정 OAuth 로그인으로 돌아가려면 `settings.json`에서 `"modelProvider"` 항목을 제거한 뒤 `agy`를 재실행합니다(API 키 모드에서는 `/logout`이 동작하지 않습니다).

---

## 라이브 서버 주소와 프로젝트 시작

| 구분 | 주소 | 설명 |
| :--- | :--- | :--- |
| 실시간 중계 화면 | `http://34.158.215.133:8080` | 던전 관전 및 3대 부문(보스 클리어·최다 레벨·PvP) 실시간 순위표 |
| 실시간 WebSocket | `ws://34.158.215.133:8080/ws` | `map_init`, 20Hz `state`(기본값: `BBL-BIN v1` + Deflate, 디버깅 시 `?encoding=json`), 입력·행동 송수신 |
| REST API 접두 경로 | `http://34.158.215.133:8080/api/*` | [`/api/health`](http://34.158.215.133:8080/api/health), `/api/register`, `/api/auth/verify`, `/api/map`, `/api/tileset`, `/api/leaderboard` *(단독 `/api` 호출은 404)* |
| 호스트 클라이언트 갤러리 | `http://34.158.215.133:8081` | 참가자 제출 클라이언트 Upsert 쇼케이스 뷰어(`POST /api/gallery/submit` 공개, 열람·플레이는 호스트 전용) |
| 예제 타일셋 이미지 | `http://34.158.215.133:8080/assets/tileset/dungeon_autotile_16x16.png` | 512×640 CC0 픽셀 아트 시트 |

### 리포지토리 클론 및 `agy` 실행

```bash
git clone https://github.com/KennethanCeyer/build-beyond-limits.git
cd build-beyond-limits
curl http://34.158.215.133:8080/api/health
agy
```

로그인 후 모델 확인(`agy models`), MCP 등록(`agy mcp add`), 에이전트 실행(`agy`, `agy -p`) 흐름은 아래와 같습니다.

![Antigravity CLI (agy) 버전 확인, 모델 조회, MCP 등록 및 단발 프롬프트 실행 콘솔 가이드](./assets/agy-cli-guide.svg)

| 자주 쓰는 명령 | 설명 |
| :--- | :--- |
| `agy` | 현재 폴더에서 대화형 세션 시작 (종료: `/exit`, 빈 입력창에서 `Ctrl+D`, 또는 대기 중 `Ctrl+C` 2회) |
| `agy --model gemini-4-neon-high` | 모델을 지정해 대화형 세션 시작 (`--effort low\|medium\|high\|xhigh` 조합 가능) |
| `agy -p "요청 문구"` | 단발 프롬프트 실행 후 결과 출력 |
| `agy models` | 사용 가능한 모델 목록 조회 |
| `agy mcp add <이름> <명령>` / `agy mcp list` | 전역 MCP 서버 등록 및 상태 확인 |

클라이언트는 HTML5 Canvas, Vite, React, Phaser, PixiJS, 터미널 UI 등 원하는 스택으로 `client/` 등의 새 폴더에 작성합니다.

### 구현 화면 참고 예시

명세서와 예제 타일셋으로 구현한 참고 화면입니다. UI 배치, 색감, 그래픽 스타일은 별도로 구성해도 됩니다.

**근접 전투 · 방패 막기 · 강공격 차지 · 대시 (수호기사)**

![수호기사 근접 전투 및 방패 막기·강공격 플레이 예시](./assets/preview-client-combat.gif)

**원거리 폭발 마법 · 던전 광원 · 대시 회피 (화염 술사)**

![화염 술사 마법 폭발 및 던전 광원 플레이 예시](./assets/preview-client-magic.gif)

**실시간 중계 화면 (`http://34.158.215.133:8080`)**

![실시간 중계 화면 플레이 예시](./assets/preview-broadcast.gif)

---

## 예제 에셋과 오디오 연동

### 예제 타일셋 구성

기본 제공되는 CC0 픽셀 아트 시트 외에 커스텀 이미지, 벡터 그래픽, ASCII 아트 등을 사용해도 됩니다.

| 파일 경로 | 설명 |
| :--- | :--- |
| [`assets/tileset/dungeon_autotile_16x16.png`](./assets/tileset/dungeon_autotile_16x16.png) | 512×640 통합 스프라이트 시트 (기본 타일 16×16px) |
| [`assets/tileset/tile_list_v1.7`](./assets/tileset/tile_list_v1.7) | 원본 스프라이트 이름과 `x y w h` 픽셀 좌표 목록 |
| [`assets/tileset/LICENSE_CC0.txt`](./assets/tileset/LICENSE_CC0.txt) | CC0 1.0 라이선스 원문 |

스프라이트 좌표는 `GET http://34.158.215.133:8080/api/tileset` 또는 `bbl-roguelike` MCP의 `get_asset_manifest` 도구(`heroes`, `weapons`, `armors`, `shields`, `monsters`, `walls`, `hearts`, `traps`, `puzzle`, `potions`)로 조회합니다.

![통합 픽셀 아트 아틀라스 구조 안내](./assets/guide-tileset-map.png)

### 오디오 연동

서버는 음원 파일 대신 `state.events[]`와 현재 구역(`state.me.zone`)만 전달합니다. Web Audio API 신디사이저 또는 오디오 파일로 전투 효과음(`slash`, `guard_block`, `parry_success`, `dash`, `arcane_boom`, `damage`, `mob_death`), 경고·진행음(`mob_windup`, `trap_arm`, `boss_wave`, `telegraph_boom`, `puzzle_step`, `puzzle_solved`, `level_up`, `pickup`, `heal`), 구역별 BGM(`성소` / 일반 던전 / `왕좌`)을 연결할 수 있습니다.

---

## 명세서 구성과 최소 구현 예시

클라이언트 구현 시 아래 명세서 3편과 `bbl-roguelike` MCP의 `get_protocol_contract` 도구를 참고합니다.

| 문서 경로 | 다루는 범위 |
| :--- | :--- |
| [`specs/PROTOCOL.md`](./specs/PROTOCOL.md) | REST 등록, WebSocket 연결, `BBL-BIN v1` 바이너리 패킷 레이아웃, JSON 스키마 |
| [`specs/TILESET_AND_RENDERING.md`](./specs/TILESET_AND_RENDERING.md) | 72×52 타일 ID, 2단계 2.5D 벽·모서리 연결 규칙, 광원, 렌더링 최적화 |
| [`specs/COMBAT_AND_VFX.md`](./specs/COMBAT_AND_VFX.md) | 반칸 하트 체력·부활, 4종 직업, 방패 막기·패링, 스킬 트리, 3단계 보스 패턴, 이벤트 목록 |

### 최소 데이터 흐름: 접속 -> 맵 수신 -> 상태 수신 -> 공격 전송

1. **`map_init` 수신 (접속 직후 1회)**: `72×52` 2차원 배열 `map.tiles`(`0`=공백, `1`=바닥, `2`=벽, `4`=가시 함정 등)와 스프라이트 좌표 `tileset.sprites`를 받습니다.
   ```json
   {
     "type": "map_init",
     "map": { "width": 72, "height": 52, "tiles": [[0, 2, 1, 4, 2]] },
     "tileset": {
       "sheetUrl": "/assets/tileset/dungeon_autotile_16x16.png?v=2.5",
       "tileSize": 16,
       "sprites": {
         "floor_1": { "x": 16, "y": 64, "w": 16, "h": 16 },
         "wall_mid": { "x": 32, "y": 16, "w": 16, "h": 16 },
         "goblin_idle_anim_f0": { "x": 368, "y": 40, "w": 16, "h": 16 }
       }
     }
   }
   ```
2. **`state` 수신 (50ms 주기, 20Hz)**: 기본 연결(`/ws?token=...`)은 `0x81 S2C_STATE` 바이너리 + `perMessageDeflate` 압축 프레임으로 전송되며, 디코딩 결과(또는 `&encoding=json` 디버깅 모드) 구조는 아래와 같습니다.
   ```json
   {
     "type": "state",
     "tick": 1420,
     "me": { "x": 18.0, "y": 24.0, "dirX": 1, "dirY": 0, "hp": 6, "maxHp": 6, "ackSeq": 12 },
     "monsters": [
       { "id": "mob_3", "name": "고블린 척후", "spriteBase": "goblin", "x": 19.2, "y": 24.0, "hp": 90, "maxHp": 90, "facing": "left", "moving": false, "hit": false }
     ],
     "events": []
   }
   ```
3. **입력·공격 송신 및 결과 이벤트 수신**: 단조 증가하는 `seq`를 담아 바이너리(`0x01 C2S_INPUT`, `0x02 C2S_ATTACK`) 또는 JSON으로 전송하면, 명중 시 다음 틱 `state.events`에 `slash`, `damage`, `mob_death`가 포함됩니다.
   ```json
   { "type": "input", "seq": 13, "move": [1, 0] }
   { "type": "action", "seq": 14, "action": "attack", "aim": [1, 0] }
   ```
   ```json
   {
     "events": [
       { "type": "slash", "originX": 18.0, "originY": 24.0, "dirX": 1, "dirY": 0, "weaponClass": "melee", "heavy": false },
       { "type": "damage", "x": 19.2, "y": 24.0, "amount": 28, "crit": false, "targetKind": "monster" },
       { "type": "mob_death", "mobId": "mob_3", "name": "고블린 척후", "isBoss": false, "tier": 1, "x": 19.2, "y": 24.0 }
     ]
   }
   ```

<details>
<summary><strong>예시 JavaScript 코드 보기: 바이너리 WebSocket 접속, 타일 렌더링, 공격 송신과 처치·피해 표시</strong></summary>

```javascript
const TILE = 16;
const SERVER_HTTP = 'http://34.158.215.133:8080';
const SERVER_WS = 'ws://34.158.215.133:8080/ws';

let mapData = null;
let sprites = null;
let atlasImg = null;
let latestState = null;
let seq = 0;
const floatingTexts = [];
const deathBursts = [];

// 0x02 C2S_ATTACK 바이너리 패킷 인코더 (9바이트, Little-Endian)
function encodeBinaryAttack(nextSeq, dirX, dirY) {
  const buf = new ArrayBuffer(9);
  const view = new DataView(buf);
  view.setUint8(0, 0x02);
  view.setUint32(1, nextSeq, true);
  view.setUint8(5, 0);
  view.setInt8(6, Math.round(dirX * 100));
  view.setInt8(7, Math.round(dirY * 100));
  view.setUint8(8, 1);
  return buf;
}

async function startClient(canvas, decodeS2CPacket) {
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const reg = await fetch(`${SERVER_HTTP}/api/register`, { method: 'POST' }).then((r) => r.json());
  const ws = new WebSocket(`${SERVER_WS}?token=${encodeURIComponent(reg.token)}`);
  ws.binaryType = 'arraybuffer';

  ws.onmessage = (ev) => {
    const msg = ev.data instanceof ArrayBuffer ? decodeS2CPacket(ev.data) : JSON.parse(ev.data);

    if (msg.type === 'map_init') {
      mapData = msg.map;
      sprites = msg.tileset.sprites;
      atlasImg = new Image();
      atlasImg.crossOrigin = 'anonymous';
      atlasImg.src = SERVER_HTTP + msg.tileset.sheetUrl;
    }

    if (msg.type === 'state') {
      latestState = msg;
      for (const e of msg.events || []) {
        if (e.type === 'damage') {
          floatingTexts.push({ x: e.x, y: e.y, text: `-${e.amount}`, bornAt: performance.now() });
        } else if (e.type === 'mob_death') {
          deathBursts.push({ x: e.x, y: e.y, bornAt: performance.now() });
        }
      }
    }
  };

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && ws.readyState === WebSocket.OPEN && latestState?.me) {
      const { dirX, dirY } = latestState.me;
      ws.send(encodeBinaryAttack(++seq, dirX, dirY));
    }
  });

  function drawFrame(now) {
    requestAnimationFrame(drawFrame);
    if (!mapData || !sprites || !atlasImg?.complete || !atlasImg.naturalWidth || !latestState?.me) return;

    const me = latestState.me;
    const camX = Math.round(me.x * TILE - canvas.width / 2);
    const camY = Math.round(me.y * TILE - canvas.height / 2);

    ctx.fillStyle = '#0d0b14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const startX = Math.max(0, Math.floor(camX / TILE));
    const endX = Math.min(mapData.width - 1, Math.ceil((camX + canvas.width) / TILE));
    const startY = Math.max(0, Math.floor(camY / TILE));
    const endY = Math.min(mapData.height - 1, Math.ceil((camY + canvas.height) / TILE));

    for (let ty = startY; ty <= endY; ty++) {
      for (let tx = startX; tx <= endX; tx++) {
        const tileId = mapData.tiles[ty][tx];
        if (tileId === 0) continue;
        const sp = sprites[tileId === 2 ? 'wall_mid' : 'floor_1'];
        if (!sp) continue;
        ctx.drawImage(atlasImg, sp.x, sp.y, sp.w, sp.h, tx * TILE - camX, ty * TILE - camY, TILE, TILE);
      }
    }

    const frame = Math.floor(now / 160) % 4;
    for (const mob of latestState.monsters || []) {
      const key = `${mob.spriteBase}_${mob.moving ? 'run' : 'idle'}_anim_f${frame}`;
      const sp = sprites[key] || sprites[`${mob.spriteBase}_idle_anim_f0`];
      if (!sp) continue;

      const drawX = Math.round(mob.x * TILE - sp.w / 2 - camX);
      const drawY = Math.round(mob.y * TILE - sp.h + 5 - camY);
      ctx.drawImage(atlasImg, sp.x, sp.y, sp.w, sp.h, drawX, drawY, sp.w, sp.h);

      const ratio = Math.max(0, mob.hp / Math.max(1, mob.maxHp));
      ctx.fillStyle = '#1b1420';
      ctx.fillRect(drawX, drawY - 5, sp.w, 3);
      ctx.fillStyle = '#e05252';
      ctx.fillRect(drawX, drawY - 5, Math.round(sp.w * ratio), 3);
    }

    for (let i = deathBursts.length - 1; i >= 0; i--) {
      const db = deathBursts[i];
      const p = (now - db.bornAt) / 360;
      if (p >= 1) { deathBursts.splice(i, 1); continue; }
      ctx.strokeStyle = `rgba(255, 196, 118, ${(1 - p).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(Math.round(db.x * TILE - camX), Math.round(db.y * TILE - camY), 4 + p * 16, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = '#ffd166';
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
      const ft = floatingTexts[i];
      const elapsed = now - ft.bornAt;
      if (elapsed > 700) { floatingTexts.splice(i, 1); continue; }
      ctx.fillText(ft.text, Math.round(ft.x * TILE - camX), Math.round(ft.y * TILE - 12 - elapsed * 0.02 - camY));
    }
  }

  requestAnimationFrame(drawFrame);
}
```

> `decodeS2CPacket(arrayBuffer)`의 전체 바이트 오프셋과 열거형 인덱스표는 [`specs/PROTOCOL.md`](./specs/PROTOCOL.md) 또는 `bbl-roguelike` MCP의 `binary_protocol` 주제에서 확인합니다.

</details>

---

## 조작 방법과 게임 규칙

### 키보드 및 마우스 조작

| 입력 키 | 동작 | 설명 |
| :--- | :--- | :--- |
| 방향키 또는 `W` `A` `S` `D` | 이동 | 8방향 이동 및 벽면 슬라이딩 |
| `Space` 또는 `J` 짧게 누르기 | 기본 공격 | 장착 무기에 따라 근접 참격, 화살 발사, 폭발 마법구 발사 |
| `Space` 또는 `J` 길게 누르기 | 강공격 차지 | `charge_start` 후 기본 약 `358ms`(심연 사냥꾼 `311ms`, 광전사 `325ms`, 화염 술사 `265ms`) 이상 유지 시 강공격 발동(근접·지팡이 `1.9배`, 활 `1.85배` 관통) |
| `C` 또는 `L` 또는 마우스 우클릭 유지 | 방패 막기 · 패링 | 유지 중 이동 속도 52%, 전방 120도 및 광역 피해 경감(방패 장착 시 일반 원거리 투사체 피해 0). 피격 직전 0.32초(수호기사 0.42초) 내 막기 시작 시 패링 발동(근접 기절·취약 1.75배, 전방 120도 원거리 투사체 반사) |
| `Shift` 또는 `K` | 대시 슬라이드 | 200ms 이동 및 280ms 회피 무적 (보스 `oblivion_wave` 통과용) |
| `Q` / `R` | 액티브 스킬 | 슬롯별 선택한 전술·궁극 스킬 발동 |
| `E` / `F` | 아이템 줍기 | 바닥 아이템 획득 (`instant_heart`는 접근 시 자동 흡수) |
| `1` / `2` / `3` | 소비 아이템 사용 | 치유 물약, 비약, 고대 비전서, 불사조의 깃털 사용 |
| `I` / `Tab` | 가방 · 스킬 · 능력치 창 | 10칸 가방, 장비 비교 툴팁, Q/R 스킬 트리, 능력치 배분 |
| `H` / `M` / `ESC` | 도움말 / 음소거 / 창 닫기 | 조작 안내 토글, 오디오 음소거 토글, 열린 패널·모달 닫기 |

### 직업 및 성장 규칙

시작 시 4종 직업 중 하나를 선택하며, 주 무기와 같은 분류의 무기를 장착하면 숙련 보너스가 추가됩니다.

| 직업 | 주 무기 숙련 | 기본 하트 | 고유 특성 |
| :--- | :--- | :---: | :--- |
| 수호기사 (`knight`) | 근접 무기 (`melee`) | 4칸 | 막기 피해 감소 +15%, 패링 판정 `0.42초`, 반격 1.45배 |
| 심연 사냥꾼 (`ranger`) | 원거리 활 (`bow`) | 3칸 | 치명타 확률 +12%(`baseCrit: 0.18`), 대시 대기시간 -30%, 대시 후 `2.2초` 내 첫 공격 확정 치명타, 차지 속도 +15% |
| 화염 술사 (`mage`) | 마법 지팡이 (`staff`) | 2.5칸 | 스킬 피해·폭발 범위·차지 속도 +35% |
| 광전사 (`berserker`) | 근접 무기 (`melee`) | 3.5칸 | 잃은 하트당 공격력 +28%·이동 속도 +7%, 처치 시 25% 확률 하트 +0.5칸 흡수, 대시 대기시간 -8%, 스킬 피해·차지 속도 +10%, 범위 +5% |

- **4등급 주사위 장비**: 일반(`common`), 희귀(`rare`), 유니크(`unique`), 전설(`legendary`) 4등급이 드롭되며(일반 몬스터도 전설 드롭 확률 보유), 드롭 시 수치 범위 내에서 주사위로 옵션이 결정됩니다. 모든 장비에 고유 효과(`effectKey`)가, 유니크·전설 장비에 방어도(`defBonus`)가 붙습니다.
- **체력·부활 및 초기화**: 레벨업 시 하트 +0.5칸만 회복되며, `VIT` 3당 최대 하트가 +0.5칸(최대 +2칸) 증가합니다. 기본 부활 횟수는 `1회`이며(`불사조의 깃털`로 추가 가능), `revivesLeft === 0`에서 사망하면 레벨·장비·스킬이 초기화됩니다(리더보드 최고 기록은 유지).
- **스킬 트리**: 3레벨마다 또는 `고대 비전서` 사용 시 스킬 포인트 +1을 얻어 `Q`/`R` 슬롯별 3종 후보 중 1종을 선택하고 최대 레벨 10까지 강화합니다.

### 던전 구역과 리더보드 3대 부문

1. **성소**: 남서쪽 시작·부활 안전지대(치유의 샘 체력 회복, PvP 비활성).
2. **사냥 구역**: 폐허, 지하수로, 회랑, 서리 묘실, 무기고, 납골당으로 구성(미궁·제단 수호 몬스터를 포함해 던전 전역에 17종 총 24마리 일반·정예 몬스터 배치, 비전투 시 체력 회복).
3. **심연의 미궁**: 동쪽 미로 구역(반응형 압력 가시 함정 및 벽면 독침 발사기 배치).
4. **봉인의 제단**: 단서 문구를 해석해 4개 색상 룬 발판을 순서대로 밟아 보스 문을 개방.
5. **왕좌**: 북동쪽 보스 방. 처치 3분마다 1단계 **말라코르** -> 2단계 **아자젤** -> 3단계 **보이드로드 바알** 순으로 등장하며, 보스 방 또는 반경 `16`타일 내 동시 접속 인원이 늘어날수록 보스 최대 체력(최대 `3.25배`)과 공격력이 동적으로 강화됩니다.

| 리더보드 부문 | 순위 기준 |
| :--- | :--- |
| 최다 레벨 | 도달한 최고 레벨 기준 |
| 보스 클리어 수 | 1~3단계 보스 누적 처치 횟수 기준 |
| PvP 1위 | PvP 활성화 후 안전지대 밖 누적 처치 수 기준 |

---

## 단계별 구현 가이드와 클라이언트 갤러리 제출

각 부문 1위는 호스트 중계 대시보드 리더보드에서 실시간으로 집계되며, 직접 만든 클라이언트는 `submit-client` 스킬로 호스트 쇼케이스 갤러리(`http://34.158.215.133:8081/`)에 업로드해 시연할 수 있습니다.

| 단계 | 구현 목표 | `agy` 프롬프트 예시 |
| :--- | :--- | :--- |
| **Step 1** | 서버 접속, `?token=` 인증 연동, 직업 선택, 맵·이동·공격 | `specs/와 bbl-roguelike MCP를 참고해 client/ 폴더에 라이브 서버 접속(?token= 쿼리 연동 포함), 직업 선택, map_init 기반 72x52 맵 렌더링, 기본 이동·공격이 동작하는 클라이언트를 만들어 줘.` |
| **Step 2** | 커스텀 비주얼·오디오 및 바이너리·패링·강공격 구현 | `클라이언트에 커스텀 색감·광원·효과음과 BBL-BIN v1 바이너리 디코더를 적용하고, 방패 막기·전방 120도 패링·강공격 차지를 구현해 줘.` |
| **Step 3** | 미니맵, 가방·비교 툴팁, Q/R 스킬 트리 구현 | `우측 상단 미니맵, 10칸 가방과 장비 비교 툴팁, Q/R 스킬 트리와 능력치 배분 창을 구현해 줘.` |
| **Step 4** | 보스 장판·충격파·룬 퍼즐 UI 완성 및 갤러리 제출 | `보스 장판과 대시 전용 충격파, 4룬 퍼즐 단서를 화면에 표시하고, submit-client 스킬로 제목을 붙여 호스트 갤러리에 제출해 줘.` |

### 호스트 갤러리 제출 규칙 (1인 1항목 Upsert + 게임 인증 연동)

- **중복 업로드 방지 (Upsert)**: 동일 플레이어가 다시 제출하면 새 카드가 중복 생성되지 않고 기존 제출본의 번들·제목·썸네일이 갱신되며 `REV` 번호가 올라갑니다.
- **브라우저 이름과 제출자 이름 일치**: 제출 스크립트는 게임 서버 `POST /api/auth/verify`로 `token`을 검증해 공식 `codename`을 받아 등록합니다. 브라우저 `localStorage`(`bbl_player_identity_v1`)에 저장된 `token`을 `--token`으로 전달하거나, 스크립트가 발급한 `.bbl-identity.json`의 토큰을 `?token=<TOKEN>`으로 브라우저에 전달하면 두 환경의 이름이 항상 일치합니다.

```bash
node .agents/skills/submit-client/scripts/submit-client.mjs \
  --title "심연의 픽셀 로그라이크" \
  --dir ./client \
  --desc "방향성 투사체 패링과 4룬 퍼즐 미니맵 구현"
```

---

## 완료 확인 체크리스트

- [ ] `agy --help` 출력 확인 및 Google 계정 OAuth 로그인(또는 `settings.json`의 `"modelProvider": "gemini"` + `GEMINI_API_KEY`) 인증 완료하기
- [ ] 워크스페이스 `.agents/mcp_config.json` 인식 확인 또는 `agy mcp add`로 `bbl-roguelike` 전역 등록하기
- [ ] 맵 지형이나 몬스터 동작을 하드코딩하지 않고 `map_init`과 `20Hz state`만으로 동작하는 클라이언트 구현하기
- [ ] 이동, 공격, 강공격 차지, 방패 막기·패링, 대시, 스킬, 아이템 줍기, 물약 사용, `ESC` 창 닫기 동작 확인하기
- [ ] 커스텀 화면 테마와 오디오·효과음 적용하기
- [ ] 브라우저 플레이어 `token`과 연동해 `submit-client` 스킬로 호스트 갤러리에 클라이언트 제출하기

---

## 자주 발생하는 오류 해결

| 증상 | 원인 | 해결 방법 |
| :--- | :--- | :--- |
| `agy: command not found` | 셸 `PATH` 미갱신 | 터미널 재실행 또는 `source ~/.zshrc` (`~/.bashrc`) 실행 |
| 로그인 브라우저가 열리지 않음 | 원격 환경 또는 기본 브라우저 미지정 | 터미널에 출력된 인증 URL을 직접 브라우저에 붙여넣거나 `settings.json`(`"modelProvider": "gemini"`) + `GEMINI_API_KEY` 사용 |
| `GEMINI_API_KEY`를 설정했는데 로그인 화면이 뜸 | `settings.json`에 `modelProvider` 누락 | `~/.gemini/antigravity-cli/settings.json`에 `"modelProvider": "gemini"` 추가 후 재실행 |
| WebSocket 연결 반복 끊김 | 사내 방화벽·프록시의 8080 포트 차단 | `curl http://34.158.215.133:8080/api/health` 확인 후 차단 시 핫스팟 전환 |
| MCP 서버·제출 스크립트 실행 실패 | Node.js 20 미만 버전 | `node -v` 확인 후 Node.js 20 LTS 이상 설치 |
| 타일셋 이미지가 그려지지 않음 | CORS 속성 누락 또는 로드 전 `drawImage` 호출 | `img.crossOrigin = 'anonymous'` 지정 및 `img.complete && img.naturalWidth > 0` 확인 |
| 새 코드네임 재발급 필요 | 이전 토큰이 로컬에 저장됨 | 브라우저 `localStorage` 토큰과 리포지토리 루트 `.bbl-identity.json` 삭제 |

---

## 리포지토리 구조

```text
build-beyond-limits/
├── README.md                     # 실습 안내, 모델·요금 비교, 인증 설정, 구현 예시
├── .mcp.json                     # 외부 호환용 MCP 서버 설정 예시
├── mcp-server/
│   └── index.mjs                 # 라이브 서버 계약·에셋·상태 조회용 로컬 MCP 서버
├── .agents/
│   ├── mcp_config.json           # Antigravity 워크스페이스 MCP 서버 설정
│   └── skills/
│       ├── roguelike-protocol/   # 프로토콜·렌더링·전투 조회 스킬
│       └── submit-client/        # 호스트 쇼케이스 갤러리 Upsert 제출 스킬
├── specs/
│   ├── PROTOCOL.md               # 접속 절차, 바이너리 패킷 및 메시지 명세
│   ├── TILESET_AND_RENDERING.md  # 타일 ID, 2.5D 벽·모서리 규칙, 광원 렌더링 명세
│   └── COMBAT_AND_VFX.md         # 체력·부활, 전투·스킬, 보스 패턴, 이벤트 명세
└── assets/
    └── tileset/                  # CC0 16x16 게임 타일셋 이미지 및 좌표 목록
```

---

## 에셋 출처 및 라이선스

- **캐릭터 · 몬스터 · 던전 스프라이트 타일셋**: [0x72 16x16 DungeonTileset II (v1.7)](https://0x72.itch.io/dungeontileset-ii) by Robert Norenberg (0x72)
  - 파일: [`assets/tileset/dungeon_autotile_16x16.png`](./assets/tileset/dungeon_autotile_16x16.png), [`assets/tileset/tile_list_v1.7`](./assets/tileset/tile_list_v1.7)
  - 라이선스: **CC0 1.0 Universal** ([`assets/tileset/LICENSE_CC0.txt`](./assets/tileset/LICENSE_CC0.txt), [라이선스 전문](https://creativecommons.org/publicdomain/zero/1.0/))
