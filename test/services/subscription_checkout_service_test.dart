import 'dart:async';

import 'package:coupon_app/services/subscription_checkout_service.dart';
import 'package:flutter_test/flutter_test.dart';

const String _token = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq';

void main() {
  test(
    'checkout preparation uses production callable and protocol version 2',
    () async {
      String? callableName;
      Map<String, Object?>? payload;
      var launches = 0;
      final service = SubscriptionCheckoutService(
        invokeCallable: (name, request) async {
          callableName = name;
          payload = request;
          return <String, Object?>{
            'url': 'https://checkout.stripe.com/c/pay/synthetic',
            'returnToken': _token,
            'returnProtocolVersion': 2,
          };
        },
        launchExternalUrl: (_) async {
          launches += 1;
          return true;
        },
      );

      final prepared = await service.prepareSubscriptionCheckout(
        restaurantAccountDocumentId: 'account-a',
      );

      expect(callableName, 'createCheckoutSession');
      expect(payload, <String, Object?>{
        'returnProtocolVersion': 2,
        'restaurantAccountDocumentId': 'account-a',
      });
      expect(prepared.externalUrl.host, 'checkout.stripe.com');
      expect(prepared.returnToken, _token);
      expect(prepared.family, PreparedSubscriptionFamily.checkout);
      expect(prepared.returnProtocolVersion, 2);
      expect(launches, 0);
    },
  );

  test(
    'fragment-bearing Checkout URL is prepared and launched exactly',
    () async {
      const checkoutUrl =
          'https://checkout.stripe.com/c/pay/cs_test_synthetic'
          '#fidkdWxSyntheticOpaque_letters_123-%2F-%2B';
      var launches = 0;
      Uri? launchedUrl;
      final service = SubscriptionCheckoutService(
        invokeCallable: (name, request) async {
          expect(name, 'createCheckoutSession');
          expect(request, <String, Object?>{
            'returnProtocolVersion': 2,
            'restaurantAccountDocumentId': 'account-a',
          });
          return <String, Object?>{
            'url': checkoutUrl,
            'returnToken': _token,
            'returnProtocolVersion': 2,
          };
        },
        launchExternalUrl: (url) async {
          launches += 1;
          launchedUrl = url;
          return true;
        },
      );

      final prepared = await service.prepareSubscriptionCheckout(
        restaurantAccountDocumentId: 'account-a',
      );

      expect(launches, 0);
      expect(prepared.externalUrl.toString(), checkoutUrl);
      expect(prepared.returnToken, _token);
      expect(prepared.family, PreparedSubscriptionFamily.checkout);
      expect(prepared.returnProtocolVersion, 2);
      expect(
        await service.launchPreparedSubscriptionUrl(
          prepared,
          isCurrent: () => true,
        ),
        SubscriptionExternalLaunchResult.launched,
      );
      expect(launches, 1);
      expect(launchedUrl?.toString(), checkoutUrl);
    },
  );

  test('portal preparation is separate from launch', () async {
    var launches = 0;
    final service = SubscriptionCheckoutService(
      invokeCallable: (name, request) async {
        expect(name, 'createCustomerPortalSession');
        expect(request, <String, Object?>{
          'returnProtocolVersion': 2,
          'restaurantAccountDocumentId': 'account-a',
        });
        return <String, Object?>{
          'url': 'https://billing.stripe.com/p/session/synthetic',
          'returnToken': _token,
          'returnProtocolVersion': 2,
        };
      },
      launchExternalUrl: (_) async {
        launches += 1;
        return true;
      },
    );

    final prepared = await service.prepareCustomerPortal(
      restaurantAccountDocumentId: 'account-a',
    );

    expect(prepared.family, PreparedSubscriptionFamily.customerPortal);
    expect(launches, 0);
    expect(
      await service.launchPreparedSubscriptionUrl(
        prepared,
        isCurrent: () => true,
      ),
      SubscriptionExternalLaunchResult.launched,
    );
    expect(launches, 1);
  });

  test(
    'strict response parser rejects unknown, missing, and malformed fields',
    () async {
      final responses = <Map<String, Object?>>[
        <String, Object?>{
          'url': 'https://checkout.stripe.com/c/pay/synthetic',
          'returnToken': _token,
          'returnProtocolVersion': 2,
          'ownerUid': 'must-not-be-returned',
        },
        <String, Object?>{
          'url': 'https://checkout.stripe.com/c/pay/synthetic',
          'returnToken': _token,
        },
        <String, Object?>{
          'url': 'https://checkout.stripe.com/c/pay/synthetic',
          'returnToken': '$_token=',
          'returnProtocolVersion': 2,
        },
        <String, Object?>{
          'url': 'https://checkout.stripe.com/c/pay/synthetic',
          'returnToken': _token,
          'returnProtocolVersion': '2',
        },
        <String, Object?>{
          'url': 'https://example.test/not-stripe',
          'returnToken': _token,
          'returnProtocolVersion': 2,
        },
      ];

      for (final response in responses) {
        final service = SubscriptionCheckoutService(
          invokeCallable: (_, _) async => response,
          launchExternalUrl: (_) async => true,
        );
        await expectLater(
          service.prepareSubscriptionCheckout(
            restaurantAccountDocumentId: 'account-a',
          ),
          throwsStateError,
          reason: response.toString(),
        );
      }
    },
  );

  test(
    'family-specific validation rejects cross-family and Portal fragments',
    () async {
      Future<Map<String, Object?>> invoke(
        String _,
        Map<String, Object?> _,
      ) async => <String, Object?>{
        'url': 'https://billing.stripe.com/p/session/synthetic',
        'returnToken': _token,
        'returnProtocolVersion': 2,
      };
      final service = SubscriptionCheckoutService(
        invokeCallable: invoke,
        launchExternalUrl: (_) async => true,
      );

      await expectLater(
        service.prepareSubscriptionCheckout(
          restaurantAccountDocumentId: 'account-a',
        ),
        throwsStateError,
      );

      var portalLaunches = 0;
      final portalService = SubscriptionCheckoutService(
        invokeCallable: (_, _) async => <String, Object?>{
          'url': 'https://billing.stripe.com/p/session/synthetic#fragment',
          'returnToken': _token,
          'returnProtocolVersion': 2,
        },
        launchExternalUrl: (_) async {
          portalLaunches += 1;
          return true;
        },
      );
      await expectLater(
        portalService.prepareCustomerPortal(
          restaurantAccountDocumentId: 'account-a',
        ),
        throwsStateError,
      );
      expect(portalLaunches, 0);
    },
  );

  test(
    'invalid canonical document ID fails before callable invocation',
    () async {
      var calls = 0;
      final service = SubscriptionCheckoutService(
        invokeCallable: (_, _) async {
          calls += 1;
          throw UnimplementedError();
        },
        launchExternalUrl: (_) async => true,
      );
      await expectLater(
        service.prepareSubscriptionCheckout(
          restaurantAccountDocumentId: 'account/path',
        ),
        throwsStateError,
      );
      expect(calls, 0);
    },
  );

  test('Stripe URL accepts exactly 4096 and rejects 4097 characters', () async {
    const prefix = 'https://checkout.stripe.com/c/pay/synthetic#';
    Future<void> expectLength(int length, Matcher matcher) async {
      final url = '$prefix${'a' * (length - prefix.length)}';
      expect(url.length, length);
      final service = SubscriptionCheckoutService(
        invokeCallable: (_, _) async => <String, Object?>{
          'url': url,
          'returnToken': _token,
          'returnProtocolVersion': 2,
        },
        launchExternalUrl: (_) async => true,
      );
      await expectLater(
        service.prepareSubscriptionCheckout(
          restaurantAccountDocumentId: 'account-a',
        ),
        matcher,
      );
    }

    await expectLength(4096, completes);
    await expectLength(4097, throwsStateError);
  });

  test('Stripe URL rejects the adversarial URL matrix', () async {
    final urls = <String>[
      'https://checkout.stripe.com',
      'https://checkout.stripe.com/',
      'https://checkout.stripe.com#fragment',
      'https://checkout.stripe.com/#fragment',
      'https://checkout.stripe.com.evil.example/c/pay/x#fragment',
      'https://evil.example/c/pay/x#checkout.stripe.com',
      'https://user@checkout.stripe.com/c/pay/x#fragment',
      'https://checkout.stripe.com:444/c/pay/x#fragment',
      'https://checkout.stripe.com/c/pay/%ZZ',
      'https://checkout.stripe.com/c/pay/x#bad%ZZ',
      ' https://checkout.stripe.com/c/pay/x#fragment',
      'https://checkout.stripe.com/c/pay/x#fragment ',
      'https://checkout.stripe.com/c/pay/x#frag\nment',
      'http://checkout.stripe.com/c/pay/x#fragment',
      'javascript:alert(1)',
      'data:text/plain,hello',
      'file:///tmp/x',
      'bitesaver://subscription-success',
      'https://checkоut.stripe.com/c/pay/x#fragment',
      'https://xn--checkut-9qf.stripe.com/c/pay/x#fragment',
    ];
    for (final url in urls) {
      var launches = 0;
      final service = SubscriptionCheckoutService(
        invokeCallable: (_, _) async => <String, Object?>{
          'url': url,
          'returnToken': _token,
          'returnProtocolVersion': 2,
        },
        launchExternalUrl: (_) async {
          launches += 1;
          return true;
        },
      );
      await expectLater(
        service.prepareSubscriptionCheckout(
          restaurantAccountDocumentId: 'account-a',
        ),
        throwsA(
          isA<StateError>().having(
            (error) => error.message,
            'message',
            'Invalid external URL.',
          ),
        ),
        reason: url,
      );
      expect(launches, 0, reason: url);
    }
  });

  test(
    'launcher fences scope immediately before and after external launch',
    () async {
      final launchCompleter = Completer<bool>();
      var current = false;
      var launchCalls = 0;
      final service = SubscriptionCheckoutService(
        invokeCallable: (_, _) async => throw UnimplementedError(),
        launchExternalUrl: (_) {
          launchCalls += 1;
          return launchCompleter.future;
        },
      );
      final prepared = PreparedSubscriptionSession(
        externalUrl: Uri(
          scheme: 'https',
          host: 'checkout.stripe.com',
          path: '/c/pay/synthetic',
        ),
        returnToken: _token,
        family: PreparedSubscriptionFamily.checkout,
        returnProtocolVersion: 2,
      );

      expect(
        await service.launchPreparedSubscriptionUrl(
          prepared,
          isCurrent: () => current,
        ),
        SubscriptionExternalLaunchResult.notCurrent,
      );
      expect(launchCalls, 0);

      current = true;
      final pending = service.launchPreparedSubscriptionUrl(
        prepared,
        isCurrent: () => current,
      );
      expect(launchCalls, 1);
      current = false;
      launchCompleter.complete(true);
      expect(await pending, SubscriptionExternalLaunchResult.launchedStale);
    },
  );

  test(
    'launcher rejects forged prepared sessions before external launch',
    () async {
      var launchCalls = 0;
      final service = SubscriptionCheckoutService(
        invokeCallable: (_, _) async => throw UnimplementedError(),
        launchExternalUrl: (_) async {
          launchCalls += 1;
          return true;
        },
      );
      const validCheckoutUrl = 'https://checkout.stripe.com/c/pay/synthetic';
      const overlongPrefix =
          'https://checkout.stripe.com/c/pay/synthetic?data=';
      final cases = <PreparedSubscriptionSession>[
        PreparedSubscriptionSession(
          externalUrl: Uri.parse(
            'https://billing.stripe.com/p/session/cross-family',
          ),
          returnToken: _token,
          family: PreparedSubscriptionFamily.checkout,
          returnProtocolVersion: 2,
        ),
        PreparedSubscriptionSession(
          externalUrl: Uri.parse('https://example.test/not-stripe'),
          returnToken: _token,
          family: PreparedSubscriptionFamily.checkout,
          returnProtocolVersion: 2,
        ),
        PreparedSubscriptionSession(
          externalUrl: Uri.parse(
            '$overlongPrefix${'a' * (4097 - overlongPrefix.length)}',
          ),
          returnToken: _token,
          family: PreparedSubscriptionFamily.checkout,
          returnProtocolVersion: 2,
        ),
        PreparedSubscriptionSession(
          externalUrl: Uri.parse(validCheckoutUrl),
          returnToken: 'invalid-token',
          family: PreparedSubscriptionFamily.checkout,
          returnProtocolVersion: 2,
        ),
        PreparedSubscriptionSession(
          externalUrl: Uri.parse(validCheckoutUrl),
          returnToken: _token,
          family: PreparedSubscriptionFamily.checkout,
          returnProtocolVersion: 1,
        ),
      ];

      for (final prepared in cases) {
        expect(
          await service.launchPreparedSubscriptionUrl(
            prepared,
            isCurrent: () => true,
          ),
          SubscriptionExternalLaunchResult.failed,
          reason: prepared.externalUrl.toString(),
        );
      }
      expect(launchCalls, 0);
    },
  );

  test(
    'launcher returns controlled failure without altering prepared URL',
    () async {
      Uri? launchedUrl;
      final service = SubscriptionCheckoutService(
        invokeCallable: (_, _) async => throw UnimplementedError(),
        launchExternalUrl: (url) async {
          launchedUrl = url;
          return false;
        },
      );
      final prepared = PreparedSubscriptionSession(
        externalUrl: Uri(
          scheme: 'https',
          host: 'checkout.stripe.com',
          path: '/c/pay/exact',
          query: 'synthetic=1',
        ),
        returnToken: _token,
        family: PreparedSubscriptionFamily.checkout,
        returnProtocolVersion: 2,
      );

      expect(
        await service.launchPreparedSubscriptionUrl(
          prepared,
          isCurrent: () => true,
        ),
        SubscriptionExternalLaunchResult.failed,
      );
      expect(launchedUrl, prepared.externalUrl);
    },
  );
}
