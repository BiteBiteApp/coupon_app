import 'dart:async';

import 'package:coupon_app/services/account_provider_service.dart';
import 'package:coupon_app/services/existing_google_password_link.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  for (final web in [false, true]) {
    group(web ? 'web popup adapter' : 'native credential adapter', () {
      late _Auth auth;
      late AccountProviderService service;
      setUp(() {
        auth = _Auth();
        service = AccountProviderService(
          auth: auth,
          isWeb: web,
          googleCredential: () async => auth.googleCredential,
        );
      });
      tearDown(() => auth.changes.close());

      for (final phase in [1, 2, 3]) {
        test(
          'sign-out during collision/finalization reload $phase stays signed out',
          () async {
            final user = auth.add('original', 'same@example.test', [
              'password',
            ]);
            auth.googleEmail = user.email!;
            auth.collision = true;
            var profileWrites = 0;
            user.onReload = (number) async {
              if (number == phase) auth.signOutNow();
            };
            await expectLater(
              service.signInWithGoogle(
                linkGuest: false,
                confirmPassword: (_) async => user.password,
                onAuthenticated: (current, isCurrent) async {
                  await current.reload();
                  if (isCurrent()) profileWrites++;
                },
              ),
              throwsCode('flow-cancelled'),
            );
            expect(auth.currentUser, isNull);
            expect(profileWrites, 0);
            expect(AccountProviderService.lastOperationSucceeded, isFalse);
            expect(auth.createCalls, 0);
            expect(user.linkCalls, phase == 1 ? 0 : 1);
          },
        );
      }

      test('cancelled picker preserves the original anonymous guest', () async {
        final guest = auth.add('guest', '', [], anonymous: true);
        auth.current = guest;
        final cancelledPicker = AccountProviderService(
          auth: auth,
          isWeb: false,
          googleCredential: () async =>
              throw FirebaseAuthException(code: 'flow-cancelled'),
        );
        await expectLater(
          cancelledPicker.signInWithGoogle(linkGuest: true),
          throwsCode('flow-cancelled'),
        );
        expect(auth.currentUser, same(guest));
        expect(guest.linkCalls, 0);
      });

      test(
        'cleanup failure releases normal email operation for retry',
        () async {
          final user = auth.add('original', 'same@example.test', ['password']);
          auth.signOutError = 'network-request-failed';
          user.onReload = (_) async => auth.signOutNow();
          await expectLater(
            service.authenticateWithEmail(
              email: user.email!,
              password: user.password!,
              register: false,
              linkGuest: false,
            ),
            throwsCode('network-request-failed'),
          );
          expect(AccountProviderService.activity.value, isFalse);
          expect(AccountProviderService.lastOperationSucceeded, isFalse);
          auth.signOutError = null;
          auth.signOutNow();
          user.onReload = null;
          expect(
            (await service.authenticateWithEmail(
              email: user.email!,
              password: user.password!,
              register: false,
              linkGuest: false,
            )).uid,
            user.uid,
          );
          expect(AccountProviderService.lastOperationSucceeded, isTrue);
        },
      );

      for (final register in [false, true]) {
        for (final guest in [false, true]) {
          test(
            'Google-first normal email flow preserves UID/data; register=$register guest=$guest',
            () async {
              final original = auth.add('google-original', 'same@gmail.com', [
                'google.com',
              ]);
              auth.data[original.uid]!['role'] =
                  'admin'; // Existing synthetic claim/data must stay untouched.
              if (guest) {
                auth.current = auth.add('guest', '', [], anonymous: true)
                  ..linkError = 'email-already-in-use';
              }
              final linker = _PasswordLink(auth);
              final flow = AccountProviderService(
                auth: auth,
                passwordLink: linker,
              );
              var finalizations = 0;
              final result = await flow.authenticateWithEmail(
                email: ' same@gmail.com ',
                password: ' new password ',
                register: register,
                linkGuest: true,
                confirmGoogle: (email) async {
                  expect(email, original.email);
                  return 'synthetic-google-confirmation';
                },
                onAuthenticated: (user, isCurrent) async {
                  expect(user.uid, original.uid);
                  expect(isCurrent(), isTrue);
                  expect(AccountProviderService.activity.value, isTrue);
                  finalizations++;
                },
              );
              expect(result.uid, original.uid);
              expect(linker.calls, 1);
              expect(finalizations, 1);
              expect(
                original.providers,
                containsAll(['google.com', 'password']),
              );
              expect(original.password, ' new password ');
              expect(auth.users.length, guest ? 2 : 1);
              expect(auth.data[original.uid], {
                'reviews': 17,
                'favorites': ['kept'],
                'role': 'admin',
              });
              expect(auth.popupCalls + auth.credentialCalls, 0);
              auth.signOutNow();
              expect(
                (await flow.authenticateWithEmail(
                  email: original.email!,
                  password: ' new password ',
                  register: false,
                  linkGuest: false,
                )).uid,
                original.uid,
              );
              auth.signOutNow();
              auth.googleEmail = original.email!;
              expect(
                (await service.signInWithGoogle(linkGuest: false)).uid,
                original.uid,
              );
            },
          );
        }

        test(
          'existing password normal email flow never requests Google; register=$register',
          () async {
            final original = auth.add(
              'password-original',
              'same@example.test',
              ['password'],
            );
            final result = await service.authenticateWithEmail(
              email: original.email!,
              password: original.password!,
              register: register,
              linkGuest: false,
              confirmGoogle: (_) async =>
                  throw StateError('Unexpected Google confirmation'),
            );
            expect(result.uid, original.uid);
            expect(original.providers, ['password']);
            expect(original.password, 'original password');
            expect(auth.users.length, 1);
          },
        );

        test(
          'existing Google/password account rejects password replacement; register=$register',
          () async {
            final original = auth.add('both', 'same@gmail.com', [
              'google.com',
              'password',
            ]);
            final linker = _PasswordLink(auth);
            final flow = AccountProviderService(
              auth: auth,
              passwordLink: linker,
            );
            await expectLater(
              flow.authenticateWithEmail(
                email: original.email!,
                password: 'replacement',
                register: register,
                linkGuest: false,
                confirmGoogle: (_) async => 'synthetic-google-confirmation',
              ),
              throwsCode('provider-already-linked'),
            );
            expect(original.password, 'original password');
            expect(auth.currentUser, isNull);
            expect(auth.users.length, 1);
          },
        );
      }

      test(
        'pending verification still requires Google after SDK sign-in',
        () async {
          final original = auth.add('original', 'same@gmail.com', [
            'google.com',
          ]);
          final linker = _PasswordLink(auth)
            ..afterLink = () {
              original.emailVerified = false;
              original.providers.remove('google.com');
            };
          final flow = AccountProviderService(auth: auth, passwordLink: linker);
          await expectLater(
            flow.authenticateWithEmail(
              email: original.email!,
              password: 'new password',
              register: true,
              linkGuest: false,
              confirmGoogle: (_) async => 'synthetic-proof',
              onAuthenticated: (_, _) async =>
                  fail('Do not finalize a missing provider'),
            ),
            throwsCode('association-not-confirmed'),
          );
          expect(linker.calls, 1);
          expect(AccountProviderService.lastOperationSucceeded, isFalse);
        },
      );

      test(
        'SDK email result must keep the UID confirmed before linking',
        () async {
          final original = auth.add('original', 'same@gmail.com', [
            'google.com',
          ]);
          final other = auth.add('other', 'other@gmail.com', ['password']);
          final linker = _PasswordLink(auth);
          linker.afterLink = () => auth.passwordResultOverride = other;
          final flow = AccountProviderService(auth: auth, passwordLink: linker);
          await expectLater(
            flow.authenticateWithEmail(
              email: original.email!,
              password: 'new password',
              register: false,
              linkGuest: false,
              confirmGoogle: (_) async => 'synthetic-proof',
              onAuthenticated: (_, _) async =>
                  fail('No finalization for a substituted UID'),
            ),
            throwsCode('user-mismatch'),
          );
          expect(auth.currentUser, isNull);
          expect(auth.data[other.uid]?['reviews'], 17);
          expect(AccountProviderService.lastOperationSucceeded, isFalse);
        },
      );

      for (final register in [false, true]) {
        test(
          'Google-confirmed password continues with verification pending; register=$register',
          () async {
            final original = auth.add('original', 'same@gmail.com', [
              'google.com',
            ]);
            final linker = _PasswordLink(auth)
              ..afterLink = () => original.emailVerified = false;
            final flow = AccountProviderService(
              auth: auth,
              passwordLink: linker,
            );
            var finalized = false;
            final result = await flow.authenticateWithEmail(
              email: original.email!,
              password: 'new password',
              register: register,
              linkGuest: false,
              confirmGoogle: (_) async => 'synthetic-proof',
              onAuthenticated: (user, isCurrent) async {
                expect(user.uid, original.uid);
                expect(user.emailVerified, isFalse);
                expect(isCurrent(), isTrue);
                finalized = true;
              },
            );
            expect(result.uid, original.uid);
            expect(result.emailVerified, isFalse);
            expect(linker.calls, 1);
            expect(finalized, isTrue);
            expect(AccountProviderService.lastOperationSucceeded, isTrue);
            expect(auth.users.length, 1);
            expect(auth.popupCalls + auth.credentialCalls, 0);
          },
        );
      }

      for (final phase in ['reload', 'finalization']) {
        for (final stop in ['route close', 'sign out']) {
          test(
            'normal email $stop during $phase discards stale success',
            () async {
              final user = auth.add('original', 'same@example.test', [
                'password',
              ]);
              var active = true;
              void cancel() {
                if (stop == 'route close') {
                  active = false;
                } else {
                  service.cancelPending();
                  auth.signOutNow();
                }
              }

              if (phase == 'reload') user.onReload = (_) async => cancel();
              await expectLater(
                service.authenticateWithEmail(
                  email: user.email!,
                  password: user.password!,
                  register: false,
                  linkGuest: false,
                  isActive: () => active,
                  onAuthenticated: (current, _) async {
                    expect(phase, 'finalization');
                    cancel();
                    await current.reload();
                  },
                ),
                throwsCode('flow-cancelled'),
              );
              expect(auth.currentUser, isNull);
              expect(AccountProviderService.lastOperationSucceeded, isFalse);
            },
          );
        }
      }

      test(
        'unknown email sign-in cannot create through Google confirmation',
        () async {
          final linker = _PasswordLink(auth);
          final flow = AccountProviderService(auth: auth, passwordLink: linker);
          await expectLater(
            flow.authenticateWithEmail(
              email: 'absent@gmail.com',
              password: 'new password',
              register: false,
              linkGuest: false,
              confirmGoogle: (_) async => 'synthetic-google-confirmation',
            ),
            throwsCode('invalid-credential'),
          );
          expect(auth.users, isEmpty);
          expect(auth.createCalls + auth.popupCalls + auth.credentialCalls, 0);
        },
      );

      test(
        'fresh registration still creates and requires email verification',
        () async {
          final result = await service.authenticateWithEmail(
            email: 'new@example.test',
            password: 'new password',
            register: true,
            linkGuest: false,
          );
          expect(result.uid, 'new-registration');
          expect(result.emailVerified, isFalse);
          expect(auth.createCalls, 1);
          expect(auth.users.length, 1);
        },
      );

      for (final stop in [
        'cancel confirmation',
        'route closed',
        'other account',
        'sign out',
      ]) {
        test(
          '$stop during email confirmation never links or finalizes',
          () async {
            final user = auth.add('original', 'same@gmail.com', ['google.com']);
            final other = auth.add('other', 'other@gmail.com', ['google.com']);
            final linker = _PasswordLink(auth);
            final flow = AccountProviderService(
              auth: auth,
              passwordLink: linker,
            );
            var active = true;
            await expectLater(
              flow.authenticateWithEmail(
                email: user.email!,
                password: 'new password',
                register: false,
                linkGuest: false,
                isActive: () => active,
                confirmGoogle: (_) async {
                  if (stop == 'route closed') active = false;
                  if (stop == 'other account') auth.switchTo(other);
                  if (stop == 'sign out') flow.cancelPending();
                  return stop == 'cancel confirmation'
                      ? null
                      : 'synthetic-google-confirmation';
                },
                onAuthenticated: (_, _) async =>
                    fail('No finalization after cancellation'),
              ),
              throwsCode('flow-cancelled'),
            );
            expect(linker.calls, 0);
            expect(user.providers, ['google.com']);
            expect(
              auth.currentUser?.uid,
              stop == 'other account' ? 'other' : null,
            );
          },
        );
      }

      test(
        'late password-link result after cancellation cannot sign in',
        () async {
          final user = auth.add('original', 'same@gmail.com', ['google.com']);
          final linker = _PasswordLink(auth);
          final flow = AccountProviderService(auth: auth, passwordLink: linker);
          linker.afterLink = flow.cancelPending;
          await expectLater(
            flow.authenticateWithEmail(
              email: user.email!,
              password: 'new password',
              register: false,
              linkGuest: false,
              confirmGoogle: (_) async => 'synthetic-google-confirmation',
            ),
            throwsCode('flow-cancelled'),
          );
          expect(auth.currentUser, isNull);
          expect(AccountProviderService.lastOperationSucceeded, isFalse);
        },
      );

      test(
        'late email SDK completion after sign-out clears the stale session',
        () async {
          final user = auth.add('original', 'same@example.test', ['password']);
          final entered = Completer<void>();
          final release = Completer<void>();
          auth.onPasswordSignIn = () async {
            entered.complete();
            await release.future;
          };
          final pending = service.authenticateWithEmail(
            email: user.email!,
            password: user.password!,
            register: false,
            linkGuest: false,
          );
          final expectation = expectLater(
            pending,
            throwsCode('flow-cancelled'),
          );
          await entered.future;
          service.cancelPending();
          auth.signOutNow();
          release.complete();
          await expectation;
          expect(auth.currentUser, isNull);
        },
      );

      test(
        'verified password collision retains registered UID, data and password',
        () async {
          final original = auth.add('original', 'same@example.test', [
            'password',
          ]);
          auth.googleEmail = original.email!;
          auth.collision = true;
          final result = await service.signInWithGoogle(
            linkGuest: false,
            confirmPassword: (email) async {
              expect(email, original.email);
              return original.password;
            },
          );
          expect(result.uid, original.uid);
          expect(original.providers, containsAll(['google.com', 'password']));
          auth.signOutNow();
          expect(
            (await auth.signInWithEmailAndPassword(
              email: original.email!,
              password: 'original password',
            )).user?.uid,
            original.uid,
          );
          auth.signOutNow();
          auth.collision = false;
          expect(
            (await service.signInWithGoogle(linkGuest: false)).uid,
            original.uid,
          );
          expect(auth.data[original.uid], {
            'reviews': 17,
            'favorites': ['kept'],
            'role': 'customer',
          });
          expect(auth.users.length, 1);
          expect(auth.createCalls, 0);
          expect(original.password, 'original password');
          expect(web ? auth.popupCalls : auth.credentialCalls, greaterThan(0));
        },
      );

      test('incorrect existing password never links or creates', () async {
        final user = auth.add('original', 'same@example.test', ['password']);
        auth.googleEmail = user.email!;
        auth.collision = true;
        await expectLater(
          service.signInWithGoogle(
            linkGuest: false,
            confirmPassword: (_) async => 'wrong',
          ),
          throwsCode('wrong-password'),
        );
        expect(user.linkCalls, 0);
        expect(auth.currentUser, isNull);
        expect(auth.createCalls, 0);
      });

      test(
        'unverified password ownership never retains attacker password by linking',
        () async {
          final user = auth.add('original', 'same@example.test', [
            'password',
          ], verified: false);
          auth.googleEmail = user.email!;
          auth.collision = true;
          await expectLater(
            service.signInWithGoogle(
              linkGuest: false,
              confirmPassword: (_) async => user.password,
            ),
            throwsCode('unverified-account'),
          );
          expect(user.linkCalls, 0);
          expect(user.providers, ['password']);
        },
      );

      test('cancelled confirmation discards pending credential', () async {
        final user = auth.add('original', 'same@example.test', ['password']);
        auth.googleEmail = user.email!;
        auth.collision = true;
        await expectLater(
          service.signInWithGoogle(
            linkGuest: false,
            confirmPassword: (_) async => null,
          ),
          throwsCode('flow-cancelled'),
        );
        expect(user.linkCalls, 0);
        auth.collision = false;
        await service.signInWithGoogle(linkGuest: false);
        expect(user.linkCalls, 0);
      });

      test(
        'another account during password confirmation invalidates operation',
        () async {
          final user = auth.add('original', 'same@example.test', ['password']);
          final other = auth.add('other', 'other@example.test', ['password']);
          auth.googleEmail = user.email!;
          auth.collision = true;
          await expectLater(
            service.signInWithGoogle(
              linkGuest: false,
              confirmPassword: (_) async {
                auth.switchTo(other);
                return user.password;
              },
            ),
            throwsCode('flow-cancelled'),
          );
          expect(auth.currentUser?.uid, other.uid);
          expect(user.linkCalls + other.linkCalls, 0);
        },
      );

      for (final phase in [1, 2]) {
        test(
          'route cancellation during Google reload $phase discards new session',
          () async {
            final user = auth.add('original', 'same@gmail.com', ['google.com']);
            auth.googleEmail = user.email!;
            var active = true;
            user.onReload = (number) async {
              if (number == phase) active = false;
            };
            await expectLater(
              service.signInWithGoogle(
                linkGuest: false,
                isActive: () => active,
                onAuthenticated: (current, isCurrent) => current.reload(),
              ),
              throwsCode('flow-cancelled'),
            );
            expect(auth.currentUser, isNull);
            expect(AccountProviderService.lastOperationSucceeded, isFalse);
          },
        );
      }

      for (final duringReload in [false, true]) {
        test(
          'cancelled guest Google association discards new session; reload=$duringReload',
          () async {
            final guest = auth.add(
              'guest',
              'same@gmail.com',
              [],
              anonymous: true,
            );
            auth.current = guest;
            auth.googleEmail = guest.email!;
            var active = true;
            if (duringReload) {
              guest.onReload = (_) async => active = false;
            } else {
              guest.onLinked = () async => active = false;
            }
            await expectLater(
              service.signInWithGoogle(linkGuest: true, isActive: () => active),
              throwsCode('flow-cancelled'),
            );
            expect(auth.currentUser, isNull);
            expect(auth.createCalls, 0);
          },
        );
      }

      test(
        'guest enters existing account then ordinary sign-out switches to synthetic Admin',
        () async {
          final guest = auth.add('guest', '', [], anonymous: true);
          final customer = auth.add('customer', 'customer@gmail.com', [
            'google.com',
          ]);
          final admin = auth.add('synthetic-admin', 'admin@gmail.com', [
            'google.com',
          ]);
          auth.data[admin.uid]!['role'] = 'admin';
          auth.current = guest;
          guest.linkError = 'credential-already-in-use';
          auth.googleEmail = customer.email!;
          expect(
            (await service.signInWithGoogle(linkGuest: true)).uid,
            customer.uid,
          );
          expect(auth.data[customer.uid]!['role'], 'customer');
          auth.signOutNow();
          auth.googleEmail = admin.email!;
          expect(
            (await service.signInWithGoogle(linkGuest: true)).uid,
            admin.uid,
          );
          expect(auth.data[admin.uid]!['role'], 'admin');
          expect(auth.data[customer.uid]!['role'], 'customer');
          expect(auth.createCalls, 0);
        },
      );
      test(
        'cancelled in-flight Google sign-in cannot restore signed-out user',
        () async {
          final user = auth.add('original', 'same@gmail.com', ['google.com']);
          auth.googleEmail = user.email!;
          final entered = Completer<void>();
          final release = Completer<void>();
          auth.onGoogleSignIn = () async {
            entered.complete();
            await release.future;
          };
          final pending = service.signInWithGoogle(linkGuest: false);
          final expectation = expectLater(
            pending,
            throwsCode('flow-cancelled'),
          );
          await entered.future;
          service.cancelPending();
          auth.signOutNow();
          release.complete();
          await expectation;
          expect(auth.currentUser, isNull);
        },
      );

      test(
        'association completion holds navigation activity through profile work',
        () async {
          final user = auth.add('original', 'same@gmail.com', ['google.com']);
          auth.googleEmail = user.email!;
          await service.signInWithGoogle(
            linkGuest: false,
            onAuthenticated: (current, isCurrent) async {
              expect(current.uid, user.uid);
              expect(isCurrent(), isTrue);
              expect(AccountProviderService.activity.value, isTrue);
              expect(
                AccountProviderService.requireNoPendingOperation,
                throwsA(
                  isA<FirebaseAuthException>().having(
                    (e) => e.code,
                    'code',
                    'flow-in-progress',
                  ),
                ),
              );
            },
          );
          expect(AccountProviderService.activity.value, isFalse);
          expect(AccountProviderService.lastOperationSucceeded, isTrue);
        },
      );
    });
  }
}

Matcher throwsCode(String code) =>
    throwsA(isA<FirebaseAuthException>().having((e) => e.code, 'code', code));

class _Auth extends Fake implements FirebaseAuth {
  final changes = StreamController<User?>.broadcast(sync: true);
  final users = <String, _User>{};
  final data = <String, Map<String, Object>>{};
  _User? current;
  _User? passwordResultOverride;
  String googleEmail = '';
  bool collision = false;
  String? signOutError;
  Future<void> Function()? onGoogleSignIn;
  Future<void> Function()? onPasswordSignIn;
  int createCalls = 0;
  int popupCalls = 0;
  int credentialCalls = 0;

  _User add(
    String uid,
    String email,
    List<String> providers, {
    bool verified = true,
    bool anonymous = false,
  }) {
    final user = _User(
      this,
      uid,
      email,
      providers.toList(),
      verified,
      anonymous,
    );
    users[uid] = user;
    data[uid] = {
      'reviews': 17,
      'favorites': ['kept'],
      'role': 'customer',
    };
    return user;
  }

  AuthCredential get googleCredential =>
      GoogleAuthProvider.credential(idToken: 'synthetic-test-only');
  @override
  User? get currentUser => current;
  @override
  Stream<User?> authStateChanges() => changes.stream;
  void switchTo(_User user) {
    current = user;
    changes.add(user);
  }

  @override
  Future<void> signOut() async {
    if (signOutError != null) throw FirebaseAuthException(code: signOutError!);
    signOutNow();
  }

  void signOutNow() {
    current = null;
    changes.add(null);
  }

  @override
  Future<UserCredential> createUserWithEmailAndPassword({
    required String email,
    required String password,
  }) async {
    createCalls++;
    if (users.values.any(
      (u) => u.email?.toLowerCase() == email.toLowerCase(),
    )) {
      throw FirebaseAuthException(code: 'email-already-in-use');
    }
    final user = add('new-registration', email, ['password'], verified: false);
    user.password = password;
    switchTo(user);
    return _Credential(user);
  }

  @override
  Future<UserCredential> signInWithPopup(AuthProvider provider) async {
    popupCalls++;
    expect(provider.providerId, 'google.com');
    return _signInGoogle();
  }

  @override
  Future<UserCredential> signInWithCredential(AuthCredential credential) async {
    credentialCalls++;
    expect(credential.providerId, 'google.com');
    return _signInGoogle();
  }

  Future<UserCredential> _signInGoogle() async {
    await onGoogleSignIn?.call();
    if (collision) {
      throw FirebaseAuthException(
        code: 'account-exists-with-different-credential',
        email: googleEmail,
        credential: googleCredential,
      );
    }
    final user = users.values.firstWhere((u) => u.email == googleEmail);
    if (!user.providers.contains('google.com')) {
      user.providers.add('google.com');
    }
    switchTo(user);
    return _Credential(user);
  }

  @override
  Future<UserCredential> signInWithEmailAndPassword({
    required String email,
    required String password,
  }) async {
    await onPasswordSignIn?.call();
    final matches = users.values.where(
      (u) => u.email?.toLowerCase() == email.toLowerCase(),
    );
    if (matches.isEmpty) {
      throw FirebaseAuthException(code: 'invalid-credential');
    }
    final user = matches.single;
    if (user.password != password) {
      throw FirebaseAuthException(code: 'wrong-password');
    }
    final result = passwordResultOverride ?? user;
    switchTo(result);
    return _Credential(result);
  }
}

class _User extends Fake implements User {
  _User(
    this.auth,
    this.uid,
    this.email,
    this.providers,
    this.emailVerified,
    this.isAnonymous,
  ) : password = providers.contains('password') ? 'original password' : null;
  final _Auth auth;
  @override
  final String uid;
  @override
  final String? email;
  @override
  bool emailVerified;
  @override
  bool isAnonymous;
  final List<String> providers;
  String? password;
  String? linkError;
  int linkCalls = 0;
  int reauthCalls = 0;
  bool publishReauthResult = true;
  bool publishReloadResult = true;
  int reloadCalls = 0;
  Future<void> Function(int number)? onReload;
  Future<void> Function()? onReauthenticate;
  Future<void> Function()? onLinked;
  @override
  List<UserInfo> get providerData =>
      providers.map((p) => _Info(p, uid, email)).toList();
  @override
  Future<void> reload() async {
    await onReload?.call(++reloadCalls);
    // Model native MethodChannelUser.reload publishing its captured user.
    if (publishReloadResult) auth.switchTo(this);
  }

  @override
  Future<UserCredential> reauthenticateWithPopup(AuthProvider provider) =>
      _reauth();
  @override
  Future<UserCredential> reauthenticateWithCredential(
    AuthCredential credential,
  ) => _reauth();
  Future<UserCredential> _reauth() async {
    reauthCalls++;
    if (auth.googleEmail != email) {
      throw FirebaseAuthException(code: 'user-mismatch');
    }
    await onReauthenticate?.call();
    if (publishReauthResult) auth.switchTo(this);
    return _Credential(this);
  }

  @override
  Future<UserCredential> linkWithPopup(AuthProvider provider) =>
      linkWithCredential(auth.googleCredential);
  @override
  Future<UserCredential> linkWithCredential(AuthCredential credential) async {
    linkCalls++;
    if (linkError != null) throw FirebaseAuthException(code: linkError!);
    if (credential is EmailAuthCredential) {
      expect(credential.email, email);
      password = credential.password;
    }
    providers.add(credential.providerId);
    isAnonymous = false;
    await onLinked?.call();
    auth.switchTo(this);
    return _Credential(this);
  }
}

class _Credential extends Fake implements UserCredential {
  _Credential(this.user);
  @override
  final User user;
}

class _Info extends Fake implements UserInfo {
  _Info(this.providerId, this.uid, this.email);
  @override
  final String providerId;
  @override
  final String uid;
  @override
  final String? email;
}

class _PasswordLink extends Fake implements ExistingGooglePasswordLink {
  _PasswordLink(this.auth);
  final _Auth auth;
  int calls = 0;
  void Function()? afterLink;
  @override
  Future<String> link({
    required String googleIdToken,
    required String email,
    required String password,
    required bool Function() isCurrent,
  }) async {
    calls++;
    expect(isCurrent(), isTrue);
    final matches = auth.users.values.where(
      (u) => u.email?.toLowerCase() == email.toLowerCase(),
    );
    if (matches.isEmpty) {
      throw FirebaseAuthException(code: 'invalid-credential');
    }
    final user = matches.single;
    if (user.providers.contains('password')) {
      throw FirebaseAuthException(code: 'provider-already-linked');
    }
    user.password = password;
    user.providers.add('password');
    afterLink?.call();
    return user.uid;
  }
}
