import 'dart:io';

import 'package:coupon_app/models/coupon.dart';
import 'package:coupon_app/models/restaurant.dart';
import 'package:coupon_app/services/restaurant_account_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  Map<String, dynamic> projection({Object? publicVisible = true}) =>
      <String, dynamic>{
        'publicProjectionVersion':
            RestaurantAccountService.customerPublicProjectionVersion,
        'entityType': 'restaurant',
        'source': 'biteSaver',
        'sourceDocumentId': 'account-1',
        'indexDocumentId': 'index-account-1',
        'displayName': 'Restaurant',
        'streetAddress': '1 Main Street',
        'city': 'Inverness',
        'state': 'FL',
        'zipCode': '34450',
        'publicVisible': publicVisible,
      };

  test('coupon detail visibility honors the safe public projection', () async {
    final now = DateTime.now();
    final coupon = Coupon(
      id: 'coupon-1',
      title: 'Visible Coupon',
      restaurant: 'Restaurant',
      distance: '',
      expires: '',
      startTime: now.subtract(const Duration(hours: 1)),
      endTime: now.add(const Duration(hours: 1)),
      usageRule: 'Once per customer',
      isProximityOnly: false,
    );
    final restaurant = Restaurant(
      documentId: 'account-1',
      uid: 'owner-1',
      name: 'Restaurant',
      distance: '',
      city: 'Inverness',
      state: 'FL',
      zipCode: '34450',
      coupons: <Coupon>[coupon],
    );

    Future<bool> visibleFor(Map<String, dynamic> data) =>
        RestaurantAccountService.isCouponCustomerVisible(
          coupon,
          restaurant: restaurant,
          projectionDataLoader: (_) async => data,
        );

    expect(await visibleFor(projection()), isTrue);
    expect(await visibleFor(projection(publicVisible: false)), isFalse);
    expect(await visibleFor(projection(publicVisible: 'true')), isFalse);
  });

  test(
    'every current BiteSaver customer entry path uses the safe projection',
    () {
      final service = File(
        'lib/services/restaurant_account_service.dart',
      ).readAsStringSync();
      final profile = File(
        'lib/screens/restaurant_profile_screen.dart',
      ).readAsStringSync();
      final specials = File(
        'lib/screens/restaurant_specials_screen.dart',
      ).readAsStringSync();
      final deepLink = File(
        'lib/screens/restaurant_customer_deep_link_screen.dart',
      ).readAsStringSync();
      final couponDetail = File(
        'lib/screens/coupon_detail_screen.dart',
      ).readAsStringSync();
      final home = File('lib/screens/home_screen.dart').readAsStringSync();
      final menu = File(
        'lib/services/restaurant_menu_service.dart',
      ).readAsStringSync();

      final discoveryStart = service.indexOf(
        'static Future<List<Restaurant>> loadApprovedRestaurantsWithCoupons',
      );
      final discoveryEnd = service.indexOf(
        'static String canonicalAccountUidForAccountData',
        discoveryStart,
      );
      final discovery = service.substring(discoveryStart, discoveryEnd);
      expect(discovery, contains('_customerRestaurantProjectionQuery'));
      expect(
        discovery.indexOf('customerRestaurantFromProjectionData'),
        lessThan(discovery.indexOf('loadCoupons(accountDocumentId)')),
        reason: 'Invalid projections must be skipped before child reads.',
      );

      final resolutionStart = service.indexOf(
        'static Future<ResolvedRestaurantAccount?> '
        'resolveCustomerRestaurantAccount',
      );
      final resolutionEnd = service.indexOf(
        'static Future<bool> canPostCoupons',
        resolutionStart,
      );
      expect(
        service.substring(resolutionStart, resolutionEnd),
        contains('loadCustomerRestaurantProjectionById'),
      );
      expect(
        service.substring(resolutionStart, resolutionEnd),
        isNot(contains("collection('restaurant_accounts')")),
      );
      expect(profile, contains('loadCustomerRestaurantProjectionById'));
      expect(specials, contains('loadCustomerRestaurantProjectionById'));
      expect(deepLink, contains('resolveCustomerRestaurantAccount'));
      expect(
        deepLink,
        contains('isCustomerVisibleProjectionData(accountData)'),
      );
      expect(couponDetail, contains('isCouponCustomerVisible'));
      expect(couponDetail, contains('coupon.restaurantAccountId'));
      expect(home, contains('RestaurantAccountService.approvedAccountsStream'));
      expect(menu, contains('loadCustomerRestaurantProjectionById'));
      expect(profile, isNot(contains('loadAccountByDocumentId')));
      expect(specials, isNot(contains('loadAccountByDocumentId')));
      expect(
        couponDetail,
        isNot(contains('loadApprovedRestaurantsWithCoupons')),
      );
    },
  );
}
