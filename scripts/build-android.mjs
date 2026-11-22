/**
 * Build the LineCart Android app.
 *
 *   node scripts/build-android.mjs debug            -> debug APK,   in.linecart.suite.debug, PRODUCTION server, launcher name "LineCart DEBUG"
 *   node scripts/build-android.mjs release [--aab]  -> release APK (or AAB), in.linecart.suite, PRODUCTION server,
 *                                                      signed only with the owner's keystore (otherwise UNSIGNED)
 *   node scripts/build-android.mjs local            -> debug APK,   in.linecart.suite.local, local server http://10.0.2.2:3001
 *                                                      (emulator only, isolated development data)
 *
 * Server addresses come only from config/android-environments.json. The Gradle bundle guard refuses to package a
 * web bundle built for another target, so a stale bundle cannot ship. Every output is inspected after the build
 * (package id, debuggable flag, backend addresses, secrets) and fails the build if anything is wrong.
 * Output: dist-android/<file> plus <file>.sha256 and build-info.json (git-ignored).
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectApk } from './inspect-apk.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientDir = path.join(repoRoot, 'client');
const androidDir = path.join(clientDir, 'android');
const outDir = path.join(repoRoot, 'dist-android');
const envs = JSON.parse(fs.readFileSync(path.join(repoRoot, 'config', 'android-environments.json'), 'utf8'));

const die = (msg) => {
  console.error(`[build-android] ${msg}`);
  process.exit(1);
};
const args = process.argv.slice(2);
if (args.includes('--env')) {
  die('The --env option was replaced. Use: debug | release [--aab] | local (debug and release both use the production server).');
}
const kind = args.find((a) => !a.startsWith('--'));
const wantAab = args.includes('--aab');

const KINDS = {
  debug: { target: 'production', appEnv: 'debug', buildType: 'debug', appId: 'in.linecart.suite.debug', filePrefix: 'linecart' },
  release: { target: 'production', appEnv: 'production', buildType: 'release', appId: 'in.linecart.suite', filePrefix: 'linecart' },
  local: { target: 'local', appEnv: 'local', buildType: 'debug', appId: 'in.linecart.suite.local', filePrefix: 'linecart-local' }
};
const cfg = KINDS[kind];
if (!cfg) die('Usage: node scripts/build-android.mjs debug | release [--aab] | local');
if (wantAab && kind !== 'release') die('--aab is only for release builds.');

const apiUrl = String(envs[cfg.target]?.apiUrl || '').replace(/\/+$/, '');
let parsed;
try { parsed = new URL(apiUrl); } catch { die(`config/android-environments.json: invalid ${cfg.target} apiUrl "${apiUrl}".`); }
if (cfg.target === 'production' && parsed.protocol !== 'https:') die('The production server must use https.');
if (cfg.target === 'local' && !['10.0.2.2', 'localhost', '127.0.0.1'].includes(parsed.hostname)) die('The local build may only point to the emulator host or localhost.');

const pkg = JSON.parse(fs.readFileSync(path.join(clientDir, 'package.json'), 'utf8'));
const [maj, min, pat] = String(pkg.version).split('.').map((n) => parseInt(n, 10) || 0);
const versionName = `${maj}.${min}.${pat}`;
const versionCode = maj * 10000 + min * 100 + pat; // 1.1.0 -> 10100

const isWin = process.platform === 'win32';
const javaHome = process.env.JAVA_HOME || (isWin ? 'C:/Program Files/Eclipse Adoptium/jdk-21.0.13.10002-hotspot' : '');
const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || (isWin ? path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk') : '');

function run(cmd, cmdArgs, opts = {}, { retryOnce = false } = {}) {
  console.log(`\n> ${cmd} ${cmdArgs.join(' ')}`);
  let r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: isWin, ...opts });
  if (r.status !== 0 && retryOnce) {
    // OneDrive briefly locks or converts freshly copied web assets ("not a regular file"); the same build
    // succeeds once it settles.
    console.log('[build-android] Gradle failed inside a OneDrive folder; retrying once in 10 s.');
    spawnSync(isWin ? 'timeout' : 'sleep', isWin ? ['/t', '10', '/nobreak'] : ['10'], { stdio: 'ignore', shell: isWin });
    r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: isWin, ...opts });
  }
  if (r.status !== 0) die(`${cmd} failed (exit ${r.status}).`);
}
const git = (a) => (spawnSync('git', a, { cwd: repoRoot, encoding: 'utf8' }).stdout || '').trim();
const gitCommit = git(['rev-parse', '--short', 'HEAD']);
const gitDirty = git(['status', '--porcelain', '--untracked-files=no']) !== '';

console.log(`[build-android] ${kind}: ${cfg.appId} (${cfg.buildType}${wantAab ? ', AAB' : ''}) version ${versionName} (${versionCode}) server ${apiUrl}`);

// 1. Web bundle with this build's server baked in
run('npx', ['vite', 'build'], {
  cwd: clientDir,
  env: { ...process.env, VITE_API_BASE_URL: apiUrl, VITE_APP_ENV: cfg.appEnv }
});

// 2. Build marker: the Gradle guard checks it before packaging (public facts only, no secrets)
const marker = { target: cfg.target, appEnv: cfg.appEnv, apiUrl, buildType: cfg.buildType, appId: cfg.appId, versionName, versionCode, gitCommit, gitDirty, builtAt: new Date().toISOString() };
fs.writeFileSync(path.join(clientDir, 'dist', 'linecart-build.json'), JSON.stringify(marker, null, 2));

// 3. Copy web assets into the Android project
run('npx', ['cap', 'sync', 'android'], { cwd: clientDir });

// 4. Gradle. Inside OneDrive (or when asked), build output goes to a local folder outside the synced tree.
let gradleBuildRoot = process.env.LINECART_GRADLE_BUILD_ROOT || '';
if (!gradleBuildRoot && isWin && /onedrive/i.test(repoRoot)) {
  gradleBuildRoot = path.join(process.env.LOCALAPPDATA || repoRoot, 'linecart-gradle-build');
}
if (gradleBuildRoot) console.log(`[build-android] Gradle build output: ${gradleBuildRoot}`);
const task = wantAab ? 'bundleRelease' : cfg.buildType === 'release' ? 'assembleRelease' : 'assembleDebug';
run(isWin ? `"${path.join(androidDir, 'gradlew.bat')}"` : './gradlew', [
  task,
  `-PlinecartTarget=${cfg.target}`,
  `-PlinecartVersionCode=${versionCode}`,
  `-PlinecartVersionName=${versionName}`,
  '--no-daemon'
], {
  cwd: androidDir,
  env: { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: androidHome, ...(gradleBuildRoot ? { LINECART_GRADLE_BUILD_ROOT: gradleBuildRoot } : {}) }
}, { retryOnce: /onedrive/i.test(repoRoot) });

// 5. Collect output
const appBuildDir = gradleBuildRoot ? path.join(gradleBuildRoot, 'app') : path.join(androidDir, 'app', 'build');
const outputs = wantAab
  ? [path.join(appBuildDir, 'outputs', 'bundle', 'release', 'app-release.aab')]
  : cfg.buildType === 'release'
    ? [path.join(appBuildDir, 'outputs', 'apk', 'release', 'app-release.apk'), path.join(appBuildDir, 'outputs', 'apk', 'release', 'app-release-unsigned.apk')]
    : [path.join(appBuildDir, 'outputs', 'apk', 'debug', 'app-debug.apk')];
const built = outputs.filter((p) => fs.existsSync(p)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
if (!built) die(`Build finished but no output found in: ${outputs.join(', ')}`);
if (fs.statSync(built).mtimeMs < Date.parse(marker.builtAt) - 1000) die(`Output ${built} is older than this build; refusing to copy a stale file.`);

const ext = wantAab ? 'aab' : 'apk';
const unsignedApk = /unsigned/.test(built);
const fileName = `${cfg.filePrefix}-${versionName}-${cfg.buildType}${unsignedApk ? '-unsigned' : ''}.${ext}`;
fs.mkdirSync(outDir, { recursive: true });
const dest = path.join(outDir, fileName);
fs.copyFileSync(built, dest);

// 6. Inspect the final file
const report = inspectApk(dest, { url: apiUrl, id: cfg.appId, debuggable: cfg.buildType === 'debug' });
for (const c of report.checks) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}  (${c.detail})`);
if (cfg.buildType === 'release' && report.signedWithDebugKey) report.checks.push({ name: 'release not signed with the debug key', ok: false, detail: report.signerDN });
if (!report.checks.every((c) => c.ok)) {
  fs.rmSync(dest, { force: true });
  die('Inspection failed; the output was removed. See the FAIL lines above.');
}

const sha256 = crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
fs.writeFileSync(`${dest}.sha256`, `${sha256}  ${fileName}\n`);
const signedState = cfg.buildType === 'debug'
  ? 'Android debug key (development only, never distribute)'
  : wantAab
    ? 'AAB (signed if keystore.properties was configured; verify with jarsigner)'
    : report.signed ? `release key (${report.signerDN})` : 'UNSIGNED (waiting for the production keystore; cannot be installed)';
const info = {
  file: fileName,
  path: dest,
  build: kind,
  server: apiUrl,
  applicationId: report.packageId || cfg.appId,
  label: report.label,
  versionName: report.versionName || versionName,
  versionCode,
  buildType: cfg.buildType,
  debuggable: report.debuggable,
  signing: signedState,
  permissions: report.permissions,
  backendAddresses: report.backendAddresses,
  secretFindings: report.secretFindings,
  gitCommit: `${gitCommit}${gitDirty ? ' (uncommitted changes)' : ''}`,
  sizeBytes: fs.statSync(dest).size,
  sha256,
  builtAt: marker.builtAt
};
const infoPath = path.join(outDir, 'build-info.json');
const all = fs.existsSync(infoPath) ? JSON.parse(fs.readFileSync(infoPath, 'utf8')) : {};
all[fileName] = info;
fs.writeFileSync(infoPath, JSON.stringify(all, null, 2));
console.log('\n[build-android] DONE');
console.log(JSON.stringify(info, null, 2));
