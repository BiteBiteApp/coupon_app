import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/foundation.dart';
import 'package:geocoding/geocoding.dart';

import 'customer_bitescore_search_service.dart' show customerBiteScoreRequestId;

typedef CustomerLocationTransport =
    Future<Object?> Function(Map<String, Object?> request);

class CustomerLocationException implements Exception {
  const CustomerLocationException(this.message);
  final String message;
  @override
  String toString() => message;
}

/// Browser-only caller. Coordinates stay in this tab's memory for at most 24h;
/// user-entered text remains owned by SharedLocationStateService preferences.
class CustomerBrowserLocationService {
  CustomerBrowserLocationService({
    CustomerLocationTransport? transport,
    DateTime Function()? now,
  }) : _transport = transport ?? _call,
       _now = now ?? DateTime.now;

  static final instance = CustomerBrowserLocationService();
  static const cacheLifetime = Duration(hours: 24);
  static const requestTimeout = Duration(seconds: 10);
  final CustomerLocationTransport _transport;
  final DateTime Function() _now;
  final String _clientInstanceId = customerBiteScoreRequestId();
  final Map<String, Future<List<Location>>> _pending = {};
  String? _cachedKey;
  Location? _cachedLocation;
  DateTime? _expiresAt;
  Timer? _expiry;
  int _generation = 0;

  static Future<Object?> _call(Map<String, Object?> request) async =>
      (await FirebaseFunctions.instanceFor(region: 'us-central1')
              .httpsCallable(
                'resolveCustomerLocation',
                options: HttpsCallableOptions(timeout: requestTimeout),
              )
              .call<Object?>(request))
          .data;

  static String _key(String query) => query
      .trim()
      .replaceAll(RegExp(r'\s+'), ' ')
      .replaceAll(RegExp(r'\s*,\s*'), ', ')
      .toLowerCase()
      .replaceFirstMapped(RegExp(r'^(\d{5})-\d{4}$'), (match) => match[1]!);

  DateTime? expirationFor(String query, double latitude, double longitude) {
    if (_cachedLocation?.latitude != latitude ||
        _cachedLocation?.longitude != longitude ||
        !_matches(query)) {
      return null;
    }
    return _expiresAt;
  }

  bool _matches(String query) {
    if (_expiresAt == null || !_now().isBefore(_expiresAt!)) {
      _clearCache();
      return false;
    }
    final key = _key(query);
    // City-only is trustworthy only when reusing this user's confirmed state.
    return key == _cachedKey ||
        (!key.contains(',') && _cachedKey?.split(',').first == key);
  }

  Future<List<Location>> resolve(String query) {
    if (_matches(query)) {
      _generation++;
      return Future.value([_cachedLocation!]);
    }
    final key = _key(query);
    if (query.length > 120 ||
        RegExp(r'[\x00-\x1f\x7f]').hasMatch(query) ||
        !(RegExp(r'^\d{5}$').hasMatch(key) ||
            RegExp(
              r"^[a-zÀ-ž][a-zÀ-ž .’'\-]{0,79}, [a-z]{2}$",
              caseSensitive: false,
            ).hasMatch(key))) {
      return Future.error(
        const CustomerLocationException(
          'Enter a US ZIP code or include the state, for example Ocala, FL.',
        ),
      );
    }
    final pending = _pending[key];
    if (pending != null) {
      final generation = ++_generation;
      return pending.then((locations) {
        if (generation == _generation) _remember(key, locations.first);
        return locations;
      });
    }
    if (_pending.length >= 2) {
      return Future.error(
        const CustomerLocationException(
          'Please wait for location lookup to finish, then try again.',
        ),
      );
    }
    final generation = ++_generation;
    final future = _resolve(query, key, generation);
    _pending[key] = future;
    unawaited(
      future.then<void>(
        (_) {
          _pending.remove(key);
        },
        onError: (Object _, StackTrace _) {
          _pending.remove(key);
        },
      ),
    );
    return future;
  }

  Future<List<Location>> _resolve(
    String query,
    String key,
    int generation,
  ) async {
    try {
      final raw = await _transport({
        'schemaVersion': 1,
        'query': query.trim(),
        'clientInstanceId': _clientInstanceId,
      }).timeout(requestTimeout);
      if (raw is! Map ||
          raw['schemaVersion'] != 1 ||
          raw['provider'] != 'google' ||
          raw['latitude'] is! num ||
          raw['longitude'] is! num ||
          raw['cacheSeconds'] != cacheLifetime.inSeconds) {
        throw const FormatException();
      }
      final latitude = (raw['latitude'] as num).toDouble();
      final longitude = (raw['longitude'] as num).toDouble();
      if (!latitude.isFinite ||
          !longitude.isFinite ||
          latitude < 18 ||
          latitude > 72 ||
          !((longitude >= -180 && longitude <= -66) ||
              (longitude >= 172 && longitude <= 180))) {
        throw const FormatException();
      }
      final location = Location(
        latitude: latitude,
        longitude: longitude,
        timestamp: _now(),
      );
      if (generation == _generation) {
        _remember(key, location);
      }
      return [location];
    } on FirebaseFunctionsException catch (error) {
      // Never display arbitrary provider/backend error text or response details.
      throw CustomerLocationException(switch (error.code) {
        'invalid-argument' || 'not-found' =>
          'That location could not be confirmed. Check the ZIP code or enter city and state.',
        'resource-exhausted' =>
          'Location lookup is busy or paused. Please try later.',
        'deadline-exceeded' => 'Location lookup timed out. Please try again.',
        _ =>
          'City and ZIP lookup is temporarily unavailable. Use your current location or try later.',
      });
    } on TimeoutException {
      throw const CustomerLocationException(
        'Location lookup timed out. Please try again.',
      );
    } catch (_) {
      throw const CustomerLocationException(
        'City and ZIP lookup is temporarily unavailable. Use your current location or try later.',
      );
    }
  }

  void _remember(String key, Location location) {
    _clearCache();
    _cachedKey = key;
    _cachedLocation = location;
    _expiresAt = location.timestamp.add(cacheLifetime);
    _expiry = Timer(_expiresAt!.difference(_now()), _clearCache);
  }

  void _clearCache() {
    _expiry?.cancel();
    _expiry = null;
    _cachedKey = null;
    _cachedLocation = null;
    _expiresAt = null;
  }

  @visibleForTesting
  void resetForTesting() {
    _generation++;
    _pending.clear();
    _clearCache();
  }
}
