import 'package:coupon_app/models/coupon.dart';
import 'package:coupon_app/models/restaurant.dart';
import 'package:coupon_app/services/restaurant_account_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('Coupon scheduling', () {
    final visibleCoupon = Coupon(
      id: 'visible',
      restaurant: 'BiteSaver Test',
      title: 'Lunch Special',
      distance: '1 mile away',
      startTime: DateTime(2026, 3, 27, 9),
      endTime: DateTime(2026, 3, 27, 18),
      usageRule: 'Once per customer',
      details: 'Valid for lunch only.',
    );

    Map<String, dynamic> accountData({
      String approvalStatus = 'approved',
      String subscriptionStatus = 'active',
      DateTime? trialEndsAt,
    }) {
      return {
        Restaurant.fieldApprovalStatus: approvalStatus,
        'subscriptionStatus': subscriptionStatus,
        'trialEndsAt': trialEndsAt,
      };
    }

    test('coupon is active within its structured time window', () {
      final now = DateTime(2026, 3, 27, 12);
      final coupon = Coupon(
        id: 'active',
        restaurant: 'BiteSaver Test',
        title: 'Lunch Special',
        distance: '1 mile away',
        startTime: DateTime(2026, 3, 27, 9),
        endTime: DateTime(2026, 3, 27, 18),
        usageRule: 'Once per customer',
        details: 'Valid for lunch only.',
      );

      expect(coupon.isActiveAt(now), isTrue);
      expect(coupon.isScheduledForFutureAt(now), isFalse);
      expect(coupon.isExpiredAt(now), isFalse);
    });

    test('coupon validation requires title description and times', () {
      final coupon = Coupon(
        id: 'invalid',
        restaurant: 'BiteSaver Test',
        title: '',
        distance: '1 mile away',
        usageRule: 'Once per customer',
        details: '',
      );

      expect(coupon.validateForSave(), 'Coupon title is required.');
    });

    test('coupon validation enforces end time after start time', () {
      final coupon = Coupon(
        id: 'invalid-time',
        restaurant: 'BiteSaver Test',
        title: 'Dinner Special',
        distance: '1 mile away',
        startTime: DateTime(2026, 3, 27, 18),
        endTime: DateTime(2026, 3, 27, 18),
        usageRule: 'Once per customer',
        details: 'Valid for dinner only.',
      );

      expect(
        coupon.validateForSave(),
        'Coupon end time must be after the start time.',
      );
    });

    test('coupon is hidden before start time', () {
      final now = DateTime(2026, 3, 27, 12);
      final coupon = Coupon(
        id: 'future',
        restaurant: 'BiteSaver Test',
        title: 'Dinner Special',
        distance: '1 mile away',
        startTime: DateTime(2026, 3, 27, 18),
        endTime: DateTime(2026, 3, 27, 22),
        usageRule: 'Once per customer',
        details: 'Valid after 6 PM.',
      );

      expect(coupon.isActiveAt(now), isFalse);
      expect(coupon.isScheduledForFutureAt(now), isTrue);
    });

    test('coupon is expired after end time', () {
      final now = DateTime(2026, 3, 27, 12);
      final coupon = Coupon(
        id: 'expired',
        restaurant: 'BiteSaver Test',
        title: 'Breakfast Special',
        distance: '1 mile away',
        startTime: DateTime(2026, 3, 27, 6),
        endTime: DateTime(2026, 3, 27, 10),
        usageRule: 'Once per customer',
        details: 'Valid before 10 AM.',
      );

      expect(coupon.isActiveAt(now), isFalse);
      expect(coupon.isExpiredAt(now), isTrue);
    });

    test('legacy expires text still displays safely', () {
      final coupon = Coupon(
        id: 'legacy',
        restaurant: 'BiteSaver Test',
        title: 'Legacy Coupon',
        distance: '1 mile away',
        expires: 'Expires tomorrow',
        usageRule: 'Once per customer',
      );

      expect(coupon.expires, 'Expires tomorrow');
      expect(coupon.isActiveAt(DateTime(2026, 3, 27, 12)), isTrue);
    });

    test('coupon number formatting keeps exactly four digits', () {
      expect(Coupon.formatCouponNumber('47'), '0047');
      expect(Coupon.formatCouponNumber('0047'), '0047');
      expect(Coupon.formatCouponNumber('9999'), '9999');
      expect(Coupon.formatCouponNumber('10000'), isNull);
      expect(Coupon.formatCouponNumber('abcd'), isNull);
    });

    test('coupon number is persisted in firestore maps', () {
      final coupon = Coupon(
        id: 'numbered',
        restaurant: 'BiteSaver Test',
        title: 'Numbered Coupon',
        distance: '1 mile away',
        startTime: DateTime(2026, 3, 27, 9),
        endTime: DateTime(2026, 3, 27, 18),
        usageRule: 'Unlimited',
        couponNumber: '47',
      );

      final map = coupon.toFirestoreMap(id: 'numbered');

      expect(map[Coupon.fieldCouponNumber], '0047');
    });

    test(
      'coupon number parses from string or int and old coupons are safe',
      () {
        final stringCoupon = Coupon.tryFromFirestore({
          Coupon.fieldRestaurant: 'BiteSaver Test',
          Coupon.fieldTitle: 'String Coupon',
          Coupon.fieldDistance: '1 mile away',
          Coupon.fieldExpires: 'Expires tomorrow',
          Coupon.fieldUsageRule: 'Unlimited',
          Coupon.fieldCouponNumber: '0047',
        }, fallbackId: 'string');
        final intCoupon = Coupon.tryFromFirestore({
          Coupon.fieldRestaurant: 'BiteSaver Test',
          Coupon.fieldTitle: 'Int Coupon',
          Coupon.fieldDistance: '1 mile away',
          Coupon.fieldExpires: 'Expires tomorrow',
          Coupon.fieldUsageRule: 'Unlimited',
          Coupon.fieldCouponNumber: 47,
        }, fallbackId: 'int');
        final oldCoupon = Coupon.tryFromFirestore({
          Coupon.fieldRestaurant: 'BiteSaver Test',
          Coupon.fieldTitle: 'Old Coupon',
          Coupon.fieldDistance: '1 mile away',
          Coupon.fieldExpires: 'Expires tomorrow',
          Coupon.fieldUsageRule: 'Unlimited',
        }, fallbackId: 'old');

        expect(stringCoupon?.formattedCouponNumber, '0047');
        expect(intCoupon?.formattedCouponNumber, '0047');
        expect(oldCoupon?.formattedCouponNumber, isNull);
      },
    );

    test(
      'stable coupon number generation is deterministic and four digits',
      () {
        final first = RestaurantAccountService.stableCouponNumberForId(
          'coupon-doc-1',
        );
        final second = RestaurantAccountService.stableCouponNumberForId(
          'coupon-doc-1',
        );

        expect(second, first);
        expect(first, matches(RegExp(r'^\d{4}$')));
      },
    );

    test('stable coupon number generation probes past reserved numbers', () {
      final first = RestaurantAccountService.stableCouponNumberForId(
        'coupon-doc-1',
      );
      final next = RestaurantAccountService.stableCouponNumberForId(
        'coupon-doc-1',
        reservedNumbers: {first},
      );

      expect(next, isNot(first));
      expect(next, matches(RegExp(r'^\d{4}$')));
    });

    test('stable coupon number generation stops after max attempts', () {
      final first = RestaurantAccountService.stableCouponNumberForId(
        'coupon-doc-1',
        maxAttempts: 1,
      );

      expect(
        () => RestaurantAccountService.stableCouponNumberForId(
          'coupon-doc-1',
          reservedNumbers: {first},
          maxAttempts: 1,
        ),
        throwsA(isA<StateError>()),
      );
    });

    test('same coupon number can be generated for separate restaurants', () {
      final restaurantAReservedNumbers = <String>{};
      final restaurantBReservedNumbers = <String>{};

      final first = RestaurantAccountService.stableCouponNumberForId(
        'coupon-doc-1',
        reservedNumbers: restaurantAReservedNumbers,
      );
      final second = RestaurantAccountService.stableCouponNumberForId(
        'coupon-doc-1',
        reservedNumbers: restaurantBReservedNumbers,
      );

      expect(second, first);
    });

    test('coupon number candidates are four digits and range checked', () {
      expect(
        RestaurantAccountService.couponNumberCandidateForId(
          'coupon-doc-1',
          attempt: 0,
        ),
        matches(RegExp(r'^\d{4}$')),
      );
      expect(
        () => RestaurantAccountService.couponNumberCandidateForId(
          'coupon-doc-1',
          attempt: -1,
        ),
        throwsRangeError,
      );
      expect(
        () => RestaurantAccountService.couponNumberCandidateForId(
          'coupon-doc-1',
          attempt: RestaurantAccountService.maxCouponNumberGenerationAttempts,
        ),
        throwsRangeError,
      );
    });

    test('manual coupon code comparison is trimmed and case-insensitive', () {
      expect(
        RestaurantAccountService.normalizedCouponCodeForComparison(' joe50 '),
        'JOE50',
      );
      expect(
        RestaurantAccountService.normalizedCouponCodeForComparison('JOE50'),
        'JOE50',
      );
      expect(
        RestaurantAccountService.normalizedCouponCodeForComparison('   '),
        isNull,
      );
    });

    test('customer-visible coupons require an active subscription', () {
      final coupons = [visibleCoupon];

      expect(
        RestaurantAccountService.customerVisibleCouponsForAccountData(
          accountData(),
          coupons,
        ),
        coupons,
      );
      expect(
        RestaurantAccountService.customerVisibleCouponsForAccountData(
          accountData(subscriptionStatus: 'inactive'),
          coupons,
        ),
        isEmpty,
      );
      expect(
        RestaurantAccountService.customerVisibleCouponsForAccountData(
          accountData(subscriptionStatus: 'canceled'),
          coupons,
        ),
        isEmpty,
      );
    });

    test(
      'customer-visible coupons allow current trials but not expired trials',
      () {
        final coupons = [visibleCoupon];

        expect(
          RestaurantAccountService.customerVisibleCouponsForAccountData(
            accountData(
              subscriptionStatus: 'trialing',
              trialEndsAt: DateTime.now().add(const Duration(days: 1)),
            ),
            coupons,
          ),
          coupons,
        );
        expect(
          RestaurantAccountService.customerVisibleCouponsForAccountData(
            accountData(
              subscriptionStatus: 'trialing',
              trialEndsAt: DateTime.now().subtract(const Duration(days: 1)),
            ),
            coupons,
          ),
          isEmpty,
        );
      },
    );

    test('canonical restaurant account UID uses stored uid when present', () {
      final uid = RestaurantAccountService.canonicalAccountUidForAccountData({
        Restaurant.fieldUid: 'owner-uid-123',
        Restaurant.fieldName: 'BiteSaver Test',
      }, fallbackUid: 'restaurant-account-doc');

      expect(uid, 'owner-uid-123');
    });

    test('canonical restaurant account UID falls back to document id', () {
      final uid = RestaurantAccountService.canonicalAccountUidForAccountData({
        Restaurant.fieldName: 'BiteSaver Test',
      }, fallbackUid: 'restaurant-account-doc');

      expect(uid, 'restaurant-account-doc');
    });
  });

  group('Restaurant validation', () {
    test('restaurant requires name distance city and zip', () {
      final restaurant = Restaurant(
        name: '',
        distance: '',
        city: '',
        zipCode: '',
        coupons: const [],
      );

      expect(
        restaurant.validateRequiredFields(),
        'Restaurant name is required.',
      );
    });
  });
}
