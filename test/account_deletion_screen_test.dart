@TestOn('vm')
library;

import 'dart:async';
import 'package:coupon_app/screens/account_deletion_screen.dart';
import 'package:coupon_app/services/account_deletion_service.dart';
import 'package:coupon_app/main.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class FakeDeletionUser extends Fake implements User {
  @override
  final String uid;
  @override
  final bool isAnonymous;
  FakeDeletionUser(this.uid, {this.isAnonymous = false});
  @override
  String? get email => '$uid@example.test';
  @override
  String? get phoneNumber => null;
}

class MemoryReceipts implements AccountDeletionReceiptStore {
  final Map<String, AccountDeletionReceipt> values = {};
  bool failSave = false;
  Completer<AccountDeletionReceipt?>? initialLoad;
  int loads = 0;
  @override
  Future<AccountDeletionReceipt?> load(String? uid) async {
    loads++;
    if (loads == 1 && initialLoad != null) return initialLoad!.future;
    return uid == null ? values.values.firstOrNull : values[uid];
  }

  @override
  Future<void> save(AccountDeletionReceipt receipt) async {
    if (failSave) throw StateError('injected persistence failure');
    values[receipt.uid] = receipt;
  }
}

Map<String, Object?> status([String state = 'processing']) => {
  'schemaVersion': 1,
  'operationId': 'a' * 64,
  'state': state,
  'reason': state == 'pending' ? 'billing' : null,
  'receiptAccepted': true,
};
Future<void> confirm(WidgetTester tester) async {
  await tester.ensureVisible(
    find.widgetWithText(FilledButton, 'Delete Account'),
  );
  await tester.tap(find.widgetWithText(FilledButton, 'Delete Account'));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Confirm permanent deletion'));
  await tester.pumpAndSettle();
}

void main() {
  test(
    'receipt persistence is high entropy, UID scoped, and recovers after lost response',
    () async {
      SharedPreferences.setMockInitialValues({});
      final store = LocalAccountDeletionReceiptStore();
      final a = AccountDeletionReceipt.create('A');
      expect(a.value, matches(RegExp(r'^[A-Za-z0-9_-]{43}$')));
      await store.save(a);
      expect((await store.load('A'))!.value, a.value);
      expect(await store.load('B'), isNull);
      expect((await store.load(null))!.value, a.value);
      expect(
        () =>
            AccountDeletionStatus.parse({...status(), 'state': 'deleted-ish'}),
        throwsFormatException,
      );
    },
  );
  test(
    'service sends exact self confirmation and receipt-only status, without URL/token authority',
    () async {
      final calls = <Map<String, Object?>>[];
      final api = AccountDeletionService((name, payload) async {
        calls.add({'name': name, ...payload});
        return status();
      });
      await api.request('A', 'r' * 43);
      await api.status('r' * 43);
      expect(calls[0], {
        'name': 'requestAccountDeletion',
        'schemaVersion': 1,
        'expectedUid': 'A',
        'confirmation': 'DELETE',
        'receipt': 'r' * 43,
      });
      expect(calls[1], {
        'name': 'getAccountDeletionStatus',
        'schemaVersion': 1,
        'receipt': 'r' * 43,
      });
    },
  );
  testWidgets(
    'opening and canceling submit nothing; accepted request saves receipt before dispatch',
    (tester) async {
      final user = FakeDeletionUser('A');
      final receipts = MemoryReceipts();
      var calls = 0, authCalls = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: AccountDeletionScreen(
            currentUser: () => user,
            authChanges: const Stream.empty(),
            receipts: receipts,
            reauthenticate: (_, _) async {
              authCalls++;
              return true;
            },
            service: AccountDeletionService((_, _) async {
              expect(receipts.values['A'], isNotNull);
              calls++;
              return status();
            }),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(calls, 0);
      await tester.ensureVisible(
        find.widgetWithText(FilledButton, 'Delete Account'),
      );
      await tester.tap(find.widgetWithText(FilledButton, 'Delete Account'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(calls, 0);
      expect(authCalls, 0);
      await confirm(tester);
      expect(calls, 1);
      expect(authCalls, 1);
      expect(find.text('Check deletion status'), findsOneWidget);
    },
  );
  testWidgets(
    'anonymous A to B during authentication cannot submit or display A result',
    (tester) async {
      User? current = FakeDeletionUser('A', isAnonymous: true);
      final changes = StreamController<User?>.broadcast();
      final reauth = Completer<bool>();
      var calls = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: AccountDeletionScreen(
            currentUser: () => current,
            authChanges: changes.stream,
            receipts: MemoryReceipts(),
            reauthenticate: (_, _) => reauth.future,
            service: AccountDeletionService((_, _) async {
              calls++;
              return status();
            }),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(
        find.widgetWithText(FilledButton, 'Delete Account'),
      );
      await tester.tap(find.widgetWithText(FilledButton, 'Delete Account'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Confirm permanent deletion'));
      await tester.pump();
      current = FakeDeletionUser('B', isAnonymous: true);
      changes.add(current);
      await tester.pump();
      reauth.complete(true);
      await tester.pumpAndSettle();
      expect(calls, 0);
      expect(find.text('Check deletion status'), findsNothing);
      await tester.pumpWidget(const SizedBox());
      await changes.close();
    },
  );
  testWidgets(
    'old startup restore cannot erase a newer saved receipt; reopening signed out recovers pending',
    (tester) async {
      final receipts = MemoryReceipts()
        ..initialLoad = Completer<AccountDeletionReceipt?>();
      final user = FakeDeletionUser('A');
      final service = AccountDeletionService((name, _) async {
        if (name == 'requestAccountDeletion') throw StateError('lost response');
        return status('pending');
      });
      await tester.pumpWidget(
        MaterialApp(
          home: AccountDeletionScreen(
            currentUser: () => user,
            authChanges: const Stream.empty(),
            receipts: receipts,
            reauthenticate: (_, _) async => true,
            service: service,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await confirm(tester);
      receipts.initialLoad!.complete(null);
      await tester.pumpAndSettle();
      expect(find.text('Check deletion status'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      await tester.pumpWidget(
        MaterialApp(
          home: AccountDeletionScreen(
            currentUser: () => null,
            authChanges: const Stream.empty(),
            receipts: receipts,
            service: service,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Check deletion status'));
      await tester.tap(find.text('Check deletion status'));
      await tester.pumpAndSettle();
      expect(find.textContaining('It is not complete.'), findsOneWidget);
      expect(find.text('Deletion complete.'), findsNothing);
    },
  );
  testWidgets('receipt save failure prevents request', (tester) async {
    var calls = 0;
    final user = FakeDeletionUser('A');
    await tester.pumpWidget(
      MaterialApp(
        home: AccountDeletionScreen(
          currentUser: () => user,
          authChanges: const Stream.empty(),
          receipts: MemoryReceipts()..failSave = true,
          reauthenticate: (_, _) async => true,
          service: AccountDeletionService((_, _) async {
            calls++;
            return status();
          }),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await confirm(tester);
    expect(calls, 0);
  });
  testWidgets(
    'cold CouponApp route signs in through adapter and requests without normal app bootstrap',
    (tester) async {
      final changes = StreamController<User?>.broadcast();
      User? current;
      var calls = 0;
      tester.binding.platformDispatcher.defaultRouteNameTestValue =
          accountDeletionRoute;
      addTearDown(
        tester.binding.platformDispatcher.clearDefaultRouteNameTestValue,
      );
      await tester.pumpWidget(
        CouponApp(
          testWrapCelebrationHosts: false,
          testInitializePlatformServices: false,
          testNavigationBuilder: (_, _) =>
              throw StateError('Normal shell must not run'),
          testAccountDeletionBuilder: (_) => AccountDeletionScreen(
            currentUser: () => current,
            authChanges: changes.stream,
            receipts: MemoryReceipts(),
            signIn: (provider) async {
              expect(provider, 'google');
              current = FakeDeletionUser('A');
              changes.add(current);
            },
            reauthenticate: (_, _) async => true,
            service: AccountDeletionService((_, _) async {
              calls++;
              return status();
            }),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Sign in with Google'));
      await tester.tap(find.text('Sign in with Google'));
      await tester.pumpAndSettle();
      await confirm(tester);
      expect(calls, 1);
      await tester.pumpWidget(const SizedBox());
      await changes.close();
    },
  );
}
