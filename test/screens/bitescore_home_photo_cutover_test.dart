import 'package:coupon_app/models/bitescore_dish.dart';
import 'package:coupon_app/screens/bitescore_home_screen.dart';
import 'package:coupon_app/services/customer_bitescore_reads.dart';
import 'package:coupon_app/services/customer_bitescore_runtime.dart';
import 'package:flutter_test/flutter_test.dart';

import '../services/customer_bitescore_search_service_test.dart'
    show dishProjection, restaurantProjection;

void main() {
  tearDown(() => CustomerBiteScoreRuntime.testEnabled = null);

  test(
    'Home first-photo preflight uses safe exact-identity detail without source fallback',
    () async {
      CustomerBiteScoreRuntime.testEnabled = true;
      final calls = <String>[];
      final reads = CustomerBiteScoreReads(
        boundary: (name, request) async {
          calls.add(name);
          expect(request['id'], 'dish 内 space');
          return {
            'kind': 'dish',
            'dish': dishProjection('dish 内 space'),
            'restaurant': restaurantProjection('restaurant-1'),
            'isFavorite': false,
            'canManage': false,
          };
        },
      );
      final result = await BiteScoreHomeScreen.loadPhotoCandidate(
        'dish 内 space',
        reads: reads,
        legacyLoader: (_) async =>
            throw StateError('Raw source read is forbidden'),
      );
      expect(result?.id, 'dish 内 space');
      expect(calls, ['getCustomerBiteScoreDetail']);
    },
  );

  test('failed safe photo preflight never retries a raw read', () async {
    CustomerBiteScoreRuntime.testEnabled = true;
    var rawReads = 0;
    await expectLater(
      BiteScoreHomeScreen.loadPhotoCandidate(
        'dish',
        reads: CustomerBiteScoreReads(
          boundary: (_, _) async => throw StateError('Unavailable'),
        ),
        legacyLoader: (_) async {
          rawReads++;
          return null;
        },
      ),
      throwsStateError,
    );
    expect(rawReads, 0);
  });

  test(
    'current default retains its compatible legacy photo preflight',
    () async {
      const dish = BitescoreDish(
        id: 'dish',
        restaurantId: 'restaurant-1',
        restaurantName: 'Restaurant',
        name: 'Dish',
        normalizedName: 'dish',
      );
      var rawReads = 0;
      final result = await BiteScoreHomeScreen.loadPhotoCandidate(
        'dish',
        reads: CustomerBiteScoreReads(
          boundary: (_, _) async => throw StateError('Bounded mode is off'),
        ),
        legacyLoader: (id) async {
          rawReads++;
          expect(id, 'dish');
          return dish;
        },
      );
      expect(result, same(dish));
      expect(rawReads, 1);
    },
  );
}
