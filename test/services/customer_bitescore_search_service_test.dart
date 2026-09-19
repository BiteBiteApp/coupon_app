import 'dart:async';

import 'package:coupon_app/models/customer_bitescore_search.dart';
import 'package:coupon_app/services/customer_bitescore_runtime.dart';
import 'package:coupon_app/services/customer_bitescore_search_service.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> dishProjection(String id) => {
  'customerPublicProjectionVersion':
      'bitestar.bitescore-customer-public-dish.v1',
  'source': 'biteScore',
  'entityType': 'dish',
  'sourceDocumentId': id,
  'restaurantSourceDocumentId': 'restaurant-1',
  'publicVisible': true,
  'displayName': 'Same Dish',
  'normalizedName': 'same dish',
  'restaurantDisplayName': 'Kitchen',
  'restaurantNormalizedName': 'kitchen',
  'restaurantCity': 'Orlando',
  'restaurantState': 'FL',
  'restaurantZipCode': '32801',
  'latitude': 28.5,
  'longitude': -81.3,
  'categoryTags': <String>[],
  'overallBiteScore': 80.0,
  'ratingCount': 3,
};

Map<String, dynamic> restaurantProjection(String id) => {
  'customerPublicProjectionVersion':
      'bitestar.bitescore-customer-public-restaurant.v1',
  'source': 'biteScore',
  'entityType': 'restaurant',
  'sourceDocumentId': id,
  'publicVisible': true,
  'displayName': 'Kitchen',
  'normalizedName': 'kitchen',
  'streetAddress': '1 Main St',
  'city': 'Orlando',
  'state': 'FL',
  'zipCode': '32801',
  'latitude': 28.5,
  'longitude': -81.3,
  'isClaimed': false,
  'cuisineTags': <String>[],
};

Map<String, dynamic> response({
  String session = 'session',
  String state = 'ready',
  List<Map<String, dynamic>> items = const [],
  String? cursor,
}) => {
  'schemaVersion': 1,
  'sessionId': session,
  'queryFingerprint': 'a' * 64,
  'state': state,
  'scannedCount': 70,
  'items': items,
  'nextCursor': cursor,
  'hasMore': cursor != null,
};

final class FakeSearchApi implements CustomerBiteScoreSearchApi {
  FakeSearchApi(this.handler);
  final Future<Map<String, dynamic>> Function(String, Map<String, Object?>)
  handler;
  final calls = <String>[];
  @override
  Future<Map<String, dynamic>> invoke(String name, Map<String, Object?> data) {
    calls.add(name);
    return handler(name, data);
  }
}

void main() {
  tearDown(() => CustomerBiteScoreRuntime.testEnabled = null);

  test('bounded customer mode is off by default', () {
    expect(CustomerBiteScoreRuntime.isEnabled, isFalse);
  });

  test(
    'DTO identity is exact and private source fields never enter models',
    () {
      final source = dishProjection('dish internal space')
        ..addAll({
          'id': 'wrong-display-id',
          'ownerUserId': 'private-owner',
          'createdByUserId': 'private-creator',
        });
      final entry = CustomerBiteScorePublicData.entry(source);
      expect(entry.dish.id, 'dish internal space');
      expect(entry.dish.createdByUserId, isNull);
      expect(entry.restaurant.ownerUserId, isNull);
      expect(
        () => CustomerBiteScorePublicData.entry({
          ...source,
          'publicVisible': false,
        }),
        throwsFormatException,
      );
      expect(
        () => CustomerBiteScorePublicData.entry(
          source,
          restaurantProjection: restaurantProjection('other-parent'),
        ),
        throwsFormatException,
      );
    },
  );

  test(
    'bounded preparation then append retains same-name canonical dishes',
    () async {
      var advances = 0;
      final api = FakeSearchApi((name, data) async {
        if (name.startsWith('start')) return response(state: 'preparing');
        if (name.startsWith('advance')) {
          advances++;
          return response(state: advances == 1 ? 'preparing' : 'ready');
        }
        return data['cursor'] == null
            ? response(items: [dishProjection('dish-a')], cursor: 'next')
            : response(
                items: [dishProjection('dish-a'), dishProjection('dish-b')],
              );
      });
      final controller = CustomerBiteScoreSearchController(
        api: api,
        criteria: customerBiteScoreDishCriteria(),
        delay: (_) async {},
      );
      addTearDown(controller.dispose);
      await controller.loadInitial();
      expect(advances, 2);
      expect(controller.entries.map((e) => e.dish.id), ['dish-a']);
      await controller.loadMore();
      expect(controller.entries.map((e) => e.dish.id), ['dish-a', 'dish-b']);
      expect(controller.hasMore, isFalse);
    },
  );

  test('criteria changes discard old first-page responses', () async {
    final delayed = Completer<Map<String, dynamic>>();
    var startCount = 0;
    final api = FakeSearchApi((name, data) async {
      if (name.startsWith('start')) {
        startCount++;
        return startCount == 1 ? delayed.future : response(session: 'new');
      }
      return response(session: 'new', items: [dishProjection('new')]);
    });
    final controller = CustomerBiteScoreSearchController(
      api: api,
      criteria: customerBiteScoreDishCriteria(),
    );
    addTearDown(controller.dispose);
    final old = controller.loadInitial();
    await controller.updateCriteria(customerBiteScoreDishCriteria(text: 'new'));
    delayed.complete(response(session: 'old'));
    await old;
    expect(controller.entries.single.dish.id, 'new');
    expect(api.calls.where((v) => v.startsWith('get')).length, 1);
  });

  test('stale append cannot join a newer query', () async {
    final delayed = Completer<Map<String, dynamic>>();
    var starts = 0;
    final api = FakeSearchApi((name, data) async {
      if (name.startsWith('start')) return response(session: 's${++starts}');
      if (data['cursor'] != null) return delayed.future;
      return response(
        session: 's$starts',
        items: [dishProjection('d$starts')],
        cursor: 'next',
      );
    });
    final controller = CustomerBiteScoreSearchController(
      api: api,
      criteria: customerBiteScoreDishCriteria(),
    );
    addTearDown(controller.dispose);
    await controller.loadInitial();
    final old = controller.loadMore();
    await controller.updateCriteria(
      customerBiteScoreDishCriteria(sort: 'Closest'),
    );
    delayed.complete(
      response(session: 's1', items: [dishProjection('old-page')]),
    );
    await old;
    expect(controller.entries.single.dish.id, 'd2');
  });

  test('actor replacement fences an in-flight response', () async {
    var actor = 'A';
    final delayed = Completer<Map<String, dynamic>>();
    final api = FakeSearchApi((_, _) => delayed.future);
    final controller = CustomerBiteScoreSearchController(
      api: api,
      criteria: customerBiteScoreDishCriteria(),
      actorKey: () => actor,
    );
    addTearDown(controller.dispose);
    final pending = controller.loadInitial();
    actor = 'B';
    delayed.complete(response(items: [dishProjection('private-stale')]));
    await pending;
    expect(controller.items, isEmpty);
    expect(api.calls, ['startCustomerBiteScoreSearch']);
  });

  test(
    'rejects cross-session and oversized pages without accepting rows',
    () async {
      for (final invalid in [
        response(session: 'different', items: [dishProjection('a')]),
        response(items: List.generate(26, (i) => dishProjection('$i'))),
      ]) {
        final api = FakeSearchApi(
          (name, _) async => name.startsWith('start') ? response() : invalid,
        );
        final controller = CustomerBiteScoreSearchController(
          api: api,
          criteria: customerBiteScoreDishCriteria(),
        );
        await controller.loadInitial();
        expect(controller.error, isFormatException);
        expect(controller.items, isEmpty);
        controller.dispose();
      }
    },
  );

  test(
    'transport failure is surfaced without invoking a raw-read fallback',
    () async {
      final api = FakeSearchApi(
        (_, _) async => throw StateError('unavailable'),
      );
      final controller = CustomerBiteScoreSearchController(
        api: api,
        criteria: customerBiteScoreDishCriteria(),
      );
      addTearDown(controller.dispose);
      await controller.loadInitial();
      expect(controller.error, isStateError);
      expect(controller.items, isEmpty);
      expect(api.calls, ['startCustomerBiteScoreSearch']);
    },
  );
}
