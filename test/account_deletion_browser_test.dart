@TestOn('browser')
library;

import 'dart:async';
import 'package:coupon_app/screens/account_deletion_screen.dart';
import 'package:coupon_app/services/account_deletion_service.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class BrowserDeletionUser extends Fake implements User {
  @override
  String get uid => 'local-browser-A';
  @override
  bool get isAnonymous => false;
  @override
  String? get email => 'local-browser-A@example.test';
  @override
  String? get phoneNumber => null;
}

class BrowserReceipts implements AccountDeletionReceiptStore {
  AccountDeletionReceipt? saved;
  @override
  Future<AccountDeletionReceipt?> load(String? uid) async =>
      uid == null || uid == saved?.uid ? saved : null;
  @override
  Future<void> save(AccountDeletionReceipt receipt) async => saved = receipt;
}

void main() {
  // This entry never imports or launches application main, and initializes no
  // Firebase instance. Providers, service calls, user state and receipts are fake.
  for (final entry in {
    'password': 'Sign in with email',
    'google': 'Sign in with Google',
    'phone': 'Sign in with phone',
  }.entries) {
    testWidgets('Chrome isolated deletion screen with fake ${entry.key}', (
      tester,
    ) async {
      User? current;
      final changes = StreamController<User?>.broadcast();
      final receipts = BrowserReceipts();
      final calls = <String>[];
      var reauthCalls = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: AccountDeletionScreen(
            currentUser: () => current,
            authChanges: changes.stream,
            receipts: receipts,
            signIn: (provider) async {
              expect(provider, entry.key);
              current = BrowserDeletionUser();
              changes.add(current);
            },
            reauthenticate: (_, user) async {
              expect(user.uid, 'local-browser-A');
              reauthCalls++;
              return true;
            },
            service: AccountDeletionService((name, payload) async {
              expect(receipts.saved, isNotNull);
              calls.add(name);
              if (name == 'requestAccountDeletion') {
                expect(payload['expectedUid'], 'local-browser-A');
                expect(payload['confirmation'], 'DELETE');
              }
              return {
                'schemaVersion': 1,
                'operationId': 'a' * 64,
                'state': name == 'requestAccountDeletion'
                    ? 'processing'
                    : 'pending',
                'reason': name == 'requestAccountDeletion' ? null : 'billing',
                'receiptAccepted': true,
              };
            }),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(calls, isEmpty);
      await tester.ensureVisible(find.text(entry.value));
      await tester.tap(find.text(entry.value));
      await tester.pumpAndSettle();
      Future<void> openConfirmation() async {
        final button = find.widgetWithText(FilledButton, 'Delete Account');
        await tester.ensureVisible(button);
        await tester.tap(button);
        await tester.pumpAndSettle();
      }

      await openConfirmation();
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(calls, isEmpty);
      expect(reauthCalls, 0);
      await openConfirmation();
      await tester.tap(find.text('Confirm permanent deletion'));
      await tester.pumpAndSettle();
      expect(calls, ['requestAccountDeletion']);
      expect(reauthCalls, 1);
      await tester.ensureVisible(find.text('Check deletion status'));
      await tester.tap(find.text('Check deletion status'));
      await tester.pumpAndSettle();
      expect(calls, ['requestAccountDeletion', 'getAccountDeletionStatus']);
      expect(find.textContaining('It is not complete.'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      await changes.close();
    });
  }
}
