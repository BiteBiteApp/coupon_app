#!/usr/bin/env python3
"""Local-only customer preview; never writes Hosting inputs/configuration.

Build with the three documented source switches, into build/customer_website.
Run: python3 tool/customer_website/preview.py [--port 8765]
"""
import argparse
import re
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]


class Preview(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/flutter_bootstrap.js' and (Path(self.directory) / 'flutter_bootstrap.js').exists():
            # Local rebuilds must never keep a previous Flutter customer bundle
            # alive through the generated offline worker. Deployment bytes stay
            # untouched; this response customization is loopback-preview only.
            bootstrap = (Path(self.directory) / 'flutter_bootstrap.js').read_text()
            data = re.sub(r'serviceWorkerSettings:\s*\{[^}]*\}',
                          'serviceWorkerSettings: undefined', bootstrap).encode()
            content_type = 'text/javascript'
        elif path == '/_customer-preview/qr.js':
            data = (ROOT / 'tool/customer_website/qr-preview.js').read_bytes()
            content_type = 'text/javascript'
        elif path.startswith(('/r/coupons/', '/r/bitescore/')):
            # The injected destination is this loopback server, never an
            # unpublished production URL and never a query-string destination.
            port = self.server.server_address[1]
            script = (f'<script src="/_customer-preview/qr.js" '
                      f'data-customer-origin="http://localhost:{port}"></script>')
            data = (ROOT / 'web/qr-fallback.html').read_text().replace(
                '</body>', script + '\n</body>').encode()
            content_type = 'text/html; charset=utf-8'
        elif path.startswith(('/invite/coupon/', '/invite/bitescore/')):
            # Keep the existing secure app-first fallback, without a public
            # customer shortcut or any token-bearing destination rewrite.
            data = (ROOT / 'web/qr-fallback.html').read_bytes()
            content_type = 'text/html; charset=utf-8'
        else:
            return super().do_GET()
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--fixture', action='store_true', help='Serve synthetic qualification data')
    parser.add_argument('--build-directory', type=Path, help='Serve a separate local qualification build')
    args = parser.parse_args()
    output = args.build_directory or ROOT / ('build/customer_website_fixture' if args.fixture else 'build/customer_website')
    if not (output / 'index.html').exists():
        parser.error('Build the customer preview into build/customer_website first.')
    server = ThreadingHTTPServer(('127.0.0.1', args.port),
                                 partial(Preview, directory=str(output)))
    print(f'Local customer preview: http://localhost:{args.port}', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
