import 'dart:async';
import 'dart:convert';

import 'package:coupon_app/screens/main_navigation_screen.dart';
import 'package:coupon_app/services/account_provider_service.dart';
import 'package:coupon_app/services/existing_google_password_link.dart';
import 'package:coupon_app/widgets/account_auth_confirmation.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_sign_in_platform_interface/google_sign_in_platform_interface.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

const _email = 'customer@example.test';
const _password = ' privately entered password ';

void main() {
  testWidgets(
    'one Create Account submission completes after Google; cancellation stays cancelled',
    (tester) async {
      // Google initializes once per app lifetime. Keep all scenarios in the
      // same fake-async zone, as the real app does.
      final diagnostics = <String>[];
      final originalPrint = debugPrint;
      debugPrint = (message, {wrapWidth}) {
        if (message != null) diagnostics.add(message);
      };
      try {
        final google = _Google();
        GoogleSignInPlatform.instance = google;
        for (final tab in [1, 2]) {
          for (final outcome in [
            'complete',
            'cancel',
            'wrong account',
            'missing token',
            'empty token',
            'route closed',
          ]) {
            diagnostics.clear();
            google.release = Completer<AuthenticationResults>();
            final backend = _Backend();
            final auth = _Auth(backend);
            final flow = AccountProviderService(
              auth: auth,
              passwordLink: ExistingGooglePasswordLink(
                apiKey: 'synthetic-test-key',
                client: MockClient(backend.handle),
              ),
            );
            final finished = Completer<void>();
            final formKey = GlobalKey<_RegistrationFormState>();
            // The shell must actually dispose the initiating form on auth change.
            var firstForm = true;
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
                  testPagesBuilder: (_) {
                    final form = firstForm
                        ? _RegistrationForm(
                            key: formKey,
                            flow: flow,
                            finish: finished.future,
                          )
                        : const Text('Existing account');
                    firstForm = false;
                    return [
                      const SizedBox(),
                      if (tab == 1) form else const SizedBox(),
                      if (tab == 2) form else const SizedBox(),
                    ];
                  },
                ),
              ),
            );
            await tester.pumpAndSettle();
            final form = formKey.currentState!;
            await tester.tap(find.text('Create Account'));
            await tester.pumpAndSettle();
            expect(form.submissions, 1);
            expect(find.byType(AlertDialog), findsNothing);
            expect(find.textContaining('Could not complete'), findsNothing);
            expect(backend.calls, isEmpty);
            // The original submit remains busy while Google's own UI is open.
            expect(
              tester
                  .widget<TextButton>(find.byType(TextButton).first)
                  .onPressed,
              isNull,
            );
            if (outcome == 'route closed') {
              await tester.pumpWidget(const SizedBox.shrink());
              await tester.pumpAndSettle();
            }
            if (outcome == 'cancel') {
              google.release.completeError(
                const GoogleSignInException(
                  code: GoogleSignInExceptionCode.canceled,
                ),
              );
            } else {
              google.release.complete(
                AuthenticationResults(
                  user: GoogleSignInUserData(
                    email: outcome == 'wrong account'
                        ? 'other@example.test'
                        : _email,
                    id: 'synthetic-google-id',
                  ),
                  authenticationTokens: AuthenticationTokenData(
                    idToken: outcome == 'missing token'
                        ? null
                        : outcome == 'empty token'
                        ? ''
                        : 'header.${base64Url.encode(utf8.encode(jsonEncode({'email': _email})))}.signature',
                  ),
                ),
              );
            }
            await tester.pumpAndSettle();
            await tester.runAsync(
              () async => Future<void>.delayed(Duration.zero),
            );
            await tester.pumpAndSettle();
            if (outcome == 'complete') {
              expect(form.mounted, isFalse);
              expect(find.text('Existing account'), findsOneWidget);
              expect(find.text('Create Account'), findsNothing);
              expect(form.finalizations, 1);
              expect(AccountProviderService.activity.value, isTrue);
              finished.complete();
              await tester.pump();
              await tester.runAsync(
                () async => Future<void>.delayed(Duration.zero),
              );
              await tester.pumpAndSettle();
              expect(form.failure, isNull);
              expect(form.result?.uid, 'original-uid');
              expect(form.result?.emailVerified, isFalse);
              expect(auth.currentUser?.uid, 'original-uid');
              expect(
                auth.passwordCalls,
                2,
              ); // Failed first attempt, then completion.
              expect(backend.calls, [
                'signInWithIdp',
                'lookup',
                'signUp',
                'lookup',
              ]);
              expect(backend.linkCalls, 1);
              expect(AccountProviderService.lastOperationSucceeded, isTrue);
            } else {
              expect(form.failure, isA<FirebaseAuthException>());
              expect(
                (form.failure as FirebaseAuthException).code,
                outcome == 'wrong account'
                    ? 'email-mismatch'
                    : outcome.contains('token')
                    ? 'invalid-credential'
                    : 'flow-cancelled',
              );
              expect(form.result, isNull);
              expect(form.finalizations, 0);
              expect(auth.currentUser, isNull);
              expect(backend.calls, isEmpty);
              expect(backend.linkCalls, 0);
            }
            final nativeCheck = switch (outcome) {
              'complete' => 'accepted',
              'wrong account' => 'emailMismatch',
              'missing token' || 'empty token' => 'missingToken',
              _ => 'cancelled',
            };
            expect(
              diagnostics,
              contains('BS_AUTH_DIAG stage=nativeGoogle check=$nativeCheck'),
            );
            expect(
              diagnostics,
              contains(
                'BS_AUTH_DIAG stage=emailContinuation check=${outcome == 'complete'
                    ? 'accepted'
                    : outcome == 'cancel' || outcome == 'route closed'
                    ? 'cancelled'
                    : 'failed'}',
              ),
            );
            expect(diagnostics.join(), isNot(contains(_email)));
            expect(diagnostics.join(), isNot(contains(_password)));
            expect(diagnostics.join(), isNot(contains('original-uid')));
            expect(form.submissions, 1);
            expect(auth.createCalls, 1);
            expect(auth.signOutCalls, 0);
            expect(backend.existingData, {
              'username': 'unchanged',
              'review': 'unchanged',
            });
            expect(AccountProviderService.activity.value, isFalse);
            expect(tester.takeException(), isNull);
            await tester.pumpWidget(const SizedBox.shrink());
            await tester.pumpAndSettle();
            await auth.changes.close();
          }
        }
      } finally {
        debugPrint = originalPrint;
      }
    },
    skip: kIsWeb,
  );
}

class _RegistrationForm extends StatefulWidget {
  const _RegistrationForm({
    super.key,
    required this.flow,
    required this.finish,
  });
  final AccountProviderService flow;
  final Future<void> finish;
  @override
  State<_RegistrationForm> createState() => _RegistrationFormState();
}

class _RegistrationFormState extends State<_RegistrationForm> {
  int submissions = 0;
  int finalizations = 0;
  bool busy = false;
  User? result;
  Object? failure;
  Future<void> _submit() async {
    if (busy) return;
    setState(() => busy = true);
    submissions++;
    try {
      result = await widget.flow.authenticateWithEmail(
        email: _email,
        password: _password,
        register: true,
        linkGuest: false,
        isActive: captureAccountSignInActivity(context),
        confirmGoogle: (email) =>
            confirmGoogleForEmail(context, email, forRegistration: true),
        onAuthenticated: (user, isCurrent) async {
          expect(isCurrent(), isTrue);
          finalizations++;
          await widget.finish;
          expect(isCurrent(), isTrue);
        },
      );
    } catch (error) {
      failure = error;
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => TextButton(
    onPressed: busy ? null : _submit,
    child: Text(busy ? 'Finishing…' : 'Create Account'),
  );
}

class _Backend {
  final calls = <String>[];
  final existingData = {'username': 'unchanged', 'review': 'unchanged'};
  int linkCalls = 0;
  bool get linked => linkCalls > 0;
  Future<http.Response> handle(http.Request request) async {
    final method = request.url.path.split(':').last;
    final body = jsonDecode(request.body) as Map<String, dynamic>;
    calls.add(method);
    switch (method) {
      case 'signInWithIdp':
        expect(body['autoCreate'], isFalse);
        return http.Response(
          jsonEncode({
            'localId': 'original-uid',
            'email': _email,
            'emailVerified': false,
            'idToken': 'synthetic-original-token',
            'isNewUser': false,
          }),
          200,
        );
      case 'lookup':
        expect(
          body['idToken'],
          linked ? 'synthetic-linked-token' : 'synthetic-original-token',
        );
        return http.Response(
          jsonEncode({
            'users': [
              {
                'localId': 'original-uid',
                'email': _email,
                // Verification stays pending before and after linking.
                'emailVerified': false,
                'providerUserInfo': [
                  {'providerId': 'google.com'},
                  if (linked) {'providerId': 'password'},
                ],
              },
            ],
          }),
          200,
        );
      case 'signUp':
        expect(body['idToken'], 'synthetic-original-token');
        expect(body['password'], _password);
        expect(body['email'], _email);
        linkCalls++;
        return http.Response(
          jsonEncode({
            'localId': 'original-uid',
            'idToken': 'synthetic-linked-token',
          }),
          200,
        );
      default:
        fail('Unexpected account request: $method');
    }
  }
}

class _Auth extends Fake implements FirebaseAuth {
  _Auth(this.backend);
  final _Backend backend;
  final changes = StreamController<User?>.broadcast();
  User? current;
  int createCalls = 0;
  int passwordCalls = 0;
  int signOutCalls = 0;
  @override
  User? get currentUser => current;
  @override
  Stream<User?> authStateChanges() => changes.stream;
  @override
  Future<UserCredential> createUserWithEmailAndPassword({
    required String email,
    required String password,
  }) async {
    createCalls++;
    throw FirebaseAuthException(code: 'email-already-in-use');
  }

  @override
  Future<UserCredential> signInWithEmailAndPassword({
    required String email,
    required String password,
  }) async {
    passwordCalls++;
    expect(email, _email);
    expect(password, _password);
    if (!backend.linked) {
      throw FirebaseAuthException(code: 'invalid-credential');
    }
    current = _User();
    changes.add(current);
    return _Credential(current!);
  }

  @override
  Future<void> signOut() async {
    signOutCalls++;
    current = null;
    changes.add(null);
  }
}

class _User extends Fake implements User {
  @override
  String get uid => 'original-uid';
  @override
  String get email => _email;
  @override
  bool get isAnonymous => false;
  @override
  bool get emailVerified => false;
  @override
  List<UserInfo> get providerData => [
    _Provider('google.com'),
    _Provider('password'),
  ];
  @override
  Future<void> reload() async {}
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

class _Google extends GoogleSignInPlatform {
  late Completer<AuthenticationResults> release;
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
  @override
  Future<void> init(InitParameters parameters) async {}
  @override
  Stream<AuthenticationEvent>? get authenticationEvents => null;
  @override
  Future<AuthenticationResults> authenticate(
    AuthenticateParameters parameters,
  ) => release.future;
}
