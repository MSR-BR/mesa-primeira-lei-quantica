"""Serve the article workspace and compile the PDF on request."""
import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import subprocess
import sys
import threading

ROOT = Path(__file__).resolve().parents[1]
BUILD_LOCK = threading.Lock()


class PreviewHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'site'), **kwargs)

    def do_POST(self):
        if self.path != '/generate-pdf':
            self.send_error(404)
            return
        port = self.server.server_port
        if self.headers.get('Origin') not in {f'http://127.0.0.1:{port}', f'http://localhost:{port}'}:
            self.send_error(403)
            return
        with BUILD_LOCK:
            result = subprocess.run([sys.executable, str(ROOT / 'scripts/build.py')], cwd=ROOT)
            if result.returncode:
                self.send_error(500, 'Falha ao compilar PDF')
                return
            data = json.loads((ROOT / 'site/workspace.json').read_text())
        content = json.dumps({'pdf': data['pdf']}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        self.wfile.write(content)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    options = parser.parse_args()
    with ThreadingHTTPServer(('127.0.0.1', options.port), PreviewHandler) as server:
        print(f'Mesa local em http://127.0.0.1:{options.port}', flush=True)
        server.serve_forever()
