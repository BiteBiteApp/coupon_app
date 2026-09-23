import 'dart:async';

import 'package:coupon_app/models/demo_redemption_store.dart';
import 'package:coupon_app/services/customer_auth_service.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'guest_device_id': 'retained-guest-device',
      'guest_coupon_redemptions_retained-guest-device': _guestHistory,
      'bitesaver_guest_usage_v1:retained-guest-device:meta': _deviceUsage,
    });
    await DemoRedemptionStore.resetForTesting();
  });
  tearDown(DemoRedemptionStore.resetForTesting);

  test(
    'default sign-in retains device history, profile, and refresh',
    () async {
      final calls = <String>[];
      final user = _User('A', onReload: () async => calls.add('reload:A'));
      await CustomerAuthService.finalizeSignedInSessionForTesting(
        signedInUser: user,
        currentUser: () => user,
        upsertProfile: (user) async => calls.add('profile:${user.uid}'),
        refreshRedemptions: () async => calls.add('refresh'),
      );
      expect(calls, ['reload:A', 'profile:A', 'refresh']);
      await _expectDeviceHistoryPreserved();
    },
  );

  test(
    'bounded sign-ins and account switches never import or refresh',
    () async {
      final calls = <String>[];
      DemoRedemptionStore.retireLegacyWritersForBoundedCutover();
      for (final uid in ['guest-linked-A', 'B', 'guest-linked-A']) {
        final user = _User(uid, onReload: () async => calls.add('reload:$uid'));
        await CustomerAuthService.finalizeSignedInSessionForTesting(
          signedInUser: user,
          currentUser: () => user,
          upsertProfile: (user) async => calls.add('profile:${user.uid}'),
          refreshRedemptions: () async => fail('legacy refresh after cutover'),
        );
      }
      expect(calls, [
        'reload:guest-linked-A',
        'profile:guest-linked-A',
        'reload:B',
        'profile:B',
        'reload:guest-linked-A',
        'profile:guest-linked-A',
      ]);
      await _expectDeviceHistoryPreserved();
    },
  );

  test('a delayed sign-in completion cannot modify an old account', () async {
    final signedInUser = _User('A');
    final current = _User('B');
    await CustomerAuthService.finalizeSignedInSessionForTesting(
      signedInUser: signedInUser,
      currentUser: () => current,
      upsertProfile: (_) async => fail('stale profile write'),
      refreshRedemptions: () async => fail('stale redemption refresh'),
    );
  });

  test(
    'account replacement during reload cannot continue finalization',
    () async {
      final started = Completer<void>();
      final release = Completer<void>();
      final calls = <String>[];
      final signedInUser = _User(
        'A',
        onReload: () async {
          started.complete();
          await release.future;
        },
      );
      User? current = signedInUser;
      final pending = CustomerAuthService.finalizeSignedInSessionForTesting(
        signedInUser: signedInUser,
        currentUser: () => current,
        upsertProfile: (_) async => fail('profile after account replacement'),
        refreshRedemptions: () async =>
            fail('refresh after account replacement'),
      );
      await started.future;
      current = _User('B');
      release.complete();
      await pending;
      expect(calls, isEmpty);
      await _expectDeviceHistoryPreserved();
    },
  );

  test('cutover during profile completion prevents legacy refresh', () async {
    final user = _User('A');
    await CustomerAuthService.finalizeSignedInSessionForTesting(
      signedInUser: user,
      currentUser: () => user,
      upsertProfile: (_) async {
        DemoRedemptionStore.retireLegacyWritersForBoundedCutover();
      },
      refreshRedemptions: () async => fail('refresh after cutover'),
    );
  });
}

const _guestHistory =
    '{"historical-coupon":{"lastRedeemedAt":"2026-09-01T10:00:00.000Z"}}';
const _deviceUsage = '{"schemaVersion":1,"revision":7,"activeOfferIds":[]}';

Future<void> _expectDeviceHistoryPreserved() async {
  final preferences = await SharedPreferences.getInstance();
  expect(preferences.getString('guest_device_id'), 'retained-guest-device');
  expect(
    preferences.getString('guest_coupon_redemptions_retained-guest-device'),
    _guestHistory,
  );
  expect(
    preferences.getString(
      'bitesaver_guest_usage_v1:retained-guest-device:meta',
    ),
    _deviceUsage,
  );
}

class _User extends Fake implements User {
  @override
  final String uid;
  final Future<void> Function()? onReload;

  _User(this.uid, {this.onReload});

  @override
  bool get isAnonymous => false;

  @override
  Future<void> reload() async => onReload?.call();
}
