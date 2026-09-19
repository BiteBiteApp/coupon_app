import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';

import '../models/bitescore_restaurant.dart';
import '../models/customer_bitescore_search.dart';
import 'bitescore_service.dart' show BiteScoreHomeEntry;

typedef CustomerBiteScoreTransport =
    Future<Object?> Function(String name, Map<String, Object?> request);

String customerBiteScoreRequestId() {
  final random = Random.secure();
  return base64UrlEncode(
    List<int>.generate(24, (_) => random.nextInt(256)),
  ).replaceAll('=', '');
}

String customerBiteScoreActorKey() {
  try {
    final user = FirebaseAuth.instance.currentUser;
    return user == null ? 'guest' : 'user:${user.uid}';
  } catch (_) {
    return 'guest';
  }
}

abstract interface class CustomerBiteScoreSearchApi {
  Future<Map<String, dynamic>> invoke(
    String operation,
    Map<String, Object?> request,
  );
}

final class CustomerBiteScoreSearchService
    implements CustomerBiteScoreSearchApi {
  CustomerBiteScoreSearchService({CustomerBiteScoreTransport? transport})
    : _transport = transport ?? _firebaseTransport;

  final CustomerBiteScoreTransport _transport;

  static Future<Object?> _firebaseTransport(
    String name,
    Map<String, Object?> request,
  ) async => (await FirebaseFunctions.instanceFor(
    region: 'us-central1',
  ).httpsCallable(name).call<Object?>(request)).data;

  @override
  Future<Map<String, dynamic>> invoke(
    String operation,
    Map<String, Object?> request,
  ) async {
    final response = await _transport(operation, request);
    if (response is! Map) {
      throw const FormatException('Invalid BiteScore response.');
    }
    return Map<String, dynamic>.from(response);
  }
}

/// One controller owns one exact query and its server-ranked result pages.
/// Preparation advances bounded server work, never downloads source batches.
final class CustomerBiteScoreSearchController extends ChangeNotifier {
  CustomerBiteScoreSearchController({
    CustomerBiteScoreSearchApi? api,
    required Map<String, Object?> criteria,
    String? clientInstanceId,
    String Function()? actorKey,
    Future<void> Function(Duration)? delay,
    this.startEndpoint = 'startCustomerBiteScoreSearch',
    this.advanceEndpoint = 'advanceCustomerBiteScoreSearch',
    this.pageEndpoint = 'getCustomerBiteScoreSearchPage',
    this.validateItem,
    this.resultIdentity,
  }) : _api = api ?? CustomerBiteScoreSearchService(),
       _criteria = _freeze(criteria),
       _clientInstanceId = clientInstanceId ?? customerBiteScoreRequestId(),
       _actorKey = actorKey ?? customerBiteScoreActorKey,
       _delay = delay ?? Future<void>.delayed;

  final CustomerBiteScoreSearchApi _api;
  final String _clientInstanceId;
  final String Function() _actorKey;
  final Future<void> Function(Duration) _delay;
  final String startEndpoint;
  final String advanceEndpoint;
  final String pageEndpoint;
  final void Function(Map<String, dynamic>)? validateItem;
  final String Function(Map<String, dynamic>)? resultIdentity;
  Map<String, Object?> _criteria;
  int _generation = 0;
  bool _disposed = false;
  Future<void>? _inFlight;
  String? _sessionId;
  String? _fingerprint;
  String? _cursor;
  String? _acceptedActor;
  List<Map<String, dynamic>> _items = [];

  bool isLoading = false;
  bool isPreparing = false;
  bool hasMore = false;
  int scannedCount = 0;
  Object? error;

  static Map<String, Object?> _freeze(Map<String, Object?> criteria) =>
      Map<String, Object?>.unmodifiable(
        Map<String, Object?>.from(jsonDecode(jsonEncode(criteria)) as Map),
      );

  Map<String, Object?> get criteria => _criteria;
  List<Map<String, dynamic>> get items => List.unmodifiable(_items);
  List<BiteScoreHomeEntry> get entries =>
      List.unmodifiable(_items.map(CustomerBiteScorePublicData.entry));
  List<BitescoreRestaurant> get restaurants =>
      List.unmodifiable(_items.map(CustomerBiteScorePublicData.restaurant));

  Future<void> updateCriteria(
    Map<String, Object?> criteria, {
    bool load = true,
  }) {
    _generation++;
    _criteria = _freeze(criteria);
    _sessionId = null;
    _fingerprint = null;
    _cursor = null;
    _acceptedActor = null;
    _items = [];
    _inFlight = null;
    isLoading = false;
    isPreparing = false;
    hasMore = false;
    scannedCount = 0;
    error = null;
    _notify();
    return load ? loadInitial() : Future<void>.value();
  }

  Future<void> loadInitial() => _sessionId != null || error != null
      ? updateCriteria(_criteria)
      : _load(append: false);
  Future<void> loadMore() => hasMore ? _load(append: true) : Future.value();

  bool _current(int generation, String actor) =>
      !_disposed && generation == _generation && actor == _actorKey();

  Map<String, Object?> _request() => {
    'schemaVersion': 1,
    'clientInstanceId': _clientInstanceId,
    'sessionId': _sessionId,
    'queryFingerprint': _fingerprint,
  };

  void _acceptSession(Map<String, dynamic> response) {
    final session = response['sessionId'];
    final fingerprint = response['queryFingerprint'];
    if (session is! String ||
        session.isEmpty ||
        fingerprint is! String ||
        !RegExp(r'^[a-f0-9]{64}$').hasMatch(fingerprint) ||
        (_sessionId != null && _sessionId != session) ||
        (_fingerprint != null && _fingerprint != fingerprint)) {
      throw const FormatException('Invalid BiteScore session binding.');
    }
    _sessionId = session;
    _fingerprint = fingerprint;
    final count = response['scannedCount'];
    if (count is! int || count < 0) {
      throw const FormatException('Invalid BiteScore preparation state.');
    }
    scannedCount = count;
  }

  Future<void> _load({required bool append}) {
    if (_disposed) return Future.value();
    if (_inFlight != null) return _inFlight!;
    final generation = _generation;
    final actor = _actorKey();
    if (append && _acceptedActor != actor) {
      return updateCriteria(_criteria);
    }
    isLoading = true;
    error = null;
    _notify();
    late final Future<void> operation;
    operation = () async {
      try {
        Map<String, dynamic>? response;
        if (!append || _sessionId == null) {
          _sessionId = null;
          _fingerprint = null;
          response = await _api.invoke(startEndpoint, {
            'schemaVersion': 1,
            'clientInstanceId': _clientInstanceId,
            'clientRequestId': customerBiteScoreRequestId(),
            'queryGeneration': generation,
            'criteria': _criteria,
          });
          if (!_current(generation, actor)) return;
          _acceptSession(response);
          final deadline = DateTime.now().add(const Duration(minutes: 15));
          while (response!['state'] == 'preparing') {
            isPreparing = true;
            _notify();
            await _delay(const Duration(milliseconds: 150));
            if (!_current(generation, actor)) return;
            if (DateTime.now().isAfter(deadline)) {
              throw const FormatException('BiteScore search expired.');
            }
            response = await _api.invoke(advanceEndpoint, _request());
            if (!_current(generation, actor)) return;
            _acceptSession(response);
          }
          if (response['state'] != 'ready') {
            throw const FormatException('BiteScore search could not complete.');
          }
        }
        response = await _api.invoke(pageEndpoint, {
          ..._request(),
          if (append) 'cursor': _cursor,
        });
        if (!_current(generation, actor)) return;
        _acceptSession(response);
        final rawItems = response['items'];
        final next = response['nextCursor'];
        final more = response['hasMore'];
        final maximum = _criteria['finder'] != null ? 8 : 25;
        if (rawItems is! List ||
            rawItems.length > maximum ||
            more is! bool ||
            (more != (next is String && next.isNotEmpty)) ||
            (append && more && next == _cursor)) {
          throw const FormatException('Invalid BiteScore result page.');
        }
        final page = rawItems.map((raw) {
          if (raw is! Map) {
            throw const FormatException('Invalid BiteScore result.');
          }
          final item = Map<String, dynamic>.from(raw);
          if (validateItem != null) {
            validateItem!(item);
          } else if (_criteria['kind'] == 'restaurant') {
            CustomerBiteScorePublicData.restaurant(item);
          } else {
            CustomerBiteScorePublicData.entry(item);
          }
          return item;
        }).toList();
        final merged = <String, Map<String, dynamic>>{
          if (append)
            for (final item in _items)
              resultIdentity?.call(item) ?? item['sourceDocumentId'] as String:
                  item,
        };
        for (final item in page) {
          merged.putIfAbsent(
            resultIdentity?.call(item) ?? item['sourceDocumentId'] as String,
            () => item,
          );
        }
        _items = merged.values.toList();
        _cursor = next as String?;
        _acceptedActor = actor;
        hasMore = more;
      } catch (failure) {
        if (_current(generation, actor)) error = failure;
      } finally {
        if (!_disposed && generation == _generation) {
          if (identical(_inFlight, operation)) _inFlight = null;
          isLoading = false;
          isPreparing = false;
          if (actor != _actorKey()) {
            _items = [];
            hasMore = false;
          }
          _notify();
        }
      }
    }();
    _inFlight = operation;
    return operation;
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    super.dispose();
  }
}

Map<String, Object?> customerBiteScoreDishCriteria({
  String text = '',
  String locationText = '',
  double? latitude,
  double? longitude,
  double radiusMiles = 15,
  String sort = 'Highest BiteScore',
  List<String> categoryQueries = const [],
  String? restaurantId,
}) => {
  'kind': 'dish',
  'text': text,
  'locationText': locationText,
  'center': latitude == null || longitude == null
      ? null
      : {'latitude': latitude, 'longitude': longitude},
  'radiusMiles': radiusMiles,
  'sort': sort,
  'categoryQueries': categoryQueries,
  'restaurantId': restaurantId,
  'finder': null,
};
