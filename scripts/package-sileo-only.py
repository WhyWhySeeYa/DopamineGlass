"""Apply and verify the user's Zebra-only removal for full-source builds."""
import argparse
import hashlib
import importlib.util
from pathlib import Path
import plistlib
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('glass_build', ROOT / 'scripts/build-glass-app.py')
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


def expected():
    return build.sileo_only_configuration((ROOT / 'Application/Dopamine/UI/PkgManagers/PkgManagers.plist').read_bytes())


def apply(app):
    app = Path(app)
    managers = expected()
    current = plistlib.loads((app / 'PkgManagers.plist').read_bytes())
    if current != managers and build.sileo_only_configuration((app / 'PkgManagers.plist').read_bytes()) != managers:
        raise ValueError('Unexpected built package manager configuration')
    source_sileo = (ROOT / 'Application/Dopamine/Resources/sileo.deb').read_bytes()
    if (app / 'sileo.deb').read_bytes() != source_sileo:
        raise ValueError('Built Sileo differs from source')
    # Only generated build output is changed; original source resources remain.
    (app / 'zebra.deb').unlink(missing_ok=True)
    temporary = app / 'PkgManagers.plist.tmp'
    temporary.write_bytes(plistlib.dumps(managers))
    temporary.replace(app / 'PkgManagers.plist')


def verify(archive):
    with zipfile.ZipFile(archive) as z:
        if any(Path(name).name.lower() == 'zebra.deb' for name in z.namelist()):
            raise ValueError('Zebra was reintroduced into installer')
        if plistlib.loads(z.read('Payload/Dopamine.app/PkgManagers.plist')) != expected():
            raise ValueError('Installer must expose only the unchanged Sileo entry')
        source = (ROOT / 'Application/Dopamine/Resources/sileo.deb').read_bytes()
        if z.read('Payload/Dopamine.app/sileo.deb') != source:
            raise ValueError('Installer Sileo differs from source')
    print(f'{archive}: no Zebra package or entry; Sileo SHA256 {hashlib.sha256(source).hexdigest()}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--app', type=Path)
    mode.add_argument('--verify', type=Path)
    args = parser.parse_args()
    apply(args.app) if args.app else verify(args.verify)
