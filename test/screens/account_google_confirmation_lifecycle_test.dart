import 'dart:async';

import 'package:coupon_app/widgets/account_auth_confirmation.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_sign_in_platform_interface/google_sign_in_platform_interface.dart';

void main() {
  testWidgets(
    'Cancel, Back and barrier ignore late Google completion and preserve the form',
    (tester) async {
      // Google initializes once per app lifetime; exercise all dismissals in that
      // same lifetime rather than carrying its Future across fake-async test zones.
      final platform = _Google();
      GoogleSignInPlatform.instance = platform;
      for (final dismiss in ['Cancel', 'Back', 'barrier']) {
        platform.release = Completer<AuthenticationResults>();
        platform.calls = 0;
        final nav = GlobalKey<NavigatorState>();
        String? result;
        await tester.pumpWidget(
          MaterialApp(
            navigatorKey: nav,
            home: const Scaffold(body: Text('Origin')),
          ),
        );
        unawaited(
          nav.currentState!.push(
            MaterialPageRoute<void>(
              builder: (context) => Scaffold(
                body: TextButton(
                  onPressed: () async {
                    result = await confirmGoogleForEmail(
                      context,
                      'person@example.test',
                    );
                  },
                  child: const Text('Form route'),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.text('Form route'));
        await tester.pumpAndSettle();
        expect(
          find.textContaining('add this password and finish signing in'),
          findsOneWidget,
        );
        await tester.tap(find.text('Continue with Google'));
        await tester.pump();
        expect(platform.calls, 1, reason: dismiss);
        if (dismiss == 'Cancel') {
          await tester.tap(find.text('Cancel'));
        } else if (dismiss == 'Back') {
          nav.currentState!.pop();
        } else {
          await tester.tapAt(const Offset(5, 5));
        }
        await tester
            .pump(); // Dialog remains mounted during the reverse animation.
        platform.release.complete(
          const AuthenticationResults(
            user: GoogleSignInUserData(
              email: 'person@example.test',
              id: 'synthetic',
            ),
            authenticationTokens: AuthenticationTokenData(
              idToken: 'synthetic-local-test',
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(result, isNull, reason: dismiss);
        expect(find.text('Form route'), findsOneWidget, reason: dismiss);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pumpAndSettle();
      }
    },
    skip: kIsWeb,
  );
}

class _Google extends GoogleSignInPlatform {
  late Completer<AuthenticationResults> release;
  int calls = 0;
  @override
  Future<void> init(InitParameters parameters) async {}
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
  @override
  Stream<AuthenticationEvent>? get authenticationEvents => null;
  @override
  Future<AuthenticationResults> authenticate(
    AuthenticateParameters parameters,
  ) {
    calls++;
    return release.future;
  }
}
