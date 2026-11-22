/**
 * Build the LineCart Android app for one environment.
 *
 *   node scripts/build-android.mjs --env staging                 -> debug APK  (app id in.linecart.suite.staging)
 *   node scripts/build-android.mjs --env local                   -> debug APK against http://10.0.2.2:3001 (emulator only)
 *   LINECART_PRODUCTION_API_URL=https://... \
 *   node scripts/build-android.mjs --env production [--aab]      -> release APK (or AAB), signed if signing is configured
 *
 * Output: dist-android/<file> plus <file>.sha256 and build-info.json (git-ignored).
 * Never embeds secrets: the only value baked into the app is the public API base URL.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientDir = path.join(repoRoot, 'client');
const androidDir = path.join(clientDir, 'android');
const outDir = path.join(repoRoot, 'dist-android');

const STAGING_API_URL = 'https://linecart-staging.onrender.com';
const LOCAL_API_URL = 'http://10.0.2.2:3001';

const args = process.argv.slice(2);
const argVal = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const env = argVal('--env');
const wantAab = args.includes('--aab');
const die = (msg) => {
  console.error(`[build-android] ${msg}`);
  process.exit(1);
};

if (!['staging', 'local', 'production'].includes(env)) die('Use --env staging | local | production');

let apiUrl;
let buildType;
if (env === 'staging') {
  apiUrl = STAGING_API_URL;
  buildType = 'debug';
} else if (env === 'local') {
  apiUrl = LOCAL_API_URL;
  buildType = 'debug';
} else {
  apiUrl = String(process.env.LINECART_PRODUCTION_API_URL || '').trim().replace(/\/+$/, '');
  buildType = 'release';
  if (!apiUrl) die('Set LINECART_PRODUCTION_API_URL to the production backend URL (https://...).');
  let u;
  try { u = new URL(apiUrl); } catch { die(`Not a valid URL: ${apiUrl}`); }
  if (u.protocol !== 'https:') die('The production API URL must use https.');
  if (/staging/i.test(apiUrl) || apiUrl === STAGING_API_URL) die('The production APK must not point to a staging server.');
}
if (wantAab && buildType !== 'release') die('--aab is only for --env production.');

const pkg = JSON.parse(fs.readFileSync(path.join(clientDir, 'package.json'), 'utf8'));
const [maj, min, pat] = String(pkg.version).split('.').map((n) => parseInt(n, 10) || 0);
const versionName = `${maj}.${min}.${pat}`;
const versionCode = maj * 10000 + min * 100 + pat; // 1.1.0 -> 10100

const isWin = process.platform === 'win32';
const javaHome = process.env.JAVA_HOME || (isWin ? 'C:/Program Files/Eclipse Adoptium/jdk-21.0.13.10002-hotspot' : '');
const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || (isWin ? path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk') : '');

function run(cmd, cmdArgs, opts = {}) {
  console.log(`\n> ${cmd} ${cmdArgs.join(' ')}`);
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: isWin, ...opts });
  if (r.status !== 0) die(`${cmd} failed (exit ${r.status}).`);
}

console.log(`[build-android] env=${env} type=${buildType}${wantAab ? ' (AAB)' : ''} version=${versionName} (${versionCode}) api=${apiUrl}`);

// 1. Web bundle with the environment's API URL baked in
run('npx', ['vite', 'build'], {
  cwd: clientDir,
  env: { ...process.env, VITE_API_BASE_URL: apiUrl, VITE_APP_ENV: env }
});

// 2. Confirm the bundle points where it should (and a production build never contains the staging URL)
const assetsDir = path.join(clientDir, 'dist', 'assets');
const bundleText = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(assetsDir, f), 'utf8')).join('\n');
if (!bundleText.includes(apiUrl)) die(`Built web bundle does not contain the API URL ${apiUrl}.`);
if (env === 'production' && bundleText.includes(STAGING_API_URL)) die('Production bundle contains the staging URL. Aborting.');

// 3. Copy web assets into the Android project
run('npx', ['cap', 'sync', 'android'], { cwd: clientDir });

// 4. Gradle. Inside OneDrive (or when asked), build output goes to a local folder outside the synced tree.
let gradleBuildRoot = process.env.LINECART_GRADLE_BUILD_ROOT || '';
if (!gradleBuildRoot && isWin && /onedrive/i.test(repoRoot)) {
  gradleBuildRoot = path.join(process.env.LOCALAPPDATA || repoRoot, 'linecart-gradle-build');
}
if (gradleBuildRoot) console.log(`[build-android] Gradle build output: ${gradleBuildRoot}`);
const task = wantAab ? 'bundleRelease' : buildType === 'release' ? 'assembleRelease' : 'assembleDebug';
run(isWin ? `"${path.join(androidDir, 'gradlew.bat')}"` : './gradlew', [task, `-PlinecartVersionCode=${versionCode}`, `-PlinecartVersionName=${versionName}`, '--no-daemon'], {
  cwd: androidDir,
  env: { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: androidHome, ...(gradleBuildRoot ? { LINECART_GRADLE_BUILD_ROOT: gradleBuildRoot } : {}) }
});

// 5. Collect output
const appBuildDir = gradleBuildRoot ? path.join(gradleBuildRoot, 'app') : path.join(androidDir, 'app', 'build');
const outputs = wantAab
  ? [path.join(appBuildDir, 'outputs', 'bundle', 'release', 'app-release.aab')]
  : buildType === 'release'
    ? [path.join(appBuildDir, 'outputs', 'apk', 'release', 'app-release.apk'), path.join(appBuildDir, 'outputs', 'apk', 'release', 'app-release-unsigned.apk')]
    : [path.join(appBuildDir, 'outputs', 'apk', 'debug', 'app-debug.apk')];
const built = outputs.find((p) => fs.existsSync(p));
if (!built) die(`Build finished but no output found in: ${outputs.join(', ')}`);
const unsigned = /unsigned/.test(built);
const ext = wantAab ? 'aab' : 'apk';
const fileName = `linecart-${env}-${versionName}-${buildType}${unsigned ? '-unsigned' : ''}.${ext}`;
fs.mkdirSync(outDir, { recursive: true });
const dest = path.join(outDir, fileName);
fs.copyFileSync(built, dest);
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
fs.writeFileSync(`${dest}.sha256`, `${sha256}  ${fileName}\n`);
const info = {
  file: fileName,
  environment: env,
  apiBaseUrl: apiUrl,
  applicationId: buildType === 'debug' ? 'in.linecart.suite.staging' : 'in.linecart.suite',
  versionName: buildType === 'debug' ? `${versionName}-staging` : versionName,
  versionCode,
  buildType,
  signed: buildType === 'debug' ? 'debug key (testing only)' : unsigned ? 'UNSIGNED (configure release signing)' : 'release key',
  sizeBytes: fs.statSync(dest).size,
  sha256,
  builtAt: new Date().toISOString()
};
const infoPath = path.join(outDir, 'build-info.json');
const all = fs.existsSync(infoPath) ? JSON.parse(fs.readFileSync(infoPath, 'utf8')) : {};
all[fileName] = info;
fs.writeFileSync(infoPath, JSON.stringify(all, null, 2));
console.log('\n[build-android] DONE');
console.log(JSON.stringify(info, null, 2));
