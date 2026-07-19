import 'package:coupon_app/services/restaurant_customer_link_service.dart';
import 'package:coupon_app/services/restaurant_invite_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('RestaurantCustomerLinkService', () {
    test(
      'builds coupon customer restaurant URLs on canonical BiteStar host',
      () {
        expect(
          RestaurantCustomerLinkService.couponRestaurantUrl('restaurant123'),
          'https://go.bitestar.app/r/coupons/restaurant123',
        );
      },
    );

    test(
      'builds BiteScore customer restaurant URLs on canonical BiteStar host',
      () {
        expect(
          RestaurantCustomerLinkService.biteScoreRestaurantUrl(
            'bitescore_restaurant_123',
          ),
          'https://go.bitestar.app/r/bitescore/bitescore_restaurant_123',
        );
      },
    );

    test('generated coupon customer URLs parse back to coupon deep links', () {
      final url = RestaurantCustomerLinkService.couponRestaurantUrl(
        'restaurant123',
      );
      final link = RestaurantCustomerLinkService.parseRestaurantDeepLink(
        Uri.parse(url),
      );

      expect(link, isNotNull);
      expect(link!.side, 'coupons');
      expect(link.restaurantId, 'restaurant123');
      expect(link.isCoupon, isTrue);
    });

    test(
      'generated BiteScore customer URLs parse back to BiteScore deep links',
      () {
        final url = RestaurantCustomerLinkService.biteScoreRestaurantUrl(
          'bitescore_restaurant_123',
        );
        final link = RestaurantCustomerLinkService.parseRestaurantDeepLink(
          Uri.parse(url),
        );

        expect(link, isNotNull);
        expect(link!.side, 'bitescore');
        expect(link.restaurantId, 'bitescore_restaurant_123');
        expect(link.isBiteScore, isTrue);
      },
    );

    test('customer URL builders path-encode restaurant IDs', () {
      final url = RestaurantCustomerLinkService.couponRestaurantUrl(
        'restaurant 123',
      );

      expect(url, 'https://go.bitestar.app/r/coupons/restaurant%20123');

      final link = RestaurantCustomerLinkService.parseRestaurantDeepLink(
        Uri.parse(url),
      );
      expect(link, isNotNull);
      expect(link!.restaurantId, 'restaurant 123');
    });

    test('customer URL builders reject empty restaurant IDs', () {
      expect(
        () => RestaurantCustomerLinkService.couponRestaurantUrl(''),
        throwsArgumentError,
      );
      expect(
        () => RestaurantCustomerLinkService.biteScoreRestaurantUrl('  '),
        throwsArgumentError,
      );
    });

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

    test('parses HTTPS coupon restaurant links on trusted QR hosts', () {
      const trustedHosts = [
        'go.bitestar.app',
        'app.bitestar.app',
        'go.biteranger.com',
        'app.biteranger.com',
        'go.colesmartllc.com',
        'app.colesmartllc.com',
        'colesmartllc.com',
        'www.colesmartllc.com',
      ];

      for (final host in trustedHosts) {
        final link = RestaurantCustomerLinkService.parseRestaurantDeepLink(
          Uri.parse('https://$host/r/coupons/test-restaurant-id'),
        );

        expect(link, isNotNull, reason: host);
        expect(link!.side, 'coupons', reason: host);
        expect(link.restaurantId, 'test-restaurant-id', reason: host);
      }
    });

    test('parses HTTPS BiteScore restaurant links on trusted QR hosts', () {
      const trustedHosts = [
        'go.bitestar.app',
        'app.bitestar.app',
        'go.biteranger.com',
        'app.biteranger.com',
        'go.colesmartllc.com',
        'app.colesmartllc.com',
        'colesmartllc.com',
        'www.colesmartllc.com',
      ];

      for (final host in trustedHosts) {
        final link = RestaurantCustomerLinkService.parseRestaurantDeepLink(
          Uri.parse('https://$host/r/bitescore/test-restaurant-id'),
        );

        expect(link, isNotNull, reason: host);
        expect(link!.side, 'bitescore', reason: host);
        expect(link.restaurantId, 'test-restaurant-id', reason: host);
      }
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

    test(
      'ignores BiteScore invite links so invite parsing remains separate',
      () {
        final uri = Uri.parse('bitesaver://invite/bitescore/token123');

        expect(
          RestaurantCustomerLinkService.parseRestaurantDeepLink(uri),
          isNull,
        );
        expect(RestaurantInviteService.parseInviteDeepLink(uri), isNotNull);
      },
    );

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

    test('ignores restaurant HTTPS links on untrusted hosts', () {
      final link = RestaurantCustomerLinkService.parseRestaurantDeepLink(
        Uri.parse('https://evil.com/r/coupons/test-restaurant-id'),
      );

      expect(link, isNull);
    });

    test('ignores random HTTPS paths on colesmartllc.com', () {
      final link = RestaurantCustomerLinkService.parseRestaurantDeepLink(
        Uri.parse('https://colesmartllc.com/random/path'),
      );

      expect(link, isNull);
    });

    test('ignores plain HTTP restaurant links on colesmartllc.com', () {
      final link = RestaurantCustomerLinkService.parseRestaurantDeepLink(
        Uri.parse('http://colesmartllc.com/r/coupons/test-restaurant-id'),
      );

      expect(link, isNull);
    });
  });
}
