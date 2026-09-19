import 'dart:async';

import 'package:coupon_app/services/customer_bitescore_suggestions.dart';
import 'package:flutter_test/flutter_test.dart';

import 'customer_bitescore_search_service_test.dart'
    show FakeSearchApi, dishProjection;

Map<String, dynamic> result(
  String kind, {
  String state = 'ready',
  List<Object?> items = const [],
  String? cursor,
}) => {
  'schemaVersion': 1,
  'kind': kind,
  'state': state,
  'items': items,
  'nextCursor': cursor,
};

void main() {
  test(
    'catalog preparation returns only final globally ranked preview',
    () async {
      final requests = <Map<String, Object?>>[];
      final api = FakeSearchApi((name, request) async {
        expect(name, 'getCustomerBiteScoreSuggestions');
        requests.add(request);
        if (requests.length == 1) {
          return result('catalog', state: 'preparing', cursor: 'opaque');
        }
        expect(request['cursor'], 'opaque');
        return result(
          'catalog',
          items: [
            {
              'canonicalName': 'Pizza',
              'aliases': ['pie'],
            },
          ],
        );
      });
      final service = CustomerBiteScoreSuggestionsService(
        api: api,
        delay: (_) async {},
      );
      final suggestions = await service.catalog('pizza');
      expect(suggestions.single.canonicalName, 'Pizza');
      expect(requests[0]['clientInstanceId'], requests[1]['clientInstanceId']);
      expect(requests[0]['clientRequestId'], requests[1]['clientRequestId']);
      expect(requests[0]['queryGeneration'], requests[1]['queryGeneration']);
    },
  );

  test('new query and auth realm retire stale suggestion responses', () async {
    final pending = Completer<Map<String, dynamic>>();
    var actor = 'user:A';
    final api = FakeSearchApi((_, request) {
      if (request['query'] == 'old') return pending.future;
      return Future.value(result('catalog'));
    });
    final service = CustomerBiteScoreSuggestionsService(
      api: api,
      actorKey: () => actor,
    );
    final stale = service.catalog('old');
    final assertion = expectLater(stale, throwsStateError);
    await service.catalog('new');
    pending.complete(result('catalog'));
    await assertion;
    final later = Completer<Map<String, dynamic>>();
    final other = CustomerBiteScoreSuggestionsService(
      api: FakeSearchApi((_, _) => later.future),
      actorKey: () => actor,
    );
    final staleActor = other.catalog('pizza');
    final actorAssertion = expectLater(staleActor, throwsStateError);
    actor = 'user:B';
    later.complete(result('catalog'));
    await actorAssertion;
  });

  test('similar preview retains distinct IDs for same-name dishes', () async {
    final service = CustomerBiteScoreSuggestionsService(
      api: FakeSearchApi(
        (_, _) async => result(
          'similar',
          items: [dishProjection('a'), dishProjection('b')],
        ),
      ),
    );
    final dishes = await service.similar(
      restaurantId: 'restaurant-1',
      dishName: 'Same Dish',
    );
    expect(dishes.map((dish) => dish.id), ['a', 'b']);
    expect(dishes.map((dish) => dish.name).toSet().length, 1);
    await expectLater(
      service.similar(restaurantId: 'other', dishName: 'Same Dish'),
      throwsFormatException,
    );
  });

  test(
    'partial results, malformed bounded size and duplicate catalog names fail closed',
    () async {
      for (final response in [
        result(
          'catalog',
          state: 'preparing',
          cursor: 'next',
          items: [
            {'canonicalName': 'Pizza', 'aliases': []},
          ],
        ),
        result('catalog', items: List.generate(9, (_) => {})),
        result(
          'catalog',
          items: [
            {'canonicalName': 'Pizza', 'aliases': []},
            {'canonicalName': 'PIZZA', 'aliases': []},
          ],
        ),
      ]) {
        final service = CustomerBiteScoreSuggestionsService(
          api: FakeSearchApi((_, _) async => response),
        );
        await expectLater(service.catalog('pizza'), throwsFormatException);
      }
    },
  );
}
