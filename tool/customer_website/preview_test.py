import functools
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer
from preview import Preview, ROOT


class PreviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0),
            functools.partial(Preview, directory=str(ROOT / 'web')))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def get(self, path):
        with urllib.request.urlopen(self.origin + path) as response:
            return response.read()

    def test_customer_sides_offer_local_only_shortcut(self):
        for side in ['coupons', 'bitescore']:
            html = self.get(f'/r/{side}/permanent%252Fidentity')
            self.assertIn(b'/_customer-preview/qr.js', html)
            self.assertIn(f'http://localhost:{self.server.server_port}'.encode(), html)

    def test_invites_retain_exact_secure_fallback(self):
        expected = (ROOT / 'web/qr-fallback.html').read_bytes()
        for side in ['coupon', 'bitescore']:
            self.assertEqual(self.get(f'/invite/{side}/private-token'), expected)

    def test_legal_and_association_assets_are_unchanged(self):
        for path in ['privacy-policy.html', 'terms-of-service.html', 'delete-account.html',
                     '.well-known/assetlinks.json', '.well-known/apple-app-site-association']:
            self.assertEqual(self.get('/' + path), (ROOT / 'web' / path).read_bytes())


if __name__ == '__main__':
    unittest.main()
