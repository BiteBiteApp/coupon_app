"""Read-only integration check against the isolated Hosting emulator.
Run after flutter build web: python3 tool/test_legal_hosting.py http://127.0.0.1:PORT
No real provider, Auth, form submission, browser JS or deployment is invoked.
"""
import sys
import unittest
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

ORIGIN = sys.argv.pop(1) if len(sys.argv) > 1 else ''
if urlsplit(ORIGIN).hostname not in ('127.0.0.1', 'localhost'):
    raise SystemExit('Supply the isolated local Hosting emulator origin.')

class HostingRoutes(unittest.TestCase):
    def check_route(self, route, filename):
        with urllib.request.urlopen(ORIGIN + route) as response:
            self.assertEqual(response.status, 200)
            body = response.read()
        self.assertEqual(body, Path('build/web', filename).read_bytes())
        return body

    def test_legal_static_files_precede_flutter_catchall(self):
        for slug in ('privacy-policy', 'terms-of-service', 'delete-account'):
            with self.subTest(slug=slug):
                body = self.check_route('/' + slug + '.html', slug + '.html')
                self.assertEqual(body, Path('web', slug + '.html').read_bytes())
                self.assertNotIn(b'flutter_bootstrap.js', body)
                self.assertNotIn(b'Draft for Owner Review', body)
                self.assertIn(b'Effective date: On first public publication.', body)
                self.assertNotIn(b'<script', body)
                self.assertNotIn(b'<form', body)

    def test_qr_and_invite_fallbacks(self):
        for route in ('/r/coupons/legal-route-check', '/r/bitescore/legal-route-check',
                      '/invite/coupon/legal-route-check', '/invite/bitescore/legal-route-check'):
            with self.subTest(route=route): self.check_route(route, 'qr-fallback.html')

    def test_stripe_and_portal_returns(self):
        for route, file in (('/stripe-success.html', 'stripe-success.html'),
                            ('/stripe-cancel.html', 'stripe-cancel.html'),
                            ('/subscription/portal-return', 'subscription-portal-return.html')):
            with self.subTest(route=route): self.check_route(route, file)

    def test_associations_and_update_endpoint(self):
        for route in ('/.well-known/assetlinks.json', '/.well-known/apple-app-site-association',
                      '/app-updates/ios.json'):
            with self.subTest(route=route): self.check_route(route, route.lstrip('/'))
        with urllib.request.urlopen(ORIGIN + '/app-updates/ios.json') as response:
            self.assertIn('no-store', response.headers['Cache-Control'])

    def test_existing_app_and_deletion_entry_preserved(self):
        # /#/account/delete sends '/' to Hosting; Flutter resolves the fragment.
        self.check_route('/', 'index.html')
        self.check_route('/account/delete', 'index.html')

if __name__ == '__main__': unittest.main()
