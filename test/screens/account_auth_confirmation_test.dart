import 'dart:async';

import 'package:coupon_app/screens/customer_account_screen.dart';
import 'package:coupon_app/screens/restaurant_auth_screen.dart';
import 'package:coupon_app/screens/restaurant_owner_hub_screen.dart';
import 'package:coupon_app/services/account_provider_service.dart';
import 'package:coupon_app/services/bitescore_sign_in_gate.dart';
import 'package:coupon_app/widgets/account_auth_confirmation.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  for (final providers in [
    <String>['google.com'],
    <String>['google.com', 'password'],
    <String>['password'],
  ]) {
    testWidgets('Account has no permanent password setup: $providers', (
      tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          home: CustomerAccountScreen(
            userStream: Stream.value(_User(providers)),
            profileDestinationBuilder: (_, _) => const SizedBox(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Set up password'), findsNothing);
      expect(find.text('My Profile'), findsOneWidget);
      expect(find.text('Sign Out'), findsOneWidget);
    });
  }

  testWidgets(
    'restaurant Owner Hub keeps its destinations without password setup',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: RestaurantOwnerHubScreen(currentUser: _User(['google.com'])),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Set up password'), findsNothing);
      expect(find.text('Owner Hub'), findsOneWidget);
      expect(find.text('Sign Out'), findsOneWidget);
      expect(find.text('Take me to the Coupon Side'), findsOneWidget);
    },
  );

  testWidgets('signed-out Account has no advance-setup instructions', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(home: CustomerAccountScreen(userStream: Stream.value(null))),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('Joined with Google?'), findsNothing);
    expect(find.text('Sign in with Google'), findsOneWidget);
  });

  testWidgets('existing password confirmation is contextual and cancelable', (
    tester,
  ) async {
    String? confirmed;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () async {
                confirmed = await confirmExistingAccountPassword(
                  context,
                  'same@example.test',
                );
              },
              child: const Text('Begin'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Begin'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), ' old password ');
    await tester.tap(find.text('Confirm'));
    await tester.pumpAndSettle();
    expect(confirmed, ' old password ');
    expect(find.byType(AlertDialog), findsNothing);
  });

  testWidgets(
    'restaurant email login preserves the password including edge spaces',
    (tester) async {
      String? received;
      await tester.pumpWidget(
        MaterialApp(
          home: RestaurantAuthScreen(
            authStateStream: Stream.value(null),
            authenticateWithEmail:
                ({
                  required isLoginMode,
                  required email,
                  required password,
                }) async {
                  received = password;
                  return null;
                },
          ),
        ),
      );
      await tester.pumpAndSettle();
      final email = find.byWidgetPredicate(
        (w) => w is TextField && w.decoration?.labelText == 'Email',
      );
      final password = find.byWidgetPredicate(
        (w) => w is TextField && w.decoration?.labelText == 'Password',
      );
      await tester.enterText(email, 'person@example.test');
      await tester.enterText(password, ' spaced password ');
      await tester.ensureVisible(
        find.widgetWithText(ElevatedButton, 'Sign In'),
      );
      await tester.tap(find.widgetWithText(ElevatedButton, 'Sign In'));
      await tester.pumpAndSettle();
      expect(received, ' spaced password ');
    },
  );

  for (final succeeds in [true, false]) {
    testWidgets(
      'BiteScore route waits through intermediate password login; association success=$succeeds',
      (tester) async {
        final users = StreamController<User?>.broadcast(sync: true);
        final auth = _GateAuth();
        final service = AccountProviderService(auth: auth, isWeb: true);
        final release = Completer<void>();
        final user = _User(['google.com']);
        auth.user = user;
        user.onReload = () async {
          users.add(user); // The intermediate authenticated Firebase session.
          await release.future;
          if (!succeeds) {
            throw FirebaseAuthException(code: 'invalid-credential');
          }
        };
        await tester.pumpWidget(
          MaterialApp(
            home: Builder(
              builder: (context) => Scaffold(
                body: TextButton(
                  onPressed: () => Navigator.of(context).push<bool>(
                    MaterialPageRoute<bool>(
                      builder: (_) => BiteScoreSignInGate.signInRouteForTesting(
                        users: users.stream,
                        child: const Text('Association route'),
                      ),
                    ),
                  ),
                  child: const Text('Open sign in'),
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('Open sign in'));
        await tester.pumpAndSettle();
        // Start signed out; the transport publishes its result before reload.
        auth.current = null;
        User? resultUser;
        Object? resultError;
        final completion = service
            .signInWithGoogle(linkGuest: false)
            .then(
              (user) {
                resultUser = user;
              },
              onError: (Object error) {
                resultError = error;
              },
            );
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 500));
        expect(find.text('Association route'), findsOneWidget);
        release.complete();
        await tester.pump();
        await tester.runAsync(() async {
          await Future<void>.delayed(Duration.zero);
        });
        await tester.pump();
        await completion;
        if (succeeds) {
          expect(resultUser, same(user));
          expect(resultError, isNull);
        } else {
          expect(resultUser, isNull);
          expect(resultError, isA<FirebaseAuthException>());
        }
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 400));
        // SDK cancellation and Navigator disposal complete on the real event
        // queue; yield it before settling the final navigation animation.
        await tester.runAsync(() async {
          await Future<void>.delayed(Duration.zero);
        });
        await tester.pumpAndSettle();
        expect(
          find.text('Association route'),
          succeeds ? findsNothing : findsOneWidget,
        );
        await tester.pumpWidget(const SizedBox.shrink());
        await users.close();
        await auth.changes.close();
      },
    );
  }
}

class _User extends Fake implements User {
  _User(this.providers);
  final List<String> providers;
  Future<void> Function()? onReload;
  @override
  String get uid => 'synthetic-existing';
  @override
  String get email => 'synthetic@example.test';
  @override
  bool get emailVerified => true;
  @override
  bool get isAnonymous => false;
  @override
  String? get displayName => null;
  @override
  List<UserInfo> get providerData => providers.map(_Info.new).toList();
  @override
  Future<void> reload() async => onReload?.call();
}

class _Info extends Fake implements UserInfo {
  _Info(this.providerId);
  @override
  final String providerId;
}

class _GateAuth extends Fake implements FirebaseAuth {
  final changes = StreamController<User?>.broadcast(sync: true);
  late User user;
  User? current;
  @override
  User? get currentUser => current;
  @override
  Stream<User?> authStateChanges() => changes.stream;
  @override
  Future<UserCredential> signInWithPopup(AuthProvider provider) async {
    current = user;
    changes.add(user);
    return _Credential(user);
  }
}

class _Credential extends Fake implements UserCredential {
  _Credential(this.user);
  @override
  final User user;
}
