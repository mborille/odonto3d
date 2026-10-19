"""Loopback-only application runtime. One authenticated inference job at a time."""
import argparse
import atexit
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
from protocol import receive_volume


class Runtime:
    def __init__(self, model, runtime, html, threads=4):
        self.model, self.runtime, self.html, self.threads = model, runtime, html, threads
        self.token = secrets.token_hex(32)
        self.job = None
        self.lock = threading.RLock()
        (runtime / "jobs").mkdir(parents=True, exist_ok=True, mode=0o700)
        self.runtime.chmod(0o700)

    def snapshot(self, job):
        if job.get("directory") and job["directory"].exists():
            try:
                job["progress"] = json.loads((job["directory"] / "progress.json").read_text())
            except (OSError, ValueError):
                pass
        return {"id": job["id"], "state": job["state"], **job.get("progress", {}),
                "elapsedSeconds": round(time.monotonic() - job["started"]), "error": job.get("error")}

    def reserve(self, identifier=None):
        with self.lock:
            if self.job and self.job["state"] in ("uploading", "running", "cancelling"):
                raise RuntimeError("Já há uma segmentação em andamento.")
            directory = Path(tempfile.mkdtemp(prefix="case-", dir=self.runtime / "jobs"))
            directory.chmod(0o700)
            job = {"id": identifier or secrets.token_hex(16), "state": "uploading", "directory": directory,
                   "started": time.monotonic(), "progress": {"detail": "Recebendo o volume localmente…"}}
            self.job = job
            return job

    def start(self, job):
        log = (job["directory"] / "engine.log").open("wb")
        env = os.environ.copy()
        env.update({"OMP_NUM_THREADS": str(self.threads), "PYTHONUNBUFFERED": "1"})
        process = subprocess.Popen([sys.executable, str(Path(__file__).with_name("infer.py")),
                                    "--job", str(job["directory"]), "--model", str(self.model),
                                    "--threads", str(self.threads)], stdout=log, stderr=subprocess.STDOUT,
                                   env=env, start_new_session=True)
        job.update(process=process, state="running")
        threading.Thread(target=self.monitor, args=(job, log), daemon=True).start()

    def monitor(self, job, log):
        process = job["process"]
        try:
            process.wait(timeout=7200)
        except subprocess.TimeoutExpired:
            process.kill(); process.wait()
            job["error"] = "O limite de duas horas foi atingido. O processamento foi interrompido."
        log.close()
        with self.lock:
            self.snapshot(job)
            if job["state"] == "cancelling":
                job["state"] = "cancelled"
            elif process.returncode == 0 and (job["directory"] / "result.odseg").is_file():
                result = job["directory"] / "result.odseg"
                if result.stat().st_size <= 192 * 1024**2:
                    job.update(state="complete", result=result.read_bytes(), finished=time.monotonic())
                else:
                    job.update(state="error", error="Resultado excedeu o limite de visualização.")
            else:
                job["state"] = "error"
                detail = (job["directory"] / "engine.log").read_text(errors="replace").strip().splitlines()
                job["error"] = job.get("error") or (detail[-1][:400] if detail else "A IA não concluiu o processamento.")
            shutil.rmtree(job["directory"], ignore_errors=True)

    def cancel(self, job):
        with self.lock:
            if job["state"] == "uploading":
                job["state"] = "cancelling"
            elif job["state"] == "running":
                job["state"] = "cancelling"
                job["process"].terminate()
                def kill_later():
                    try: job["process"].wait(timeout=5)
                    except subprocess.TimeoutExpired: job["process"].kill()
                threading.Thread(target=kill_later, daemon=True).start()
            elif job["state"] == "complete":
                job.pop("result", None); job["state"] = "cancelled"

    def close(self):
        if self.job:
            self.cancel(self.job)
            proc = self.job.get("process")
            if proc and proc.poll() is None:
                try: proc.wait(timeout=6)
                except subprocess.TimeoutExpired: proc.kill(); proc.wait()
            shutil.rmtree(self.job["directory"], ignore_errors=True)


def make_handler(runtime, port):
    origin = f"http://127.0.0.1:{port}"

    class Handler(BaseHTTPRequestHandler):
        server_version = "Odonto3D-local"
        def log_message(self, *args):
            pass  # No case data, tokens or request bodies in access logs.

        def send(self, code, payload, mime="application/json"):
            if not isinstance(payload, bytes):
                payload = json.dumps(payload, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Cross-Origin-Resource-Policy", "same-origin")
            self.send_header("Referrer-Policy", "no-referrer")
            self.end_headers()
            try: self.wfile.write(payload)
            except (BrokenPipeError, ConnectionResetError): pass

        def allowed(self, auth=False):
            if self.headers.get("Host") != f"127.0.0.1:{port}" or self.headers.get("Origin", origin) != origin:
                self.send(403, {"error": "Origem não permitida."}); return False
            if auth and not hmac.compare_digest(self.headers.get("X-Odonto-Token", ""), runtime.token):
                self.send(403, {"error": "Sessão local não autorizada."}); return False
            return True

        def lookup(self, identifier):
            with runtime.lock:
                job = runtime.job
                if not job or job["id"] != identifier:
                    self.send(404, {"error": "Processamento não encontrado."}); return None
                if job.get("finished") and time.monotonic() - job["finished"] > 3600:
                    job.pop("result", None); job["state"] = "expired"
                return job

        def do_GET(self):
            if not self.allowed(): return
            if self.path in ("/", "/Odonto3D.html"):
                html = runtime.html.read_text().replace('<meta name="odonto-ai-token" content="">',
                                                       f'<meta name="odonto-ai-token" content="{runtime.token}">')
                self.send(200, html.encode(), "text/html; charset=utf-8"); return
            if self.path == "/favicon.ico":
                self.send(204, b"", "image/x-icon"); return
            if not self.allowed(auth=True): return
            if self.path == "/api/health":
                self.send(200, {"ready": (runtime.model / "verified-files.json").is_file(),
                                "engine": "DentalSegmentator", "device": "cpu", "version": "0.4.0",
                                "activeJob": runtime.snapshot(runtime.job) if runtime.job and runtime.job["state"] in ("uploading", "running", "cancelling") else None}); return
            match = re.fullmatch(r"/api/jobs/([a-f0-9]{32})(/result)?", self.path)
            if match:
                job = self.lookup(match[1])
                if job is None: return
                if match[2]:
                    if job["state"] != "complete": self.send(409, {"error": "Resultado indisponível."})
                    else: self.send(200, job["result"], "application/octet-stream")
                else: self.send(200, runtime.snapshot(job))
                return
            self.send(404, {"error": "Rota não encontrada."})

        def do_POST(self):
            if not self.allowed(auth=True): return
            if self.path == "/api/jobs":
                if self.headers.get("Content-Type") != "application/octet-stream":
                    self.send(415, {"error": "Formato de volume inválido."}); return
                if not (runtime.model / "verified-files.json").is_file():
                    self.send(503, {"error": "Modelo ausente. Execute Instalar IA local."}); return
                job = None
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    identifier = self.headers.get("X-Odonto-Request", "")
                    if not re.fullmatch(r"[a-f0-9]{32}", identifier):
                        raise ValueError("Identificação de processamento inválida.")
                    job = runtime.reserve(identifier)
                    self.connection.settimeout(120)
                    receive_volume(self.rfile, length, job["directory"])
                    if job["state"] != "uploading":
                        raise ValueError("Segmentação cancelada.")
                    runtime.start(job)
                    self.send(202, {"id": job["id"]})
                except RuntimeError as e:
                    self.send(409, {"error": str(e)})
                except Exception as e:
                    if job:
                        job.update(state="error", error="Não foi possível receber o volume.")
                        shutil.rmtree(job["directory"], ignore_errors=True)
                    self.send(400, {"error": str(e)[:250]})
                return
            match = re.fullmatch(r"/api/jobs/([a-f0-9]{32})/cancel", self.path)
            if match:
                job = self.lookup(match[1])
                if job is not None:
                    runtime.cancel(job); self.send(200, {"state": job["state"]})
                return
            self.send(404, {"error": "Rota não encontrada."})

        def do_OPTIONS(self):
            self.send(403, {"error": "Acesso entre origens não permitido."})
    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--html", type=Path, default=Path(__file__).resolve().parents[2] / "Odonto3D.html")
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    os.umask(0o077)
    runtime = Runtime(args.model.resolve(), args.runtime.resolve(), args.html.resolve(), max(1, min(8, args.threads)))
    atexit.register(runtime.close)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(runtime, args.port))
    server.daemon_threads = True
    url = f"http://127.0.0.1:{args.port}/"
    print(f"Odonto3D com IA local: {url}\nMantenha esta janela aberta. Ctrl+C encerra o serviço.", flush=True)
    if not args.no_browser: webbrowser.open(url)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: runtime.close(); server.server_close()


if __name__ == "__main__":
    main()
