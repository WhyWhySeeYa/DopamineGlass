import importlib.util
import io
import pathlib
import tempfile
import json
import hashlib
import plistlib
from unittest import mock
import unittest
import zipfile
import subprocess
import sys
spec = importlib.util.spec_from_file_location('glass_build', pathlib.Path(__file__).resolve().parents[1] / 'scripts/build-glass-app.py')
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)

class ArchiveIntegrityTests(unittest.TestCase):
    def test_cli_refuses_installer_without_rebuilt_runtime(self):
        with tempfile.TemporaryDirectory() as directory:
            output = pathlib.Path(directory) / 'output'
            result = subprocess.run([sys.executable, str(pathlib.Path(build.__file__)),
                'package', '--work', directory, '--built', directory, '--out', str(output)],
                capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertIn('require rebuilt roothidehooks and basebin', result.stderr)
            self.assertFalse(output.exists())

    def archive(self, names):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w') as z:
            for name in names:
                if isinstance(name, zipfile.ZipInfo):
                    z.writestr(name, b'content')
                else:
                    z.writestr(name, b'content')
        stream.seek(0)
        return zipfile.ZipFile(stream)

    def test_safe_paths(self):
        with self.archive(['Payload/Dopamine.app/Dopamine']) as z:
            self.assertEqual(len(list(build.checked_entries(z))), 1)

    def test_unsafe_paths(self):
        for name in ('../outside', '/tmp/outside', 'a/../../outside', 'C:/outside', 'a\\..\\outside'):
            with self.subTest(name=name), self.archive([name]) as z:
                with self.assertRaises(ValueError):
                    list(build.checked_entries(z))

    def test_symlink(self):
        info = zipfile.ZipInfo('Payload/link')
        info.external_attr = 0o120777 << 16
        with self.archive([info]) as z:
            with self.assertRaises(ValueError):
                list(build.checked_entries(z))

    def test_duplicate(self):
        with self.archive(['same', 'same']) as z:
            with self.assertRaises(ValueError):
                list(build.checked_entries(z))

    def test_core_boundary(self):
        for name in ('Frameworks/kfd.framework/kfd', 'libchoma.dylib', 'bootstrap_1900.tar.zst', 'basebin.tar', 'basebin.tc', 'PkgManagers.plist', 'Dopamine.roothide', 'libroot.deb'):
            self.assertTrue(build.protected(name), name)
        for name in ('Dopamine', 'Themes.plist', 'Info.plist', 'Assets.car'):
            self.assertFalse(build.protected(name), name)

    def test_wrong_digest_rejected(self):
        with tempfile.TemporaryDirectory() as t:
            p = pathlib.Path(t) / 'bad.ipa'
            p.write_bytes(b'not the official release')
            with self.assertRaisesRegex(ValueError, 'digest mismatch'):
                build.fetch('https://invalid.example', p, build.OFFICIAL_SHA256)

class PackageIntegrityTests(unittest.TestCase):
    def fixture(self, directory):
        work = pathlib.Path(directory) / 'work'
        official = work / 'official' / build.PREFIX
        built = pathlib.Path(directory) / 'built'
        official.mkdir(parents=True)
        built.mkdir()
        data = {'libchoma.dylib': b'official-choma', 'Frameworks/kfd.framework/kfd': b'official-kfd', 'sileo.deb': b'official-sileo'}
        for name, contents in data.items():
            p = official / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(contents)
        managers = [
            {'Display Name': 'Sileo', 'Key': 'org.coolstar.SileoStore', 'Package': 'sileo.deb', 'Icon': 'Sileo'},
            {'Display Name': 'Zebra', 'Key': 'xyz.willy.Zebra', 'Package': 'zebra.deb', 'Icon': 'Zebra'},
        ]
        (official / 'PkgManagers.plist').write_bytes(plistlib.dumps(managers))
        (official / 'zebra.deb').write_bytes(b'official-zebra')
        (built / 'zebra.deb').write_bytes(b'reintroduced-by-build')
        (built / 'PkgManagers.plist').write_bytes(plistlib.dumps(managers))
        (official / 'Dopamine').write_bytes(b'original-executable')
        (built / 'Dopamine').write_bytes(b'rebuilt-executable')
        (built / 'libchoma.dylib').write_bytes(b'MUST-NOT-REPLACE-OFFICIAL')
        (built / 'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier': 'com.opa334.Dopamine-roothide'}))
        (built / 'Themes.plist').write_bytes(plistlib.dumps({'custom_glass': {}}))
        provenance = {'sourceCommit': 'a' * 40, 'preservedCore': {name: hashlib.sha256(contents).hexdigest() for name, contents in data.items()}}
        provenance['packageCustomizationInputs'] = {name: build.sha256(official / name) for name in build.PACKAGE_CUSTOMIZATION_INPUTS}
        build.write_json(work / 'input-provenance.json', provenance)
        return work, official, built

    def test_packaged_core_cannot_be_overwritten_by_build(self):
        with tempfile.TemporaryDirectory() as t:
            work, official, built = self.fixture(t)
            out = pathlib.Path(t) / 'output'
            entitlements = (build.ROOT / 'Application/Dopamine/Dopamine.entitlements').read_bytes()
            actual_run = build.subprocess.run
            def sign_or_verify(args, **kwargs):
                if args[0] == 'ldid':
                    executable = pathlib.Path(args[-1])
                    executable.write_bytes(executable.read_bytes() + b'-SIGNED')
                    return build.subprocess.CompletedProcess(args, 0)
                return actual_run(args, **kwargs)
            with mock.patch.object(build.subprocess, 'run', side_effect=sign_or_verify), mock.patch.object(build.subprocess, 'check_output', return_value=entitlements):
                build.package(work, built, out)
            ipa = next(out.glob('*.ipa'))
            tipa = next(out.glob('*.tipa'))
            self.assertEqual(ipa.read_bytes(), tipa.read_bytes())
            with zipfile.ZipFile(ipa) as z:
                self.assertEqual(z.read(build.PREFIX + 'libchoma.dylib'), b'official-choma')
                self.assertEqual(z.read(build.PREFIX + 'Dopamine'), b'rebuilt-executable-SIGNED')
                self.assertNotIn(build.PREFIX + 'zebra.deb', z.namelist())
                self.assertEqual(z.read(build.PREFIX + 'sileo.deb'), b'official-sileo')
                managers = plistlib.loads(z.read(build.PREFIX + 'PkgManagers.plist'))
                self.assertEqual(managers, plistlib.loads((official / 'PkgManagers.plist').read_bytes())[:1])
            report = json.loads((out / 'BUILD-REPORT.json').read_text())
            self.assertTrue(report['coreIntegrity'].startswith('PASS'))
            self.assertEqual(report['outputSHA256'], build.sha256(ipa))
            self.assertEqual(report['packageCustomizationResult']['removed'], ['zebra.deb'])
            self.assertEqual(report['packageCustomizationResult']['remainingPackageManagers'], managers)

    def test_removal_rejects_unexpected_manager_changes(self):
        with tempfile.TemporaryDirectory() as t:
            work, official, built = self.fixture(t)
            original = plistlib.loads((official / 'PkgManagers.plist').read_bytes())
            for invalid in (original[:1], original[1:], original + [{'Key': 'other', 'Package': 'other.deb'}]):
                with self.subTest(managers=invalid), self.assertRaises(ValueError):
                    build.sileo_only_configuration(plistlib.dumps(invalid))

    def test_customization_source_tamper_is_rejected(self):
        with tempfile.TemporaryDirectory() as t:
            work, official, built = self.fixture(t)
            (official / 'PkgManagers.plist').write_bytes(plistlib.dumps([]))
            with self.assertRaisesRegex(ValueError, 'Original core changed'):
                build.package(work, built, pathlib.Path(t) / 'output')

    def test_modified_official_input_is_rejected(self):
        with tempfile.TemporaryDirectory() as t:
            work, official, built = self.fixture(t)
            (official / 'libchoma.dylib').write_bytes(b'tampered')
            with self.assertRaisesRegex(ValueError, 'Original core changed'):
                build.package(work, built, pathlib.Path(t) / 'output')

if __name__ == '__main__':
    unittest.main()
