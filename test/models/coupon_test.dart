import 'package:coupon_app/models/coupon.dart';
import 'package:coupon_app/models/restaurant.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('Coupon scheduling', () {
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

      expect(restaurant.validateRequiredFields(), 'Restaurant name is required.');
    });
  });
}
