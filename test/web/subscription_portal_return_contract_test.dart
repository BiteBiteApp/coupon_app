import 'dart:convert';
import 'dart:io';

import 'package:coupon_app/services/subscription_return_service.dart';
import 'package:flutter_test/flutter_test.dart';

const String _helperSourcePath = 'web/subscription-portal-return.html';
const String _helperDestination = '/subscription-portal-return.html';
const String _hostingRoute = '/subscription/portal-return';

void main() {
  test('Hosting preserves existing links and adds one exact portal route', () {
    final firebaseConfig =
        jsonDecode(File('firebase.json').readAsStringSync())
            as Map<String, dynamic>;
    final hosting = firebaseConfig['hosting'] as Map<String, dynamic>;
    final rewrites = (hosting['rewrites'] as List<dynamic>)
        .cast<Map<String, dynamic>>();

    expect(
      rewrites
          .map(
            (rewrite) => (
              source: rewrite['source'] as String,
              destination: rewrite['destination'] as String,
            ),
          )
          .toList(growable: false),
      <({String source, String destination})>[
        (source: '/r/coupons/**', destination: '/qr-fallback.html'),
        (source: '/r/bitescore/**', destination: '/qr-fallback.html'),
        (source: '/invite/coupon/**', destination: '/qr-fallback.html'),
        (source: '/invite/bitescore/**', destination: '/qr-fallback.html'),
        (source: _hostingRoute, destination: _helperDestination),
        (source: '**', destination: '/index.html'),
      ],
    );

    final portalRewrites = rewrites
        .where(
          (rewrite) =>
              (rewrite['source'] as String).startsWith('/subscription'),
        )
        .toList(growable: false);
    expect(portalRewrites, <Map<String, dynamic>>[
      <String, dynamic>{
        'source': _hostingRoute,
        'destination': _helperDestination,
      },
    ]);

    final portalIndex = rewrites.indexWhere(
      (rewrite) => rewrite['source'] == _hostingRoute,
    );
    final catchAllIndex = rewrites.indexWhere(
      (rewrite) => rewrite['source'] == '**',
    );
    expect(portalIndex, catchAllIndex - 1);
    expect(
      rewrites.where((rewrite) => rewrite['source'] == '/subscription/**'),
      isEmpty,
    );
  });

  test('helper assets and canonical public URL are source controlled', () {
    final helperFile = File(_helperSourcePath);
    expect(helperFile.existsSync(), isTrue);

    final html = helperFile.readAsStringSync();
    final canonicalUrl = _linkHref(html, relation: 'canonical');
    expect(canonicalUrl, stripeCustomerPortalReturnUrl);

    final canonicalUri = Uri.parse(canonicalUrl);
    expect(canonicalUri.scheme, 'https');
    expect(canonicalUri.host, 'app.bitestar.app');
    expect(canonicalUri.hasPort, isFalse);
    expect(canonicalUri.path, _hostingRoute);
    expect(canonicalUri.hasQuery, isFalse);
    expect(canonicalUri.hasFragment, isFalse);
    expect(canonicalUri.userInfo, isEmpty);

    expect(_anchorHref(html, id: 'open-bitestar'), subscriptionPortalReturnUri);
    expect(
      _anchorHref(html, id: 'continue-on-web'),
      'https://app.bitestar.app/',
    );
  });

  test('helper is neutral, explicit, responsive, and privacy preserving', () {
    final html = File(_helperSourcePath).readAsStringSync();
    final lowerHtml = html.toLowerCase();

    expect(html, contains('<title>Return to BiteStar</title>'));
    expect(html, contains('aria-label="BiteStar"'));
    expect(html, contains('Back from subscription management'));
    expect(html, contains('returned from managing your subscription'));
    expect(html, contains('refresh your current subscription status'));
    expect(html, contains('Open BiteStar'));
    expect(html, contains('Continue on the web'));
    expect(html, contains('<meta name="viewport" content="width=device-width'));
    expect(html, contains('overflow-wrap: anywhere'));
    expect(html, contains('@media (max-width: 22rem)'));
    expect(html, contains('<meta name="referrer" content="no-referrer">'));

    for (final forbiddenClaim in <String>[
      'checkout success',
      'checkout cancel',
      'subscription active',
      'subscription successful',
      'subscription canceled',
      'payment succeeded',
      'payment failed',
      'plan change successful',
    ]) {
      expect(lowerHtml, isNot(contains(forbiddenClaim)));
    }

    for (final forbiddenBehavior in <String>[
      '<script',
      'http-equiv="refresh"',
      'window.location',
      'document.location',
      'urlsearchparams',
      'document.referrer',
      'localstorage',
      'sessionstorage',
      'document.cookie',
      'window.opener',
      '<form',
      'target="_blank"',
    ]) {
      expect(lowerHtml, isNot(contains(forbiddenBehavior)));
    }

    for (final forbiddenDestination in <String>[
      'go.bitestar.app',
      'biteranger.com',
      'colesmartllc.com',
      'bitestar://',
      'couponapp://',
    ]) {
      expect(lowerHtml, isNot(contains(forbiddenDestination)));
    }

    for (final sensitiveShape in <RegExp>[
      RegExp(r'\bcus_[a-z0-9]+', caseSensitive: false),
      RegExp(r'\bsub_[a-z0-9]+', caseSensitive: false),
      RegExp(r'\bcs_(?:live|test)_[a-z0-9]+', caseSensitive: false),
      RegExp(r'\bpi_[a-z0-9]+', caseSensitive: false),
      RegExp(r'\bsk_(?:live|test)_[a-z0-9]+', caseSensitive: false),
      RegExp(r'\bapi[_ -]?key\b', caseSensitive: false),
      RegExp(r'\bauth[_ -]?token\b', caseSensitive: false),
      RegExp(r'\bwebhook[_ -]?secret\b', caseSensitive: false),
      RegExp(r'\binvitation[_ -]?token\b', caseSensitive: false),
      RegExp(r'[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'),
    ]) {
      expect(sensitiveShape.hasMatch(html), isFalse);
    }
  });

  test('existing checkout helper destinations remain distinct', () {
    final successHtml = File('web/stripe-success.html').readAsStringSync();
    final cancelHtml = File('web/stripe-cancel.html').readAsStringSync();

    expect(
      _anchorHref(successHtml, id: 'return-link'),
      'bitesaver://subscription-success',
    );
    expect(
      _anchorHref(cancelHtml, id: 'return-link'),
      'bitesaver://subscription-cancel',
    );
    expect(successHtml, isNot(contains(subscriptionPortalReturnUri)));
    expect(cancelHtml, isNot(contains(subscriptionPortalReturnUri)));
  });
}

String _anchorHref(String html, {required String id}) {
  final match = RegExp(
    '<a\\b(?=[^>]*\\bid="$id")[^>]*\\bhref="([^"]+)"',
    caseSensitive: false,
    dotAll: true,
  ).firstMatch(html);
  expect(match, isNotNull, reason: 'Missing anchor with id "$id".');
  return match!.group(1)!;
}

String _linkHref(String html, {required String relation}) {
  final match = RegExp(
    '<link\\b(?=[^>]*\\brel="$relation")[^>]*\\bhref="([^"]+)"',
    caseSensitive: false,
    dotAll: true,
  ).firstMatch(html);
  expect(match, isNotNull, reason: 'Missing link with rel "$relation".');
  return match!.group(1)!;
}
