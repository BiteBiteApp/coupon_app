import 'dart:async';

import 'package:coupon_app/services/account_provider_service.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  late _Auth auth;
  late AccountProviderService service;
  setUp(() {
    auth = _Auth();
    service = AccountProviderService(auth: auth);
  });

  test(
    'reset uses trimmed email and default Firebase action handling only',
    () async {
      await service.sendPasswordResetEmail('  Person@example.test  ');
      expect(auth.emails, ['Person@example.test']);
      expect(auth.actionSettings, isNull);
      // All other SDK methods on this Fake throw, including session/provider edits.
    },
  );

  for (final email in [
    '',
    ' ',
    'missing-domain',
    'a@',
    '@example.test',
    'a b@example.test',
    'a@@example.test',
  ]) {
    test('invalid email is rejected before SDK request: $email', () async {
      await expectLater(
        service.sendPasswordResetEmail(email),
        throwsCode('invalid-email'),
      );
      expect(auth.emails, isEmpty);
    });
  }

  for (final code in ['user-not-found', 'user-disabled']) {
    test('$code has the same accepted outcome', () async {
      auth.error = FirebaseAuthException(
        code: code,
        message: 'private internal detail',
      );
      await service.sendPasswordResetEmail('person@example.test');
      expect(auth.emails, hasLength(1));
    });
  }

  test(
    'concurrent requests across dialogs cannot issue another SDK call; retry after failure works',
    () async {
      final pending = Completer<void>();
      auth.pending = pending.future;
      final first = service.sendPasswordResetEmail('first@example.test');
      await expectLater(
        service.sendPasswordResetEmail('second@example.test'),
        throwsCode('too-many-requests'),
      );
      expect(auth.emails, ['first@example.test']);
      final failure = expectLater(first, throwsCode('network-request-failed'));
      pending.completeError(
        FirebaseAuthException(code: 'network-request-failed'),
      );
      await failure;
      auth.pending = null;
      await service.sendPasswordResetEmail('second@example.test');
      expect(auth.emails, ['first@example.test', 'second@example.test']);
    },
  );
}

Matcher throwsCode(String code) =>
    throwsA(isA<FirebaseAuthException>().having((e) => e.code, 'code', code));

class _Auth extends Fake implements FirebaseAuth {
  final emails = <String>[];
  ActionCodeSettings? actionSettings;
  Object? error;
  Future<void>? pending;
  @override
  Future<void> sendPasswordResetEmail({
    required String email,
    ActionCodeSettings? actionCodeSettings,
  }) async {
    emails.add(email);
    actionSettings = actionCodeSettings;
    if (error != null) throw error!;
    await pending;
  }
}
