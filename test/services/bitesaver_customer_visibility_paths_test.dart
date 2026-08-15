import 'dart:io';

import 'package:coupon_app/models/coupon.dart';
import 'package:coupon_app/models/restaurant.dart';
import 'package:coupon_app/services/restaurant_account_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  Map<String, dynamic> account({
    bool postingEnabled = true,
    Object? adminHidden,
  }) => <String, dynamic>{
    Restaurant.fieldApprovalStatus: 'approved',
    'couponPostingEnabled': postingEnabled,
    'adminHidden': ?adminHidden,
  };

  test(
    'coupon detail visibility honors Admin veto and publication access',
    () async {
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
            accountDataLoader: (_) async => data,
          );

      expect(await visibleFor(account()), isTrue);
      expect(await visibleFor(account(adminHidden: false)), isTrue);
      expect(await visibleFor(account(adminHidden: true)), isFalse);
      expect(await visibleFor(account(postingEnabled: false)), isFalse);
    },
  );

  test(
    'every current BiteSaver customer entry path applies the visibility veto',
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

      final discoveryStart = service.indexOf(
        'static Future<List<Restaurant>> loadApprovedRestaurantsWithCoupons',
      );
      final discoveryEnd = service.indexOf(
        'static ResolvedRestaurantAccount?',
        discoveryStart,
      );
      final discovery = service.substring(discoveryStart, discoveryEnd);
      expect(discovery, contains('isCustomerVisibleAccountData'));
      expect(
        discovery.indexOf('isCustomerVisibleAccountData'),
        lessThan(discovery.indexOf('loadCoupons(doc.id)')),
        reason: 'Hidden accounts must be skipped before child reads.',
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
        contains('isCustomerVisibleAccountData'),
      );
      expect(profile, contains('isCustomerVisibleAccountData'));
      expect(specials, contains('isCustomerVisibleAccountData'));
      expect(deepLink, contains('resolveCustomerRestaurantAccount'));
      expect(deepLink, contains('isCustomerVisibleAccountData(accountData)'));
      expect(couponDetail, contains('isCouponCustomerVisible'));
    },
  );
}
