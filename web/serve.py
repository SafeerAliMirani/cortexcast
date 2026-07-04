#!/usr/bin/env python3
"""Tiny static server for CortexCast that disables caching, so every browser
refresh always loads the latest files (plain `python -m http.server` caches
modules, which causes stale/mismatched code). Run from the web/ folder:

    python serve.py           # then open http://localhost:8080
"""
import http.server
import socketserver

PORT = 8080


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), NoCacheHandler) as httpd:
        print(f"CortexCast  ->  http://localhost:{PORT}   (no-cache; Ctrl+C to stop)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")
