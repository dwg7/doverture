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
    """no-store に加えて Range に応じる。PMTiles は Range が使えないと読めない。"""

    def send_head(self):
        rng = self.headers.get("Range")
        if not rng or not rng.startswith("bytes="):
            return super().send_head()
        path = self.translate_path(self.path)
        if os.path.isdir(path) or not os.path.exists(path):
            return super().send_head()
        size = os.path.getsize(path)
        first, _, last = rng[6:].partition("-")
        try:
            start = int(first) if first else max(0, size - int(last))
            end = int(last) if (last and first) else size - 1
        except ValueError:
            return super().send_head()
        end = min(end, size - 1)
        if start > end:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return None
        f = open(path, "rb")
        f.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        self._range_len = end - start + 1
        return f

    def copyfile(self, source, outputfile):
        n = getattr(self, "_range_len", None)
        if n is None:
            return super().copyfile(source, outputfile)
        self._range_len = None
        while n > 0:
            buf = source.read(min(65536, n))
            if not buf:
                break
            outputfile.write(buf)
            n -= len(buf)

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
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
