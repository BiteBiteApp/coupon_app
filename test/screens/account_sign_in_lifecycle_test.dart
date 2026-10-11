import 'dart:async';

import 'package:coupon_app/screens/main_navigation_screen.dart';
import 'package:coupon_app/services/account_provider_service.dart';
import 'package:coupon_app/services/existing_google_password_link.dart';
import 'package:coupon_app/widgets/account_auth_confirmation.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  for (final tab in [1, 2]) {
    for (final register in [false, true]) {
      testWidgets(
        'normal email association survives actual tab $tab remount; register=$register',
        (tester) async {
          final auth = _EmailAuth();
          final release = Completer<void>();
          auth.user.releaseReload = release.future;
          final flow = AccountProviderService(
            auth: auth,
            passwordLink: _EmailLink(auth),
          );
          await tester.pumpWidget(
            MaterialApp(
              home: MainNavigationScreen(
                initialIndex: tab,
                initializePlatformServices: false,
                testCustomerAuthRealmProvider: () =>
                    mainNavigationAuthRealmForUser(auth.currentUser),
                testCustomerAuthRealmChanges: auth.changes.stream.map(
                  mainNavigationAuthRealmForUser,
                ),
                testPagesBuilder: (_) => [
                  const SizedBox(),
                  if (tab == 1)
                    _EmailProbe(flow, register)
                  else
                    const SizedBox(),
                  if (tab == 2)
                    _EmailProbe(flow, register)
                  else
                    const SizedBox(),
                ],
              ),
            ),
          );
          await tester.pumpAndSettle();
          final initiating = tester.state<_EmailProbeState>(
            find.byType(_EmailProbe),
          );
          await tester.tap(find.text('Email form probe'));
          await tester.pumpAndSettle();
          expect(initiating.mounted, isFalse);
          expect(initiating.active!(), isTrue);
          expect(auth.user.reloadCalls, 1);
          release.complete();
          await _finishAsync(tester);
          expect(initiating.failure, isNull);
          expect(initiating.result?.uid, 'registered-original');
          expect(initiating.finalizations, 1);
          expect(auth.user.providers, containsAll(['google.com', 'password']));
          expect(auth.signOutCalls, 0);
          expect(auth.createCalls, register ? 1 : 0);
          expect(AccountProviderService.lastOperationSucceeded, isTrue);
          await tester.pumpWidget(const SizedBox.shrink());
          await auth.changes.close();
        },
      );
    }
  }

  for (final tab in [1, 2]) {
    for (final collision in [false, true]) {
      testWidgets(
        'tab $tab keeps Google sign-in through auth remount; collision=$collision',
        (tester) async {
          final auth = _Auth(collision: collision);
          final release = Completer<void>();
          auth.user.releaseReload = release.future;
          final service = AccountProviderService(auth: auth, isWeb: true);
          await tester.pumpWidget(
            MaterialApp(home: _shell(auth, service, tab)),
          );
          await tester.pumpAndSettle();
          final initiating = tester.state<_SignInProbeState>(
            find.byType(_SignInProbe),
          );
          await tester.tap(find.text('Google sign-in probe'));
          await tester.pumpAndSettle();
          if (collision) {
            expect(find.text('Confirm your existing account'), findsOneWidget);
            expect(
              initiating.active!(),
              isTrue,
              reason:
                  'A confirmation dialog covers but does not close the sign-in route.',
            );
            await tester.enterText(find.byType(TextField), 'existing password');
            await tester.tap(find.text('Confirm'));
            await tester.pumpAndSettle();
          }
          expect(auth.user.reloadCalls, 1);
          expect(
            initiating.mounted,
            isFalse,
            reason:
                'The actual shell must still invalidate private pages on auth change.',
          );
          expect(initiating.active!(), isTrue);
          release.complete();
          await _finishAsync(tester);
          expect(initiating.failure, isNull);
          expect(initiating.result?.uid, 'registered-original');
          expect(auth.currentUser?.uid, 'registered-original');
          expect(initiating.finalizations, 1);
          expect(auth.user.providers, contains('google.com'));
          if (collision) expect(auth.user.providers, contains('password'));
          expect(auth.createCalls, 0);
          expect(auth.signOutCalls, 0);
          expect(AccountProviderService.activity.value, isFalse);
          await tester.pumpWidget(const SizedBox.shrink());
          await auth.changes.close();
        },
      );
    }
  }

  for (final stop in ['route close', 'sign out', 'other account']) {
    testWidgets('$stop still cancels after the expected auth remount', (
      tester,
    ) async {
      final auth = _Auth();
      final release = Completer<void>();
      auth.user.releaseReload = release.future;
      final service = AccountProviderService(auth: auth, isWeb: true);
      final navigator = GlobalKey<NavigatorState>();
      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: navigator,
          home: const Scaffold(body: Text('Origin')),
        ),
      );
      unawaited(
        navigator.currentState!.push(
          MaterialPageRoute<void>(builder: (_) => _shell(auth, service, 2)),
        ),
      );
      await tester.pumpAndSettle();
      final initiating = tester.state<_SignInProbeState>(
        find.byType(_SignInProbe),
      );
      await tester.tap(find.text('Google sign-in probe'));
      await tester.pumpAndSettle();
      expect(initiating.mounted, isFalse);
      expect(initiating.active!(), isTrue);
      if (stop == 'route close') {
        navigator.currentState!.pop();
        await tester.pumpAndSettle();
        expect(initiating.active!(), isFalse);
      } else if (stop == 'sign out') {
        await auth.signOut();
        expect(initiating.active!(), isTrue);
      } else {
        auth.user.publishReload = false;
        auth.publish(_User(auth, uid: 'other-registered'));
        expect(initiating.active!(), isTrue);
      }
      release.complete();
      await _finishAsync(tester);
      expect(
        initiating.failure,
        isA<FirebaseAuthException>().having(
          (e) => e.code,
          'code',
          'flow-cancelled',
        ),
      );
      expect(initiating.result, isNull);
      expect(initiating.finalizations, 0);
      expect(
        auth.currentUser?.uid,
        stop == 'other account' ? 'other-registered' : null,
      );
      if (stop == 'other account') expect(auth.signOutCalls, 0);
      expect(auth.createCalls, 0);
      expect(AccountProviderService.activity.value, isFalse);
      await tester.pumpWidget(const SizedBox.shrink());
      await auth.changes.close();
    });
  }

  testWidgets(
    'route-less activity falls back to the original context lifetime',
    (tester) async {
      late bool Function() active;
      await tester.pumpWidget(
        Directionality(
          textDirection: TextDirection.ltr,
          child: Builder(
            builder: (context) {
              active = captureAccountSignInActivity(context);
              return const SizedBox();
            },
          ),
        ),
      );
      expect(active(), isTrue);
      await tester.pumpWidget(const SizedBox.shrink());
      expect(active(), isFalse);
    },
  );
}

Future<void> _finishAsync(WidgetTester tester) async {
  await tester.pump();
  await tester.runAsync(() async => Future<void>.delayed(Duration.zero));
  await tester.pumpAndSettle();
}

Widget _shell(_Auth auth, AccountProviderService service, int tab) =>
    MainNavigationScreen(
      initialIndex: tab,
      initializePlatformServices: false,
      testCustomerAuthRealmProvider: () =>
          mainNavigationAuthRealmForUser(auth.currentUser),
      testCustomerAuthRealmChanges: auth.changes.stream.map(
        mainNavigationAuthRealmForUser,
      ),
      testPagesBuilder: (_) => [
        const SizedBox(),
        if (tab == 1) _SignInProbe(service) else const SizedBox(),
        if (tab == 2) _SignInProbe(service) else const SizedBox(),
      ],
    );

class _SignInProbe extends StatefulWidget {
  const _SignInProbe(this.service);
  final AccountProviderService service;
  @override
  State<_SignInProbe> createState() => _SignInProbeState();
}

class _SignInProbeState extends State<_SignInProbe> {
  bool Function()? active;
  User? result;
  Object? failure;
  int finalizations = 0;
  Future<void> _start() async {
    active = captureAccountSignInActivity(context);
    try {
      result = await widget.service.signInWithGoogle(
        linkGuest: false,
        isActive: active,
        confirmPassword: (email) =>
            confirmExistingAccountPassword(context, email),
        onAuthenticated: (_, isCurrent) async {
          if (isCurrent()) finalizations++;
        },
      );
    } catch (error) {
      failure = error;
    }
  }

  @override
  Widget build(BuildContext context) =>
      TextButton(onPressed: _start, child: const Text('Google sign-in probe'));
}

class _Auth extends Fake implements FirebaseAuth {
  _Auth({this.collision = false}) {
    user = _User(this, passwordFirst: collision);
  }
  final bool collision;
  final changes = StreamController<User?>.broadcast(sync: true);
  late final _User user;
  User? current;
  int signOutCalls = 0;
  int createCalls = 0;
  @override
  User? get currentUser => current;
  @override
  Stream<User?> authStateChanges() => changes.stream;
  void publish(User? next) {
    current = next;
    changes.add(next);
  }

  @override
  Future<void> signOut() async {
    signOutCalls++;
    publish(null);
  }

  @override
  Future<UserCredential> signInWithPopup(AuthProvider provider) async {
    if (collision) {
      throw FirebaseAuthException(
        code: 'account-exists-with-different-credential',
        email: user.email,
        credential: GoogleAuthProvider.credential(
          idToken: 'synthetic-test-only',
        ),
      );
    }
    publish(user);
    return _Credential(user);
  }

  @override
  Future<UserCredential> signInWithEmailAndPassword({
    required String email,
    required String password,
  }) async {
    expect(email, user.email);
    expect(password, 'existing password');
    publish(user);
    return _Credential(user);
  }

  @override
  Future<UserCredential> createUserWithEmailAndPassword({
    required String email,
    required String password,
  }) async {
    createCalls++;
    throw StateError('No account creation in provider association.');
  }
}

class _User extends Fake implements User {
  _User(
    this.auth, {
    this.uid = 'registered-original',
    bool passwordFirst = false,
  }) : providers = [passwordFirst ? 'password' : 'google.com'];
  final _Auth auth;
  final List<String> providers;
  Future<void>? releaseReload;
  int reloadCalls = 0;
  bool publishReload = true;
  @override
  final String uid;
  @override
  String get email => 'synthetic@example.test';
  @override
  bool get isAnonymous => false;
  @override
  bool get emailVerified => true;
  @override
  List<UserInfo> get providerData => providers.map(_Provider.new).toList();
  @override
  Future<void> reload() async {
    reloadCalls++;
    await releaseReload;
    if (publishReload) auth.publish(this);
  }

  @override
  Future<UserCredential> linkWithCredential(AuthCredential credential) async {
    providers.add(credential.providerId);
    return _Credential(this);
  }
}

class _Provider extends Fake implements UserInfo {
  _Provider(this.providerId);
  @override
  final String providerId;
}

class _Credential extends Fake implements UserCredential {
  _Credential(this.user);
  @override
  final User user;
}

class _EmailAuth extends _Auth {
  @override
  Future<UserCredential> signInWithEmailAndPassword({
    required String email,
    required String password,
  }) async {
    if (!user.providers.contains('password')) {
      throw FirebaseAuthException(code: 'invalid-credential');
    }
    return super.signInWithEmailAndPassword(email: email, password: password);
  }

  @override
  Future<UserCredential> createUserWithEmailAndPassword({
    required String email,
    required String password,
  }) async {
    createCalls++;
    throw FirebaseAuthException(code: 'email-already-in-use');
  }
}

class _EmailLink extends Fake implements ExistingGooglePasswordLink {
  _EmailLink(this.auth);
  final _EmailAuth auth;
  @override
  Future<String> link({
    required String googleIdToken,
    required String email,
    required String password,
    required bool Function() isCurrent,
  }) async {
    expect(isCurrent(), isTrue);
    expect(email, auth.user.email);
    auth.user.providers.add('password');
    return auth.user.uid;
  }
}

class _EmailProbe extends StatefulWidget {
  const _EmailProbe(this.service, this.register);
  final AccountProviderService service;
  final bool register;
  @override
  State<_EmailProbe> createState() => _EmailProbeState();
}

class _EmailProbeState extends State<_EmailProbe> {
  bool Function()? active;
  User? result;
  Object? failure;
  int finalizations = 0;
  Future<void> _start() async {
    active = captureAccountSignInActivity(context);
    try {
      result = await widget.service.authenticateWithEmail(
        email: 'synthetic@example.test',
        password: 'existing password',
        register: widget.register,
        linkGuest: false,
        isActive: active,
        confirmGoogle: (_) async => 'synthetic-proof',
        onAuthenticated: (_, isCurrent) async {
          if (isCurrent()) finalizations++;
        },
      );
    } catch (error) {
      failure = error;
    }
  }

  @override
  Widget build(BuildContext context) =>
      TextButton(onPressed: _start, child: const Text('Email form probe'));
}
