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
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

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
  if (!resolvedToken) {
    for (const fp of candidateFiles) {
      const saved = tryReadJson(fp);
      if (saved?.token) {
        resolvedToken = String(saved.token).trim();
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
    const savePath = path.resolve(cwd, '.bbl-identity.json');
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
  const savePath = path.resolve(cwd, '.bbl-identity.json');
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
  const previewUrl = token
    ? `http://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`
    : `http://127.0.0.1:${port}/`;

  try {
    await new Promise((resolve) => {
      const child = spawn(
        browserBin,
        [
          '--headless',
          '--disable-gpu',
          '--no-sandbox',
          '--hide-scrollbars',
          '--mute-audio',
          '--window-size=800,500',
          '--virtual-time-budget=2200',
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
    fs.rmSync(tmpPng, { force: true });
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
  gameServerUrl = DEFAULT_GAME_SERVER,
  galleryServerUrl = DEFAULT_GALLERY_SERVER,
} = {}) {
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) {
    throw new Error('작품 제목(--title)은 필수입니다.');
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
  const files = collectBundleFiles(bundleRoot);

  let thumbnailDataUrl = null;
  if (thumbnailPath) {
    thumbnailDataUrl = readCustomThumbnailDataUrl(thumbnailPath);
  } else if (!noHeadless) {
    thumbnailDataUrl = await captureHeadlessThumbnail(bundleRoot, { token: identity.token });
  }

  const galleryBase = String(galleryServerUrl).replace(/\/+$/, '');
  const resp = await fetch(`${galleryBase}/api/gallery/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: identity.token,
      title: cleanTitle,
      description: String(description || '').trim(),
      thumbnailDataUrl,
      files: files.map(({ path: p, contentBase64 }) => ({ path: p, contentBase64 })),
    }),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.ok) {
    throw new Error(data.error || `갤러리 제출 실패 (HTTP ${resp.status})`);
  }

  return {
    ok: true,
    updated: data.updated,
    entry: data.entry,
    identity,
    newlyRegistered,
    identityFile,
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
      const defaultDir = fs.existsSync(path.resolve('my-client')) ? './my-client' : '.';
      const result = await submitClientToGallery({
        title: args.title,
        description: args.desc || args.description || '',
        clientDir: args.dir || defaultDir,
        token: args.token || '',
        thumbnailPath: args.thumbnail || '',
        noHeadless: args['no-headless'] === 'true',
        skipChecks: args['skip-checks'] === 'true',
        gameServerUrl: args['game-server'] || DEFAULT_GAME_SERVER,
        galleryServerUrl: args['gallery-server'] || DEFAULT_GALLERY_SERVER,
      });

      const modeLabel = result.updated ? 'UPSERT 업데이트 완료' : '신규 등록 완료';
      console.log(`\n[OK] 클라이언트 갤러리 ${modeLabel}!`);
      console.log(`  - 제목       : ${result.entry.title}`);
      console.log(`  - 제출자     : ${result.entry.codename} (#${result.entry.verifyCode})`);
      console.log(`  - 리비전     : REV.${result.entry.revision} (파일 ${result.entry.fileCount}개)`);
      console.log(`  - 프리뷰 썸네일: ${result.thumbnailCaptured ? '캡처 포함됨' : '서버 기본 썸네일 사용'}`);
      console.log(`  - 호스트 갤러리: ${result.galleryServerUrl}${result.entry.viewerPath}`);
      if (result.newlyRegistered) {
        console.log(`\n[인증 동기화 안내]`);
        console.log(`  신규 발급된 게임 인증 정보가 ${result.identityFile} 에 저장되었습니다.`);
        console.log(`  브라우저에서도 동일한 이름(${result.identity.codename})으로 플레이하려면 URL 뒤에 ?token=${result.identity.token} 을 붙여 접속하세요.`);
      }
    } catch (err) {
      console.error(`\n[ERROR] ${err.message}`);
      process.exit(1);
    }
  })();
}
