import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';

const sdkDir = 'C:\\Users\\samki\\AppData\\Local\\Android\\Sdk';
const cmdlineToolsDir = path.join(sdkDir, 'cmdline-tools', 'latest');
const tempZip = path.join(os.tmpdir(), 'cmdline-tools.zip');
const tempExtract = path.join(os.tmpdir(), 'cmdline-extract');

async function main() {
  console.log('[SDK Setup] Target SDK directory:', sdkDir);

  if (!fs.existsSync(path.join(cmdlineToolsDir, 'bin', 'sdkmanager.bat'))) {
    console.log('[SDK Setup] Downloading Android Command-Line Tools (~127 MB)...');
    const url = 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);

    fs.mkdirSync(path.dirname(tempZip), { recursive: true });
    const fileStream = createWriteStream(tempZip);
    await pipeline(res.body, fileStream);
    console.log('[SDK Setup] Download complete.');

    console.log('[SDK Setup] Extracting archive...');
    fs.mkdirSync(tempExtract, { recursive: true });
    const tarResult = spawnSync('tar.exe', ['-xf', tempZip, '-C', tempExtract], { stdio: 'inherit' });
    if (tarResult.status !== 0) throw new Error('tar extraction failed');

    fs.mkdirSync(path.join(sdkDir, 'cmdline-tools'), { recursive: true });
    if (fs.existsSync(cmdlineToolsDir)) {
      fs.rmSync(cmdlineToolsDir, { recursive: true, force: true });
    }

    fs.renameSync(path.join(tempExtract, 'cmdline-tools'), cmdlineToolsDir);
    console.log('[SDK Setup] Command-line tools installed at:', cmdlineToolsDir);

    try {
      fs.unlinkSync(tempZip);
      fs.rmSync(tempExtract, { recursive: true, force: true });
    } catch {}
  } else {
    console.log('[SDK Setup] Command-line tools already installed at:', cmdlineToolsDir);
  }

  // Create local.properties in client/android
  const localPropsPath = path.resolve('client', 'android', 'local.properties');
  fs.writeFileSync(localPropsPath, `sdk.dir=C:/Users/samki/AppData/Local/Android/Sdk\n`, 'utf8');
  console.log('[SDK Setup] Created client/android/local.properties');

  const sdkManager = path.join(cmdlineToolsDir, 'bin', 'sdkmanager.bat');
  console.log('[SDK Setup] Accepting Android SDK licenses...');
  spawnSync(sdkManager, ['--sdk_root=' + sdkDir, '--licenses'], {
    input: 'y\ny\ny\ny\ny\ny\ny\ny\ny\n',
    encoding: 'utf8',
    stdio: ['pipe', 'inherit', 'inherit']
  });

  const packages = ['platforms;android-36', 'build-tools;36.0.0', 'build-tools;35.0.0', 'platform-tools'];
  console.log('[SDK Setup] Installing SDK packages:', packages.join(' '));
  const child = spawn(sdkManager, ['--sdk_root=' + sdkDir, ...packages], {
    shell: true,
    stdio: ['pipe', 'inherit', 'inherit']
  });
  child.stdin.write('y\ny\ny\ny\ny\ny\ny\ny\ny\ny\n');
  child.stdin.end();

  await new Promise((resolve, reject) => {
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`sdkmanager exited with code ${code}`));
    });
  });

  console.log('[SDK Setup] SDK Setup Finished Successfully!');
}

main().catch((err) => {
  console.error('[SDK Setup Failed]', err);
  process.exit(1);
});
