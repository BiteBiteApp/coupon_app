import 'dart:async';

import 'package:coupon_app/models/demo_redemption_store.dart';
import 'package:coupon_app/services/customer_auth_service.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  setUp(DemoRedemptionStore.resetForTesting);
  tearDown(DemoRedemptionStore.resetForTesting);

  test('default sign-in retains guest import, profile, and refresh', () async {
    final calls = <String>[];
    final user = _User('A', onReload: () async => calls.add('reload:A'));
    await CustomerAuthService.finalizeSignedInSessionForTesting(
      signedInUser: user,
      currentUser: () => user,
      importGuest: (uid) async => calls.add('import:$uid'),
      upsertProfile: (user) async => calls.add('profile:${user.uid}'),
      refreshRedemptions: () async => calls.add('refresh'),
    );
    expect(calls, ['import:A', 'reload:A', 'profile:A', 'refresh']);
  });

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
          importGuest: (uid) async => fail('legacy import after cutover'),
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
    },
  );

  test(
    'a delayed sign-in completion cannot import into an old account',
    () async {
      final signedInUser = _User('A');
      final current = _User('B');
      await CustomerAuthService.finalizeSignedInSessionForTesting(
        signedInUser: signedInUser,
        currentUser: () => current,
        importGuest: (_) async => fail('stale guest import'),
        upsertProfile: (_) async => fail('stale profile write'),
        refreshRedemptions: () async => fail('stale redemption refresh'),
      );
    },
  );

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
        importGuest: (uid) async => calls.add('import:$uid'),
        upsertProfile: (_) async => fail('profile after account replacement'),
        refreshRedemptions: () async =>
            fail('refresh after account replacement'),
      );
      await started.future;
      current = _User('B');
      release.complete();
      await pending;
      expect(calls, ['import:A']);
    },
  );

  test('cutover during profile completion prevents legacy refresh', () async {
    final user = _User('A');
    await CustomerAuthService.finalizeSignedInSessionForTesting(
      signedInUser: user,
      currentUser: () => user,
      importGuest: (_) async {},
      upsertProfile: (_) async {
        DemoRedemptionStore.retireLegacyWritersForBoundedCutover();
      },
      refreshRedemptions: () async => fail('refresh after cutover'),
    );
  });
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
