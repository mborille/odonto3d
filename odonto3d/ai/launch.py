"""Start the installed local product runtime, or install it on first use."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request
import webbrowser
from install import install

base = Path(__file__).resolve().parents[2]
work = Path.home() / '.cache' / 'odonto3d'
python = work / 'ai-venv/bin/python'
model = work / 'ai-model'
url = 'http://127.0.0.1:8766/'
try:
    with urllib.request.urlopen(url, timeout=2) as response:
        if 'Odonto3D-local' in response.headers.get('Server', ''):
            webbrowser.open(url)
            raise SystemExit(0)
except (OSError, urllib.error.URLError): pass
if not python.is_file() or not (model / 'verified-files.json').is_file():
    print('Primeira instalação: serão baixadas as bibliotecas e o modelo público de IA. Exames permanecem locais.', flush=True)
    install(work)
service=work/'service';service.mkdir(parents=True,exist_ok=True)
for source in Path(__file__).parent.glob('*.py'): shutil.copy2(source,service/source.name)
shutil.copy2(base/'Odonto3D.html',work/'Odonto3D.html')
args = [str(python), str(service/'server.py'), '--model', str(model),
        '--runtime', str(work / 'ai-runtime'), '--html', str(work / 'Odonto3D.html')]
os.execv(str(python), args)
