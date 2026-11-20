#!/usr/bin/env node
/**
 * Build Beyond Limits - Client Showcase Gallery Upsert Submission Script
 *
 * Flow:
 * 1. Resolves & verifies the player's game authentication token against Game Server (:8080/api/auth/verify)
 *    so the gallery author codename ALWAYS matches the in-browser player codename.
 * 2. Runs local verification (npm test / node --check) & production build (npm run build) if configured.
 * 3. Captures an 800x500 preview thumbnail automatically via headless Chromium/Chrome/Edge (or uses --thumbnail / SVG fallback).
 * 4. Uploads { token, title, description, thumbnailDataUrl, files } to Gallery Gateway (:8081/api/gallery/submit)
 *    using 1-per-user UPSERT (updating existing entry & incrementing revision if already submitted).
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_GAME_SERVER = process.env.GAME_SERVER_URL || 'http://34.158.215.133:8080';
const DEFAULT_GALLERY_SERVER = process.env.GALLERY_SERVER_URL || 'http://34.158.215.133:8081';

const ALLOWED_EXTS = new Set([
  '.html', '.htm', '.js', '.mjs', '.css', '.json',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico',
  '.woff', '.woff2', '.ttf', '.mp3', '.wav', '.ogg', '.wasm',
]);

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.agents', '.mcp', 'coverage', '.vite', 'test', 'tests', '__tests__',
]);

const IGNORED_FILES = new Set([
  'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
  'tsconfig.json', 'vite.config.js', 'vite.config.ts', 'vite.config.mjs',
  '.bbl-identity.json', 'bbl-identity.json',
]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.wasm': 'application/wasm',
};

const TEXT_SCAN_EXTS = new Set(['.html', '.htm', '.js', '.mjs', '.css', '.svg']);

const ALLOWED_HTML_ASSET_HOSTS = new Set([
  '127.0.0.1',
  'localhost',
  '34.158.215.133:8080',
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com',
  'unpkg.com',
  'esm.sh',
]);

function stripJsCommentsPreserveLines(src) {
  // Replaces // and /* ... */ comments with spaces while keeping exact \n line numbers intact
  return src.replace(/\/\*[\s\S]*?\*\/|(?<!:)\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
}

function getLineCol(text, index) {
  const upTo = text.slice(0, index);
  const lines = upTo.split('\n');
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

function extractLineSnippet(rawText, lineNum) {
  const lines = rawText.split('\n');
  return String(lines[lineNum - 1] || '').trim().slice(0, 160);
}

/**
 * Layer 1 (Client Skill Pre-Submission Security Review & Safe Auto-Sanitizer):
 * 1) Automatically remediates common HTML/SVG injection hazards (inline on*= handlers, javascript: URIs,
 *    <meta refresh>, <base>, <iframe/object/embed>, SVG <script>/<foreignObject>).
 * 2) Audits all HTML/JS/CSS/SVG files for XSS, parent-frame access, cookie theft, eval/Function,
 *    ServiceWorker/SharedWorker, host-gateway probing, and external exfiltration endpoints.
 */
export function scanAndSanitizeBundleFiles(
  files,
  { gameServerUrl = DEFAULT_GAME_SERVER, autoFix = true } = {}
) {
  let gameHost = '34.158.215.133:8080';
  try {
    gameHost = new URL(gameServerUrl).host || gameHost;
  } catch {}
  const allowedApiHosts = new Set(['127.0.0.1', 'localhost', gameHost, '34.158.215.133:8080']);
  const allowedAssetHosts = new Set([...ALLOWED_HTML_ASSET_HOSTS, gameHost]);

  const fixes = [];
  const violations = [];

  for (const file of files) {
    const ext = path.posix.extname(file.path).toLowerCase();
    if (!TEXT_SCAN_EXTS.has(ext)) continue;

    let raw = Buffer.from(file.contentBase64, 'base64').toString('utf-8');
    if (raw.includes('\0')) {
      violations.push({
        ruleId: 'NO_NULL_BYTES',
        severity: 'high',
        file: file.path,
        line: 1,
        column: 1,
        snippet: '(binary null byte in text asset)',
        reason: '텍스트 코드 파일에 널 바이트(\\0)가 포함되어 있습니다.',
        suggestion: '유효한 UTF-8 텍스트 파일만 포함하도록 다시 빌드하세요.',
      });
      continue;
    }

    // Safe Auto-Remediation Pass (HTML & SVG)
    if (autoFix && (ext === '.html' || ext === '.htm')) {
      const rules = [
        [
          /<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi,
          '',
          '자동 리다이렉트(<meta http-equiv="refresh">) 태그 제거',
        ],
        [
          /<base\b[^>]*>/gi,
          '',
          '기본 경로 변조(<base>) 태그 제거',
        ],
        [
          /<(iframe|object|embed|applet)\b[\s\S]*?<\/\1>|<(iframe|object|embed|applet)\b[^>]*\/?>/gi,
          '',
          '중첩 프레임/플러그인(<iframe>/<object>/<embed>) 태그 제거',
        ],
        [
          /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
          '',
          '인라인 이벤트 핸들러(on*=) 속성 제거',
        ],
        [
          /\b(href|src|action|formaction)\s*=\s*(["'])\s*(?:javascript:|vbscript:|data:text\/html)[^"']*\2/gi,
          '$1=$2#$2',
          '위험 스킴(javascript:/vbscript:/data:text/html) URI 무력화',
        ],
      ];
      for (const [regex, replacement, desc] of rules) {
        if (regex.test(raw)) {
          raw = raw.replace(regex, replacement);
          fixes.push({ file: file.path, action: desc });
        }
      }
    }

    if (autoFix && ext === '.svg') {
      const svgRules = [
        [/<script\b[\s\S]*?<\/script>|<script\b[^>]*\/?>/gi, '', 'SVG 내부 <script> 태그 제거'],
        [/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, '', 'SVG 내부 <foreignObject> 태그 제거'],
        [/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '', 'SVG 인라인 이벤트 핸들러(on*=) 제거'],
        [/\b(href|xlink:href)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1=$2#$2', 'SVG javascript: 링크 제거'],
      ];
      for (const [regex, replacement, desc] of svgRules) {
        if (regex.test(raw)) {
          raw = raw.replace(regex, replacement);
          fixes.push({ file: file.path, action: desc });
        }
      }
    }

    // Persist auto-remediated buffer back into file entry
    const updatedBuf = Buffer.from(raw, 'utf-8');
    file.contentBase64 = updatedBuf.toString('base64');
    file.size = updatedBuf.length;

    // Static Security Audit Pass
    if (ext === '.html' || ext === '.htm' || ext === '.svg') {
      const htmlChecks = [
        {
          ruleId: 'NO_INLINE_EVENT_HANDLER',
          regex: /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
          reason: 'HTML/SVG 인라인 이벤트 핸들러(onload, onerror, onclick 등)는 XSS 방지를 위해 금지됩니다.',
          suggestion: 'JS 모듈에서 addEventListener()를 사용하세요.',
        },
        {
          ruleId: 'NO_DANGEROUS_URI_SCHEME',
          regex: /\b(?:href|src|action|xlink:href)\s*=\s*["']?\s*(?:javascript:|vbscript:|data:text\/html)/gi,
          reason: 'javascript:, vbscript:, data:text/html URI 스킴은 금지됩니다.',
          suggestion: '일반 상대 경로(./...) 또는 안전한 이벤트 리스너로 교체하세요.',
        },
        {
          ruleId: 'NO_EMBEDDED_FRAME_OR_OBJECT',
          regex: /<\s*(?:iframe|object|embed|applet|base|foreignObject)\b/gi,
          reason: '<iframe>, <object>, <embed>, <base>, <foreignObject> 태그는 샌드박스 보안 정책상 금지됩니다.',
          suggestion: '해당 태그를 제거하고 <canvas> 및 일반 DOM 요소만 사용하세요.',
        },
      ];
      if (ext === '.svg') {
        htmlChecks.push({
          ruleId: 'NO_SVG_SCRIPT',
          regex: /<\s*script\b/gi,
          reason: 'SVG 이미지 내부의 <script> 태그는 금지됩니다.',
          suggestion: '순수 벡터 그래픽 요소(<path>, <rect> 등)만 포함된 SVG를 사용하세요.',
        });
      }
      for (const chk of htmlChecks) {
        let m;
        while ((m = chk.regex.exec(raw)) !== null) {
          const { line, column } = getLineCol(raw, m.index);
          violations.push({
            ruleId: chk.ruleId,
            severity: 'high',
            file: file.path,
            line,
            column,
            snippet: extractLineSnippet(raw, line),
            reason: chk.reason,
            suggestion: chk.suggestion,
          });
        }
      }

      // Check external asset URLs in HTML (<script src="https://..."> / <link href="https://...">)
      const extTagUrlRe = /<(?:script|link|img|audio|video|source)\b[^>]*?\b(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi;
      let um;
      while ((um = extTagUrlRe.exec(raw)) !== null) {
        try {
          const u = new URL(um[1]);
          if (!allowedAssetHosts.has(u.host) && !allowedAssetHosts.has(u.hostname)) {
            const { line, column } = getLineCol(raw, um.index);
            violations.push({
              ruleId: 'NO_UNTRUSTED_EXTERNAL_ASSET',
              severity: 'high',
              file: file.path,
              line,
              column,
              snippet: extractLineSnippet(raw, line),
              reason: `허용되지 않은 외부 도메인 리소스 참조(${u.host})가 감지되었습니다.`,
              suggestion: '필요한 에셋과 스크립트를 프로젝트 번들 내부에 로컬 파일로 포함하거나 게임 서버(:8080) 타일셋을 사용하세요.',
            });
          }
        } catch {}
      }
    }

    if (ext === '.js' || ext === '.mjs' || ext === '.html' || ext === '.htm') {
      const scanTarget = ext === '.js' || ext === '.mjs' ? stripJsCommentsPreserveLines(raw) : raw;
      const jsChecks = [
        {
          ruleId: 'NO_DYNAMIC_CODE_EXEC',
          regex: /\beval\s*\(|\bnew\s+Function\s*\(|(?:window|globalThis|self)\s*\[\s*['"`](?:eval|Function)['"`]\s*\]|\b(?:setTimeout|setInterval)\s*\(\s*['"`]/g,
          reason: '동적 문자열 코드 실행(eval, new Function, 문자열 setTimeout)은 XSS 방지를 위해 금지됩니다.',
          suggestion: '일반 함수 참조와 JSON.parse()를 사용하도록 수정하세요.',
        },
        {
          ruleId: 'NO_DOCUMENT_WRITE',
          regex: /\bdocument\s*\.\s*write(?:ln)?\s*\(/g,
          reason: 'document.write()는 DOM 주입 취약점을 유발하므로 금지됩니다.',
          suggestion: 'document.createElement() 및 textContent를 사용하세요.',
        },
        {
          ruleId: 'NO_COOKIE_ACCESS',
          regex: /\bdocument\s*\.\s*cookie\b|\bdocument\s*\[\s*['"`]cookie['"`]\s*\]|\bcookieStore\b/g,
          reason: 'document.cookie 및 cookieStore 접근은 세션 탈취 방지를 위해 금지됩니다.',
          suggestion: '플레이어 토큰 저장에는 명세서에 안내된 localStorage("bbl_player_identity_v1")를 사용하세요.',
        },
        {
          ruleId: 'NO_PARENT_FRAME_ACCESS',
          regex: /\b(?:window|globalThis|self)\s*\.\s*(?:parent|top|opener|frameElement)\b|\b(?:window|globalThis|self)\s*\[\s*['"`](?:parent|top|opener|frameElement)['"`]\s*\]|\b(?:parent|top)\s*\.\s*(?:document|location|window|frames|postMessage|fetch|eval)\b|\bframeElement\b/g,
          reason: '상위 호스트 프레임(window.parent, window.top, opener, frameElement) 접근은 호스트 대시보드 보호를 위해 금지됩니다.',
          suggestion: '상위 창 참조를 제거하고 현재 클라이언트 창(window/document) 내부에서만 동작하도록 수정하세요.',
        },
        {
          ruleId: 'NO_SERVICE_OR_SHARED_WORKER',
          regex: /\bnavigator\s*\.\s*serviceWorker\b|\bnew\s+SharedWorker\s*\(/g,
          reason: 'ServiceWorker 및 SharedWorker 등록은 오리진 가로채기 방지를 위해 금지됩니다.',
          suggestion: '일반 메인 스레드 루프(requestAnimationFrame)를 사용하세요.',
        },
        {
          ruleId: 'NO_HOST_GATEWAY_PROBING',
          regex: /['"`]\s*(?:\/api\/gallery|\/auth\/login|\/auth\/logout|\/viewer\/|\/sample\/)/g,
          reason: '호스트 아카이브 관리 경로(/api/gallery, /auth/*, /viewer/*, /sample/*) 호출 시도가 감지되었습니다.',
          suggestion: '게임 클라이언트는 게임 서버(:8080)의 /api/register, /api/map, /ws 엔드포인트와만 통신해야 합니다.',
        },
        {
          ruleId: 'NO_SEND_BEACON',
          regex: /\bnavigator\s*\.\s*sendBeacon\s*\(/g,
          reason: '외부 데이터 유출 방지를 위해 navigator.sendBeacon() 호출이 금지됩니다.',
          suggestion: 'sendBeacon 호출을 제거하세요.',
        },
      ];

      for (const chk of jsChecks) {
        let m;
        while ((m = chk.regex.exec(scanTarget)) !== null) {
          const { line, column } = getLineCol(scanTarget, m.index);
          violations.push({
            ruleId: chk.ruleId,
            severity: 'high',
            file: file.path,
            line,
            column,
            snippet: extractLineSnippet(raw, line),
            reason: chk.reason,
            suggestion: chk.suggestion,
          });
        }
      }

      // Check network calls (fetch / WebSocket / XMLHttpRequest.open) targeting unauthorized external hosts
      const netCallRe = /\b(?:fetch|WebSocket)\s*\(\s*['"`]((?:https?|wss?):\/\/[^'"`]+)['"`]|\.open\s*\(\s*['"`][A-Z]+['"`]\s*,\s*['"`](https?:\/\/[^'"`]+)['"`]/g;
      let nm;
      while ((nm = netCallRe.exec(scanTarget)) !== null) {
        const rawUrl = nm[1] || nm[2];
        try {
          const u = new URL(rawUrl);
          const hostOk =
            allowedApiHosts.has(u.host) ||
            (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
          if (!hostOk) {
            const { line, column } = getLineCol(scanTarget, nm.index);
            violations.push({
              ruleId: 'NO_UNAUTHORIZED_NETWORK_HOST',
              severity: 'high',
              file: file.path,
              line,
              column,
              snippet: extractLineSnippet(raw, line),
              reason: `허용되지 않은 외부 네트워크 엔드포인트(${u.origin}) 연결 코드가 감지되었습니다.`,
              suggestion: `게임 서버(${gameServerUrl}) 엔드포인트만 호출하도록 URL을 수정하세요.`,
            });
          }
        } catch {}
      }
    }
  }

  return { files, fixes, violations };
}

export function validateThumbnailDataUrlSecurity(dataUrl) {
  if (!dataUrl) return;
  if (dataUrl.startsWith('data:image/svg+xml;base64,')) {
    const svg = Buffer.from(dataUrl.slice('data:image/svg+xml;base64,'.length), 'base64').toString('utf-8');
    if (/<\s*script\b|<\s*foreignObject\b|\son[a-z]+\s*=|javascript:/i.test(svg)) {
      throw new Error('보안 정책 위반: 썸네일 SVG에 스크립트 또는 이벤트 핸들러가 포함되어 있습니다.');
    }
  } else if (dataUrl.startsWith('data:image/png;base64,')) {
    const buf = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
    if (buf.length < 8 || buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
      throw new Error('보안 정책 위반: PNG 썸네일 시그니처가 유효하지 않습니다.');
    }
  } else if (dataUrl.startsWith('data:image/jpeg;base64,')) {
    const buf = Buffer.from(dataUrl.slice('data:image/jpeg;base64,'.length), 'base64');
    if (buf.length < 3 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
      throw new Error('보안 정책 위반: JPEG 썸네일 시그니처가 유효하지 않습니다.');
    }
  } else if (dataUrl.startsWith('data:image/webp;base64,')) {
    const buf = Buffer.from(dataUrl.slice('data:image/webp;base64,'.length), 'base64');
    if (buf.length < 12 || buf.subarray(0, 4).toString('ascii') !== 'RIFF' || buf.subarray(8, 12).toString('ascii') !== 'WEBP') {
      throw new Error('보안 정책 위반: WEBP 썸네일 시그니처가 유효하지 않습니다.');
    }
  }
}

export function formatSecurityViolationsReport(violations = []) {
  const lines = [
    `보안 정책 위반이 ${violations.length}건 감지되어 제출이 중단되었습니다. 아래 파일과 라인을 수정한 뒤 다시 제출하세요:`,
  ];
  for (const [idx, v] of violations.entries()) {
    lines.push(
      `  [${idx + 1}] ${v.file}:${v.line || 1}:${v.column || 1} (${v.ruleId})\n` +
      `      - 문제 코드: ${v.snippet || '(생략)'}\n` +
      `      - 사유     : ${v.reason}\n` +
      `      - 해결 방법: ${v.suggestion}`
    );
  }
  return lines.join('\n');
}

export function parseCliArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eqIdx = a.indexOf('=');
    if (eqIdx !== -1) {
      args[a.slice(2, eqIdx)] = a.slice(eqIdx + 1);
    } else {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = 'true';
      } else {
        args[key] = next;
        i += 1;
      }
    }
  }
  return args;
}

function tryReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

export async function resolveGameIdentity({
  token = '',
  clientDir = process.cwd(),
  cwd = process.cwd(),
  gameServerUrl = DEFAULT_GAME_SERVER,
} = {}) {
  const baseUrl = String(gameServerUrl).replace(/\/+$/, '');
  const candidateFiles = [
    path.resolve(clientDir, '.bbl-identity.json'),
    path.resolve(cwd, '.bbl-identity.json'),
    path.resolve(clientDir, 'public/bbl-identity.json'),
    path.resolve(clientDir, 'bbl-identity.json'),
  ];

  let resolvedToken = String(token || process.env.BBL_PLAYER_TOKEN || '').trim();
  let matchedIdentityFile = '';
  if (!resolvedToken) {
    for (const fp of candidateFiles) {
      const saved = tryReadJson(fp);
      if (saved?.token) {
        resolvedToken = String(saved.token).trim();
        matchedIdentityFile = fp;
        break;
      }
    }
  }

  if (resolvedToken) {
    const verifyRes = await fetch(`${baseUrl}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: resolvedToken }),
    });
    if (!verifyRes.ok) {
      throw new Error(
        `제공된 토큰이 게임 서버(${baseUrl})에 등록되어 있지 않습니다. 브라우저 localStorage('bbl_player_identity_v1')의 token을 전달하거나 .bbl-identity.json을 확인하세요.`
      );
    }
    const verified = await verifyRes.json();
    const identity = {
      codename: verified.codename,
      token: resolvedToken,
      verifyCode: verified.verifyCode,
      preferredSkin: verified.preferredSkin || 'knight_m',
    };
    const savePath = matchedIdentityFile || path.resolve(clientDir, '.bbl-identity.json');
    fs.writeFileSync(savePath, JSON.stringify(identity, null, 2), { mode: 0o600 });
    return { identity, newlyRegistered: false, identityFile: savePath };
  }

  // Register a fresh game identity on :8080 and persist .bbl-identity.json so browser (?token=...) & CLI share it
  const regRes = await fetch(`${baseUrl}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!regRes.ok) {
    throw new Error(`게임 서버 플레이어 등록 실패: HTTP ${regRes.status}`);
  }
  const reg = await regRes.json();
  const identity = {
    codename: reg.codename,
    token: reg.token,
    verifyCode: reg.verifyCode,
    preferredSkin: reg.preferredSkin || 'knight_m',
  };
  const savePath = path.resolve(clientDir, '.bbl-identity.json');
  fs.writeFileSync(savePath, JSON.stringify(identity, null, 2), { mode: 0o600 });
  return { identity, newlyRegistered: true, identityFile: savePath };
}

export function runClientChecksAndBuild(clientDir, { skipChecks = false } = {}) {
  const pkgPath = path.join(clientDir, 'package.json');
  const pkg = tryReadJson(pkgPath);

  if (pkg) {
    if (!skipChecks && pkg.scripts?.test && !pkg.scripts.test.includes('no test specified')) {
      execSync('npm test', { cwd: clientDir, stdio: 'inherit' });
    }
    if (pkg.scripts?.build) {
      const isVite = Boolean(
        pkg.devDependencies?.vite ||
        pkg.dependencies?.vite ||
        String(pkg.scripts.build).includes('vite')
      );
      const buildCmd = isVite ? 'npm run build -- --base=./' : 'npm run build';
      execSync(buildCmd, { cwd: clientDir, stdio: 'inherit' });
    }
  } else if (!skipChecks) {
    // Plain vanilla JS syntax check
    for (const entry of fs.readdirSync(clientDir, { withFileTypes: true })) {
      if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) {
        execSync(`node --check "${path.join(clientDir, entry.name)}"`, { stdio: 'inherit' });
      }
    }
  }
}

export function resolveBundleRoot(clientDir) {
  for (const sub of ['dist', 'build']) {
    const candidate = path.join(clientDir, sub);
    if (fs.existsSync(path.join(candidate, 'index.html'))) {
      return candidate;
    }
  }
  if (fs.existsSync(path.join(clientDir, 'index.html'))) {
    return clientDir;
  }
  throw new Error(`클라이언트 디렉터리(${clientDir}) 또는 dist/에서 index.html을 찾을 수 없습니다.`);
}

export function collectBundleFiles(bundleRoot) {
  const root = path.resolve(bundleRoot);
  const files = [];

  const walk = (dir, prefix) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.')) continue;
      const fullPath = path.join(dir, ent.name);
      const relPath = prefix ? `${prefix}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (IGNORED_DIRS.has(ent.name)) continue;
        walk(fullPath, relPath);
      } else if (ent.isFile()) {
        if (relPath.endsWith('.map')) continue;
        if (prefix === '' && IGNORED_FILES.has(ent.name)) continue;
        const ext = path.extname(ent.name).toLowerCase();
        if (!ALLOWED_EXTS.has(ext)) continue;
        const buf = fs.readFileSync(fullPath);
        files.push({
          path: relPath,
          size: buf.length,
          contentBase64: buf.toString('base64'),
        });
      }
    }
  };

  walk(root, '');
  if (!files.some((f) => f.path === 'index.html')) {
    throw new Error(`번들 루트(${root})에 index.html 파일이 없습니다.`);
  }
  return files;
}

function findHeadlessBrowserBinary() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);

  for (const bin of candidates) {
    if (fs.existsSync(bin)) return bin;
  }
  return null;
}

export function readCustomThumbnailDataUrl(thumbPath) {
  const resolved = path.resolve(thumbPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`지정한 썸네일 파일을 찾을 수 없습니다: ${resolved}`);
  }
  const ext = path.extname(resolved).toLowerCase();
  const mimeMap = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
  };
  const mime = mimeMap[ext];
  if (!mime) {
    throw new Error('썸네일 파일 확장자는 .png, .jpg, .jpeg, .webp, .svg 중 하나여야 합니다.');
  }
  const buf = fs.readFileSync(resolved);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

export async function captureHeadlessThumbnail(bundleRoot, { token = '', browserBin = findHeadlessBrowserBinary() } = {}) {
  if (!browserBin) return null;

  const root = path.resolve(bundleRoot);
  const existingSet = new Set();
  const walkSet = (d, p) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const rel = p ? `${p}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walkSet(path.join(d, ent.name), rel);
      else existingSet.add(rel);
    }
  };
  walkSet(root, '');

  const localSrv = http.createServer((req, res) => {
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    const rel = u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname).replace(/^\/+/, '');
    const target = path.resolve(root, rel);
    if (!target.startsWith(root + path.sep) && target !== root) {
      res.writeHead(403).end();
      return;
    }
    const finalFile = fs.existsSync(target) && fs.statSync(target).isFile() ? target : path.join(root, 'index.html');
    if (!fs.existsSync(finalFile)) {
      res.writeHead(404).end();
      return;
    }
    const ext = path.extname(finalFile).toLowerCase();
    let body = fs.readFileSync(finalFile);
    if (ext === '.html') {
      const html = body.toString('utf-8').replace(
        /\b(src|href)=(["'])\/(?!\/)([^"'?#]+)([^"']*)\2/gi,
        (full, attr, q, cand, suf) => (existingSet.has(cand) ? `${attr}=${q}./${cand}${suf}${q}` : full)
      );
      body = Buffer.from(html, 'utf-8');
    }
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(body);
  });

  await new Promise((resolve) => localSrv.listen(0, '127.0.0.1', resolve));
  const port = localSrv.address().port;
  const tmpPng = path.join(os.tmpdir(), `bbl-thumb-${Date.now()}-${Math.random().toString(16).slice(2)}.png`);
  const tmpProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'bbl-chrome-prof-'));
  const previewUrl = token
    ? `http://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`
    : `http://127.0.0.1:${port}/`;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  try {
    if (typeof globalThis.WebSocket === 'function') {
      let child = null;
      let cdpWs = null;
      try {
        child = spawn(
          browserBin,
          [
            '--headless=new',
            '--incognito',
            `--user-data-dir=${tmpProfile}`,
            '--no-first-run',
            '--disable-extensions',
            '--disable-sync',
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--ignore-gpu-blocklist',
            '--hide-scrollbars',
            '--mute-audio',
            '--window-size=800,500',
            '--remote-debugging-port=0',
            'about:blank',
          ],
          { stdio: ['ignore', 'ignore', 'pipe'] }
        );

        const browserWsUrl = await new Promise((resolve, reject) => {
          let stderrBuf = '';
          const t = setTimeout(() => reject(new Error('CDP startup timeout')), 6000);
          child.stderr.on('data', (chunk) => {
            stderrBuf += chunk.toString('utf-8');
            const m = stderrBuf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
            if (m) {
              clearTimeout(t);
              resolve(m[1]);
            }
          });
          child.once('error', (err) => {
            clearTimeout(t);
            reject(err);
          });
          child.once('exit', (code) => {
            clearTimeout(t);
            reject(new Error(`Chrome exited early (${code})`));
          });
        });

        const debugOrigin = new URL(browserWsUrl).origin.replace(/^ws:/, 'http:');
        let pageWsUrl = '';
        for (let attempt = 0; attempt < 15; attempt++) {
          const listRes = await fetch(`${debugOrigin}/json/list`).catch(() => null);
          if (listRes && listRes.ok) {
            const targets = await listRes.json();
            const pageTarget = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
            if (pageTarget) {
              pageWsUrl = pageTarget.webSocketDebuggerUrl;
              break;
            }
          }
          await sleep(100);
        }
        if (!pageWsUrl) throw new Error('No CDP page target');

        cdpWs = new globalThis.WebSocket(pageWsUrl);
        await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('CDP WS open timeout')), 4000);
          cdpWs.addEventListener('open', () => {
            clearTimeout(t);
            resolve();
          }, { once: true });
          cdpWs.addEventListener('error', (e) => {
            clearTimeout(t);
            reject(e);
          }, { once: true });
        });

        let msgId = 0;
        const pending = new Map();
        cdpWs.addEventListener('message', (ev) => {
          try {
            const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf-8'));
            if (msg.id && pending.has(msg.id)) {
              const { resolve, reject } = pending.get(msg.id);
              pending.delete(msg.id);
              if (msg.error) reject(new Error(msg.error.message || 'CDP error'));
              else resolve(msg.result);
            }
          } catch {}
        });
        const sendCdp = (method, params = {}) =>
          new Promise((resolve, reject) => {
            const id = ++msgId;
            const t = setTimeout(() => {
              pending.delete(id);
              reject(new Error(`CDP timeout: ${method}`));
            }, 5000);
            pending.set(id, {
              resolve: (val) => {
                clearTimeout(t);
                resolve(val);
              },
              reject: (err) => {
                clearTimeout(t);
                reject(err);
              },
            });
            cdpWs.send(JSON.stringify({ id, method, params }));
          });

        await sendCdp('Page.enable');
        await sendCdp('Runtime.enable');
        await sendCdp('Emulation.setDeviceMetricsOverride', {
          width: 800,
          height: 500,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await sendCdp('Page.navigate', { url: previewUrl });

        // Wait real wall-clock time so REST /api/auth/verify + live WebSocket map_init/0x81 state + tileset images settle
        await sleep(2500);
        const deadline = Date.now() + 4500;
        while (Date.now() < deadline) {
          const check = await sendCdp('Runtime.evaluate', {
            expression: `(() => {
              if (document.readyState !== 'complete') return false;
              const imgs = Array.from(document.images || []);
              if (imgs.some((img) => img.src && !img.complete)) return false;
              const text = (document.body && document.body.innerText) ? document.body.innerText : '';
              const stillConnecting = /\\b(connecting|authenticating|reconnecting)\\b|연결\\s*중|접속\\s*중|인증\\s*중|동기화\\s*중/i.test(text);
              return !stillConnecting;
            })()`,
            returnByValue: true,
          }).catch(() => null);
          if (check?.result?.value === true) break;
          await sleep(300);
        }
        await sleep(400);

        const shot = await sendCdp('Page.captureScreenshot', { format: 'png' });
        if (shot?.data) {
          return `data:image/png;base64,${shot.data}`;
        }
      } catch {
        // Fall back to CLI screenshot below if CDP fails
      } finally {
        try { cdpWs?.close(); } catch {}
        if (child && child.exitCode === null) {
          await new Promise((resolve) => {
            const t = setTimeout(resolve, 600);
            child.once('exit', () => {
              clearTimeout(t);
              resolve();
            });
            try { child.kill('SIGKILL'); } catch { resolve(); }
          });
        }
      }
    }

    await new Promise((resolve) => {
      const child = spawn(
        browserBin,
        [
          '--headless=new',
          '--incognito',
          `--user-data-dir=${tmpProfile}`,
          '--no-first-run',
          '--disable-extensions',
          '--disable-sync',
          '--use-gl=angle',
          '--use-angle=swiftshader',
          '--enable-unsafe-swiftshader',
          '--hide-scrollbars',
          '--mute-audio',
          '--window-size=800,500',
          `--screenshot=${tmpPng}`,
          previewUrl,
        ],
        { stdio: 'ignore' }
      );
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 9000);
      child.on('close', () => {
        clearTimeout(timer);
        resolve();
      });
      child.on('error', () => {
        clearTimeout(timer);
        resolve();
      });
    });

    if (fs.existsSync(tmpPng) && fs.statSync(tmpPng).size > 0) {
      const buf = fs.readFileSync(tmpPng);
      return `data:image/png;base64,${buf.toString('base64')}`;
    }
    return null;
  } finally {
    try { fs.rmSync(tmpPng, { force: true }); } catch {}
    try { fs.rmSync(tmpProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
    await new Promise((resolve) => localSrv.close(() => resolve()));
  }
}

export async function submitClientToGallery({
  title,
  description = '',
  clientDir = process.cwd(),
  token = '',
  thumbnailPath = '',
  noHeadless = false,
  skipChecks = false,
  autoFix = true,
  skipLocalSecurityScan = false,
  gameServerUrl = DEFAULT_GAME_SERVER,
  galleryServerUrl = DEFAULT_GALLERY_SERVER,
} = {}) {
  const cleanTitle = String(title || '').trim();
  const cleanDesc = String(description || '').trim();
  if (!cleanTitle) {
    throw new Error('작품 제목(--title)은 필수입니다.');
  }
  if (/[<>]/.test(cleanTitle) || /[<>]/.test(cleanDesc)) {
    throw new Error('보안 정책 위반: 제목 또는 설명에 HTML 꺾쇠(<, >) 문자를 포함할 수 없습니다.');
  }

  const resolvedClientDir = path.resolve(clientDir);
  if (!fs.existsSync(resolvedClientDir)) {
    throw new Error(`클라이언트 디렉터리를 찾을 수 없습니다: ${resolvedClientDir}`);
  }

  const { identity, newlyRegistered, identityFile } = await resolveGameIdentity({
    token,
    clientDir: resolvedClientDir,
    cwd: process.cwd(),
    gameServerUrl,
  });

  runClientChecksAndBuild(resolvedClientDir, { skipChecks });
  const bundleRoot = resolveBundleRoot(resolvedClientDir);
  const rawFiles = collectBundleFiles(bundleRoot);

  // Layer 1: Pre-submission XSS & Sandbox-Escape Review + Safe Auto-Sanitization
  let files = rawFiles;
  let securityFixes = [];
  if (!skipLocalSecurityScan) {
    const scanRes = scanAndSanitizeBundleFiles(rawFiles, { gameServerUrl, autoFix });
    files = scanRes.files;
    securityFixes = scanRes.fixes;
    if (scanRes.violations.length > 0) {
      const err = new Error(formatSecurityViolationsReport(scanRes.violations));
      err.code = 'SECURITY_POLICY_VIOLATION';
      err.violations = scanRes.violations;
      throw err;
    }
  }

  let thumbnailDataUrl = null;
  if (thumbnailPath) {
    thumbnailDataUrl = readCustomThumbnailDataUrl(thumbnailPath);
    if (!skipLocalSecurityScan && thumbnailDataUrl.startsWith('data:image/svg+xml;base64,')) {
      const svgClean = scanAndSanitizeBundleFiles(
        [{ path: 'thumbnail.svg', size: 0, contentBase64: thumbnailDataUrl.slice('data:image/svg+xml;base64,'.length) }],
        { gameServerUrl, autoFix }
      );
      if (svgClean.violations.length > 0) {
        throw new Error(formatSecurityViolationsReport(svgClean.violations));
      }
      thumbnailDataUrl = `data:image/svg+xml;base64,${svgClean.files[0].contentBase64}`;
      securityFixes.push(...svgClean.fixes);
    }
    validateThumbnailDataUrlSecurity(thumbnailDataUrl);
  } else if (!noHeadless) {
    thumbnailDataUrl = await captureHeadlessThumbnail(bundleRoot, { token: identity.token });
    validateThumbnailDataUrlSecurity(thumbnailDataUrl);
  }

  const galleryBase = String(galleryServerUrl).replace(/\/+$/, '');
  const resp = await fetch(`${galleryBase}/api/gallery/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: identity.token,
      title: cleanTitle,
      description: cleanDesc,
      thumbnailDataUrl,
      files: files.map(({ path: p, contentBase64 }) => ({ path: p, contentBase64 })),
    }),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.ok) {
    if (Array.isArray(data.violations) && data.violations.length > 0) {
      const err = new Error(formatSecurityViolationsReport(data.violations));
      err.code = data.code || 'SECURITY_POLICY_VIOLATION';
      err.violations = data.violations;
      throw err;
    }
    throw new Error(data.error || `아카이브 제출 실패 (HTTP ${resp.status})`);
  }

  return {
    ok: true,
    updated: data.updated,
    entry: data.entry,
    identity,
    newlyRegistered,
    identityFile,
    securityFixes,
    thumbnailCaptured: Boolean(thumbnailDataUrl),
    galleryServerUrl: galleryBase,
  };
}

function isMainModule(metaUrl) {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(metaUrl));
  } catch {
    return path.resolve(process.argv[1]) === fileURLToPath(metaUrl);
  }
}

if (isMainModule(import.meta.url)) {
  (async () => {
    try {
      const args = parseCliArgs();
      const defaultDir = fs.existsSync(path.resolve('client'))
        ? './client'
        : fs.existsSync(path.resolve('my-client'))
          ? './my-client'
          : '.';
      const result = await submitClientToGallery({
        title: args.title,
        description: args.desc || args.description || '',
        clientDir: args.dir || defaultDir,
        token: args.token || '',
        thumbnailPath: args.thumbnail || '',
        noHeadless: args['no-headless'] === 'true',
        skipChecks: args['skip-checks'] === 'true',
        autoFix: args['no-autofix'] !== 'true',
        gameServerUrl: args['game-server'] || DEFAULT_GAME_SERVER,
        galleryServerUrl: args['gallery-server'] || DEFAULT_GALLERY_SERVER,
      });

      if (result.securityFixes.length > 0) {
        console.log(`\n[SECURITY AUTO-FIX] 위험 요소 ${result.securityFixes.length}건을 자동으로 정화하여 제출했습니다:`);
        for (const fx of result.securityFixes) {
          console.log(`  - ${fx.file}: ${fx.action}`);
        }
      }

      const modeLabel = result.updated ? 'UPSERT 업데이트 완료' : '신규 등록 완료';
      console.log(`\n[OK] 클라이언트 아카이브 ${modeLabel}!`);
      console.log(`  - 제목       : ${result.entry.title}`);
      console.log(`  - 제출자     : ${result.entry.codename} (#${result.entry.verifyCode})`);
      console.log(`  - 인증 토큰  : ${result.identity.token}`);
      console.log(`  - 인증 파일  : ${result.identityFile}`);
      console.log(`  - 리비전     : REV.${result.entry.revision} (파일 ${result.entry.fileCount}개)`);
      console.log(`  - 프리뷰 썸네일: ${result.thumbnailCaptured ? '캡처 포함됨' : '서버 기본 썸네일 사용'}`);
      console.log(`  - 시연 안내  : 아카이브 웹 화면은 발표자(호스트) 전용이며, 발표자 화면에서 바로 플레이됩니다.`);
      console.log(`\n[본인 확인 및 브라우저 접속 안내]`);
      console.log(`  본인 확인 시 제출자 이름(${result.identity.codename}), 확인 코드(#${result.identity.verifyCode}), 인증 토큰을 사용하세요.`);
      console.log(`  브라우저에서 같은 캐릭터로 접속하려면 클라이언트 URL 뒤에 ?token=${result.identity.token} 을 붙여 여세요.`);
      console.log(`  에이전트는 위 제출자 이름, 확인 코드, 인증 토큰을 사용자에게 그대로 전달하세요. (.bbl-identity.json 파일의 Git 커밋만 금지)`);
    } catch (err) {
      console.error(`\n[ERROR] ${err.message}`);
      process.exit(1);
    }
  })();
}
