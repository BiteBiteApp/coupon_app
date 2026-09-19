import '../models/bitescore_dish.dart';
import '../models/customer_bitescore_search.dart';
import 'bitescore_service.dart' show DishCatalogSuggestion;
import 'customer_bitescore_search_service.dart';

/// A preparation response contains no partial, misleading top-eight results.
/// New queries and auth changes retire an older in-flight preparation.
class CustomerBiteScoreSuggestionsService {
  CustomerBiteScoreSuggestionsService({
    CustomerBiteScoreSearchApi? api,
    String Function()? actorKey,
    Future<void> Function(Duration)? delay,
  }) : _api = api ?? CustomerBiteScoreSearchService(),
       _actorKey = actorKey ?? customerBiteScoreActorKey,
       _delay = delay ?? Future<void>.delayed;

  final CustomerBiteScoreSearchApi _api;
  final String Function() _actorKey;
  final Future<void> Function(Duration) _delay;
  final String _clientInstanceId = customerBiteScoreRequestId();
  final Map<String, int> _generations = {};

  Future<List<Map<String, dynamic>>> _load(
    String kind,
    String query, {
    String? restaurantId,
  }) async {
    final generation = (_generations[kind] ?? 0) + 1;
    _generations[kind] = generation;
    final actor = _actorKey();
    final requestId = customerBiteScoreRequestId();
    String? cursor;
    bool current() => _generations[kind] == generation && _actorKey() == actor;
    do {
      if (!current()) throw StateError('Suggestion request changed.');
      final response = await _api.invoke('getCustomerBiteScoreSuggestions', {
        'schemaVersion': 1,
        'kind': kind,
        'query': query,
        'restaurantId': ?restaurantId,
        'clientInstanceId': _clientInstanceId,
        'clientRequestId': requestId,
        'queryGeneration': generation,
        'cursor': ?cursor,
      });
      if (!current()) throw StateError('Suggestion request changed.');
      final items = response['items'];
      final next = response['nextCursor'];
      if (response['schemaVersion'] != 1 ||
          response['kind'] != kind ||
          items is! List ||
          items.length > 8 ||
          (next != null && (next is! String || next.isEmpty))) {
        throw const FormatException('Invalid suggestions response.');
      }
      if (response['state'] == 'ready') {
        if (next != null) {
          throw const FormatException('Invalid completed suggestions.');
        }
        return items
            .map((item) {
              if (item is! Map) {
                throw const FormatException('Invalid suggestion.');
              }
              return Map<String, dynamic>.from(item);
            })
            .toList(growable: false);
      }
      if (response['state'] != 'preparing' ||
          items.isNotEmpty ||
          next == null) {
        throw const FormatException('Invalid suggestion preparation.');
      }
      cursor = next as String;
      await _delay(const Duration(milliseconds: 100));
    } while (true);
  }

  Future<List<DishCatalogSuggestion>> catalog(String query) async {
    final items = await _load('catalog', query);
    final names = <String>{};
    return items
        .map((item) {
          final name = item['canonicalName'];
          final aliases = item['aliases'];
          if (name is! String ||
              name.trim().isEmpty ||
              aliases is! List ||
              aliases.length > 2 ||
              aliases.any((alias) => alias is! String) ||
              !names.add(name.toLowerCase())) {
            throw const FormatException('Invalid catalog suggestion.');
          }
          return DishCatalogSuggestion(
            canonicalName: name,
            aliases: List<String>.from(aliases),
          );
        })
        .toList(growable: false);
  }

  Future<List<BitescoreDish>> similar({
    required String restaurantId,
    required String dishName,
    int limit = 8,
  }) async {
    if (limit < 0 || limit > 8) {
      throw ArgumentError.value(
        limit,
        'limit',
        'Must be between zero and eight.',
      );
    }
    final items = await _load('similar', dishName, restaurantId: restaurantId);
    final ids = <String>{};
    final dishes = items
        .map((item) {
          final dish = CustomerBiteScorePublicData.entry(item).dish;
          if (dish.restaurantId != restaurantId || !ids.add(dish.id)) {
            throw const FormatException('Invalid similar dish identity.');
          }
          return dish;
        })
        .toList(growable: false);
    return dishes.take(limit).toList(growable: false);
  }
}
