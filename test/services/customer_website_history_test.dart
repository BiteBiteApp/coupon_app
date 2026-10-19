import 'package:coupon_app/services/customer_website_routes.dart';
import 'package:coupon_app/screens/customer_website_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'same URL nested visits push, browser arrivals replace without losing Forward',
    () async {
      final calls = <MethodCall>[];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.navigation, (call) async {
            calls.add(call);
            return null;
          });
      addTearDown(
        () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(SystemChannels.navigation, null),
      );
      RouteInformation visit(String key) => RouteInformation(
        uri: Uri.parse('/browse/coupons'),
        state: {CustomerWebsiteLocation.stateKey: key},
      );
      final provider = CustomerWebsiteRouteInformationProvider(visit('home'));
      addTearDown(provider.dispose);
      provider.routerReportsNewRouteInformation(visit('home'));
      await Future<void>.delayed(Duration.zero);
      expect((calls.last.arguments as Map)['replace'], isTrue);
      provider.routerReportsNewRouteInformation(visit('restaurant'));
      await Future<void>.delayed(Duration.zero);
      expect((calls.last.arguments as Map)['replace'], isFalse);
      await provider.didPushRouteInformation(visit('home'));
      provider.routerReportsNewRouteInformation(visit('home'));
      await Future<void>.delayed(Duration.zero);
      expect((calls.last.arguments as Map)['replace'], isTrue);
      // Unknown/expired in-memory keys recover by replacing that browser entry.
      await provider.didPushRouteInformation(visit('expired'));
      provider.routerReportsNewRouteInformation(visit('home'));
      await Future<void>.delayed(Duration.zero);
      expect((calls.last.arguments as Map)['replace'], isTrue);
    },
  );
  test(
    'history sends exact encoded IDs and preserves Forward replacement semantics',
    () async {
      final calls = <MethodCall>[];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.navigation, (call) async {
            calls.add(call);
            return null;
          });
      addTearDown(
        () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(SystemChannels.navigation, null),
      );
      final home = RouteInformation(uri: Uri.parse('/'));
      final restaurant = RouteInformation(
        uri: Uri.parse('/r/coupons/permanent%252Fidentity'),
      );
      final provider = CustomerWebsiteRouteInformationProvider(home);
      addTearDown(provider.dispose);
      var arrivals = 0;
      provider.addListener(() => arrivals++);
      provider.routerReportsNewRouteInformation(restaurant);
      await Future<void>.delayed(Duration.zero);
      expect(calls.last.method, 'routeInformationUpdated');
      expect(calls.last.arguments, {
        'location': '/r/coupons/permanent%252Fidentity',
        'state': null,
        'replace': false,
      });
      // Browser Back changes the provider first. Reporting that same resulting
      // destination must replace, not push and discard the Forward entry.
      await provider.didPushRouteInformation(home);
      provider.routerReportsNewRouteInformation(home);
      await Future<void>.delayed(Duration.zero);
      expect((calls.last.arguments as Map)['replace'], isTrue);
      await provider.didPushRouteInformation(restaurant);
      provider.routerReportsNewRouteInformation(restaurant);
      await Future<void>.delayed(Duration.zero);
      expect(
        (calls.last.arguments as Map)['location'],
        restaurant.uri.toString(),
      );
      expect((calls.last.arguments as Map)['replace'], isTrue);
      expect(arrivals, 2);
    },
  );
}
