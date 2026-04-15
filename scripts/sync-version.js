const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const manifestPath = path.join(rootDir, 'manifest.json');
const packageJsonPath = path.join(rootDir, 'package.json');
const packageLockPath = path.join(rootDir, 'package-lock.json');

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
    fs.writeFileSync(filePath, `${JSON.stringify(data, null, 4)}\n`, 'utf8');
}

function assertVersion(version) {
    if (typeof version !== 'string' || version.trim() === '') {
        throw new Error('manifest.json 中缺少有效的 version 字段');
    }
}

function syncPackageJson(version) {
    const packageJson = readJson(packageJsonPath);
    if (packageJson.version !== version) {
        packageJson.version = version;
        writeJson(packageJsonPath, packageJson);
        console.log(`[sync-version] package.json -> ${version}`);
    } else {
        console.log(`[sync-version] package.json already synced (${version})`);
    }
}

function syncPackageLock(version) {
    if (!fs.existsSync(packageLockPath)) {
        console.log('[sync-version] package-lock.json not found, skipped');
        return;
    }

    const packageLock = readJson(packageLockPath);
    let changed = false;

    if (packageLock.version !== version) {
        packageLock.version = version;
        changed = true;
    }

    if (packageLock.packages && packageLock.packages[''] && packageLock.packages[''].version !== version) {
        packageLock.packages[''].version = version;
        changed = true;
    }

    if (changed) {
        writeJson(packageLockPath, packageLock);
        console.log(`[sync-version] package-lock.json -> ${version}`);
    } else {
        console.log(`[sync-version] package-lock.json already synced (${version})`);
    }
}

function main() {
    const manifest = readJson(manifestPath);
    const version = manifest.version;
    assertVersion(version);

    syncPackageJson(version);
    syncPackageLock(version);
}

main();
