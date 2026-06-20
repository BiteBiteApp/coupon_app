import 'package:coupon_app/services/restaurant_customer_link_service.dart';
import 'package:coupon_app/services/restaurant_invite_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('RestaurantCustomerLinkService', () {
    test('parses double-slash coupon restaurant links', () {
      final link = RestaurantCustomerLinkService.parseRestaurantDeepLink(
        Uri.parse('bitesaver://r/coupons/restaurant123'),
      );

      expect(link, isNotNull);
      expect(link!.side, 'coupons');
      expect(link.restaurantId, 'restaurant123');
      expect(link.isCoupon, isTrue);
    });

    test('parses triple-slash coupon restaurant links', () {
      final link = RestaurantCustomerLinkService.parseRestaurantDeepLink(
        Uri.parse('bitesaver:///r/coupons/restaurant123'),
      );

      expect(link, isNotNull);
      expect(link!.side, 'coupons');
      expect(link.restaurantId, 'restaurant123');
    });

    test('parses double-slash BiteScore restaurant links', () {
      final link = RestaurantCustomerLinkService.parseRestaurantDeepLink(
        Uri.parse('bitesaver://r/bitescore/bitescore_restaurant_123'),
      );

      expect(link, isNotNull);
      expect(link!.side, 'bitescore');
      expect(link.restaurantId, 'bitescore_restaurant_123');
      expect(link.isBiteScore, isTrue);
    });

    test('parses triple-slash BiteScore restaurant links', () {
      final link = RestaurantCustomerLinkService.parseRestaurantDeepLink(
        Uri.parse('bitesaver:///r/bitescore/bitescore_restaurant_123'),
      );

      expect(link, isNotNull);
      expect(link!.side, 'bitescore');
      expect(link.restaurantId, 'bitescore_restaurant_123');
    });

    test('decodes encoded restaurant IDs', () {
      final link = RestaurantCustomerLinkService.parseRestaurantDeepLink(
        Uri.parse('bitesaver://r/coupons/restaurant%20123'),
      );

      expect(link, isNotNull);
      expect(link!.restaurantId, 'restaurant 123');
    });

    test('parses startup route name without r host segment', () {
      final link = RestaurantCustomerLinkService.parseRestaurantRouteName(
        '/coupons/restaurant123',
      );

      expect(link, isNotNull);
      expect(link!.side, 'coupons');
      expect(link.restaurantId, 'restaurant123');
    });

    test('parses startup route name with explicit r segment', () {
      final link = RestaurantCustomerLinkService.parseRestaurantRouteName(
        '/r/bitescore/restaurant123',
      );

      expect(link, isNotNull);
      expect(link!.side, 'bitescore');
      expect(link.restaurantId, 'restaurant123');
    });

    test('parses double-slash BiteScore startup route name', () {
      final link = RestaurantCustomerLinkService.parseRestaurantRouteName(
        '/bitescore/restaurant123',
      );

      expect(link, isNotNull);
      expect(link!.side, 'bitescore');
      expect(link.restaurantId, 'restaurant123');
    });

    test('ignores invite links so invite parsing remains separate', () {
      final uri = Uri.parse('bitesaver://invite/coupon/token123');

      expect(
        RestaurantCustomerLinkService.parseRestaurantDeepLink(uri),
        isNull,
      );
      expect(RestaurantInviteService.parseInviteDeepLink(uri), isNotNull);
    });

    test('ignores subscription links', () {
      expect(
        RestaurantCustomerLinkService.parseRestaurantDeepLink(
          Uri.parse('bitesaver://subscription-success'),
        ),
        isNull,
      );
      expect(
        RestaurantCustomerLinkService.parseRestaurantDeepLink(
          Uri.parse('bitesaver://subscription-cancel'),
        ),
        isNull,
      );
    });

    test('ignores unsupported restaurant link sides', () {
      final link = RestaurantCustomerLinkService.parseRestaurantDeepLink(
        Uri.parse('bitesaver://r/menus/restaurant123'),
      );

      expect(link, isNull);
    });
  });
}
