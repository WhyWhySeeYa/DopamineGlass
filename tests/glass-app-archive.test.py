import importlib.util
import io
import pathlib
import tempfile
import unittest
import zipfile
spec = importlib.util.spec_from_file_location('glass_build', pathlib.Path(__file__).resolve().parents[1] / 'scripts/build-glass-app.py')
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)

class ArchiveIntegrityTests(unittest.TestCase):
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

if __name__ == '__main__':
    unittest.main()
