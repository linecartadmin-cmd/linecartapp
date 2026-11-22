/**
 * Inspect a LineCart APK (or AAB) without installing it.
 *
 *   node scripts/inspect-apk.mjs <file.apk|file.aab> [--expect-url URL] [--expect-id ID] [--expect-debuggable true|false]
 *
 * Reports: package id, version, label, permissions, debuggable flag, signature, the build marker, every backend
 * address in the web bundle, and any credential-looking content anywhere in the file. Exits 1 if an expectation
 * fails or anything secret-looking is found. Read-only: extracts to a temporary folder that is deleted afterwards.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const isWin = process.platform === 'win32';

function sdkTool(name) {
  const home = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || (isWin ? path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk') : '');
  const btDir = path.join(home, 'build-tools');
  if (!fs.existsSync(btDir)) return null;
  const versions = fs.readdirSync(btDir).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const v of versions) {
    for (const f of isWin ? [`${name}.exe`, `${name}.bat`] : [name]) {
      const p = path.join(btDir, v, f);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

const SECRET_PATTERNS = [
  [/postgres(?:ql)?:\/\/[^\s"'`]+/g, 'database URL'],
  [/[a-z0-9]{20}\.supabase\.co|pooler\.supabase\.com/g, 'Supabase host'],
  [/service_role|SUPABASE_SERVICE_ROLE|sb_secret_[A-Za-z0-9]+/g, 'Supabase service key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, 'private key'],
  [/eyJhbGciOi[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, 'JWT-like token']
];
const ADDRESS_PATTERN = /https?:\/\/[a-z0-9.-]+\.onrender\.com|https?:\/\/(?:10\.0\.2\.2|127\.0\.0\.1|localhost):\d+/g;

export function inspectApk(file, expect = {}) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error(`No such file: ${abs}`);
  const isAab = abs.toLowerCase().endsWith('.aab');
  const result = { file: abs, sizeBytes: fs.statSync(abs).size, checks: [] };
  const check = (name, ok, detail) => result.checks.push({ name, ok: Boolean(ok), detail });

  // Manifest facts (APK only; aapt cannot read an AAB)
  const aapt = sdkTool('aapt');
  if (!isAab && aapt) {
    const out = spawnSync(aapt, ['dump', 'badging', abs], { encoding: 'utf8' }).stdout || '';
    const pkg = out.match(/^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/m);
    result.packageId = pkg?.[1];
    result.versionCode = pkg?.[2];
    result.versionName = pkg?.[3];
    result.label = out.match(/^application-label:'([^']*)'/m)?.[1];
    result.debuggable = /^application-debuggable/m.test(out);
    result.permissions = [...out.matchAll(/^uses-permission: name='([^']+)'/gm)].map((m) => m[1]);
    const xml = spawnSync(aapt, ['dump', 'xmltree', abs, 'AndroidManifest.xml'], { encoding: 'utf8' }).stdout || '';
    result.allowBackup = /allowBackup\([^)]*\)=\(type 0x12\)0xffffffff/.test(xml) ? true : /allowBackup/.test(xml) ? false : 'not set';
    result.usesCleartextTraffic = /usesCleartextTraffic\([^)]*\)=\(type 0x12\)0xffffffff/.test(xml);
    result.networkSecurityConfig = /networkSecurityConfig/.test(xml);
  }
  const apksigner = sdkTool('apksigner');
  if (!isAab && apksigner) {
    const r = spawnSync(apksigner, ['verify', '--print-certs', abs], { encoding: 'utf8', shell: isWin });
    result.signed = r.status === 0;
    result.signerDN = (r.stdout || '').match(/certificate DN: (.+)/)?.[1]?.trim() || null;
    result.signedWithDebugKey = /CN=Android Debug/i.test(result.signerDN || '');
  }

  // Extract and scan contents
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-inspect-'));
  try {
    const tar = isWin ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : null;
    const x = tar ? spawnSync(tar, ['-xf', abs, '-C', tmp]) : spawnSync('unzip', ['-q', '-o', abs, '-d', tmp]);
    if (x.status !== 0) throw new Error(`Could not extract ${abs}`);
    const publicDir = path.join(tmp, ...(isAab ? ['base', 'assets', 'public'] : ['assets', 'public']));
    const files = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } };
    walk(tmp);

    const markerPath = path.join(publicDir, 'linecart-build.json');
    result.buildMarker = fs.existsSync(markerPath) ? JSON.parse(fs.readFileSync(markerPath, 'utf8')) : null;

    const addresses = {};
    for (const f of files.filter((p) => p.startsWith(publicDir) && /\.(js|html)$/.test(p))) {
      for (const m of fs.readFileSync(f, 'utf8').matchAll(ADDRESS_PATTERN)) addresses[m[0]] = (addresses[m[0]] || 0) + 1;
    }
    result.backendAddresses = addresses;

    const secrets = [];
    for (const f of files) {
      const text = fs.readFileSync(f).toString('latin1');
      for (const [re, label] of SECRET_PATTERNS) {
        re.lastIndex = 0;
        const m = re.exec(text);
        if (m) secrets.push({ file: path.relative(tmp, f).replace(/\\/g, '/'), kind: label });
      }
    }
    result.secretFindings = secrets;
    result.filesScanned = files.length;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  check('no credentials, database URLs or private keys', result.secretFindings.length === 0, result.secretFindings.map((s) => `${s.kind} in ${s.file}`).join('; ') || `${result.filesScanned} files scanned`);
  check('build marker present', Boolean(result.buildMarker), result.buildMarker ? `${result.buildMarker.appEnv} -> ${result.buildMarker.apiUrl}` : 'missing');
  if (expect.url) {
    const others = Object.keys(result.backendAddresses).filter((a) => a !== expect.url);
    check(`only backend address is ${expect.url}`, result.backendAddresses[expect.url] > 0 && others.length === 0, JSON.stringify(result.backendAddresses));
    check('build marker matches expected URL', result.buildMarker?.apiUrl === expect.url, result.buildMarker?.apiUrl);
  }
  if (expect.id && !isAab) check(`package id is ${expect.id}`, result.packageId === expect.id, result.packageId);
  if (expect.debuggable !== undefined && !isAab) check(`debuggable is ${expect.debuggable}`, result.debuggable === expect.debuggable, String(result.debuggable));
  if (!isAab && result.allowBackup !== undefined) check('Android backup disabled', result.allowBackup === false, String(result.allowBackup));
  if (!isAab && result.usesCleartextTraffic !== undefined) check('cleartext HTTP disabled in manifest', result.usesCleartextTraffic === false, String(result.usesCleartextTraffic));
  result.ok = result.checks.every((c) => c.ok);
  return result;
}

// CLI
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const file = args.find((a) => !a.startsWith('--') && !['--expect-url', '--expect-id', '--expect-debuggable'].includes(args[args.indexOf(a) - 1]));
  if (!file) { console.error('Usage: node scripts/inspect-apk.mjs <file.apk|aab> [--expect-url URL] [--expect-id ID] [--expect-debuggable true|false]'); process.exit(2); }
  const dbg = val('--expect-debuggable');
  const r = inspectApk(file, { url: val('--expect-url'), id: val('--expect-id'), debuggable: dbg === undefined ? undefined : dbg === 'true' });
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
}
