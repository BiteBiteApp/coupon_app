import 'package:coupon_app/services/customer_website_routes.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'public nested destinations preserve permanent identity exactly once',
    () {
      for (final side in ['coupons', 'bitescore']) {
        final kinds = side == 'coupons'
            ? [CustomerWebsiteDetailKind.menu, CustomerWebsiteDetailKind.offer]
            : [
                CustomerWebsiteDetailKind.menu,
                CustomerWebsiteDetailKind.dish,
                CustomerWebsiteDetailKind.reviews,
              ];
        for (final kind in kinds) {
          final route = CustomerWebsiteDetailRoute(
            side,
            'permanent%2Fid',
            kind,
            detailId: 'detail%2Fid',
          );
          final parsed = CustomerWebsiteDetailRoute.parse(route.location)!;
          expect(parsed.restaurantId, 'permanent%2Fid');
          expect(parsed.kind, kind);
          if (kind != CustomerWebsiteDetailKind.menu) {
            expect(parsed.detailId, 'detail%2Fid');
          }
          expect(parsed.location, route.location);
        }
      }
    },
  );
  test('unsupported nested paths never become another customer page', () {
    for (final value in [
      '/invite/coupon/token/menu',
      '/r/coupons/id/dish/d',
      '/r/bitescore/id/offer/o',
      '/r/coupons/id/menu/extra',
      '/r/bitescore/id/dish/d/owner',
      '/r/coupons/id/offer/',
      '/r/coupons/%2F/menu',
      'https://evil.invalid/r/coupons/id/menu',
      '/r/coupons/id/menu?token=x',
    ]) {
      expect(CustomerWebsiteDetailRoute.parse(value), isNull, reason: value);
    }
  });
}
