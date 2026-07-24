import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/models/restaurant.dart';
import 'package:coupon_app/screens/restaurant_auth_screen.dart';
import 'package:coupon_app/services/restaurant_account_service.dart';
import 'package:coupon_app/services/restaurant_auth_service.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  group('existing-account compatibility updates', () {
    test('missing restaurant account remains absent without a write', () async {
      Map<String, dynamic>? account;
      var existenceChecks = 0;
      var updates = 0;

      final updated =
          await RestaurantAccountService.updateLegacyAccountIdentityIfPresent(
            user: _TestUser(
              email: 'owner@example.com',
              phoneNumber: '+13525550100',
              displayName: 'Account Owner',
            ),
            accountExists: () async {
              existenceChecks += 1;
              return account != null;
            },
            updateAccount: (fields) async {
              updates += 1;
              account = Map<String, dynamic>.from(fields);
            },
            updatedAt: 'server-timestamp',
          );

      expect(updated, isFalse);
      expect(existenceChecks, 1);
      expect(updates, 0);
      expect(account, isNull);
    });

    test('existing account receives only narrow identity updates', () async {
      final preservedFields = <String, dynamic>{
        Restaurant.fieldName: 'Trusted Cafe',
        Restaurant.fieldStreetAddress: '1 Main Street',
        Restaurant.fieldCity: 'Crystal River',
        Restaurant.fieldState: 'FL',
        Restaurant.fieldZipCode: '34428',
        Restaurant.fieldPhone: '(352) 555-0199',
        Restaurant.fieldLatitude: 28.8517,
        Restaurant.fieldLongitude: -82.487,
        Restaurant.fieldAddressFingerprint: List<String>.filled(64, 'a').join(),
        Restaurant.fieldLocationValidatedAt: 'trusted-timestamp',
        Restaurant.fieldLocationSource: 'google_geocoding',
        Restaurant.fieldLocationVersion: 4,
        Restaurant.fieldProfileVersion: 7,
        Restaurant.fieldApprovalStatus: 'approved',
        'couponApplicationSubmitted': true,
        'geohash': 'dhw0abc123',
        'subscriptionStatus': 'active',
        'stripeCustomerId': 'cus_existing',
        'inviteTokenHash': 'invite-hash',
        'customerLinkId': 'customer-link',
        'futureField': <String, dynamic>{'preserve': true},
      };
      final account = <String, dynamic>{
        Restaurant.fieldUid: 'auth-owner',
        Restaurant.fieldEmail: 'old@example.com',
        'phoneNumber': '+13525550000',
        'displayName': 'Old Owner',
        'emailVerified': false,
        Restaurant.fieldUpdatedAt: 'old-timestamp',
        ...preservedFields,
      };
      Map<String, dynamic>? appliedFields;

      final updated =
          await RestaurantAccountService.updateLegacyAccountIdentityIfPresent(
            user: _TestUser(
              email: '  owner@example.com  ',
              phoneNumber: '  +13525550100  ',
              displayName: '  Account Owner  ',
              emailVerified: true,
            ),
            accountExists: () async => true,
            updateAccount: (fields) async {
              appliedFields = Map<String, dynamic>.from(fields);
              account.addAll(fields);
            },
            updatedAt: 'server-timestamp',
          );

      expect(updated, isTrue);
      expect(appliedFields, <String, dynamic>{
        Restaurant.fieldUid: 'auth-owner',
        Restaurant.fieldEmail: 'owner@example.com',
        'phoneNumber': '+13525550100',
        'displayName': 'Account Owner',
        'emailVerified': true,
        Restaurant.fieldUpdatedAt: 'server-timestamp',
      });
      for (final entry in preservedFields.entries) {
        expect(account[entry.key], entry.value, reason: entry.key);
      }
    });

    test('deletion race is a safe no-create result', () async {
      Map<String, dynamic>? account = <String, dynamic>{
        Restaurant.fieldUid: 'auth-owner',
      };
      var updateAttempts = 0;

      final updated =
          await RestaurantAccountService.updateLegacyAccountIdentityIfPresent(
            user: _TestUser(email: 'owner@example.com'),
            accountExists: () async => account != null,
            updateAccount: (fields) async {
              updateAttempts += 1;
              account = null;
              throw FirebaseException(
                plugin: 'cloud_firestore',
                code: 'not-found',
                message: 'The document disappeared before update.',
              );
            },
            updatedAt: 'server-timestamp',
          );

      expect(updated, isFalse);
      expect(updateAttempts, 1);
      expect(account, isNull);
    });

    test('unrelated update failure still propagates', () async {
      final failure = FirebaseException(
        plugin: 'cloud_firestore',
        code: 'permission-denied',
        message: 'The write is not allowed.',
      );

      await expectLater(
        RestaurantAccountService.updateLegacyAccountIdentityIfPresent(
          user: _TestUser(email: 'owner@example.com'),
          accountExists: () async => true,
          updateAccount: (fields) async => throw failure,
          updatedAt: 'server-timestamp',
        ),
        throwsA(same(failure)),
      );
    });

    test('existence-check failure still propagates', () async {
      final failure = StateError('account lookup unavailable');

      await expectLater(
        RestaurantAccountService.updateLegacyAccountIdentityIfPresent(
          user: _TestUser(email: 'owner@example.com'),
          accountExists: () async => throw failure,
          updateAccount: (fields) async {},
          updatedAt: 'server-timestamp',
        ),
        throwsA(same(failure)),
      );
    });
  });

  for (final isLoginMode in <bool>[false, true]) {
    test(
      '${isLoginMode ? 'email sign-in' : 'email registration'} uses its auth path and existing-only completion',
      () async {
        final actions = <String>[];
        final user = _TestUser(emailVerified: isLoginMode);

        final result = await RestaurantAuthService.authenticateWithEmail(
          isLoginMode: isLoginMode,
          signIn: () async {
            actions.add('sign-in');
            return user;
          },
          register: () async {
            actions.add('register');
            return user;
          },
          sendVerificationEmail: (user) async {
            actions.add('verification');
          },
          refreshUser: (user) async {
            actions.add('refresh');
            return user;
          },
          syncExistingRestaurantAccount: (user) async {
            actions.add('update-existing');
          },
          upsertUserProfile: (user) async {
            actions.add('user-profile');
          },
        );

        expect(result, same(user));
        expect(
          actions,
          isLoginMode
              ? <String>[
                  'sign-in',
                  'refresh',
                  'update-existing',
                  'user-profile',
                ]
              : <String>[
                  'register',
                  'verification',
                  'refresh',
                  'update-existing',
                  'user-profile',
                ],
        );
      },
    );

    test(
      '${isLoginMode ? 'email sign-in' : 'email registration'} completes when existing-account synchronization fails',
      () async {
        final actions = <String>[];
        final user = _TestUser(emailVerified: isLoginMode);

        final result = await RestaurantAuthService.authenticateWithEmail(
          isLoginMode: isLoginMode,
          signIn: () async {
            actions.add('sign-in');
            return user;
          },
          register: () async {
            actions.add('register');
            return user;
          },
          sendVerificationEmail: (user) async {
            actions.add('verification');
          },
          refreshUser: (user) async {
            actions.add('refresh');
            return user;
          },
          syncExistingRestaurantAccount: (user) async {
            actions.add('update-existing');
            throw StateError('account synchronization unavailable');
          },
          upsertUserProfile: (user) async {
            actions.add('user-profile');
          },
        );

        expect(result, same(user));
        expect(
          actions,
          isLoginMode
              ? <String>[
                  'sign-in',
                  'refresh',
                  'update-existing',
                  'user-profile',
                ]
              : <String>[
                  'register',
                  'verification',
                  'refresh',
                  'update-existing',
                  'user-profile',
                ],
        );
      },
    );
  }

  test('email authentication propagates profile completion failures', () async {
    final actions = <String>[];
    final user = _TestUser();
    final completionFailure = StateError('user-profile unavailable');

    await expectLater(
      RestaurantAuthService.authenticateWithEmail(
        isLoginMode: true,
        signIn: () async {
          actions.add('sign-in');
          return user;
        },
        register: () async => user,
        refreshUser: (user) async {
          actions.add('refresh');
          return user;
        },
        syncExistingRestaurantAccount: (user) async {
          actions.add('update-existing');
        },
        upsertUserProfile: (user) async {
          actions.add('user-profile');
          throw completionFailure;
        },
      ),
      throwsA(same(completionFailure)),
    );
    expect(actions, <String>[
      'sign-in',
      'refresh',
      'update-existing',
      'user-profile',
    ]);
  });

  test('email authentication propagates genuine auth failures', () async {
    final actions = <String>[];
    final authFailure = FirebaseAuthException(code: 'invalid-credential');

    await expectLater(
      RestaurantAuthService.authenticateWithEmail(
        isLoginMode: true,
        signIn: () async {
          actions.add('sign-in');
          throw authFailure;
        },
        register: () async {
          actions.add('register');
          return _TestUser();
        },
        refreshUser: (user) async {
          actions.add('refresh');
          return user;
        },
        syncExistingRestaurantAccount: (user) async {
          actions.add('update-existing');
        },
        upsertUserProfile: (user) async {
          actions.add('user-profile');
        },
      ),
      throwsA(same(authFailure)),
    );
    expect(actions, <String>['sign-in']);
  });

  test('email registration propagates verification failures', () async {
    final actions = <String>[];
    final user = _TestUser(emailVerified: false);
    final verificationFailure = StateError('verification unavailable');

    await expectLater(
      RestaurantAuthService.authenticateWithEmail(
        isLoginMode: false,
        signIn: () async => user,
        register: () async {
          actions.add('register');
          return user;
        },
        sendVerificationEmail: (user) async {
          actions.add('verification');
          throw verificationFailure;
        },
        refreshUser: (user) async {
          actions.add('refresh');
          return user;
        },
        syncExistingRestaurantAccount: (user) async {
          actions.add('update-existing');
        },
        upsertUserProfile: (user) async {
          actions.add('user-profile');
        },
      ),
      throwsA(same(verificationFailure)),
    );
    expect(actions, <String>['register', 'verification']);
  });

  test('email authentication propagates refresh failures', () async {
    final actions = <String>[];
    final user = _TestUser();
    final refreshFailure = StateError('refresh unavailable');

    await expectLater(
      RestaurantAuthService.authenticateWithEmail(
        isLoginMode: true,
        signIn: () async {
          actions.add('sign-in');
          return user;
        },
        register: () async => user,
        refreshUser: (user) async {
          actions.add('refresh');
          throw refreshFailure;
        },
        syncExistingRestaurantAccount: (user) async {
          actions.add('update-existing');
        },
        upsertUserProfile: (user) async {
          actions.add('user-profile');
        },
      ),
      throwsA(same(refreshFailure)),
    );
    expect(actions, <String>['sign-in', 'refresh']);
  });

  test(
    'Google sign-in uses its injected transport and profile completion',
    () async {
      final actions = <String>[];
      final user = _TestUser();

      final result = await RestaurantAuthService.signInWithGoogleUsing(
        authenticate: () async {
          actions.add('google-auth');
          return user;
        },
        syncExistingRestaurantAccount: (user) async {
          actions.add('update-existing');
        },
        upsertUserProfile: (user) async {
          actions.add('user-profile');
        },
      );

      expect(result, same(user));
      expect(actions, <String>[
        'google-auth',
        'update-existing',
        'user-profile',
      ]);
    },
  );

  test(
    'phone sign-in uses its injected transport and profile completion',
    () async {
      final actions = <String>[];
      final user = _TestUser();

      final result = await RestaurantAuthService.signInWithPhoneUsing(
        authenticate: () async {
          actions.add('phone-auth');
          return user;
        },
        syncExistingRestaurantAccount: (user) async {
          actions.add('update-existing');
        },
        upsertUserProfile: (user) async {
          actions.add('user-profile');
        },
      );

      expect(result, same(user));
      expect(actions, <String>[
        'phone-auth',
        'update-existing',
        'user-profile',
      ]);
    },
  );

  for (final isGoogle in <bool>[true, false]) {
    final providerName = isGoogle ? 'Google' : 'phone';

    test(
      '$providerName sign-in propagates shared profile completion failures',
      () async {
        final actions = <String>[];
        final user = _TestUser();
        final completionFailure = StateError('user-profile unavailable');

        final result = isGoogle
            ? RestaurantAuthService.signInWithGoogleUsing(
                authenticate: () async {
                  actions.add('provider-auth');
                  return user;
                },
                syncExistingRestaurantAccount: (user) async {
                  actions.add('update-existing');
                },
                upsertUserProfile: (user) async {
                  actions.add('user-profile');
                  throw completionFailure;
                },
              )
            : RestaurantAuthService.signInWithPhoneUsing(
                authenticate: () async {
                  actions.add('provider-auth');
                  return user;
                },
                syncExistingRestaurantAccount: (user) async {
                  actions.add('update-existing');
                },
                upsertUserProfile: (user) async {
                  actions.add('user-profile');
                  throw completionFailure;
                },
              );

        await expectLater(result, throwsA(same(completionFailure)));
        expect(actions, <String>[
          'provider-auth',
          'update-existing',
          'user-profile',
        ]);
      },
    );

    test(
      '$providerName sign-in completes when shared account synchronization fails',
      () async {
        final actions = <String>[];
        final user = _TestUser();

        final result = isGoogle
            ? await RestaurantAuthService.signInWithGoogleUsing(
                authenticate: () async {
                  actions.add('provider-auth');
                  return user;
                },
                syncExistingRestaurantAccount: (user) async {
                  actions.add('update-existing');
                  throw StateError('account synchronization unavailable');
                },
                upsertUserProfile: (user) async {
                  actions.add('user-profile');
                },
              )
            : await RestaurantAuthService.signInWithPhoneUsing(
                authenticate: () async {
                  actions.add('provider-auth');
                  return user;
                },
                syncExistingRestaurantAccount: (user) async {
                  actions.add('update-existing');
                  throw StateError('account synchronization unavailable');
                },
                upsertUserProfile: (user) async {
                  actions.add('user-profile');
                },
              );

        expect(result, same(user));
        expect(actions, <String>[
          'provider-auth',
          'update-existing',
          'user-profile',
        ]);
      },
    );

    test('$providerName sign-in propagates genuine auth failures', () async {
      final actions = <String>[];
      final authFailure = FirebaseAuthException(code: 'invalid-credential');

      final result = isGoogle
          ? RestaurantAuthService.signInWithGoogleUsing(
              authenticate: () async {
                actions.add('provider-auth');
                throw authFailure;
              },
              syncExistingRestaurantAccount: (user) async {
                actions.add('update-existing');
              },
              upsertUserProfile: (user) async {
                actions.add('user-profile');
              },
            )
          : RestaurantAuthService.signInWithPhoneUsing(
              authenticate: () async {
                actions.add('provider-auth');
                throw authFailure;
              },
              syncExistingRestaurantAccount: (user) async {
                actions.add('update-existing');
              },
              upsertUserProfile: (user) async {
                actions.add('user-profile');
              },
            );

      await expectLater(result, throwsA(same(authFailure)));
      expect(actions, <String>['provider-auth']);
    });
  }

  testWidgets(
    'email sync failure still reports sign-in success on the auth screen',
    (tester) async {
      SharedPreferences.setMockInitialValues(<String, Object>{});
      final user = _TestUser(emailVerified: true);
      var accountSyncs = 0;
      var profileCompletions = 0;

      await tester.pumpWidget(
        MaterialApp(
          home: RestaurantAuthScreen(
            authStateStream: Stream<User?>.value(null),
            authenticateWithEmail:
                ({required isLoginMode, required email, required password}) {
                  return RestaurantAuthService.authenticateWithEmail(
                    isLoginMode: isLoginMode,
                    signIn: () async => user,
                    register: () async => user,
                    refreshUser: (user) async => user,
                    syncExistingRestaurantAccount: (user) async {
                      accountSyncs += 1;
                      throw StateError('account synchronization unavailable');
                    },
                    upsertUserProfile: (user) async {
                      profileCompletions += 1;
                    },
                  );
                },
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.enterText(
        find.widgetWithText(TextField, 'Email'),
        'owner@example.com',
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Password'),
        'correct horse battery staple',
      );
      await tester.tap(find.widgetWithText(ElevatedButton, 'Sign In'));
      await tester.pumpAndSettle();

      expect(accountSyncs, 1);
      expect(profileCompletions, 1);
      expect(find.text('Signed in successfully.'), findsOneWidget);
      expect(find.textContaining('failed'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  test('production auth and lifecycle paths never call the legacy creator', () {
    final productionSources = <String, String>{
      for (final path in <String>[
        'lib/services/restaurant_auth_service.dart',
        'lib/screens/restaurant_auth_screen.dart',
        'lib/screens/restaurant_create_coupon_screen.dart',
        'lib/screens/admin_review_screen.dart',
        'lib/screens/restaurant_profile_screen.dart',
        'lib/screens/restaurant_specials_screen.dart',
        'lib/screens/restaurant_customer_deep_link_screen.dart',
        'lib/services/restaurant_menu_service.dart',
      ])
        path: File(path).readAsStringSync(),
    };

    for (final entry in productionSources.entries) {
      expect(
        entry.value,
        isNot(contains('createOrUpdateAccountRecord')),
        reason: entry.key,
      );
    }
    final authService =
        productionSources['lib/services/restaurant_auth_service.dart']!;
    final authScreen =
        productionSources['lib/screens/restaurant_auth_screen.dart']!;
    expect(authService, contains('signInWithGoogleUsing('));
    expect(authService, contains('signInWithPhoneUsing('));
    expect(authScreen, contains('RestaurantAuthService.authenticateWithEmail'));
    expect(authScreen, contains('buildNoApprovedAccountsScreen(user)'));
  });

  test('missing account and legacy skeleton resolve to application setup', () {
    expect(
      resolveRestaurantAuthCouponGateState(null),
      RestaurantAuthCouponGateState.application,
    );
    expect(
      resolveRestaurantAuthCouponGateState(<String, dynamic>{
        Restaurant.fieldUid: 'auth-owner',
        Restaurant.fieldEmail: 'owner@example.com',
      }),
      RestaurantAuthCouponGateState.application,
    );
  });

  test('submitted existing accounts retain their lifecycle routing', () {
    Map<String, dynamic> account(String status) => <String, dynamic>{
      'couponApplicationSubmitted': true,
      Restaurant.fieldApprovalStatus: status,
    };

    expect(
      resolveRestaurantAuthCouponGateState(account('pending')),
      RestaurantAuthCouponGateState.pending,
    );
    expect(
      resolveRestaurantAuthCouponGateState(account('approved')),
      RestaurantAuthCouponGateState.approved,
    );
    expect(
      resolveRestaurantAuthCouponGateState(account('rejected')),
      RestaurantAuthCouponGateState.rejected,
    );
  });

  test('migrated lifecycle screens contain no legacy direct-write calls', () {
    final ownerScreen = File(
      'lib/screens/restaurant_create_coupon_screen.dart',
    ).readAsStringSync();
    final adminScreen = File(
      'lib/screens/admin_review_screen.dart',
    ).readAsStringSync();

    for (final forbidden in <String>[
      'RestaurantAccountService.createOrUpdateAccountRecord',
      'RestaurantAccountService.saveRestaurantProfile',
      'RestaurantAccountService.saveRestaurantCoordinates',
      'locationFromAddress',
    ]) {
      expect(ownerScreen, isNot(contains(forbidden)));
    }
    for (final forbidden in <String>[
      'RestaurantAccountService.saveRestaurantProfile',
      'RestaurantAccountService.saveRestaurantCoordinates',
      'RestaurantAccountService.approveAccount',
      'RestaurantAccountService.rejectAccount',
    ]) {
      expect(adminScreen, isNot(contains(forbidden)));
    }
    expect(
      ownerScreen,
      contains('BiteSaverProfileSaveRequest.submitApplication'),
    );
    expect(ownerScreen, contains('BiteSaverProfileSaveRequest.ownerUpdate'));
    expect(adminScreen, contains('BiteSaverApplicationDecision.approve'));
    expect(adminScreen, contains('BiteSaverApplicationDecision.reject'));
    expect(adminScreen, contains('BiteSaverProfileSaveRequest.adminUpdate'));
  });

  test(
    'owner name changes stay separate and application omits hidden fields',
    () {
      final ownerScreen = File(
        'lib/screens/restaurant_create_coupon_screen.dart',
      ).readAsStringSync();
      final applicationStart = ownerScreen.indexOf(
        'BiteSaverRestaurantProfileInput _applicationProfileInput',
      );
      final applicationEnd = ownerScreen.indexOf(
        'String _stringFromCoordinateValue',
        applicationStart,
      );
      final applicationHelper = ownerScreen.substring(
        applicationStart,
        applicationEnd,
      );

      expect(ownerScreen, contains('restaurant_name_change_requests'));
      expect(
        ownerScreen,
        contains('final approvedName = _storedRestaurantName'),
      );
      expect(applicationHelper, isNot(contains('websiteController')));
      expect(applicationHelper, isNot(contains('bioController')));
      expect(applicationHelper, isNot(contains('restaurantImageUrl')));
      expect(applicationHelper, isNot(contains('_hoursForPersistence')));
    },
  );

  test(
    'remaining compatibility writes cannot materialize status or location',
    () {
      final accountService = File(
        'lib/services/restaurant_account_service.dart',
      ).readAsStringSync();

      expect(
        accountService,
        contains("@Deprecated('Use reviewBiteSaverApplication instead.')"),
      );
      expect(
        accountService,
        contains(
          'Trusted BiteSaver coordinates must be written only by the backend.',
        ),
      );
      expect(accountService, contains('docForUser(uid).update({'));
      expect(accountService, isNot(contains('batch.set(docForUser')));
      expect(accountService, isNot(contains('transaction.set(docForUser')));
    },
  );

  test('deprecated creator contains no account-creation write path', () {
    final accountService = File(
      'lib/services/restaurant_account_service.dart',
    ).readAsStringSync();
    final helperStart = accountService.indexOf(
      'static Future<void> createOrUpdateAccountRecord',
    );
    final helperEnd = accountService.indexOf(
      'static Future<void> syncEmailVerified',
      helperStart,
    );
    final helperSource = accountService.substring(helperStart, helperEnd);

    expect(helperSource, contains('docForUser(user.uid)'));
    expect(helperSource, contains('updateLegacyAccountIdentityIfPresent('));
    expect(helperSource, contains('updateExistingAccountOnly('));
    expect(helperSource, contains('updateAccount({'));
    expect(helperSource, isNot(contains('.set(')));
    expect(helperSource, isNot(contains('SetOptions')));
  });

  test('account normalization preserves trusted lifecycle metadata', () {
    final validatedAt = Timestamp.fromDate(DateTime.utc(2026, 7, 23));
    final normalized = RestaurantAccountService.normalizedAccountDataForTesting(
      <String, dynamic>{
        Restaurant.fieldUid: 'stored-owner',
        Restaurant.fieldProfileVersion: 5,
        Restaurant.fieldLocationVersion: 2,
        Restaurant.fieldFormattedAddress: '1 Main Street, Crystal River, FL',
        Restaurant.fieldAddressFingerprint: List<String>.filled(64, 'a').join(),
        Restaurant.fieldLocationValidatedAt: validatedAt,
        Restaurant.fieldLocationSource: 'google_geocoding',
        Restaurant.fieldLatitude: 28.8517,
        Restaurant.fieldLongitude: -82.487,
      },
      fallbackUid: 'firestore-document',
    );
    final restaurant = Restaurant.fromFirestore(
      normalized,
      documentId: 'firestore-document',
      coupons: const [],
    );

    expect(restaurant.documentId, 'firestore-document');
    expect(restaurant.uid, 'stored-owner');
    expect(restaurant.profileVersion, 5);
    expect(restaurant.locationVersion, 2);
    expect(restaurant.hasTrustedSearchableLocation, isTrue);
  });
}

class _TestUser extends Fake implements User {
  final String _uid;
  final String? _email;
  final String? _phoneNumber;
  final String? _displayName;
  final bool _emailVerified;

  _TestUser({
    String uid = 'auth-owner',
    String? email,
    String? phoneNumber,
    String? displayName,
    bool emailVerified = true,
  }) : _uid = uid,
       _email = email,
       _phoneNumber = phoneNumber,
       _displayName = displayName,
       _emailVerified = emailVerified;

  @override
  String get uid => _uid;

  @override
  String? get email => _email;

  @override
  String? get phoneNumber => _phoneNumber;

  @override
  String? get displayName => _displayName;

  @override
  bool get emailVerified => _emailVerified;
}
