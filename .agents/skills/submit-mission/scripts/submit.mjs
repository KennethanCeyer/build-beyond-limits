#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const IDENTITY_FILE = path.join(REPO_ROOT, '.bbl-identity.json');
const DEFAULT_SERVER = process.env.BBL_SERVER_URL || 'http://34.158.215.133:8080';

function parseArgs(argv) {
  const args = { mission: 'mission-1', style: 'custom-canvas', note: '', dir: '' };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if ((k === '--mission' || k === '-m') && v) { args.mission = v; i++; }
    else if ((k === '--style' || k === '-s') && v) { args.style = v; i++; }
    else if ((k === '--note' || k === '-n') && v) { args.note = v; i++; }
    else if ((k === '--dir' || k === '-d') && v) { args.dir = v; i++; }
    else if (k === '--server' && v) { args.server = v; i++; }
  }
  return args;
}

function detectClientDir(explicitDir) {
  if (explicitDir) {
    const abs = path.resolve(REPO_ROOT, explicitDir);
    if (!fs.existsSync(abs)) {
      throw new Error(`지정한 클라이언트 폴더를 찾을 수 없습니다: ${explicitDir}`);
    }
    return abs;
  }
  const candidates = ['client', 'my-client', 'app', 'web', 'src'];
  for (const name of candidates) {
    const full = path.join(REPO_ROOT, name);
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) return full;
  }
  if (fs.existsSync(path.join(REPO_ROOT, 'index.html'))) return REPO_ROOT;
  return null;
}

function collectJsFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectJsFiles(full, out);
    else if (/\.(mjs|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function runStep(label, cmd, cwd) {
  console.log(`\n[RUN] ${label}...`);
  execSync(cmd, { cwd, stdio: 'inherit' });
  console.log(`[OK]  ${label}`);
}

async function ensureIdentity(serverBase) {
  if (fs.existsSync(IDENTITY_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(IDENTITY_FILE, 'utf-8'));
      if (saved.token && saved.codename) return saved;
    } catch {
      // recreate below
    }
  }
  const res = await fetch(`${serverBase}/api/register`, { method: 'POST' });
  if (!res.ok) {
    throw new Error(`고유 코드네임 등록 실패 (HTTP ${res.status})`);
  }
  const identity = await res.json();
  fs.writeFileSync(IDENTITY_FILE, JSON.stringify(identity, null, 2), 'utf-8');
  return identity;
}

async function main() {
  const args = parseArgs(process.argv);
  const serverBase = (args.server || DEFAULT_SERVER).replace(/\/+$/, '');
  const checksPassed = [];

  const clientDir = detectClientDir(args.dir);
  if (clientDir) {
    console.log(`[INFO] Client directory: ${path.relative(REPO_ROOT, clientDir) || '.'}`);
    const pkgPath = path.join(clientDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if ((pkg.dependencies || pkg.devDependencies) && !fs.existsSync(path.join(clientDir, 'node_modules'))) {
        runStep('클라이언트 의존성 설치', 'npm install', clientDir);
      }
      if (pkg.scripts?.test) {
        runStep('클라이언트 테스트 실행', 'npm test', clientDir);
        checksPassed.push('client-test');
      }
      if (pkg.scripts?.build) {
        runStep('클라이언트 빌드 검증', 'npm run build', clientDir);
        checksPassed.push('client-build');
      }
    } else {
      const jsFiles = collectJsFiles(clientDir);
      if (jsFiles.length > 0) {
        console.log(`\n[RUN] JavaScript 문법 검사 (${jsFiles.length}개 파일)...`);
        for (const f of jsFiles) {
          execSync(`node --check "${f}"`, { stdio: 'inherit' });
        }
        console.log('[OK]  JavaScript 문법 검사');
        checksPassed.push('client-syntax');
      }
    }
  }

  // Verify live server health
  console.log(`\n[CHECK] Live server health (${serverBase}/api/health)...`);
  const healthRes = await fetch(`${serverBase}/api/health`);
  if (!healthRes.ok) {
    throw new Error(`서버 응답 오류: HTTP ${healthRes.status}`);
  }
  const health = await healthRes.json();
  console.log(`[OK]    Server healthy (online players: ${health.onlinePlayers})`);
  checksPassed.push('server-health');

  // Ensure unique player identity
  const identity = await ensureIdentity(serverBase);

  // Submit mission result
  console.log(`\n[SUBMIT] Uploading verification for [${args.mission}]...`);
  const subRes = await fetch(`${serverBase}/api/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      missionId: args.mission,
      token: identity.token,
      codename: identity.codename,
      clientStyle: args.style,
      checksPassed,
      note: args.note,
    }),
  });
  const data = await subRes.json();
  if (!subRes.ok) {
    throw new Error(`제출 실패: ${data.error || subRes.status}`);
  }

  console.log('\n----------------------------------------');
  console.log(`MISSION  : ${data.submission.missionId.toUpperCase()}`);
  console.log(`RANK     : #${data.rank}${data.duplicate ? ' (existing record kept)' : ''}`);
  console.log(`CODENAME : ${data.submission.codename}`);
  console.log(`VERIFY   : #${data.submission.verifyCode}`);
  console.log(`BOARD    : ${serverBase}`);
  console.log('----------------------------------------\n');
}

main().catch((err) => {
  console.error(`\n[ERROR] Submission failed: ${err.message}`);
  process.exit(1);
});
