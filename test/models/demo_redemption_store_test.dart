import 'dart:async';

import 'package:coupon_app/models/demo_redemption_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() async {
    SharedPreferences.setMockInitialValues(const <String, Object>{});
    await DemoRedemptionStore.resetForTesting();
  });

  tearDown(DemoRedemptionStore.resetForTesting);

  test('null-user refresh clears the previous signed user memory', () async {
    DemoRedemptionAuthSnapshot? authSnapshot;
    DemoRedemptionStore.configureForTesting(
      currentAuthSnapshot: () => authSnapshot,
    );
    DemoRedemptionStore.seedMemoryForTesting(
      loadedUid: 'signed-user-a',
      lastRedeemedAtByCoupon: <String, DateTime>{
        'signed-coupon': DateTime.now().subtract(const Duration(minutes: 1)),
      },
      timerStartedAtByCoupon: <String, DateTime>{
        'signed-coupon': DateTime.now().add(const Duration(hours: 1)),
      },
    );

    expect(
      DemoRedemptionStore.memoryStateForTesting('signed-coupon'),
      isNotNull,
    );

    await DemoRedemptionStore.refreshFromFirestore();

    expect(DemoRedemptionStore.memoryStateForTesting('signed-coupon'), isNull);
  });

  test('older signed load cannot repopulate after null refresh', () async {
    DemoRedemptionAuthSnapshot? authSnapshot = (
      uid: 'signed-user-a',
      isAnonymous: false,
    );
    final signedLoadStarted = Completer<void>();
    final releaseSignedLoad = Completer<void>();
    DemoRedemptionStore.configureForTesting(
      currentAuthSnapshot: () => authSnapshot,
      signedStateLoader: (uid) async {
        expect(uid, 'signed-user-a');
        signedLoadStarted.complete();
        await releaseSignedLoad.future;
        return <String, DemoRedemptionStoredState>{
          'stale-signed-coupon': DemoRedemptionStoredState(
            lastRedeemedAt: DateTime.now(),
          ),
        };
      },
    );
    DemoRedemptionStore.seedMemoryForTesting(
      loadedUid: 'signed-user-a',
      lastRedeemedAtByCoupon: <String, DateTime>{
        'previous-signed-coupon': DateTime.now(),
      },
    );

    final oldSignedRefresh = DemoRedemptionStore.refreshFromFirestore();
    await signedLoadStarted.future;
    expect(
      DemoRedemptionStore.memoryStateForTesting('previous-signed-coupon'),
      isNull,
    );

    authSnapshot = null;
    await DemoRedemptionStore.refreshFromFirestore();
    releaseSignedLoad.complete();
    await oldSignedRefresh;

    expect(
      DemoRedemptionStore.memoryStateForTesting('stale-signed-coupon'),
      isNull,
    );
  });

  test('auth stream clears A memory before a blocked B load', () async {
    final authChanges = StreamController<DemoRedemptionAuthSnapshot?>(
      sync: true,
    );
    final bLoadStarted = Completer<void>();
    final releaseBLoad = Completer<void>();
    addTearDown(() async {
      if (!releaseBLoad.isCompleted) {
        releaseBLoad.complete();
      }
      await authChanges.close();
    });
    DemoRedemptionAuthSnapshot? authSnapshot = (
      uid: 'signed-user-a',
      isAnonymous: false,
    );
    DemoRedemptionStore.configureForTesting(
      currentAuthSnapshot: () => authSnapshot,
      authChanges: authChanges.stream,
      ensureAuthReady: () async {
        bLoadStarted.complete();
        await releaseBLoad.future;
      },
    );
    DemoRedemptionStore.seedMemoryForTesting(
      loadedUid: 'signed-user-a',
      timerStartedAtByCoupon: <String, DateTime>{
        'a-coupon': DateTime.now().add(const Duration(hours: 1)),
      },
    );
    await DemoRedemptionStore.ensureInitialized();

    authSnapshot = (uid: 'signed-user-b', isAnonymous: false);
    authChanges.add(authSnapshot);
    await bLoadStarted.future;
    final bLoad = DemoRedemptionStore.ensureInitialized();

    expect(DemoRedemptionStore.memoryStateForTesting('a-coupon'), isNull);

    releaseBLoad.complete();
    await bLoad;
    expect(DemoRedemptionStore.memoryStateForTesting('a-coupon'), isNull);
  });
}
