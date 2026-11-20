"""Pinned official-core App build. Not a full-source or device-validated release."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import plistlib
import shutil
import stat
import subprocess
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OFFICIAL_NAME = 'Dopamine_roothide_zqbb_3.0.13-30_20261106_103030.ipa'
OFFICIAL_URL = 'https://github.com/w2599/Dopamine/releases/download/3.0.13/' + OFFICIAL_NAME
OFFICIAL_SHA256 = 'cb90db40fdc085ba1f8e6c56a6bb3220d902497fa66a860b66b2a24fced52394'
PREFIX = 'Payload/Dopamine.app/'
HEADER_PINS = json.loads((ROOT / 'scripts/glass-header-pins.json').read_text(encoding='utf-8'))
# User-requested package-only change. All other protected files remain byte-for-byte official.
PACKAGE_CUSTOMIZATION_INPUTS = ('zebra.deb', 'PkgManagers.plist')

def sha256(file):
    with open(file, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def fetch(url, dest, digest):
    dest = Path(dest)
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(dest.suffix + '.partial')
        urllib.request.urlretrieve(url, tmp)
        if sha256(tmp) != digest:
            raise ValueError('Download digest mismatch: ' + url)
        tmp.replace(dest)
    if sha256(dest) != digest:
        raise ValueError('Input digest mismatch: ' + str(dest))
    return dest

def checked_entries(archive):
    """Reject traversal, duplicates, symlinks, device files and oversized archives."""
    seen = set()
    total = 0
    for info in archive.infolist():
        path = PurePosixPath(info.filename)
        if '\\' in info.filename or path.is_absolute() or '..' in path.parts or ':' in info.filename:
            raise ValueError('Unsafe ZIP path: ' + info.filename)
        if not path.parts or info.filename in seen:
            raise ValueError('Duplicate/empty ZIP path: ' + info.filename)
        seen.add(info.filename)
        mode = info.external_attr >> 16
        if stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR):
            raise ValueError('Unsupported ZIP special file: ' + info.filename)
        total += info.file_size
        if total > 2 * 1024**3:
            raise ValueError('ZIP exceeds extraction limit')
        yield info

def extract(archive_path, dest):
    dest = Path(dest).resolve()
    if dest.exists():
        raise ValueError('Extraction destination must be new: ' + str(dest))
    dest.mkdir(parents=True)
    with zipfile.ZipFile(archive_path) as archive:
        entries = list(checked_entries(archive))
        for info in entries:
            target = dest.joinpath(*PurePosixPath(info.filename).parts)
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(info))
                os.chmod(target, (info.external_attr >> 16 & 0o777) or 0o644)

def protected(relative):
    # Everything defining exploits, bootstrap and package installation is original, even nested code.
    return (relative.startswith('Frameworks/') or relative.endswith(('.dylib', '.deb', '.tar.zst'))
            or relative in ('basebin.tar', 'basebin.tc', 'PkgManagers.plist', 'Dopamine.roothide'))

def sileo_only_configuration(data):
    managers = plistlib.loads(data)
    if not isinstance(managers, list) or not all(isinstance(m, dict) for m in managers):
        raise ValueError('Unexpected package manager configuration')
    zebra = [m for m in managers if m.get('Key') == 'xyz.willy.Zebra' and m.get('Package') == 'zebra.deb']
    remaining = [m for m in managers if m not in zebra]
    if len(zebra) != 1 or len(remaining) != 1 or remaining[0].get('Key') != 'org.coolstar.SileoStore' or remaining[0].get('Package') != 'sileo.deb':
        raise ValueError('Expected exactly original Zebra and Sileo; refuse broader package changes')
    return remaining

def write_json(file, data):
    Path(file).write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')

def prepare(work, ipa=None, downloads=None):
    work = Path(work).resolve()
    work.mkdir(parents=True, exist_ok=True)
    downloads = Path(downloads).resolve() if downloads else work / 'downloads'
    ipa = fetch(OFFICIAL_URL, Path(ipa) if ipa else downloads / OFFICIAL_NAME, OFFICIAL_SHA256)
    extract(ipa, work / 'official')
    include = work / 'include'
    shutil.copytree(ROOT / 'BaseBin/_external/include', include)
    for name in ('libjailbreak', 'libroothider'):
        target = include / name
        target.mkdir()
        for header in (ROOT / 'BaseBin' / name / 'src').glob('*.h'):
            shutil.copy2(header, target)
    for pin in HEADER_PINS:
        name = pin['name']
        target = include / name
        target.mkdir()
        for header in pin['headers']:
            url = 'https://raw.githubusercontent.com/' + pin['repository'] + '/' + pin['commit'] + '/' + header['path']
            basename = PurePosixPath(header['path']).name
            file = fetch(url, downloads / name / basename, header['sha256'])
            shutil.copy2(file, target / basename)
    # iOS 17.4+ SDK supplies XPC. Preserve upstream's existing conditional include rule.
    if os.name != 'nt':
        sdk = subprocess.check_output(['xcrun', '--sdk', 'iphoneos', '--show-sdk-path'], text=True).strip()
        if (Path(sdk) / 'usr/include/xpc.modulemap').exists():
            shutil.rmtree(include / 'xpc')
    source_app = work / 'official' / PREFIX
    preserved = {p.relative_to(source_app).as_posix(): sha256(p) for p in source_app.rglob('*')
                 if p.is_file() and protected(p.relative_to(source_app).as_posix())
                 and p.relative_to(source_app).as_posix() not in PACKAGE_CUSTOMIZATION_INPUTS}
    for name in ('libjailbreak.dylib', 'libchoma.dylib', 'libxpf.dylib', 'libroothider.dylib', 'basebin.tar', 'basebin.tc', 'sileo.deb'):
        if name not in preserved:
            raise ValueError('Missing required original core: ' + name)
    customization_inputs = {name: sha256(source_app / name) for name in PACKAGE_CUSTOMIZATION_INPUTS}
    sileo_only_configuration((source_app / 'PkgManagers.plist').read_bytes())
    write_json(work / 'input-provenance.json', {
        'buildMode': 'App source + pinned official prebuilt core; TEST CANDIDATE',
        'officialURL': OFFICIAL_URL, 'officialSHA256': OFFICIAL_SHA256,
        'sourceCommit': subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip(),
        'headers': HEADER_PINS,
        'headerCaveat': 'ChOma 7dccded declarations only, not the unavailable 4e4f884 source. No ChOma code is rebuilt. Runtime ABI/device testing remains required.',
        'zstdFrontendRevision': 'f8745da6ff1ad1e7bab384bd1f9d742439278e99',
        'preservedCore': preserved,
        'packageCustomizationInputs': customization_inputs,
        'packageCustomization': 'User requested removal of bundled zebra.deb and only its PkgManagers.plist entry; retain Sileo unchanged',
        'fullSourceBuild': False, 'deviceValidation': 'NOT RUN',
        'uikitRuntime': 'NOT VERIFIED: separate simulator job timed out during installation',
    })
    print('Verified original core inputs:', len(preserved))

def package(work, built, out):
    work, built, out = Path(work), Path(built), Path(out)
    provenance = json.loads((work / 'input-provenance.json').read_text(encoding='utf-8'))
    official = work / 'official' / PREFIX
    for file, digest in {**provenance['preservedCore'], **provenance['packageCustomizationInputs']}.items():
        if sha256(official / file) != digest:
            raise ValueError('Original core changed during build: ' + file)
    # Original IPA is the base: new App code and compiled UI assets overlay it, never the protected core.
    final = work / 'candidate' / PREFIX
    shutil.copytree(official, final)
    for p in built.rglob('*'):
        rel = p.relative_to(built).as_posix()
        if p.is_symlink():
            raise ValueError('Unexpected symlink in built App: ' + rel)
        if not p.is_file() or protected(rel) or rel.startswith('_CodeSignature/'):
            continue
        target = final / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(p, target)
    expected_managers = sileo_only_configuration((official / 'PkgManagers.plist').read_bytes())
    (final / 'zebra.deb').unlink()
    (final / 'PkgManagers.plist').write_bytes(plistlib.dumps(expected_managers))
    provenance['packageCustomizationResult'] = {
        'removed': ['zebra.deb'],
        'removedBytes': (official / 'zebra.deb').stat().st_size,
        'PkgManagersSHA256': sha256(final / 'PkgManagers.plist'),
        'remainingPackageManagers': expected_managers,
    }
    seal = final / '_CodeSignature'
    if seal.exists():
        shutil.rmtree(seal)
    info = plistlib.loads((final / 'Info.plist').read_bytes())
    if info['CFBundleIdentifier'] != 'cn.zqbb.dopaRH':
        raise ValueError('Bundle identity changed')
    info['CFBundleShortVersionString'] = '3.0.13-30'
    info['DOBuildTimestamp'] = int(os.environ.get('SOURCE_DATE_EPOCH', '1793932230'))
    info['DOGlassBuildMode'] = 'official-prebuilt-core-test-candidate'
    info['DOGlassSourceCommit'] = provenance['sourceCommit']
    (final / 'Info.plist').write_bytes(plistlib.dumps(info))
    executable = final / 'Dopamine'
    if sha256(executable) == sha256(official / 'Dopamine'):
        raise ValueError('App executable was not rebuilt')
    subprocess.run(['ldid', '-S' + str(ROOT / 'Application/Dopamine/Dopamine.entitlements'), str(executable)], check=True)
    entitlements = subprocess.check_output(['ldid', '-e', str(executable)])
    (work / 'app-entitlements.plist').write_bytes(entitlements)
    (work / 'app-entitlements.json').write_text(json.dumps(plistlib.loads(entitlements)), encoding='utf-8')
    (work / 'app-info.json').write_text(json.dumps(info), encoding='utf-8')
    subprocess.run(['node', str(ROOT / 'scripts/verify-app-entitlements.cjs'), str(work / 'app-entitlements.json'), str(work / 'app-info.json')], check=True)
    (final / 'GlassBuildProvenance.json').write_text(json.dumps(provenance, indent=2) + '\n', encoding='utf-8')
    out.mkdir(parents=True, exist_ok=True)
    stem = 'DopamineGlass-3.0.13-30-' + provenance['sourceCommit'][:7] + '-TEST'
    ipa = out / (stem + '.ipa')
    with zipfile.ZipFile(ipa, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for p in sorted(final.rglob('*')):
            if p.is_file():
                archive.write(p, PREFIX + p.relative_to(final).as_posix())
    with zipfile.ZipFile(ipa) as archive:
        list(checked_entries(archive))
        actual_protected = {n[len(PREFIX):] for n in archive.namelist() if n.startswith(PREFIX) and protected(n[len(PREFIX):])}
        if actual_protected != set(provenance['preservedCore']) | {'PkgManagers.plist'}:
            raise ValueError('Core file set changed')
        for file, digest in provenance['preservedCore'].items():
            if hashlib.sha256(archive.read(PREFIX + file)).hexdigest() != digest:
                raise ValueError('Final IPA core mismatch: ' + file)
        if any(PurePosixPath(n).name == 'zebra.deb' for n in archive.namelist()):
            raise ValueError('Zebra package was reintroduced')
        if plistlib.loads(archive.read(PREFIX + 'PkgManagers.plist')) != expected_managers:
            raise ValueError('Package manager list differs from the authorized Zebra-only removal')
        themes = plistlib.loads(archive.read(PREFIX + 'Themes.plist'))
        if 'custom_glass' not in str(themes):
            raise ValueError('Glass theme missing from package')
    shutil.copy2(ipa, out / (stem + '.tipa'))
    provenance['outputSHA256'] = sha256(ipa)
    provenance['coreIntegrity'] = 'PASS: exact original file set and SHA256 for every preserved file; only declared Zebra package removal and manager entry filter differ'
    write_json(out / 'BUILD-REPORT.json', provenance)
    (out / 'READ-ME-FIRST.txt').write_text(
        'TEST CANDIDATE / 待真机验收\nApp 源码重新编译，底层来自固定 SHA256 的 ZQBB 官方 3.0.13-30 IPA。\n'
        '不是全源码重建，不是已完成真机验收的发行版。UIKit 模拟器运行校验尚未通过。\n'
        '未授权默认原版 UI；有效授权并选中 custom_glass 才启用玻璃。\n'
        '按用户要求移除内置 Zebra 安装包及选择入口，保留 Sileo；不卸载设备已有的 Zebra。\n'
        '请先备份现有安装和越狱环境。不要直接作为已验证稳定版分发。\n', encoding='utf-8')
    print('Packaged and verified:', ipa, provenance['outputSHA256'])

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'package'])
    parser.add_argument('--work', required=True)
    parser.add_argument('--ipa')
    parser.add_argument('--downloads')
    parser.add_argument('--built')
    parser.add_argument('--out')
    args = parser.parse_args()
    if args.action == 'prepare':
        prepare(args.work, args.ipa, args.downloads)
    else:
        if not args.built or not args.out:
            parser.error('package requires --built and --out')
        parser.error('Scheduled power/battery features require rebuilt roothidehooks and basebin. Use the full-source workflow; pinned-core packaging is disabled.')
