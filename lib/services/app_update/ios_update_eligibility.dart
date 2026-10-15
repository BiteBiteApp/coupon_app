import 'dart:convert';

import 'package:http/http.dart' as http;

import 'ios_store_devices.dart';

/// A public Apple version is a numeric tuple, not an Android build code or a
/// decimal. Canonical identity keeps 1.2 and 1.2.0 on the same snooze record.
String? canonicalIosVersion(Object? value) {
  if (value is! String ||
      !RegExp(r'^[0-9]{1,9}(\.[0-9]{1,9}){0,2}$').hasMatch(value)) {
    return null;
  }
  final parts = value.split('.').map(int.parse).toList();
  while (parts.length < 3) {
    parts.add(0);
  }
  return parts.join('.');
}

int? compareIosVersions(Object? left, Object? right) {
  final a = canonicalIosVersion(left)?.split('.').map(int.parse).toList();
  final b = canonicalIosVersion(right)?.split('.').map(int.parse).toList();
  if (a == null || b == null) return null;
  for (var i = 0; i < 3; i++) {
    final result = a[i].compareTo(b[i]);
    if (result != 0) return result;
  }
  return 0;
}

/// Public metadata only. No Firebase/auth/account dependency and no cached
/// eligibility fallback. Every opening, handoff and return checks afresh.
final class IosUpdateEligibility {
  IosUpdateEligibility({
    required this.snapshot,
    this.expectedAppleId = configuredAppleId,
    Future<Object?> Function(Uri)? fetch,
    DateTime Function()? clock,
  }) : fetch = fetch ?? fetchJson,
       clock = clock ?? DateTime.now;

  // Configuration gap: fill only after matching the current ASC record's
  // numeric Apple ID AND com.colesmart.bitestar. Null disables production.
  static const String? configuredAppleId = null;
  static const bundleId = 'com.colesmart.bitestar';
  static final policyUrl = Uri.https(
    'coupon-app-29446.web.app',
    '/app-updates/ios.json',
  );
  final String? expectedAppleId;
  final Future<Object?> Function() snapshot;
  final Future<Object?> Function(Uri) fetch;
  final DateTime Function() clock;

  static Future<Object?> fetchJson(Uri uri) async {
    final client = http.Client();
    try {
      final request = http.Request('GET', uri)
        ..followRedirects = false
        ..headers['Cache-Control'] = 'no-cache, no-store'
        ..headers['Accept'] = 'application/json';
      final response = await client
          .send(request)
          .timeout(const Duration(seconds: 3));
      final age = response.headers['age'];
      final mime = response.headers['content-type']
          ?.split(';')
          .first
          .trim()
          .toLowerCase();
      final appleLookup =
          uri.scheme == 'https' &&
          uri.host == 'itunes.apple.com' &&
          uri.path == '/lookup' &&
          uri.port == 443 &&
          uri.userInfo.isEmpty;
      if (response.statusCode != 200 ||
          !(mime == 'application/json' ||
              appleLookup && mime == 'text/javascript') ||
          (age != null &&
              (int.tryParse(age) == null ||
                  int.parse(age) < 0 ||
                  int.parse(age) > 300))) {
        return null;
      }
      final bytes = <int>[];
      await for (final chunk in response.stream.timeout(
        const Duration(seconds: 3),
      )) {
        bytes.addAll(chunk);
        if (bytes.length > 65536) return null;
      }
      return jsonDecode(utf8.decode(bytes));
    } finally {
      client.close();
    }
  }

  Future<Map<String, Object>?> check() async {
    try {
      final id = expectedAppleId;
      if (id == null || !RegExp(r'^[1-9][0-9]{0,17}$').hasMatch(id)) {
        return null;
      }
      final policy = await fetch(policyUrl);
      if (policy is! Map ||
          policy['schemaVersion'] != 1 ||
          policy['enabled'] != true ||
          policy['bundleId'] != bundleId ||
          policy['appleId'] != id ||
          policy['urgent'] is! bool) {
        return null;
      }
      final target = canonicalIosVersion(policy['version']);
      final issued = _timestamp(policy['issuedAt']);
      final expires = _timestamp(policy['expiresAt']);
      bool fresh() {
        final now = clock().toUtc();
        return issued != null &&
            expires != null &&
            !issued.isAfter(now) &&
            expires.isAfter(now) &&
            expires.isAfter(issued) &&
            expires.difference(issued) <= const Duration(days: 7);
      }

      if (target == null || !fresh()) return null;
      final local = await snapshot();
      if (local is! Map ||
          local['publicInstallation'] != true ||
          local['externalEntry'] != false ||
          local['bundleId'] != bundleId ||
          local['appleId'] != id ||
          local['country'] is! String ||
          !RegExp(r'^[A-Z]{2}$').hasMatch(local['country'] as String) ||
          local['device'] is! String ||
          !RegExp(
            r'^(iPhone|iPad)[0-9]+,[0-9]+$',
          ).hasMatch(local['device'] as String) ||
          compareIosVersions(target, local['installedVersion']) != 1) {
        return null;
      }
      final listing = await fetch(
        Uri.https('itunes.apple.com', '/lookup', {
          'id': id,
          'country': local['country'] as String,
          'entity': 'software',
        }),
      );
      if (listing is! Map ||
          listing['resultCount'] != 1 ||
          listing['results'] is! List ||
          (listing['results'] as List).length != 1) {
        return null;
      }
      final app = (listing['results'] as List).single;
      if (app is! Map ||
          app['trackId'] is! int ||
          '${app['trackId']}' != id ||
          app['bundleId'] != bundleId ||
          app['kind'] != 'software' ||
          canonicalIosVersion(app['version']) != target ||
          app['supportedDevices'] is! List) {
        return null;
      }
      final os = compareIosVersions(
        local['osVersion'],
        app['minimumOsVersion'],
      );
      if (os == null || os < 0) return null;
      // Bind the actual hardware to an exact, independently verified Apple
      // marketing token, then require that token in THIS app's current listing.
      final deviceToken = iosStoreDeviceTokens[local['device']];
      if (deviceToken == null ||
          !(app['supportedDevices'] as List).contains(deviceToken)) {
        return null;
      }
      if (!fresh()) return null;
      return {
        'eligible': true,
        'platform': 'ios',
        'bundleId': bundleId,
        'appleId': id,
        'version': target,
        'urgent': policy['urgent'] as bool,
        'installedVersion': local['installedVersion'] as String,
        'country': local['country'] as String,
      };
    } catch (_) {
      return null;
    }
  }

  static DateTime? _timestamp(Object? value) =>
      value is String && value.endsWith('Z')
      ? DateTime.tryParse(value)?.toUtc()
      : null;
}
