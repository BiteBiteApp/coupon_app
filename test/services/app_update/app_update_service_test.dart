import 'dart:async';
import 'dart:convert';

import 'package:coupon_app/services/app_update/app_update_service.dart';
import 'package:flutter_test/flutter_test.dart';

class MemoryUpdateStorage implements AppUpdateStorage {
  final data = <String, String>{};
  bool fail = false;
  Future<void> Function(String key)? beforeWrite;
  @override
  Future<String?> read(String key) async {
    if (fail) throw StateError('offline storage');
    return data[key];
  }

  @override
  Future<void> write(String key, String value) async {
    await beforeWrite?.call(key);
    if (fail) throw StateError('offline storage');
    data[key] = value;
  }
}

class FakeUpdatePlatform implements AppUpdatePlatform {
  final interrupt = StreamController<void>.broadcast();
  @override
  Stream<void> get interruptions => interrupt.stream;
  AppUpdateRelease? release = const AppUpdateRelease(build: 10, urgent: false);
  Future<AppUpdateRelease?> Function()? onCheck;
  Future<AppUpdateHandoff> Function()? onOpen;
  int checks = 0;
  int opens = 0;
  @override
  Future<AppUpdateRelease?> check() async {
    checks++;
    return onCheck != null ? await onCheck!() : release;
  }

  @override
  Future<AppUpdateHandoff> open(AppUpdateRelease release) async {
    opens++;
    return onOpen != null ? await onOpen!() : AppUpdateHandoff.cancelled;
  }
}

void main() {
  late MemoryUpdateStorage storage;
  late FakeUpdatePlatform platform;
  late DateTime now;
  AppUpdateService service() =>
      AppUpdateService(platform: platform, storage: storage, clock: () => now);
  setUp(() {
    storage = MemoryUpdateStorage();
    platform = FakeUpdatePlatform();
    now = DateTime.utc(2026, 10, 14);
  });

  test(
    'two explicit choices, each full 24 hours; restart/account independent',
    () async {
      final first = (await service().check())!;
      expect(first.required, false);
      now = now.add(const Duration(days: 7)); // unchosen time spends nothing
      expect((await service().check())!.postponements, 0);
      expect(await service().postpone(first), true);
      expect(await service().check(), null);
      now = now.add(
        const Duration(hours: 24) - const Duration(milliseconds: 1),
      );
      expect(await service().check(), null);
      now = now.add(const Duration(milliseconds: 1));
      final second = (await service().check())!;
      expect(second.postponements, 1);
      expect(second.required, false);
      expect(await service().postpone(second), true);
      now = now.add(
        const Duration(hours: 24) - const Duration(milliseconds: 1),
      );
      expect(await service().check(), null);
      now = now.add(const Duration(milliseconds: 1));
      final required = (await service().check())!;
      expect(required.required, true);
      expect(await service().postpone(required), false);
      expect(
        storage.data.keys.single,
        contains('android:com.colesmart.bitestar:10'),
      );
    },
  );

  test(
    'release changes keep distinct history and installation removes prompt',
    () async {
      await service().postpone((await service().check())!);
      platform.release = const AppUpdateRelease(build: 11, urgent: false);
      expect((await service().check())!.postponements, 0);
      platform.release = null;
      expect(await service().check(), null);
      platform.release = const AppUpdateRelease(build: 10, urgent: false);
      expect(await service().check(), null);
    },
  );

  test('explicit urgency skips grace, version size alone does not', () async {
    platform.release = const AppUpdateRelease(build: 9999, urgent: false);
    expect((await service().check())!.required, false);
    await service().postpone((await service().check())!);
    platform.release = const AppUpdateRelease(build: 9999, urgent: true);
    expect((await service().check())!.required, true);
  });

  test('integer versions and malformed/unavailable/downgrade response', () {
    Map<String, Object?> payload() => {
      'eligible': true,
      'package': 'com.colesmart.bitestar',
      'installed': 9,
      'available': 10,
      'priority': 0,
      'inProgress': false,
    };
    expect(AppUpdateRelease.fromPlatform(payload())!.build, 10);
    for (final response in [
      null,
      {},
      payload()..['available'] = 8,
      payload()..['available'] = 9,
      payload()..['available'] = '10',
      payload()..['priority'] = 6,
      payload()..['eligible'] = false,
      payload()..['package'] = 'other',
    ]) {
      expect(AppUpdateRelease.fromPlatform(response), null);
    }
    expect(
      AppUpdateRelease.fromPlatform(payload()..['priority'] = 5)!.urgent,
      true,
    );
  });

  test(
    'offline, malformed persistence and failed persistence fail open',
    () async {
      platform.onCheck = () => Future.error(StateError('offline'));
      expect(await service().check(), null);
      platform.onCheck = null;
      storage.data['app_update.v1.android:com.colesmart.bitestar:10'] = '{bad';
      expect(await service().check(), null);
      storage.data.clear();
      final decision = (await service().check())!;
      storage.fail = true;
      expect(await service().postpone(decision), false);
      expect(await service().check(), null);
    },
  );

  testWidgets('platform timeout fails open without altering history', (
    tester,
  ) async {
    platform.onCheck = () => Completer<AppUpdateRelease?>().future;
    AppUpdateDecision? result;
    var completed = false;
    unawaited(
      service().check().then((v) {
        result = v;
        completed = true;
      }),
    );
    await tester.pump(const Duration(seconds: 5));
    expect(completed, true);
    expect(result, null);
    expect(storage.data, isEmpty);
  });

  test('clock rollback does not shorten a postponement', () async {
    await service().postpone((await service().check())!);
    now = now.subtract(const Duration(days: 1));
    expect(await service().check(), null);
  });

  test(
    'opening safeguard rejects unknown/crash/recent sessions; five minute boundary',
    () async {
      AppUpdateOpeningSafety guard() =>
          AppUpdateOpeningSafety(storage, clock: () => now);
      expect(await guard().begin(), false);
      expect(await guard().begin(), false);
      await guard().markForeground(false);
      now = now.add(
        const Duration(minutes: 5) - const Duration(milliseconds: 1),
      );
      expect(await guard().begin(), false);
      await guard().markForeground(false);
      now = now.add(const Duration(minutes: 5));
      expect(await guard().begin(), true);
      expect(
        jsonDecode(storage.data[AppUpdateOpeningSafety.key]!)['foreground'],
        true,
      );
      storage.data[AppUpdateOpeningSafety.key] = '{bad';
      expect(await guard().begin(), false);
    },
  );

  test('development builds never call a native update channel', () async {
    expect(await const StoreAppUpdatePlatform().check(), null);
    expect(
      await const StoreAppUpdatePlatform().open(platform.release!),
      AppUpdateHandoff.failed,
    );
  });
  test(
    'already accepted Play update remains resumable during a prior snooze',
    () async {
      await service().postpone((await service().check())!);
      platform.release = const AppUpdateRelease(
        build: 10,
        urgent: false,
        inProgress: true,
      );
      final decision = (await service().check())!;
      expect(decision.required, true);
      expect(await service().postpone(decision), false);
    },
  );
}
