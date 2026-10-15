import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'ios_update_eligibility.dart';

/// Only an obtainable, newer release can enter the reminder policy. Android
/// build codes are integers, never marketing-version strings. iOS must supply
/// its own verified eligibility contract before it can produce this value.
final class AppUpdateRelease {
  const AppUpdateRelease({
    required this.build,
    required this.urgent,
    this.inProgress = false,
  }) : iosVersion = null,
       appleId = null,
       country = null;
  const AppUpdateRelease.ios({
    required this.iosVersion,
    required this.appleId,
    required this.country,
    required this.urgent,
  }) : build = null,
       inProgress = false;
  final int? build;
  final String? iosVersion;
  final String? appleId;
  final String? country;
  final bool urgent;
  final bool inProgress;
  String get key => iosVersion == null
      ? 'android:com.colesmart.bitestar:$build'
      : 'ios:com.colesmart.bitestar:$appleId:${canonicalIosVersion(iosVersion)}';

  static AppUpdateRelease? fromIos(Object? value) {
    if (value is! Map ||
        value['eligible'] != true ||
        value['platform'] != 'ios' ||
        value['bundleId'] != IosUpdateEligibility.bundleId ||
        value['appleId'] is! String ||
        !RegExp(r'^[1-9][0-9]{0,17}$').hasMatch(value['appleId'] as String) ||
        value['urgent'] is! bool ||
        value['country'] is! String ||
        !RegExp(r'^[A-Z]{2}$').hasMatch(value['country'] as String) ||
        compareIosVersions(value['version'], value['installedVersion']) != 1) {
      return null;
    }
    return AppUpdateRelease.ios(
      iosVersion: canonicalIosVersion(value['version']),
      appleId: value['appleId'] as String,
      country: value['country'] as String,
      urgent: value['urgent'] as bool,
    );
  }

  static AppUpdateRelease? fromPlatform(Object? value) {
    if (value is! Map ||
        value['eligible'] != true ||
        value['package'] != 'com.colesmart.bitestar') {
      return null;
    }
    final installed = value['installed'];
    final available = value['available'];
    final priority = value['priority'];
    if (installed is! int ||
        installed <= 0 ||
        available is! int ||
        available <= installed ||
        priority is! int ||
        priority < 0 ||
        priority > 5 ||
        value['inProgress'] is! bool) {
      return null;
    }
    // Play release priority is an explicit publisher control, not a version
    // heuristic. Play includes intervening releases across tracks: an internal
    // priority-5 release can affect later production availability. Only the
    // maximum priority omits ordinary postponements.
    return AppUpdateRelease(
      build: available,
      urgent: priority == 5,
      inProgress: value['inProgress'] as bool,
    );
  }
}

enum AppUpdateHandoff { returned, cancelled, failed }

abstract interface class AppUpdatePlatform {
  Stream<void> get interruptions;
  Future<AppUpdateRelease?> check();
  Future<AppUpdateHandoff> open(AppUpdateRelease release);
}

final class StoreAppUpdatePlatform implements AppUpdatePlatform {
  const StoreAppUpdatePlatform();
  static const channel = MethodChannel('com.colesmart.bitestar/app_update');

  static StreamController<void>? _interruptions;
  @override
  Stream<void> get interruptions {
    if (_interruptions == null) {
      _interruptions = StreamController<void>.broadcast();
      channel.setMethodCallHandler((call) async {
        if (call.method == 'externalEntry') _interruptions!.add(null);
      });
    }
    return _interruptions!.stream;
  }

  bool get _supported =>
      !kIsWeb &&
      kReleaseMode &&
      (defaultTargetPlatform == TargetPlatform.android ||
          defaultTargetPlatform == TargetPlatform.iOS);

  @override
  Future<AppUpdateRelease?> check() async {
    // Unsupported channels remain usable; native evidence also rejects
    // sideloads, simulator, development and TestFlight installations.
    if (!_supported) return null;
    try {
      if (defaultTargetPlatform == TargetPlatform.iOS) {
        return AppUpdateRelease.fromIos(
          await IosUpdateEligibility(
            snapshot: () => channel.invokeMethod<Object?>('snapshot'),
          ).check().timeout(const Duration(seconds: 5)),
        );
      }
      return AppUpdateRelease.fromPlatform(
        await channel
            .invokeMethod<Object?>('check')
            .timeout(const Duration(seconds: 5)),
      );
    } catch (_) {
      return null;
    }
  }

  @override
  Future<AppUpdateHandoff> open(AppUpdateRelease release) async {
    if (!_supported) return AppUpdateHandoff.failed;
    try {
      final ios = defaultTargetPlatform == TargetPlatform.iOS;
      if (ios != (release.iosVersion != null)) return AppUpdateHandoff.failed;
      final result = await channel.invokeMethod<String>(
        'open',
        ios
            ? {'appleId': release.appleId, 'country': release.country}
            : {'build': release.build},
      );
      return switch (result) {
        'returned' => AppUpdateHandoff.returned,
        'cancelled' => AppUpdateHandoff.cancelled,
        _ => AppUpdateHandoff.failed,
      };
    } catch (_) {
      return AppUpdateHandoff.failed;
    }
  }
}

abstract interface class AppUpdateStorage {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
}

final class PreferencesAppUpdateStorage implements AppUpdateStorage {
  late final SharedPreferencesAsync _preferences = SharedPreferencesAsync();
  @override
  Future<String?> read(String key) => _preferences.getString(key);
  @override
  Future<void> write(String key, String value) =>
      _preferences.setString(key, value);
}

final class AppUpdateDecision {
  const AppUpdateDecision(this.release, this.postponements);
  final AppUpdateRelease release;
  final int postponements;
  bool get required =>
      release.urgent || release.inProgress || postponements >= 2;
}

final class AppUpdateService {
  AppUpdateService({
    required this.platform,
    required this.storage,
    DateTime Function()? clock,
  }) : clock = clock ?? DateTime.now;
  final AppUpdatePlatform platform;
  final AppUpdateStorage storage;
  final DateTime Function() clock;
  bool _saving = false;
  static const interval = Duration(hours: 24);

  Future<AppUpdateDecision?> check() =>
      _check().timeout(const Duration(seconds: 5), onTimeout: () => null);

  Future<AppUpdateDecision?> _check() async {
    try {
      final release = await platform.check().timeout(
        const Duration(seconds: 5),
      );
      if (release == null) return null;
      final raw = await storage.read('app_update.v1.${release.key}');
      var count = 0;
      if (raw != null) {
        final data = jsonDecode(raw);
        if (data is! Map || data['count'] is! int || data['at'] is! int) {
          return null; // Corrupt local state must not lock out the installation.
        }
        count = data['count'] as int;
        if (count < 1 || count > 2 || (data['at'] as int) <= 0) return null;
        final postponedAt = DateTime.fromMillisecondsSinceEpoch(data['at']);
        if (!release.urgent &&
            !release.inProgress &&
            clock().difference(postponedAt) < interval) {
          return null;
        }
      }
      return AppUpdateDecision(release, count);
    } catch (_) {
      return null;
    }
  }

  Future<bool> postpone(AppUpdateDecision decision) async {
    if (_saving || decision.required) return false;
    _saving = true;
    try {
      // One installation/release record, no UID, auth or account permissions.
      // Timestamp is captured at the explicit choice, before storage latency.
      final at = clock().millisecondsSinceEpoch;
      await storage
          .write(
            'app_update.v1.${decision.release.key}',
            jsonEncode({'count': decision.postponements + 1, 'at': at}),
          )
          .timeout(const Duration(seconds: 5));
      return true;
    } catch (_) {
      return false;
    } finally {
      _saving = false;
    }
  }
}

/// Conservative cold-opening safeguard. A five-minute redemption cannot
/// survive a known background interval longer than five minutes. A crash or
/// missing/corrupt marker is uncertain, so skip the reminder for that opening.
/// No timer, polling, redemption writes or account reads are introduced.
final class AppUpdateOpeningSafety {
  AppUpdateOpeningSafety(this.storage, {DateTime Function()? clock})
    : clock = clock ?? DateTime.now;
  final AppUpdateStorage storage;
  final DateTime Function() clock;
  static const key = 'app_update.opening.v1';
  Future<void> _tail = Future.value();

  Future<T> _serial<T>(Future<T> Function() action) {
    final next = _tail.then((_) => action());
    _tail = next.then<void>((_) {}, onError: (Object _, StackTrace _) {});
    return next;
  }

  Future<bool> begin() => _serial(() async {
    try {
      final raw = await storage.read(key);
      var safe = false; // No marker means prior coupon state is unknown.
      if (raw != null) {
        final data = jsonDecode(raw);
        safe =
            data is Map &&
            data['foreground'] == false &&
            data['at'] is int &&
            (data['at'] as int) > 0 &&
            clock().millisecondsSinceEpoch - (data['at'] as int) >=
                const Duration(minutes: 5).inMilliseconds;
      }
      await _write(true);
      return safe;
    } catch (_) {
      return false;
    }
  });

  Future<void> markForeground(bool foreground) => _serial(() async {
    try {
      await _write(foreground);
    } catch (_) {
      /* fail open next time */
    }
  });

  Future<void> _write(bool foreground) => storage.write(
    key,
    jsonEncode({
      'foreground': foreground,
      'at': clock().millisecondsSinceEpoch,
    }),
  );
}
