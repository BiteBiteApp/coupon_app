import 'dart:async';
import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/models/coupon.dart';
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

  test(
    'concurrent anonymous saves preserve both coupons and timer anchors',
    () async {
      final firstWriteStarted = Completer<void>();
      final releaseFirstWrite = Completer<void>();
      final preferences = await SharedPreferences.getInstance();
      var writes = 0;
      DemoRedemptionStore.configureForTesting(
        currentAuthSnapshot: () => (uid: 'guest', isAnonymous: true),
        guestStateWriter: (key, value) async {
          writes++;
          if (writes == 1) {
            firstWriteStarted.complete();
            await releaseFirstWrite.future;
          }
          await preferences.setString(key, value);
        },
      );
      await DemoRedemptionStore.ensureInitialized();
      final firstUse = DemoRedemptionStore.startRedeemTimer(_coupon('first'));
      await firstWriteStarted.future;
      final firstAnchor = DemoRedemptionStore.memoryStateForTesting(
        'first',
      )!.timerStartedAt;
      final secondUse = DemoRedemptionStore.startRedeemTimer(_coupon('second'));
      await _flushAsync();
      expect(
        writes,
        1,
        reason: 'A newer save must not overtake an older write.',
      );
      releaseFirstWrite.complete();
      await Future.wait([firstUse, secondUse]);
      await DemoRedemptionStore.startRedeemTimer(_coupon('first'));
      expect(
        writes,
        2,
        reason: 'Reopening an active timer must not start another use.',
      );
      final stored = jsonDecode(preferences.getString(_guestKey)!) as Map;
      expect(stored.keys, unorderedEquals(['first', 'second']));
      expect(stored['first']['timerStartedAt'], firstAnchor!.toIso8601String());
    },
  );

  test(
    'anonymous save preserves newer persisted history outside memory',
    () async {
      final preferences = await SharedPreferences.getInstance();
      DemoRedemptionStore.configureForTesting(
        currentAuthSnapshot: () => (uid: 'guest', isAnonymous: true),
      );
      await DemoRedemptionStore.ensureInitialized();
      final newer = DateTime.now();
      await preferences.setString(
        _guestKey,
        jsonEncode({
          'existing': {'lastRedeemedAt': newer.toIso8601String()},
        }),
      );
      await DemoRedemptionStore.startRedeemTimer(_coupon('another'));
      final stored = jsonDecode(preferences.getString(_guestKey)!) as Map;
      expect(stored['existing']['lastRedeemedAt'], newer.toIso8601String());
      expect(stored['another']['timerStartedAt'], isNotNull);
    },
  );

  test('guest refresh waits for a successful pending save', () async {
    final writeStarted = Completer<void>();
    final releaseWrite = Completer<void>();
    final preferences = await SharedPreferences.getInstance();
    DemoRedemptionStore.configureForTesting(
      currentAuthSnapshot: () => (uid: 'guest', isAnonymous: true),
      guestStateWriter: (key, value) async {
        writeStarted.complete();
        await releaseWrite.future;
        await preferences.setString(key, value);
      },
    );
    await DemoRedemptionStore.ensureInitialized();
    final use = DemoRedemptionStore.startRedeemTimer(_coupon('pending'));
    // Handle a concurrent refresh invalidating the caller immediately.
    final staleUse = expectLater(use, throwsStateError);
    await writeStarted.future;
    final anchor = DemoRedemptionStore.memoryStateForTesting(
      'pending',
    )!.timerStartedAt;
    final refresh = DemoRedemptionStore.refreshFromFirestore();
    await _flushAsync();
    releaseWrite.complete();
    await staleUse;
    await refresh;
    expect(
      DemoRedemptionStore.memoryStateForTesting('pending')!.timerStartedAt,
      anchor,
    );
  });

  test('read finalization preserves a newer persisted guest timer', () async {
    final preferences = await SharedPreferences.getInstance();
    final oldAnchor = DateTime.now().subtract(const Duration(minutes: 10));
    final newerAnchor = DateTime.now().subtract(const Duration(minutes: 1));
    DemoRedemptionStore.configureForTesting(
      currentAuthSnapshot: () => (uid: 'guest', isAnonymous: true),
    );
    DemoRedemptionStore.seedMemoryForTesting(
      loadedUid: 'guest',
      loadedAsGuest: true,
      loadedGuestDeviceId: 'guest-test-device',
      timerStartedAtByCoupon: {'coupon': oldAnchor},
    );
    await preferences.setString(
      _guestKey,
      jsonEncode({
        'coupon': {'timerStartedAt': newerAnchor.toIso8601String()},
      }),
    );
    expect(DemoRedemptionStore.hasActiveRedeemTimer('coupon'), isFalse);
    expect(
      DemoRedemptionStore.isAvailable('coupon', 'Once per customer'),
      isFalse,
    );
    await DemoRedemptionStore.refreshFromFirestore();
    final stored = jsonDecode(preferences.getString(_guestKey)!) as Map;
    expect(stored['coupon']['timerStartedAt'], newerAnchor.toIso8601String());
    expect(
      DemoRedemptionStore.memoryStateForTesting('coupon')!.timerStartedAt,
      newerAnchor,
    );
  });

  test('signed read finalizer cannot overwrite a newer server timer', () async {
    final oldAnchor = DateTime.now().subtract(const Duration(minutes: 10));
    final newerAnchor = DateTime.now().subtract(const Duration(minutes: 1));
    final firestore = _MemoryFirestore({
      'timerStartedAt': Timestamp.fromDate(oldAnchor),
    });
    final readStarted = Completer<void>();
    final releaseRead = Completer<void>();
    firestore.transaction.beforeRead = () async {
      readStarted.complete();
      await releaseRead.future;
    };
    DemoRedemptionStore.configureForTesting(
      currentAuthSnapshot: () => (uid: 'signed', isAnonymous: false),
      firestore: firestore,
    );
    DemoRedemptionStore.seedMemoryForTesting(
      loadedUid: 'signed',
      timerStartedAtByCoupon: {'coupon': oldAnchor},
    );
    expect(
      DemoRedemptionStore.isAvailable('coupon', 'Once per customer'),
      isFalse,
    );
    await readStarted.future;
    firestore.transaction.data['timerStartedAt'] = Timestamp.fromDate(
      newerAnchor,
    );
    releaseRead.complete();
    await _flushAsync();
    expect(firestore.transaction.writes, isEmpty);
    expect(
      firestore.transaction.data['timerStartedAt'],
      Timestamp.fromDate(newerAnchor),
    );
    expect(
      DemoRedemptionStore.memoryStateForTesting('coupon')!.timerStartedAt,
      newerAnchor,
    );
    expect(DemoRedemptionStore.hasActiveRedeemTimer('coupon'), isTrue);
  });

  test(
    'repeated reads finalize the original signed anchor only once',
    () async {
      final anchor = DateTime.now().subtract(const Duration(minutes: 10));
      final firestore = _MemoryFirestore({
        'timerStartedAt': Timestamp.fromDate(anchor),
      });
      DemoRedemptionStore.configureForTesting(
        currentAuthSnapshot: () => (uid: 'signed', isAnonymous: false),
        firestore: firestore,
      );
      DemoRedemptionStore.seedMemoryForTesting(
        loadedUid: 'signed',
        timerStartedAtByCoupon: {'coupon': anchor},
      );
      expect(DemoRedemptionStore.hasActiveRedeemTimer('coupon'), isFalse);
      expect(DemoRedemptionStore.activeTimerRemaining('coupon'), isNull);
      expect(
        DemoRedemptionStore.isAvailable('coupon', 'Once per customer'),
        isFalse,
      );
      await _flushAsync();
      expect(firestore.transaction.writes, hasLength(1));
      expect(
        firestore.transaction.data['lastRedeemedAt'],
        Timestamp.fromDate(anchor.add(DemoRedemptionStore.redeemWindow)),
      );
      expect(firestore.transaction.data['redeemedCount'], 1);
      expect(firestore.transaction.data.containsKey('timerStartedAt'), isFalse);
    },
  );

  test('delayed finalization cannot write after an account switch', () async {
    DemoRedemptionAuthSnapshot? auth = (uid: 'a', isAnonymous: false);
    final authWaitStarted = Completer<void>();
    final releaseAuthWait = Completer<void>();
    final firestore = _MemoryFirestore({});
    DemoRedemptionStore.configureForTesting(
      currentAuthSnapshot: () => auth,
      firestore: firestore,
      ensureAuthReady: () async {
        authWaitStarted.complete();
        await releaseAuthWait.future;
      },
    );
    DemoRedemptionStore.seedMemoryForTesting(
      loadedUid: 'a',
      timerStartedAtByCoupon: {
        'coupon': DateTime.now().subtract(const Duration(minutes: 10)),
      },
    );
    DemoRedemptionStore.hasActiveRedeemTimer('coupon');
    await authWaitStarted.future;
    auth = (uid: 'b', isAnonymous: false);
    final bAnchor = DateTime.now();
    DemoRedemptionStore.seedMemoryForTesting(
      loadedUid: 'b',
      timerStartedAtByCoupon: {'coupon': bAnchor},
    );
    releaseAuthWait.complete();
    await _flushAsync();
    expect(firestore.collectionPaths, isEmpty);
    expect(
      DemoRedemptionStore.memoryStateForTesting('coupon')!.timerStartedAt,
      bAnchor,
    );
  });

  test(
    'bounded retirement disables legacy operations and preserves device history',
    () async {
      final preferences = await SharedPreferences.getInstance();
      const storedHistory =
          '{"coupon":{"lastRedeemedAt":"2026-09-01T10:00:00.000Z"}}';
      await preferences.setString(_guestKey, storedHistory);
      var reads = 0;
      final firestore = _MemoryFirestore({});
      DemoRedemptionStore.configureForTesting(
        currentAuthSnapshot: () => (uid: 'signed', isAnonymous: false),
        firestore: firestore,
        signedStateLoader: (_) async {
          reads++;
          return {};
        },
      );
      DemoRedemptionStore.seedMemoryForTesting(
        loadedUid: 'signed',
        timerStartedAtByCoupon: {
          'coupon': DateTime.now().subtract(const Duration(minutes: 10)),
        },
      );
      DemoRedemptionStore.retireLegacyWritersForBoundedCutover();
      expect(DemoRedemptionStore.legacyWritesEnabled, isFalse);
      await DemoRedemptionStore.ensureInitialized();
      await DemoRedemptionStore.refreshFromFirestore();
      DemoRedemptionStore.hasActiveRedeemTimer('coupon');
      await expectLater(
        DemoRedemptionStore.startRedeemTimer(_coupon('coupon')),
        throwsStateError,
      );
      expect(preferences.getString(_guestKey), storedHistory);
      expect(reads, 0);
      expect(firestore.collectionPaths, isEmpty);
      expect(DemoRedemptionStore.memoryStateForTesting('coupon'), isNull);
    },
  );

  test(
    'bounded retirement invalidates an in-flight signed finalizer',
    () async {
      final anchor = DateTime.now().subtract(const Duration(minutes: 10));
      final firestore = _MemoryFirestore({
        'timerStartedAt': Timestamp.fromDate(anchor),
      });
      final readStarted = Completer<void>();
      final releaseRead = Completer<void>();
      firestore.transaction.beforeRead = () async {
        readStarted.complete();
        await releaseRead.future;
      };
      DemoRedemptionStore.configureForTesting(
        currentAuthSnapshot: () => (uid: 'signed', isAnonymous: false),
        firestore: firestore,
      );
      DemoRedemptionStore.seedMemoryForTesting(
        loadedUid: 'signed',
        timerStartedAtByCoupon: {'coupon': anchor},
      );
      DemoRedemptionStore.hasActiveRedeemTimer('coupon');
      await readStarted.future;
      DemoRedemptionStore.retireLegacyWritersForBoundedCutover();
      releaseRead.complete();
      await _flushAsync();
      expect(firestore.transaction.writes, isEmpty);
    },
  );

  test('newer signed history blocks a use pending old finalization', () async {
    final oldAnchor = DateTime.now().subtract(const Duration(days: 2));
    final newerUse = DateTime.now();
    final firestore = _MemoryFirestore({
      'lastRedeemedAt': Timestamp.fromDate(newerUse),
    });
    final readStarted = Completer<void>();
    final releaseRead = Completer<void>();
    firestore.transaction.beforeRead = () async {
      readStarted.complete();
      await releaseRead.future;
    };
    DemoRedemptionStore.configureForTesting(
      currentAuthSnapshot: () => (uid: 'signed', isAnonymous: false),
      firestore: firestore,
    );
    DemoRedemptionStore.seedMemoryForTesting(
      loadedUid: 'signed',
      timerStartedAtByCoupon: {'coupon': oldAnchor},
    );
    final use = DemoRedemptionStore.startRedeemTimer(
      _coupon('coupon').copyWith(usageRule: 'Once per day'),
    );
    final failedUse = expectLater(use, throwsException);
    await readStarted.future;
    releaseRead.complete();
    await failedUse;
    expect(firestore.transaction.writes, isEmpty);
    expect(
      DemoRedemptionStore.memoryStateForTesting('coupon')!.lastRedeemedAt,
      newerUse,
    );
    expect(DemoRedemptionStore.isAvailable('coupon', 'Once per day'), isFalse);
    expect(DemoRedemptionStore.hasActiveRedeemTimer('coupon'), isFalse);
  });

  test(
    'offline signed finalization preserves completion and retries on refresh',
    () async {
      final anchor = DateTime.now().subtract(const Duration(minutes: 10));
      final firestore = _MemoryFirestore({
        'timerStartedAt': Timestamp.fromDate(anchor),
      });
      firestore.transactionFailure = FirebaseException(
        plugin: 'cloud_firestore',
        code: 'unavailable',
      );
      DemoRedemptionStore.configureForTesting(
        currentAuthSnapshot: () => (uid: 'signed', isAnonymous: false),
        firestore: firestore,
        signedStateLoader: (_) async => {
          'coupon': DemoRedemptionStoredState(timerStartedAt: anchor),
        },
      );
      await DemoRedemptionStore.ensureInitialized();
      expect(
        DemoRedemptionStore.isAvailable('coupon', 'Once per customer'),
        isFalse,
      );
      expect(
        firestore.transaction.data['timerStartedAt'],
        Timestamp.fromDate(anchor),
      );
      expect(firestore.transaction.writes, isEmpty);
      firestore.transactionFailure = null;
      await DemoRedemptionStore.refreshFromFirestore();
      expect(firestore.transaction.writes, hasLength(1));
      expect(
        firestore.transaction.data['lastRedeemedAt'],
        Timestamp.fromDate(anchor.add(DemoRedemptionStore.redeemWindow)),
      );
      expect(firestore.transaction.data['redeemedCount'], 1);
    },
  );

  test(
    'daily use retries deferred completion before replacing its timer',
    () async {
      final anchor = DateTime.now().subtract(const Duration(days: 2));
      final firestore = _MemoryFirestore({
        'timerStartedAt': Timestamp.fromDate(anchor),
      });
      firestore.transactionFailure = FirebaseException(
        plugin: 'cloud_firestore',
        code: 'unavailable',
      );
      DemoRedemptionStore.configureForTesting(
        currentAuthSnapshot: () => (uid: 'signed', isAnonymous: false),
        firestore: firestore,
      );
      DemoRedemptionStore.seedMemoryForTesting(
        loadedUid: 'signed',
        timerStartedAtByCoupon: {'coupon': anchor},
      );
      expect(DemoRedemptionStore.hasActiveRedeemTimer('coupon'), isFalse);
      await _flushAsync();
      expect(firestore.transaction.writes, isEmpty);
      expect(
        firestore.transaction.data['timerStartedAt'],
        Timestamp.fromDate(anchor),
      );

      firestore.transactionFailure = null;
      await DemoRedemptionStore.startRedeemTimer(
        _coupon('coupon').copyWith(usageRule: 'Once per day'),
      );

      expect(firestore.transaction.writes, hasLength(1));
      expect(
        firestore.transaction.data['lastRedeemedAt'],
        Timestamp.fromDate(anchor.add(DemoRedemptionStore.redeemWindow)),
      );
      expect(firestore.transaction.data['redeemedCount'], 1);
      expect(firestore.transaction.directWrites, hasLength(1));
      expect(
        firestore.transaction.data['timerStartedAt'],
        isNot(Timestamp.fromDate(anchor)),
      );
    },
  );

  test(
    'daily use retains deferred completion when its explicit retry fails',
    () async {
      final anchor = DateTime.now().subtract(const Duration(days: 2));
      final firestore = _MemoryFirestore({
        'timerStartedAt': Timestamp.fromDate(anchor),
      });
      firestore.transactionFailure = FirebaseException(
        plugin: 'cloud_firestore',
        code: 'unavailable',
      );
      DemoRedemptionStore.configureForTesting(
        currentAuthSnapshot: () => (uid: 'signed', isAnonymous: false),
        firestore: firestore,
      );
      DemoRedemptionStore.seedMemoryForTesting(
        loadedUid: 'signed',
        timerStartedAtByCoupon: {'coupon': anchor},
      );
      DemoRedemptionStore.hasActiveRedeemTimer('coupon');
      await _flushAsync();

      final dailyCoupon = _coupon('coupon').copyWith(usageRule: 'Once per day');
      await expectLater(
        DemoRedemptionStore.startRedeemTimer(dailyCoupon),
        throwsA(
          isA<FirebaseException>().having(
            (error) => error.code,
            'code',
            'unavailable',
          ),
        ),
      );
      expect(firestore.transaction.writes, isEmpty);
      expect(firestore.transaction.directWrites, isEmpty);
      expect(
        firestore.transaction.data['timerStartedAt'],
        Timestamp.fromDate(anchor),
      );
      expect(DemoRedemptionStore.hasActiveRedeemTimer('coupon'), isFalse);

      firestore.transactionFailure = null;
      await DemoRedemptionStore.startRedeemTimer(dailyCoupon);
      expect(firestore.transaction.writes, hasLength(1));
      expect(firestore.transaction.data['redeemedCount'], 1);
      expect(firestore.transaction.directWrites, hasLength(1));
    },
  );

  test(
    'deferred retry respects newer signed history before daily use',
    () async {
      final anchor = DateTime.now().subtract(const Duration(days: 2));
      final newerUse = DateTime.now();
      final firestore = _MemoryFirestore({
        'timerStartedAt': Timestamp.fromDate(anchor),
      });
      firestore.transactionFailure = FirebaseException(
        plugin: 'cloud_firestore',
        code: 'unavailable',
      );
      DemoRedemptionStore.configureForTesting(
        currentAuthSnapshot: () => (uid: 'signed', isAnonymous: false),
        firestore: firestore,
      );
      DemoRedemptionStore.seedMemoryForTesting(
        loadedUid: 'signed',
        timerStartedAtByCoupon: {'coupon': anchor},
      );
      DemoRedemptionStore.hasActiveRedeemTimer('coupon');
      await _flushAsync();

      firestore.transactionFailure = null;
      firestore.transaction.data
        ..remove('timerStartedAt')
        ..['lastRedeemedAt'] = Timestamp.fromDate(newerUse)
        ..['redeemedCount'] = 7;
      await expectLater(
        DemoRedemptionStore.startRedeemTimer(
          _coupon('coupon').copyWith(usageRule: 'Once per day'),
        ),
        throwsException,
      );
      expect(firestore.transaction.writes, isEmpty);
      expect(firestore.transaction.directWrites, isEmpty);
      expect(firestore.transaction.data['redeemedCount'], 7);
      expect(
        DemoRedemptionStore.memoryStateForTesting('coupon')!.lastRedeemedAt,
        newerUse,
      );
    },
  );

  test(
    'daily use waits for a newer expired timer found during retry',
    () async {
      final anchor = DateTime.now().subtract(const Duration(days: 3));
      final newerAnchor = DateTime.now().subtract(const Duration(days: 2));
      final firestore = _MemoryFirestore({
        'timerStartedAt': Timestamp.fromDate(anchor),
      });
      firestore.transactionFailure = FirebaseException(
        plugin: 'cloud_firestore',
        code: 'unavailable',
      );
      DemoRedemptionStore.configureForTesting(
        currentAuthSnapshot: () => (uid: 'signed', isAnonymous: false),
        firestore: firestore,
      );
      DemoRedemptionStore.seedMemoryForTesting(
        loadedUid: 'signed',
        timerStartedAtByCoupon: {'coupon': anchor},
      );
      DemoRedemptionStore.hasActiveRedeemTimer('coupon');
      await _flushAsync();

      firestore.transactionFailure = null;
      firestore.transaction.data['timerStartedAt'] = Timestamp.fromDate(
        newerAnchor,
      );
      final secondReadStarted = Completer<void>();
      final releaseSecondRead = Completer<void>();
      addTearDown(() {
        if (!releaseSecondRead.isCompleted) releaseSecondRead.complete();
      });
      var reads = 0;
      firestore.transaction.beforeRead = () async {
        if (++reads == 2) {
          secondReadStarted.complete();
          await releaseSecondRead.future;
        }
      };
      final use = DemoRedemptionStore.startRedeemTimer(
        _coupon('coupon').copyWith(usageRule: 'Once per day'),
      );
      await secondReadStarted.future;
      await _flushAsync();
      expect(firestore.transaction.directWrites, isEmpty);
      releaseSecondRead.complete();
      await use;
      expect(firestore.transaction.writes, hasLength(1));
      expect(
        firestore.transaction.data['lastRedeemedAt'],
        Timestamp.fromDate(newerAnchor.add(DemoRedemptionStore.redeemWindow)),
      );
      expect(firestore.transaction.data['redeemedCount'], 1);
      expect(firestore.transaction.directWrites, hasLength(1));
    },
  );

  for (final retire in [false, true]) {
    test(
      'deferred retry cannot start use after ${retire ? 'bounded retirement' : 'account switch'}',
      () async {
        DemoRedemptionAuthSnapshot? auth = (uid: 'a', isAnonymous: false);
        final anchor = DateTime.now().subtract(const Duration(days: 2));
        final firestore = _MemoryFirestore({
          'timerStartedAt': Timestamp.fromDate(anchor),
        });
        firestore.transactionFailure = FirebaseException(
          plugin: 'cloud_firestore',
          code: 'unavailable',
        );
        DemoRedemptionStore.configureForTesting(
          currentAuthSnapshot: () => auth,
          firestore: firestore,
        );
        DemoRedemptionStore.seedMemoryForTesting(
          loadedUid: 'a',
          timerStartedAtByCoupon: {'coupon': anchor},
        );
        DemoRedemptionStore.hasActiveRedeemTimer('coupon');
        await _flushAsync();

        firestore.transactionFailure = null;
        final readStarted = Completer<void>();
        final releaseRead = Completer<void>();
        addTearDown(() {
          if (!releaseRead.isCompleted) releaseRead.complete();
        });
        firestore.transaction.beforeRead = () async {
          readStarted.complete();
          await releaseRead.future;
        };
        final failedUse = expectLater(
          DemoRedemptionStore.startRedeemTimer(
            _coupon('coupon').copyWith(usageRule: 'Once per day'),
          ),
          throwsStateError,
        );
        await readStarted.future;
        final bAnchor = DateTime.now();
        if (retire) {
          DemoRedemptionStore.retireLegacyWritersForBoundedCutover();
        } else {
          auth = (uid: 'b', isAnonymous: false);
          DemoRedemptionStore.seedMemoryForTesting(
            loadedUid: 'b',
            timerStartedAtByCoupon: {'coupon': bAnchor},
          );
        }
        releaseRead.complete();
        await failedUse;
        expect(firestore.transaction.writes, isEmpty);
        expect(firestore.transaction.directWrites, isEmpty);
        expect(
          DemoRedemptionStore.memoryStateForTesting('coupon')?.timerStartedAt,
          retire ? isNull : bAnchor,
        );
      },
    );
  }

  for (final historyKind in ['used', 'expiredTimer', 'activeTimer']) {
    test(
      'signed refresh enforces local $historyKind without importing account history',
      () async {
        final preferences = await SharedPreferences.getInstance();
        final anchor = DateTime.now().subtract(
          Duration(minutes: historyKind == 'activeTimer' ? 1 : 10),
        );
        final storedHistory = jsonEncode({
          'coupon': {
            historyKind == 'used' ? 'lastRedeemedAt' : 'timerStartedAt': anchor
                .toIso8601String(),
          },
        });
        await preferences.setString(_guestKey, storedHistory);
        final firestore = _MemoryFirestore({});
        DemoRedemptionStore.configureForTesting(
          currentAuthSnapshot: () => (uid: 'signed', isAnonymous: false),
          firestore: firestore,
        );

        await DemoRedemptionStore.refreshFromFirestore();

        expect(firestore.transaction.writes, isEmpty);
        expect(firestore.transaction.directWrites, isEmpty);
        expect(firestore.transaction.data, isEmpty);
        expect(preferences.getString(_guestKey), storedHistory);
        if (historyKind == 'activeTimer') {
          expect(DemoRedemptionStore.hasActiveRedeemTimer('coupon'), isTrue);
          expect(
            DemoRedemptionStore.memoryStateForTesting('coupon')!.timerStartedAt,
            anchor,
          );
        } else {
          expect(
            DemoRedemptionStore.isAvailable('coupon', 'Once per customer'),
            isFalse,
          );
        }
      },
    );
  }

  test(
    'device-only expiry preserves existing account history without a timer',
    () async {
      final anchor = DateTime.now().subtract(const Duration(minutes: 10));
      final previousUse = anchor.subtract(const Duration(days: 1));
      final firestore = _MemoryFirestore({
        'lastRedeemedAt': Timestamp.fromDate(previousUse),
        'redeemedCount': 3,
      });
      DemoRedemptionStore.configureForTesting(
        currentAuthSnapshot: () => (uid: 'signed', isAnonymous: false),
        firestore: firestore,
      );
      DemoRedemptionStore.seedMemoryForTesting(
        loadedUid: 'signed',
        timerStartedAtByCoupon: {'coupon': anchor},
      );

      expect(DemoRedemptionStore.hasActiveRedeemTimer('coupon'), isFalse);
      await _flushAsync();

      expect(firestore.transaction.writes, isEmpty);
      expect(firestore.transaction.directWrites, isEmpty);
      expect(firestore.transaction.data, {
        'lastRedeemedAt': Timestamp.fromDate(previousUse),
        'redeemedCount': 3,
      });
      expect(
        DemoRedemptionStore.isAvailable('coupon', 'Once per customer'),
        isFalse,
      );
    },
  );

  test(
    'initialization finalizes expired guest use at its original anchor',
    () async {
      final anchor = DateTime.now().subtract(const Duration(minutes: 10));
      final preferences = await SharedPreferences.getInstance();
      await preferences.setString(
        _guestKey,
        jsonEncode({
          'coupon': {'timerStartedAt': anchor.toIso8601String()},
        }),
      );
      var writes = 0;
      DemoRedemptionStore.configureForTesting(
        currentAuthSnapshot: () => (uid: 'guest', isAnonymous: true),
        guestStateWriter: (key, value) async {
          writes++;
          await preferences.setString(key, value);
        },
      );
      await DemoRedemptionStore.ensureInitialized();
      expect(DemoRedemptionStore.activeTimerRemaining('coupon'), isNull);
      expect(
        DemoRedemptionStore.isAvailable('coupon', 'Once per customer'),
        isFalse,
      );
      await _flushAsync();
      final stored = jsonDecode(preferences.getString(_guestKey)!) as Map;
      expect(
        stored['coupon']['lastRedeemedAt'],
        anchor.add(DemoRedemptionStore.redeemWindow).toIso8601String(),
      );
      expect(stored['coupon'].containsKey('timerStartedAt'), isFalse);
      expect(writes, 1);
    },
  );

  test(
    'viewing unused or active coupons never writes or restarts a timer',
    () async {
      final anchor = DateTime.now().subtract(const Duration(minutes: 1));
      final firestore = _MemoryFirestore({});
      DemoRedemptionStore.configureForTesting(
        currentAuthSnapshot: () => (uid: 'signed', isAnonymous: false),
        firestore: firestore,
      );
      DemoRedemptionStore.seedMemoryForTesting(
        loadedUid: 'signed',
        timerStartedAtByCoupon: {'active': anchor},
      );
      expect(
        DemoRedemptionStore.isAvailable('unused', 'Once per customer'),
        isTrue,
      );
      expect(DemoRedemptionStore.hasActiveRedeemTimer('active'), isTrue);
      expect(DemoRedemptionStore.activeTimerRemaining('active'), isNotNull);
      await DemoRedemptionStore.startRedeemTimer(_coupon('active'));
      await _flushAsync();
      expect(firestore.collectionPaths, isEmpty);
      expect(
        DemoRedemptionStore.memoryStateForTesting('active')!.timerStartedAt,
        anchor,
      );
    },
  );
}

const _guestKey = 'guest_coupon_redemptions_guest-test-device';

Coupon _coupon(String id) => Coupon(
  id: id,
  restaurant: 'Restaurant',
  title: 'Offer',
  distance: '1 mi',
  usageRule: 'Once per customer',
);

Future<void> _flushAsync() => Future<void>.delayed(Duration.zero);

class _MemoryFirestore extends Fake implements FirebaseFirestore {
  _MemoryFirestore(Map<String, dynamic> data)
    : transaction = _MemoryTransaction(data);
  final _MemoryTransaction transaction;
  final List<String> collectionPaths = [];
  FirebaseException? transactionFailure;

  @override
  CollectionReference<Map<String, dynamic>> collection(String path) {
    collectionPaths.add(path);
    return _MemoryCollection(transaction);
  }

  @override
  Future<T> runTransaction<T>(
    TransactionHandler<T> transactionHandler, {
    Duration timeout = const Duration(seconds: 30),
    int maxAttempts = 5,
  }) async {
    if (transactionFailure case final failure?) throw failure;
    return transactionHandler(transaction);
  }
}

// Test-only Firestore doubles exercise transaction decisions without a backend.
// ignore: subtype_of_sealed_class
class _MemoryCollection extends Fake
    implements CollectionReference<Map<String, dynamic>> {
  _MemoryCollection(this.transaction);
  final _MemoryTransaction transaction;

  @override
  DocumentReference<Map<String, dynamic>> doc([String? path]) =>
      _MemoryDocument(transaction);
}

// Test-only Firestore doubles exercise transaction decisions without a backend.
// ignore: subtype_of_sealed_class
class _MemoryDocument extends Fake
    implements DocumentReference<Map<String, dynamic>> {
  _MemoryDocument(this.transaction);
  final _MemoryTransaction transaction;

  @override
  CollectionReference<Map<String, dynamic>> collection(String path) =>
      _MemoryCollection(transaction);

  @override
  Future<void> set(Map<String, dynamic> data, [SetOptions? options]) async {
    transaction.directWrites.add(data);
    transaction.data.addAll(data);
  }
}

// Test-only Firestore doubles exercise transaction decisions without a backend.
// ignore: subtype_of_sealed_class
class _MemorySnapshot<T extends Object?> extends Fake
    implements DocumentSnapshot<T> {
  _MemorySnapshot(this.value);
  final T value;
  @override
  T data() => value;
}

class _MemoryTransaction extends Fake implements Transaction {
  _MemoryTransaction(this.data);
  final Map<String, dynamic> data;
  final List<Map<String, dynamic>> writes = [];
  final List<Map<String, dynamic>> directWrites = [];
  Future<void> Function()? beforeRead;

  @override
  Future<DocumentSnapshot<T>> get<T extends Object?>(
    DocumentReference<T> documentReference,
  ) async {
    await beforeRead?.call();
    return _MemorySnapshot<T>(Map<String, dynamic>.from(data) as T);
  }

  @override
  Transaction set<T>(
    DocumentReference<T> documentReference,
    T value, [
    SetOptions? options,
  ]) {
    final patch = value as Map<String, dynamic>;
    writes.add(patch);
    if (patch.containsKey('timerStartedAt')) data.remove('timerStartedAt');
    if (patch.containsKey('lastRedeemedAt')) {
      data['lastRedeemedAt'] = patch['lastRedeemedAt'];
    }
    if (patch.containsKey('redeemedCount')) {
      data['redeemedCount'] = (data['redeemedCount'] as int? ?? 0) + 1;
    }
    return this;
  }
}
