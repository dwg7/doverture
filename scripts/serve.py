#!/usr/bin/env python3
"""docs/ をローカル配信する。`python3 -m http.server` の代わり。

`http.server` は Cache-Control を送らないため、ブラウザのヒューリスティック
キャッシュが古い JS を配信し続け、ハードリロードでも直らないことがある
（cafebabe patterns/local-dev-pitfalls.md、kitavolca が遭遇）。
ここでは no-store を明示して、その罠を塞ぐ。

    ./scripts/serve.py [port]      既定 8779
"""
import functools, http.server, os, socketserver, sys

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8779


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("", PORT), functools.partial(Handler, directory=ROOT)) as httpd:
    print(f"http://localhost:{PORT}/  (docs/, Cache-Control: no-store)", flush=True)
    httpd.serve_forever()
