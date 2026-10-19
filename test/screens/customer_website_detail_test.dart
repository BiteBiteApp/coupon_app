import 'dart:async';
import 'package:coupon_app/screens/customer_website_detail_screen.dart';
import 'package:coupon_app/services/customer_website_routes.dart';
import 'package:coupon_app/services/customer_bitesaver_public_profile.dart';
import 'package:coupon_app/services/customer_bitesaver_service.dart';
import 'package:coupon_app/models/customer_bitesaver_search.dart';
import 'package:coupon_app/services/customer_bitescore_reads.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../customer_website_fixture/main.dart'
    show fixtureRestaurant, fixtureNow;
import '../customer_website_fixture/score_data.dart'
    show dishProjection, restaurantProjection;

CustomerBiteSaverPublicProfileResult page(List offers, {String? cursor}) =>
    CustomerBiteSaverPublicProfileResult.fromJson({
      'schemaVersion': 1,
      'kind': 'publicProfile',
      'state': 'available',
      'catalogRestaurantId': 'permanent%2Fid',
      'restaurant': fixtureRestaurant(profile: true)
        ..['offers'] = offers
        ..['usableOfferCount'] = offers.length + (cursor == null ? 0 : 1)
        ..['hasMoreOffers'] = cursor != null,
      'favoriteStates': [],
      'nextCursor': cursor,
      'hasMore': cursor != null,
      'partial': false,
    });
CustomerBiteSaverPublicProfile profile(
  CustomerBiteSaverPublicProfileResult initial,
  Future<CustomerBiteSaverPublicProfileResult> Function(String?) loader,
  VoidCallback disposed,
) => CustomerBiteSaverPublicProfile(
  CustomerBiteSaverService(
    transport: (_, _) async => throw StateError('No network'),
  ),
  initial,
  () async => (timeZone: 'America/New_York', utcOffsetMinutes: -240),
  loader,
  (_) => null,
  () => fixtureNow.millisecondsSinceEpoch,
  ChangeNotifier(),
  disposed,
);
void main() {
  testWidgets(
    'public coupon reload finds exact offer through bounded pages and disposes owner',
    (t) async {
      final offers = fixtureRestaurant(profile: true)['offers'] as List;
      var calls = 0;
      var disposed = false;
      final p = profile(page([offers.first], cursor: 'next'), (cursor) async {
        calls++;
        expect(cursor, 'next');
        return page([offers[1]]);
      }, () => disposed = true);
      final id = (offers[1] as Map)['offerId'] as String;
      await t.pumpWidget(
        MaterialApp(
          home: CustomerWebsiteDetailScreen(
            destination: CustomerWebsiteDetailRoute(
              'coupons',
              'permanent%2Fid',
              CustomerWebsiteDetailKind.offer,
              detailId: id,
            ),
            profileLoader: (id) async {
              expect(id, 'permanent%2Fid');
              return p;
            },
            testOfferBuilder: (profile, offer) =>
                Text('Resolved ${offer.offerId.value}'),
          ),
        ),
      );
      await t.pumpAndSettle();
      expect(find.text('Resolved $id'), findsOneWidget);
      expect(calls, 1);
      await t.pumpWidget(const SizedBox());
      expect(disposed, isTrue);
    },
  );
  testWidgets(
    'public coupon does not loop a nonprogressing cursor or show another offer',
    (t) async {
      final offers = fixtureRestaurant(profile: true)['offers'] as List;
      var calls = 0;
      final first = page([offers.first], cursor: 'same');
      final p = profile(first, (_) async {
        calls++;
        return first;
      }, () {});
      await t.pumpWidget(
        MaterialApp(
          home: CustomerWebsiteDetailScreen(
            destination: const CustomerWebsiteDetailRoute(
              'coupons',
              'permanent%2Fid',
              CustomerWebsiteDetailKind.offer,
              detailId: 'missing',
            ),
            profileLoader: (_) async => p,
            testOfferBuilder: (_, _) => const Text('WRONG OFFER'),
          ),
        ),
      );
      await t.pumpAndSettle();
      expect(calls, 1);
      expect(find.text('WRONG OFFER'), findsNothing);
      expect(find.textContaining('This page is not available'), findsOneWidget);
    },
  );
  testWidgets('dish reload rejects mismatched public restaurant parent', (
    t,
  ) async {
    final reads = CustomerBiteScoreReads(
      actorKey: () => 'guest',
      boundary: (_, _) async => {
        'kind': 'dish',
        'dish': dishProjection('dish'),
        'restaurant': restaurantProjection('restaurant-1'),
        'isFavorite': false,
        'canManage': false,
      },
    );
    await t.pumpWidget(
      MaterialApp(
        home: CustomerWebsiteDetailScreen(
          destination: const CustomerWebsiteDetailRoute(
            'bitescore',
            'other-parent',
            CustomerWebsiteDetailKind.dish,
            detailId: 'dish',
          ),
          biteScoreReads: reads,
        ),
      ),
    );
    await t.pumpAndSettle();
    expect(find.textContaining('This page is not available'), findsOneWidget);
  });
  testWidgets(
    'late public profile load is disposed after browser navigation leaves',
    (t) async {
      final deferred = Completer<CustomerBiteSaverPublicProfile>();
      var disposed = false;
      await t.pumpWidget(
        MaterialApp(
          home: CustomerWebsiteDetailScreen(
            destination: const CustomerWebsiteDetailRoute(
              'coupons',
              'permanent%2Fid',
              CustomerWebsiteDetailKind.menu,
            ),
            profileLoader: (_) => deferred.future,
          ),
        ),
      );
      await t.pump();
      await t.pumpWidget(const SizedBox());
      final p = profile(
        page(fixtureRestaurant()['offers'] as List),
        (_) async => page([]),
        () => disposed = true,
      );
      deferred.complete(p);
      await t.pumpAndSettle();
      expect(disposed, isTrue);
      expect(t.takeException(), isNull);
    },
  );
}
