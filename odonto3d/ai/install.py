"""Install a pinned, published model locally. Never uploads examinations."""
import hashlib
import json
import os
import platform
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import urllib.request
import venv
import zipfile

MODEL = 'Dataset112_DentalSegmentator_v100'
URL = f'https://zenodo.org/api/records/10829675/files/{MODEL}.zip/content'
MD5 = 'b71cd5230168d28a4f71b078265b76be'
SIZE = 229747861


def prepare_model(directory):
    directory.mkdir(parents=True, exist_ok=True)
    archive = directory / (MODEL + '.zip')
    def valid():
        if not archive.is_file() or archive.stat().st_size != SIZE: return False
        with archive.open('rb') as stream: return hashlib.file_digest(stream, 'md5').hexdigest() == MD5
    if not valid():
        partial = directory / (MODEL + '.download')
        print('Baixando o modelo público DentalSegmentator (230 MB)…', flush=True)
        with urllib.request.urlopen(URL, timeout=120) as response, partial.open('wb') as target:
            total = 0
            while chunk := response.read(1024 * 1024):
                total += len(chunk)
                if total > SIZE: raise ValueError('Download excedeu o tamanho esperado.')
                target.write(chunk)
        partial.replace(archive)
        if not valid(): raise ValueError('A assinatura do modelo publicado não confere.')
    hashes = {}
    with zipfile.ZipFile(archive) as bundle:
        if sum(i.file_size for i in bundle.infolist()) > 1_000_000_000: raise ValueError('Modelo excedeu o limite.')
        for info in bundle.infolist():
            path = PurePosixPath(info.filename)
            if path.is_absolute() or '..' in path.parts or '\\' in info.filename or (info.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError('Caminho inválido no modelo.')
            if info.is_dir(): continue
            target = directory.joinpath(*path.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with bundle.open(info) as source, target.open('wb') as out: shutil.copyfileobj(source, out)
            with target.open('rb') as stream: hashes[info.filename] = hashlib.file_digest(stream, 'sha256').hexdigest()
    if not hashes or not any(p.endswith('checkpoint_final.pth') for p in hashes): raise ValueError('Pesos não encontrados no modelo.')
    (directory / 'verified-files.json').write_text(json.dumps(hashes, indent=2))
    print('Modelo conferido e instalado.', flush=True)


def install(work):
    if sys.version_info[:2] not in [(3,11),(3,12)]: raise SystemExit('Use Python 3.11 ou 3.12 para executar esta versão da IA local.')
    if sys.platform != 'darwin' or platform.machine() != 'arm64': raise SystemExit('Este instalador de IA foi preparado para macOS Apple Silicon. O HTML continua independente.')
    os.umask(0o077)
    work.mkdir(parents=True, exist_ok=True)
    environment = work / 'ai-venv'
    python = environment / 'bin/python'
    if not python.exists(): venv.EnvBuilder(with_pip=True).create(environment)
    requirements = Path(__file__).with_name('requirements-lock.txt')
    subprocess.run([str(python), '-m', 'pip', 'install', '-r', str(requirements)], check=True)
    prepare_model(work / 'ai-model')


if __name__ == '__main__':
    install(Path.home() / '.cache' / 'odonto3d')
