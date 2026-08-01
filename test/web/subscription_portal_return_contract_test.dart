import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

const String _helperDestination = '/subscription-portal-return.html';
const String _hostingRoute = '/subscription/portal-return';
const String _portalCanonicalUrl =
    'https://app.bitestar.app/subscription/portal-return';
const String _webReturnOrigin = 'https://app.bitestar.app/';
const String _webReturnFragmentPrefix = '#/subscription-return/';
const String _neutralHeading = 'Return to BiteStar';
const String _neutralMessage = 'This return link is unavailable.';
const String _validToken = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ABCDE';

const List<_HelperSpec> _helperSpecs = <_HelperSpec>[
  _HelperSpec(
    sourcePath: 'web/stripe-success.html',
    publicUrl: 'https://coupon-app-29446.web.app/stripe-success.html',
    tokenlessPath: '/stripe-success.html',
    nativeButtonId: 'return-link',
    customSchemeBase: 'bitesaver://subscription-success',
    returnKind: 'checkoutSuccess',
    validTitle: 'Subscription Active',
    statusIconId: 'status-icon',
    validVisibleFragments: <String>[
      'Subscription Active',
      'Your subscription was successful.',
      'Tap below to return to BiteStar.',
    ],
  ),
  _HelperSpec(
    sourcePath: 'web/stripe-cancel.html',
    publicUrl: 'https://coupon-app-29446.web.app/stripe-cancel.html',
    tokenlessPath: '/stripe-cancel.html',
    nativeButtonId: 'return-link',
    customSchemeBase: 'bitesaver://subscription-cancel',
    returnKind: 'checkoutCancel',
    validTitle: 'Subscription Canceled',
    statusIconId: 'status-icon',
    validVisibleFragments: <String>[
      'Subscription Canceled',
      'No charge was made.',
      'Tap below to return to BiteStar.',
    ],
  ),
  _HelperSpec(
    sourcePath: 'web/subscription-portal-return.html',
    publicUrl: _portalCanonicalUrl,
    tokenlessPath: _hostingRoute,
    nativeButtonId: 'open-bitestar',
    customSchemeBase: 'bitesaver://subscription-portal-return',
    returnKind: 'customerPortal',
    validTitle: 'Back from subscription management',
    validVisibleFragments: <String>[
      'Back from subscription management',
      'You have returned from managing your subscription.',
      'refresh your current subscription status.',
      'If the app does not open, use the web option',
    ],
  ),
];

void main() {
  test(
    'Hosting preserves every existing route and the exact portal helper',
    () {
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
    },
  );

  test('canonical and fixed web-fragment semantics remain exact', () {
    for (final helper in _helperSpecs) {
      expect(
        File(helper.sourcePath).existsSync(),
        isTrue,
        reason: helper.sourcePath,
      );
    }

    final portalHtml = File(
      'web/subscription-portal-return.html',
    ).readAsStringSync();
    expect(_linkHref(portalHtml, relation: 'canonical'), _portalCanonicalUrl);
    final canonicalUri = Uri.parse(_portalCanonicalUrl);
    expect(canonicalUri.scheme, 'https');
    expect(canonicalUri.host, 'app.bitestar.app');
    expect(canonicalUri.hasPort, isFalse);
    expect(canonicalUri.path, _hostingRoute);
    expect(canonicalUri.hasQuery, isFalse);
    expect(canonicalUri.hasFragment, isFalse);
    expect(canonicalUri.userInfo, isEmpty);

    for (final sourcePath in <String>[
      'web/stripe-success.html',
      'web/stripe-cancel.html',
    ]) {
      final html = File(sourcePath).readAsStringSync();
      expect(
        RegExp(
          r'<link\b(?=[^>]*\brel="canonical")',
          caseSensitive: false,
        ).hasMatch(html),
        isFalse,
        reason: '$sourcePath did not historically define a canonical link.',
      );
      expect(_anchorHrefs(html), isEmpty);
      expect(
        html,
        contains(
          'If BiteStar does not open, use the web option or switch back to ',
        ),
      );
    }

    expect(_anchorHrefs(portalHtml), isEmpty);
    expect(
      portalHtml,
      contains(
        'If the app does not open, use the web option or switch back to ',
      ),
    );
  });

  test('all helpers are fail-closed, inline, and privacy preserving', () {
    expect(_validToken, hasLength(43));
    expect(RegExp(r'^[A-Za-z0-9_-]{43}$').hasMatch(_validToken), isTrue);

    for (final helper in _helperSpecs) {
      final html = File(helper.sourcePath).readAsStringSync();
      final lowerHtml = html.toLowerCase();
      final scripts = _inlineScripts(html);
      final nativeButtonTag = _openingTag(
        html,
        tagName: 'button',
        id: helper.nativeButtonId,
      );
      final webButtonTag = _openingTag(
        html,
        tagName: 'button',
        id: 'continue-on-web',
      );

      expect(
        html,
        contains('<meta name="referrer" content="no-referrer">'),
        reason: helper.sourcePath,
      );
      expect(
        html,
        contains('<meta name="viewport" content="width=device-width'),
        reason: helper.sourcePath,
      );
      expect(_elementText(html, id: 'return-heading'), _neutralHeading);
      expect(_elementText(html, id: 'return-message'), _neutralMessage);
      expect(_titleText(html), _neutralHeading);
      expect(
        html,
        matches(RegExp(r'\[hidden\]\s*\{\s*display: none !important;')),
        reason: helper.sourcePath,
      );
      for (final buttonTag in <String>[nativeButtonTag, webButtonTag]) {
        expect(buttonTag, matches(RegExp(r'\bhidden\b')));
        expect(buttonTag, matches(RegExp(r'\bdisabled\b')));
        expect(buttonTag, isNot(contains('href=')));
        expect(buttonTag, isNot(contains(_validToken)));
      }
      if (helper.statusIconId case final statusIconId?) {
        final statusIconTag = _openingTag(
          html,
          tagName: 'div',
          id: statusIconId,
        );
        expect(statusIconTag, matches(RegExp(r'\bhidden\b')));
        expect(statusIconTag, contains('aria-hidden="true"'));
      }

      expect(scripts, hasLength(1), reason: helper.sourcePath);
      expect(scripts.single.attributes.trim(), isEmpty);
      expect(scripts.single.source, contains(r'/^[A-Za-z0-9_-]{43}$/'));
      expect(
        scripts.single.source,
        contains("const parameterName = 'return_token';"),
      );
      expect(scripts.single.source, contains('window.history.replaceState('));
      expect(scripts.single.source, contains('const maximumUrlLength = 2048;'));
      expect(
        scripts.single.source.indexOf('window.history.replaceState('),
        lessThan(
          scripts.single.source.indexOf('parseReturnToken(originalHref)'),
        ),
      );
      expect(
        scripts.single.source,
        contains("'https://app.bitestar.app/#/subscription-return/'"),
      );
      expect(scripts.single.source, contains(helper.returnKind));
      expect(
        RegExp(r'window\.location\.assign\(').allMatches(scripts.single.source),
        hasLength(1),
      );
      expect(_anchorHrefs(html), isEmpty, reason: helper.sourcePath);
      expect(
        html,
        contains('min-height: 48px'),
        reason: '${helper.sourcePath} must retain a 48px action target.',
      );

      for (final fragment in helper.validVisibleFragments) {
        expect(html, contains(fragment), reason: helper.sourcePath);
      }

      for (final forbiddenBehavior in <String>[
        '<script src=',
        'rel="stylesheet"',
        'rel="preload"',
        '<img',
        'http-equiv="refresh"',
        'document.referrer',
        'localstorage',
        'sessionstorage',
        'document.cookie',
        'indexeddb',
        'window.opener',
        'window.open(',
        'console.',
        'fetch(',
        'xmlhttprequest',
        'websocket',
        'eventsource',
        'sendbeacon',
        'google-analytics',
        'googletagmanager',
        'gtag(',
        '<form',
        'target="_blank"',
      ]) {
        expect(
          lowerHtml,
          isNot(contains(forbiddenBehavior)),
          reason: '${helper.sourcePath}: $forbiddenBehavior',
        );
      }

      for (final forbiddenDestination in <String>[
        'go.bitestar.app',
        'biteranger.com',
        'colesmartllc.com',
        'bitestar://',
        'couponapp://',
      ]) {
        expect(
          lowerHtml,
          isNot(contains(forbiddenDestination)),
          reason: helper.sourcePath,
        );
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
        expect(
          sensitiveShape.hasMatch(html),
          isFalse,
          reason: helper.sourcePath,
        );
      }
    }
  });

  test('all helpers declare exactly one network-free inline favicon', () {
    for (final helper in _helperSpecs) {
      final html = File(helper.sourcePath).readAsStringSync();
      final faviconTags = _linkTagsWithRelation(html, relation: 'icon');

      expect(faviconTags, hasLength(1), reason: helper.sourcePath);
      final faviconTag = faviconTags.single;
      final nullableFaviconHref = _attributeValue(faviconTag, name: 'href');
      expect(nullableFaviconHref, isNotNull, reason: helper.sourcePath);
      final faviconHref = nullableFaviconHref!;
      expect(faviconHref, 'data:,', reason: helper.sourcePath);
      expect(Uri.parse(faviconHref).scheme, 'data', reason: helper.sourcePath);
      expect(
        faviconHref.toLowerCase(),
        isNot(anyOf(contains('http:'), contains('https:'))),
        reason: helper.sourcePath,
      );
      expect(
        faviconHref.toLowerCase(),
        isNot(contains('/favicon.ico')),
        reason: helper.sourcePath,
      );
      expect(
        faviconHref.toLowerCase(),
        isNot(contains('token')),
        reason: helper.sourcePath,
      );
      expect(
        faviconHref,
        isNot(contains(_validToken)),
        reason: helper.sourcePath,
      );
      expect(
        html.toLowerCase(),
        isNot(contains('/favicon.ico')),
        reason: helper.sourcePath,
      );
    }
  });

  for (final helper in _helperSpecs) {
    group(helper.sourcePath, () {
      test('valid token is cleaned before exact native and web actions', () {
        final validUrl = '${helper.publicUrl}?return_token=$_validToken';
        final maximumLengthUrl = _validUrlWithLength(helper.publicUrl, 2048);
        final results = _executeHelper(helper, <Map<String, Object>>[
          <String, Object>{'name': 'valid without click', 'href': validUrl},
          <String, Object>{
            'name': 'valid native click',
            'href': validUrl,
            'clickButtonId': helper.nativeButtonId,
          },
          <String, Object>{
            'name': 'valid web click',
            'href': validUrl,
            'clickButtonId': 'continue-on-web',
          },
          <String, Object>{
            'name': 'exactly 2048 characters',
            'href': maximumLengthUrl,
          },
        ]);

        final withoutClick = results[0];
        final nativeClick = results[1];
        final webClick = results[2];
        for (final result in results) {
          _expectSafeRuntime(result, helper: helper);
          expect(result['nativeButtonHidden'], isFalse);
          expect(result['nativeButtonDisabled'], isFalse);
          expect(result['nativeListenerCount'], 1);
          expect(result['webButtonHidden'], isFalse);
          expect(result['webButtonDisabled'], isFalse);
          expect(result['webListenerCount'], 1);
          if (helper.statusIconId != null) {
            expect(result['statusIconHidden'], isFalse);
          }
          expect(result['assignedBeforeClick'], isEmpty);
          expect(result['cleanHref'], _cleanUrl(helper));
          expect(result['documentTitle'], helper.validTitle);

          final replacements = (result['replacements'] as List<dynamic>)
              .cast<Map<String, dynamic>>();
          expect(replacements, hasLength(1));
          expect(replacements.single['state'], isNull);
          expect(replacements.single['title'], _neutralHeading);
          expect(replacements.single['url'], helper.tokenlessPath);

          final visibleText = result['visibleText'] as String;
          expect(visibleText, isNot(contains(_validToken)));
          expect(visibleText, isNot(contains(_neutralMessage)));
          for (final fragment in helper.validVisibleFragments) {
            expect(visibleText, contains(fragment), reason: helper.sourcePath);
          }
        }

        expect(withoutClick['assigned'], isEmpty);
        expect(withoutClick['order'], <String>[
          'replaceState',
          'addEventListener:click',
          'addEventListener:click',
        ]);

        expect(nativeClick['assigned'], <String>[
          '${helper.customSchemeBase}?return_token=$_validToken',
        ]);
        expect(nativeClick['order'], <String>[
          'replaceState',
          'addEventListener:click',
          'addEventListener:click',
          'assign',
        ]);

        expect(webClick['assigned'], <String>[
          '$_webReturnOrigin$_webReturnFragmentPrefix'
              '${helper.returnKind}?return_token=$_validToken',
        ]);
        expect(webClick['order'], <String>[
          'replaceState',
          'addEventListener:click',
          'addEventListener:click',
          'assign',
        ]);
      });

      test('complete malformed matrix remains neutral and opens nothing', () {
        final invalidCases = _invalidCases(helper.publicUrl);
        final results = _executeHelper(helper, invalidCases);
        expect(results, hasLength(invalidCases.length));

        for (var index = 0; index < invalidCases.length; index += 1) {
          final input = invalidCases[index];
          final result = results[index];
          final caseName = input['name'] as String;

          _expectSafeRuntime(result, helper: helper, caseName: caseName);
          expect(result['nativeButtonHidden'], isTrue, reason: caseName);
          expect(result['nativeButtonDisabled'], isTrue, reason: caseName);
          expect(result['nativeListenerCount'], 0, reason: caseName);
          expect(result['webButtonHidden'], isTrue, reason: caseName);
          expect(result['webButtonDisabled'], isTrue, reason: caseName);
          expect(result['webListenerCount'], 0, reason: caseName);
          if (helper.statusIconId != null) {
            expect(result['statusIconHidden'], isTrue, reason: caseName);
          }
          expect(result['assignedBeforeClick'], isEmpty, reason: caseName);
          expect(result['assigned'], isEmpty, reason: caseName);
          expect(result['documentTitle'], _neutralHeading, reason: caseName);
          expect(result['cleanHref'], _cleanUrl(helper), reason: caseName);

          final replacements = (result['replacements'] as List<dynamic>)
              .cast<Map<String, dynamic>>();
          expect(replacements, hasLength(1), reason: caseName);
          expect(replacements.single['state'], isNull, reason: caseName);
          expect(
            replacements.single['title'],
            _neutralHeading,
            reason: caseName,
          );
          expect(
            replacements.single['url'],
            helper.tokenlessPath,
            reason: caseName,
          );
          expect(result['order'], <String>['replaceState'], reason: caseName);

          final visibleText = result['visibleText'] as String;
          expect(visibleText, contains(_neutralHeading), reason: caseName);
          expect(visibleText, contains(_neutralMessage), reason: caseName);
          expect(visibleText, isNot(contains(_validToken)), reason: caseName);
          for (final fragment in helper.validVisibleFragments) {
            expect(
              visibleText,
              isNot(contains(fragment)),
              reason: '$caseName exposed valid-only presentation.',
            );
          }
        }
      });

      test('tokenless reload remains neutral and actionless', () {
        final results = _executeHelper(helper, <Map<String, Object>>[
          <String, Object>{
            'name': 'tokenless reload',
            'href': _cleanUrl(helper),
            'clickButtonId': helper.nativeButtonId,
          },
        ]);
        final result = results.single;
        _expectSafeRuntime(result, helper: helper);
        expect(result['documentTitle'], _neutralHeading);
        expect(result['nativeListenerCount'], 0);
        expect(result['webListenerCount'], 0);
        expect(result['assigned'], isEmpty);
        expect(result['cleanHref'], _cleanUrl(helper));
      });
    });
  }

  group('app_links 7.2.1 native source contracts', () {
    test('dependency is exactly pinned and locked', () {
      final pubspec = File('pubspec.yaml').readAsStringSync();
      final lockfile = File('pubspec.lock').readAsStringSync();

      expect(
        pubspec,
        matches(RegExp(r'^\s{2}app_links: 7\.2\.1$', multiLine: true)),
      );
      expect(
        lockfile,
        matches(
          RegExp(
            r'name: app_links\s+sha256: ["a-f0-9]+["a-f0-9]*\s+'
            r'url: "https://pub.dev"\s+source: hosted\s+version: "7\.2\.1"',
            multiLine: true,
          ),
        ),
      );
    });

    test('Android cold/warm delivery emits no complete URI log', () {
      final packageRoot = _resolvedPackageRoot('app_links');
      final pluginSource = File(
        '${packageRoot.path}/android/src/main/java/'
        'com/llfbandit/app_links/AppLinksPlugin.java',
      ).readAsStringSync();
      final helperSource = File(
        '${packageRoot.path}/android/src/main/java/'
        'com/llfbandit/app_links/AppLinksHelper.java',
      ).readAsStringSync();
      final androidSource = '$pluginSource\n$helperSource';

      expect(
        pluginSource,
        contains('handleIntent(binding.getActivity().getIntent())'),
      );
      expect(pluginSource, contains('boolean onNewIntent'));
      expect(pluginSource, contains('return handleIntent(intent);'));
      expect(pluginSource, contains('eventSink.success(dataString);'));
      for (final forbiddenLog in <RegExp>[
        RegExp(r'android\.util\.Log'),
        RegExp(r'\bLog\s*\.'),
        RegExp(r'System\.(?:out|err)'),
        RegExp(r'\bprint(?:ln)?\s*\('),
      ]) {
        expect(
          forbiddenLog.hasMatch(androidSource),
          isFalse,
          reason:
              'Resolved Android app_links source must not log incoming URIs.',
        );
      }
    });

    test('iOS plugin owns cold scene and warm URL forwarding exactly once', () {
      final packageRoot = _resolvedPackageRoot('app_links');
      final pluginSource = File(
        '${packageRoot.path}/ios/app_links/Sources/app_links/'
        'AppLinksIosPlugin.swift',
      ).readAsStringSync();
      final runnerSceneDelegate = File(
        'ios/Runner/SceneDelegate.swift',
      ).readAsStringSync();

      expect(pluginSource, contains('FlutterSceneLifeCycleDelegate'));
      expect(pluginSource, contains('registrar.addSceneDelegate(instance)'));
      expect(
        pluginSource,
        contains('options connectionOptions: UIScene.ConnectionOptions?'),
      );
      expect(
        pluginSource,
        contains('self.scene(scene, openURLContexts: options.urlContexts)'),
      );
      expect(
        pluginSource,
        matches(
          RegExp(
            r'application\(\s*_ application: UIApplication,\s*open url: URL,',
          ),
        ),
      );
      expect(
        runnerSceneDelegate,
        contains('class SceneDelegate: FlutterSceneDelegate'),
      );
      expect(runnerSceneDelegate, isNot(contains('openURLContexts')));
      expect(runnerSceneDelegate, isNot(contains('willConnectTo')));
    });
  });
}

Directory _resolvedPackageRoot(String packageName) {
  final packageConfigFile = File('.dart_tool/package_config.json');
  expect(packageConfigFile.existsSync(), isTrue);
  final packageConfig =
      jsonDecode(packageConfigFile.readAsStringSync()) as Map<String, dynamic>;
  final packages = (packageConfig['packages'] as List<dynamic>)
      .cast<Map<String, dynamic>>();
  final package = packages.singleWhere(
    (candidate) => candidate['name'] == packageName,
  );
  final rootUri = packageConfigFile.uri.resolve(package['rootUri'] as String);
  final directory = Directory.fromUri(rootUri);
  expect(directory.existsSync(), isTrue);
  return directory;
}

String _cleanUrl(_HelperSpec helper) {
  final publicUri = Uri.parse(helper.publicUrl);
  return publicUri.replace(path: helper.tokenlessPath).toString();
}

String _validUrlWithLength(String baseUrl, int length) {
  final origin = Uri.parse(baseUrl).origin;
  const suffix = '?return_token=$_validToken';
  final paddingLength = length - origin.length - 1 - suffix.length;
  expect(paddingLength, greaterThanOrEqualTo(0));
  final padding = List<String>.filled(paddingLength, 'a').join();
  final result = '$origin/$padding$suffix';
  expect(result, hasLength(length));
  return result;
}

List<Map<String, Object>> _invalidCases(String baseUrl) {
  final tooShort = _validToken.substring(1);
  final invalidCharacter = '${_validToken.substring(0, 42)}.';
  final encodedInvalidCharacter = '${_validToken.substring(0, 42)}%2E';
  final encodedValidCharacter = '%41${_validToken.substring(1)}';
  final invalidPercent = '${_validToken.substring(0, 42)}%';
  final overlongUrl = _validUrlWithLength(baseUrl, 2049);

  return <Map<String, Object>>[
    <String, Object>{'name': 'missing token', 'href': baseUrl, 'click': true},
    <String, Object>{
      'name': 'empty token',
      'href': '$baseUrl?return_token=',
      'click': true,
    },
    <String, Object>{
      'name': 'empty token without equals',
      'href': '$baseUrl?return_token',
      'click': true,
    },
    <String, Object>{
      'name': 'duplicate token',
      'href': '$baseUrl?return_token=$_validToken&return_token=$_validToken',
      'click': true,
    },
    <String, Object>{
      'name': 'too short',
      'href': '$baseUrl?return_token=$tooShort',
      'click': true,
    },
    <String, Object>{
      'name': 'too long',
      'href': '$baseUrl?return_token=${_validToken}A',
      'click': true,
    },
    <String, Object>{
      'name': 'invalid character',
      'href': '$baseUrl?return_token=$invalidCharacter',
      'click': true,
    },
    <String, Object>{
      'name': 'encoded invalid character',
      'href': '$baseUrl?return_token=$encodedInvalidCharacter',
      'click': true,
    },
    <String, Object>{
      'name': 'padding',
      'href': '$baseUrl?return_token=$_validToken=',
      'click': true,
    },
    <String, Object>{
      'name': 'encoded padding',
      'href': '$baseUrl?return_token=$_validToken%3D',
      'click': true,
    },
    <String, Object>{
      'name': 'leading whitespace',
      'href': '$baseUrl?return_token=%20$_validToken',
      'click': true,
    },
    <String, Object>{
      'name': 'trailing whitespace',
      'href': '$baseUrl?return_token=$_validToken%20',
      'click': true,
    },
    <String, Object>{
      'name': 'extra query parameter',
      'href': '$baseUrl?return_token=$_validToken&source=caller',
      'click': true,
    },
    <String, Object>{
      'name': 'unexpected parameter',
      'href': '$baseUrl?source=caller',
      'click': true,
    },
    <String, Object>{
      'name': 'wrong parameter case',
      'href': '$baseUrl?RETURN_TOKEN=$_validToken',
      'click': true,
    },
    <String, Object>{
      'name': 'encoded parameter name',
      'href': '$baseUrl?return%5Ftoken=$_validToken',
      'click': true,
    },
    <String, Object>{
      'name': 'encoded valid token character',
      'href': '$baseUrl?return_token=$encodedValidCharacter',
      'click': true,
    },
    <String, Object>{
      'name': 'plus decoded as whitespace',
      'href': '$baseUrl?return_token=+${_validToken.substring(1)}',
      'click': true,
    },
    <String, Object>{
      'name': 'invalid percent encoding',
      'href': '$baseUrl?return_token=$invalidPercent',
      'click': true,
    },
    <String, Object>{
      'name': 'trailing query delimiter',
      'href': '$baseUrl?return_token=$_validToken&',
      'click': true,
    },
    <String, Object>{
      'name': 'fragment',
      'href': '$baseUrl?return_token=$_validToken#caller',
      'click': true,
    },
    <String, Object>{
      'name': 'empty fragment',
      'href': '$baseUrl?return_token=$_validToken#',
      'click': true,
    },
    <String, Object>{
      'name': 'overlong URL with otherwise valid token',
      'href': overlongUrl,
      'click': true,
    },
  ];
}

List<Map<String, dynamic>> _executeHelper(
  _HelperSpec helper,
  List<Map<String, Object>> cases,
) {
  final html = File(helper.sourcePath).readAsStringSync();
  final scripts = _inlineScripts(html);
  expect(scripts, hasLength(1), reason: helper.sourcePath);

  final statusIconId = helper.statusIconId;
  final textById = <String, String>{
    'return-heading': _elementText(html, id: 'return-heading'),
    'return-message': _elementText(html, id: 'return-message'),
    'return-instruction': _elementText(html, id: 'return-instruction'),
    helper.nativeButtonId: _elementText(html, id: helper.nativeButtonId),
    'continue-on-web': _elementText(html, id: 'continue-on-web'),
  };
  if (statusIconId != null) {
    textById[statusIconId] = _elementText(html, id: statusIconId);
  }

  final payload = <String, Object>{
    'nativeButtonId': helper.nativeButtonId,
    'webButtonId': 'continue-on-web',
    'title': _titleText(html),
    'textById': textById,
    'cases': cases,
  };
  if (statusIconId != null) {
    payload['statusIconId'] = statusIconId;
  }

  final result = Process.runSync(
    'node',
    <String>[
      '-e',
      _nodeRuntimeHarness,
      base64Encode(utf8.encode(scripts.single.source)),
      base64Encode(utf8.encode(jsonEncode(payload))),
    ],
    workingDirectory: Directory.current.path,
    stdoutEncoding: utf8,
    stderrEncoding: utf8,
  );
  expect(
    result.exitCode,
    0,
    reason:
        'Node helper execution failed for ${helper.sourcePath}: '
        '${result.stderr}',
  );

  return (jsonDecode(result.stdout as String) as List<dynamic>)
      .cast<Map<String, dynamic>>();
}

void _expectSafeRuntime(
  Map<String, dynamic> result, {
  required _HelperSpec helper,
  String? caseName,
}) {
  final reason = caseName == null
      ? helper.sourcePath
      : '${helper.sourcePath}: $caseName';
  expect(result['error'], isNull, reason: reason);
  expect(result['logAccesses'], 0, reason: reason);
  expect(result['storageAccesses'], 0, reason: reason);
  expect(result['cookieAccesses'], 0, reason: reason);
  expect(result['networkAccesses'], 0, reason: reason);
  expect(result['timerAccesses'], 0, reason: reason);
}

List<_InlineScript> _inlineScripts(String html) {
  return RegExp(
        r'<script\b([^>]*)>(.*?)</script>',
        caseSensitive: false,
        dotAll: true,
      )
      .allMatches(html)
      .map(
        (match) =>
            _InlineScript(attributes: match.group(1)!, source: match.group(2)!),
      )
      .toList(growable: false);
}

String _openingTag(String html, {required String tagName, required String id}) {
  final match = RegExp(
    '<$tagName\\b(?=[^>]*\\bid="$id")[^>]*>',
    caseSensitive: false,
    dotAll: true,
  ).firstMatch(html);
  expect(match, isNotNull, reason: 'Missing <$tagName> with id "$id".');
  return match!.group(0)!;
}

String _elementText(String html, {required String id}) {
  final match = RegExp(
    '<([a-z][a-z0-9]*)\\b(?=[^>]*\\bid="$id")[^>]*>(.*?)</\\1>',
    caseSensitive: false,
    dotAll: true,
  ).firstMatch(html);
  expect(match, isNotNull, reason: 'Missing element with id "$id".');
  return match!
      .group(2)!
      .replaceAll(RegExp(r'<[^>]+>'), '')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
}

String _titleText(String html) {
  final match = RegExp(
    r'<title>(.*?)</title>',
    caseSensitive: false,
    dotAll: true,
  ).firstMatch(html);
  expect(match, isNotNull, reason: 'Missing document title.');
  return match!.group(1)!.trim();
}

List<String> _anchorHrefs(String html) {
  return RegExp(
    r'<a\b[^>]*\bhref="([^"]+)"',
    caseSensitive: false,
    dotAll: true,
  ).allMatches(html).map((match) => match.group(1)!).toList(growable: false);
}

List<String> _linkTagsWithRelation(String html, {required String relation}) {
  return RegExp(r'<link\b[^>]*>', caseSensitive: false, dotAll: true)
      .allMatches(html)
      .map((match) => match.group(0)!)
      .where((tag) {
        final rel = _attributeValue(tag, name: 'rel');
        return rel
                ?.toLowerCase()
                .split(RegExp(r'\s+'))
                .contains(relation.toLowerCase()) ??
            false;
      })
      .toList(growable: false);
}

String? _attributeValue(String openingTag, {required String name}) {
  final match = RegExp(
    "\\b${RegExp.escape(name)}\\s*=\\s*(['\"])(.*?)\\1",
    caseSensitive: false,
    dotAll: true,
  ).firstMatch(openingTag);
  return match?.group(2);
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

class _HelperSpec {
  final String sourcePath;
  final String publicUrl;
  final String tokenlessPath;
  final String nativeButtonId;
  final String customSchemeBase;
  final String returnKind;
  final String validTitle;
  final String? statusIconId;
  final List<String> validVisibleFragments;

  const _HelperSpec({
    required this.sourcePath,
    required this.publicUrl,
    required this.tokenlessPath,
    required this.nativeButtonId,
    required this.customSchemeBase,
    required this.returnKind,
    required this.validTitle,
    this.statusIconId,
    required this.validVisibleFragments,
  });
}

class _InlineScript {
  final String attributes;
  final String source;

  const _InlineScript({required this.attributes, required this.source});
}

const String _nodeRuntimeHarness = r'''
const vm = require("node:vm");

const source = Buffer.from(process.argv[1], "base64").toString("utf8");
const payload = JSON.parse(
  Buffer.from(process.argv[2], "base64").toString("utf8"),
);

const results = payload.cases.map((testCase) => {
  const accesses = {
    logs: 0,
    storage: 0,
    cookies: 0,
    network: 0,
    timers: 0,
  };
  const calls = {
    assigned: [],
    replacements: [],
    order: [],
  };

  const guarded = (category, label) => () => {
    accesses[category] += 1;
    throw new Error(`Forbidden ${label} access.`);
  };

  const elements = {};
  for (const [id, text] of Object.entries(payload.textById)) {
    elements[id] = {
      id,
      textContent: text,
      hidden: false,
      disabled: false,
      listeners: {},
      addEventListener(type, listener) {
        this.listeners[type] ??= [];
        this.listeners[type].push(listener);
        calls.order.push(`addEventListener:${type}`);
      },
    };
  }

  const nativeButton = elements[payload.nativeButtonId];
  nativeButton.hidden = true;
  nativeButton.disabled = true;
  const webButton = elements[payload.webButtonId];
  webButton.hidden = true;
  webButton.disabled = true;
  const statusIcon = payload.statusIconId === undefined
    ? null
    : elements[payload.statusIconId];
  if (statusIcon !== null) {
    statusIcon.hidden = true;
  }

  let currentHref = testCase.href;
  const location = {
    get href() {
      return currentHref;
    },
    get pathname() {
      return new URL(currentHref).pathname;
    },
    assign(value) {
      calls.assigned.push(value);
      calls.order.push("assign");
    },
    replace: guarded("network", "location.replace"),
  };
  const history = {
    replaceState(state, title, url) {
      calls.replacements.push({state, title, url});
      calls.order.push("replaceState");
      currentHref = new URL(url, currentHref).href;
    },
  };
  const document = {
    title: payload.title,
    getElementById(id) {
      return elements[id] ?? null;
    },
  };
  Object.defineProperty(document, "cookie", {
    get: guarded("cookies", "document.cookie read"),
    set: guarded("cookies", "document.cookie write"),
  });

  const windowObject = {
    location,
    history,
    open: guarded("network", "window.open"),
  };
  const sandbox = {
    URL,
    window: windowObject,
    document,
    navigator: {
      sendBeacon: guarded("network", "navigator.sendBeacon"),
    },
    fetch: guarded("network", "fetch"),
    XMLHttpRequest: guarded("network", "XMLHttpRequest"),
    WebSocket: guarded("network", "WebSocket"),
    EventSource: guarded("network", "EventSource"),
    setTimeout: guarded("timers", "setTimeout"),
    setInterval: guarded("timers", "setInterval"),
    console: Object.fromEntries(
      ["log", "info", "warn", "error", "debug", "trace"].map((method) => [
        method,
        guarded("logs", `console.${method}`),
      ]),
    ),
  };

  for (const name of ["localStorage", "sessionStorage", "indexedDB"]) {
    const descriptor = {
      get: guarded("storage", name),
    };
    Object.defineProperty(windowObject, name, descriptor);
    Object.defineProperty(sandbox, name, descriptor);
  }

  let error = null;
  try {
    vm.runInNewContext(source, sandbox, {
      timeout: 1000,
      filename: "hosted-return-helper.js",
    });
  } catch (caught) {
    error = String(caught);
  }

  const assignedBeforeClick = [...calls.assigned];
  const clickButtonId = testCase.clickButtonId ?? (
    testCase.click === true ? payload.nativeButtonId : null
  );
  if (error === null && clickButtonId !== null) {
    const clickButton = elements[clickButtonId];
    const clickListeners = clickButton.listeners.click ?? [];
    try {
      for (const listener of clickListeners) {
        listener();
      }
    } catch (caught) {
      error = String(caught);
    }
  }

  return {
    name: testCase.name,
    error,
    nativeButtonHidden: nativeButton.hidden,
    nativeButtonDisabled: nativeButton.disabled,
    nativeListenerCount: (nativeButton.listeners.click ?? []).length,
    webButtonHidden: webButton.hidden,
    webButtonDisabled: webButton.disabled,
    webListenerCount: (webButton.listeners.click ?? []).length,
    statusIconHidden: statusIcon?.hidden ?? null,
    assignedBeforeClick,
    assigned: calls.assigned,
    replacements: calls.replacements,
    order: calls.order,
    cleanHref: currentHref,
    documentTitle: document.title,
    visibleText: Object.values(elements)
      .filter((element) => !element.hidden)
      .map((element) => element.textContent)
      .join("\n"),
    logAccesses: accesses.logs,
    storageAccesses: accesses.storage,
    cookieAccesses: accesses.cookies,
    networkAccesses: accesses.network,
    timerAccesses: accesses.timers,
  };
});

process.stdout.write(JSON.stringify(results));
''';
