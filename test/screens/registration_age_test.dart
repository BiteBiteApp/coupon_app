import 'dart:async';
import 'package:coupon_app/screens/account_deletion_screen.dart';
import 'package:coupon_app/screens/restaurant_invite_preview_screen.dart';
import 'package:coupon_app/services/restaurant_invite_service.dart';
import 'package:google_sign_in_platform_interface/google_sign_in_platform_interface.dart';

import 'package:coupon_app/screens/customer_account_screen.dart';
import 'package:coupon_app/screens/restaurant_auth_screen.dart';
import 'package:coupon_app/services/account_provider_service.dart';
import 'package:coupon_app/services/registration_age_policy.dart';
import 'package:coupon_app/widgets/phone_auth_sheet.dart';
import 'package:coupon_app/widgets/registration_age_dialog.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
// SDK transport fakes: no Firebase, Google or SMS network requests.
// ignore: depend_on_referenced_packages
import 'package:firebase_core_platform_interface/firebase_core_platform_interface.dart';
// ignore: depend_on_referenced_packages
import 'package:firebase_auth_platform_interface/firebase_auth_platform_interface.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

Finder field(String label) => find.byWidgetPredicate(
  (w) =>
      w is TextField &&
      (w.decoration?.labelText == label || w.decoration?.hintText == label),
);

void main() {
  final platform = _PlatformAuth();
  final google = _Google();
  late _Auth auth;
  var pickerCalls = 0;
  setUpAll(() {
    FirebasePlatform.instance = _Core();
    FirebaseAuthPlatform.instance = platform;
    GoogleSignInPlatform.instance = google;
  });
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    RegistrationAgePolicy.enabledForTesting = true;
    auth = _Auth();
    pickerCalls = 0;
    platform.smsCalls = 0;
    platform.createCalls = 0;
    google.calls = 0;
    AccountProviderService.instanceForTesting = AccountProviderService(
      auth: auth,
      isWeb: false,
      googleCredential: () async {
        pickerCalls++;
        throw FirebaseAuthException(code: 'network-request-failed');
      },
    );
  });
  tearDown(() {
    RegistrationAgePolicy.enabledForTesting = null;
    AccountProviderService.instanceForTesting = null;
    auth.changes.close();
  });

  Future<void> open(WidgetTester tester, bool owner) async {
    tester.view.physicalSize = const Size(900, 1500);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        home: owner
            ? RestaurantAuthScreen(authStateStream: Stream.value(null))
            : CustomerAccountScreen(userStream: Stream.value(null)),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('How old are you?'), findsNothing);
  }

  Future<void> begin(
    WidgetTester tester,
    String method, {
    bool register = true,
  }) async {
    if (method == 'email') {
      if (register) {
        await tester.ensureVisible(find.text('Need an account? Create one'));
        await tester.tap(find.text('Need an account? Create one'));
        await tester.pumpAndSettle();
      }
      await tester.enterText(field('Email'), 'synthetic@example.test');
      await tester.enterText(field('Password'), 'test password');
      if (register) {
        await tester.enterText(field('Confirm Password'), 'test password');
      }
      final button = find.widgetWithText(
        find.byType(RestaurantAuthScreen).evaluate().isNotEmpty
            ? ElevatedButton
            : OutlinedButton,
        register
            ? (find.byType(RestaurantAuthScreen).evaluate().isNotEmpty
                  ? 'Create Account'
                  : 'Create Customer Account')
            : 'Sign In',
      );
      await tester.ensureVisible(button);
      await tester.tap(button);
    } else if (method == 'google') {
      await tester.ensureVisible(find.text('Sign in with Google'));
      await tester.tap(find.text('Sign in with Google'));
    } else {
      await tester.enterText(field('Phone number'), '2025550100');
      await tester.ensureVisible(find.text('Send Code'));
      await tester.tap(find.text('Send Code'));
    }
    await tester.pumpAndSettle();
  }

  for (final owner in [false, true]) {
    for (final method in ['email', 'google', 'phone']) {
      for (final answer in ['12', '13', '42', 'cancel']) {
        testWidgets(
          '${owner ? 'owner' : 'customer'} $method age=$answer actual control path',
          (tester) async {
            await open(tester, owner);
            await begin(tester, method);
            expect(find.text('How old are you?'), findsOneWidget);
            final controller = tester
                .widget<TextField>(field('Age in years'))
                .controller!;
            expect(controller.text, isEmpty);
            expect(auth.emailCalls + pickerCalls + platform.smsCalls, 0);
            if (answer == 'cancel') {
              await tester.tap(find.text('Cancel'));
            } else {
              await tester.enterText(field('Age in years'), answer);
              await tester.tap(find.text('Continue'));
            }
            await tester.pumpAndSettle();
            final allowed = answer == '13' || answer == '42';
            if (answer == '12') {
              expect(find.text('Registration unavailable'), findsOneWidget);
              expect(controller.text, isEmpty);
              expect(field('Age in years'), findsNothing);
              await tester.tap(find.text('Close'));
              await tester.pumpAndSettle();
            }
            expect(auth.emailCalls, allowed && method == 'email' ? 1 : 0);
            expect(pickerCalls, allowed && method == 'google' ? 1 : 0);
            expect(platform.smsCalls, allowed && method == 'phone' ? 1 : 0);
            expect(find.textContaining('successfully'), findsNothing);
            expect(find.textContaining('Account created.'), findsNothing);
            expect((await SharedPreferences.getInstance()).getKeys(), isEmpty);
            await tester.pumpWidget(const SizedBox.shrink());
            await tester.pumpAndSettle();
          },
        );
      }
    }
    testWidgets(
      '${owner ? 'owner' : 'customer'} existing email login never prompts',
      (tester) async {
        await open(tester, owner);
        await begin(tester, 'email', register: false);
        expect(find.text('How old are you?'), findsNothing);
        expect(auth.emailCalls, 1);
      },
    );
    testWidgets(
      '${owner ? 'owner' : 'customer'} default-off registration unchanged',
      (tester) async {
        RegistrationAgePolicy.enabledForTesting = null;
        await open(tester, owner);
        await begin(tester, 'email');
        expect(find.text('How old are you?'), findsNothing);
        expect(auth.emailCalls, 1);
      },
    );
    testWidgets(
      '${owner ? 'owner' : 'customer'} account switch during age prevents registration',
      (tester) async {
        await open(tester, owner);
        await begin(tester, 'email');
        auth.current = _User('other');
        auth.changes.add(auth.current);
        await tester.enterText(field('Age in years'), '13');
        await tester.tap(find.text('Continue'));
        await tester.pumpAndSettle();
        expect(auth.emailCalls, 0);
        expect(auth.current!.uid, 'other');
        expect(find.textContaining('successfully'), findsNothing);
      },
    );
  }

  testWidgets('invalid/blank ages fail safely, narrow screen with large text', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    bool? result;
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: TextScaler.linear(2)),
          child: child!,
        ),
        home: Scaffold(
          body: Builder(
            builder: (context) => TextButton(
              onPressed: () async =>
                  result = await requestRegistrationAge(context),
              child: const Text('Open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    for (final value in ['', 'abc', '-1', '12.9', '121', '999999', '1e2']) {
      await tester.enterText(field('Age in years'), value);
      await tester.ensureVisible(find.text('Continue'));
      await tester.tap(find.text('Continue'));
      await tester.pumpAndSettle();
      expect(find.text('Enter your age in whole years.'), findsOneWidget);
      expect(result, isNull);
      expect(tester.takeException(), isNull);
    }
    await tester.ensureVisible(find.text('Cancel'));
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(result, isFalse);
  });

  for (final side in ['coupon', 'bitescore']) {
    for (final answer in ['12', '13', 'cancel']) {
      testWidgets('invite $side age=$answer real creation path', (
        tester,
      ) async {
        tester.view.physicalSize = const Size(900, 1500);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        await tester.pumpWidget(
          MaterialApp(
            home: RestaurantInvitePreviewScreen(
              side: side,
              token: 'synthetic',
              previewForTesting: Future.value(
                RestaurantInvitePreview(
                  inviteId: 'test-invite',
                  side: side,
                  type: side,
                  status: 'active',
                  restaurantName: 'Synthetic',
                  expiresAt: null,
                  pendingRestaurantKey: '',
                  couponPrefill: null,
                  restaurantId: 'test-restaurant',
                  restaurantAddressSummary: '',
                ),
              ),
            ),
          ),
        );
        await tester.pump(const Duration(milliseconds: 400));
        await tester.enterText(field('Email'), 'synthetic@example.test');
        await tester.enterText(field('Password'), 'test password');
        await tester.enterText(field('Confirm password'), 'test password');
        await tester.tap(
          find.text(
            side == 'coupon'
                ? 'Create Account'
                : 'Create Account & Claim Restaurant',
          ),
        );
        await tester.pump(const Duration(milliseconds: 400));
        expect(platform.createCalls, 0);
        expect(find.text('How old are you?'), findsOneWidget);
        if (answer == 'cancel') {
          await tester.tap(find.text('Cancel'));
        } else {
          await tester.enterText(field('Age in years'), answer);
          await tester.tap(find.text('Continue'));
        }
        await tester.pump(const Duration(milliseconds: 400));
        // Let SDK/fake stream cancellation finish across the real/FakeAsync zones.
        await tester.runAsync(() => Future<void>.delayed(Duration.zero));
        await tester.pump(const Duration(milliseconds: 400));
        expect(platform.createCalls, answer == '13' ? 1 : 0);
        expect(find.textContaining('Account created'), findsNothing);
      });
    }
  }
  for (final answer in ['12', '13', 'cancel']) {
    testWidgets('signed-out deletion Google signup possibility age=$answer', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(900, 1500);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(const MaterialApp(home: AccountDeletionScreen()));
      await tester.pump(const Duration(milliseconds: 400));
      await tester.tap(find.text('Sign in with Google'));
      await tester.pump(const Duration(milliseconds: 400));
      expect(google.calls, 0);
      expect(find.text('How old are you?'), findsOneWidget);
      if (answer == 'cancel') {
        await tester.tap(find.text('Cancel'));
      } else {
        await tester.enterText(field('Age in years'), answer);
        await tester.tap(find.text('Continue'));
      }
      await tester.pump(const Duration(milliseconds: 400));
      // Let SDK/fake stream cancellation finish across the real/FakeAsync zones.
      await tester.runAsync(() => Future<void>.delayed(Duration.zero));
      await tester.pump(const Duration(milliseconds: 400));
      expect(google.calls, answer == '13' ? 1 : 0);
    });
  }

  for (final session in ['signed-out', 'guest', 'registered']) {
    testWidgets('phone sheet accepted callback; session=$session', (
      tester,
    ) async {
      final signedIn = session == 'registered';
      if (session != 'signed-out') {
        auth.current = _User('existing', anonymous: !signedIn);
      }
      var verified = 0;
      bool? result;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) => TextButton(
                onPressed: () async => result = await showPhoneAuthSheet(
                  context: context,
                  authForTesting: auth,
                  initialPhoneNumber: '+12025550100',
                  sendCodeImmediately: true,
                  onVerifiedCredential: (_) async {
                    verified++;
                  },
                ),
                child: const Text('Open'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();
      if (!signedIn) {
        await tester.enterText(field('Age in years'), '13');
        await tester.tap(find.text('Continue'));
        await tester.pumpAndSettle();
      } else {
        expect(find.text('How old are you?'), findsNothing);
      }
      expect(auth.smsCalls, 1);
      await (auth.verificationCompleted as dynamic)(
        PhoneAuthProvider.credential(
          verificationId: 'synthetic',
          smsCode: '123456',
        ),
      );
      await tester.pumpAndSettle();
      expect(verified, 1);
      await tester.pumpAndSettle();
      // Let SDK/fake stream cancellation finish across the real/FakeAsync zones.
      await tester.runAsync(() => Future<void>.delayed(Duration.zero));
      await tester.pumpAndSettle();
      expect(result, isTrue);
    });
  }

  for (final changeAccount in [false, true]) {
    testWidgets(
      'late phone callback ignored after ${changeAccount ? 'account change' : 'sheet dismissal'}',
      (tester) async {
        var verified = 0;
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: Builder(
                builder: (context) => TextButton(
                  onPressed: () => showPhoneAuthSheet(
                    context: context,
                    authForTesting: auth,
                    initialPhoneNumber: '+12025550100',
                    sendCodeImmediately: true,
                    onVerifiedCredential: (_) async {
                      verified++;
                    },
                  ),
                  child: const Text('Open'),
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('Open'));
        await tester.pumpAndSettle();
        await tester.enterText(field('Age in years'), '13');
        await tester.tap(find.text('Continue'));
        await tester.pumpAndSettle();
        if (changeAccount) {
          auth.current = _User('other');
          auth.changes.add(auth.current);
        } else {
          Navigator.of(
            tester.element(find.text('Enter verification code')),
          ).pop();
        }
        await (auth.verificationCompleted as dynamic)(
          PhoneAuthProvider.credential(
            verificationId: 'synthetic',
            smsCode: '123456',
          ),
        );
        await tester.pumpAndSettle();
        expect(verified, 0);
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pumpAndSettle();
      },
    );
  }
}

class _Core extends FirebasePlatform {
  @override
  FirebaseAppPlatform app([String name = '[DEFAULT]']) => FirebaseAppPlatform(
    name,
    const FirebaseOptions(
      apiKey: 'synthetic',
      appId: 'synthetic',
      messagingSenderId: 'synthetic',
      projectId: 'demo-age',
    ),
  );
}

class _PlatformAuth extends FirebaseAuthPlatform {
  int smsCalls = 0;
  int createCalls = 0;
  @override
  Future<UserCredentialPlatform> createUserWithEmailAndPassword(
    String email,
    String password,
  ) async {
    createCalls++;
    throw FirebaseAuthException(code: 'network-request-failed');
  }

  @override
  FirebaseAuthPlatform delegateFor({required FirebaseApp app}) => this;
  @override
  FirebaseAuthPlatform setInitialValues({
    InternalUserDetails? currentUser,
    String? languageCode,
  }) => this;
  @override
  UserPlatform? get currentUser => null;
  @override
  Stream<UserPlatform?> userChanges() => Stream.value(null);
  @override
  Stream<UserPlatform?> authStateChanges() => Stream.value(null);
  @override
  Future<void> verifyPhoneNumber({
    String? phoneNumber,
    required PhoneVerificationCompleted verificationCompleted,
    required PhoneVerificationFailed verificationFailed,
    required PhoneCodeSent codeSent,
    required PhoneCodeAutoRetrievalTimeout codeAutoRetrievalTimeout,
    String? autoRetrievedSmsCodeForTesting,
    Duration timeout = const Duration(seconds: 30),
    int? forceResendingToken,
    MultiFactorSession? multiFactorSession,
    PhoneMultiFactorInfo? multiFactorInfo,
  }) async {
    smsCalls++;
    codeSent('synthetic', null);
  }
}

class _Auth extends Fake implements FirebaseAuth {
  int emailCalls = 0;
  int smsCalls = 0;
  User? current;
  late final changes = StreamController<User?>.broadcast(sync: true);
  PhoneVerificationCompleted? verificationCompleted;
  @override
  User? get currentUser => current;
  @override
  Stream<User?> authStateChanges() => changes.stream;
  @override
  Future<UserCredential> createUserWithEmailAndPassword({
    required String email,
    required String password,
  }) async {
    emailCalls++;
    throw FirebaseAuthException(code: 'network-request-failed');
  }

  @override
  Future<UserCredential> signInWithEmailAndPassword({
    required String email,
    required String password,
  }) async {
    emailCalls++;
    throw FirebaseAuthException(code: 'network-request-failed');
  }

  @override
  Future<void> verifyPhoneNumber({
    String? phoneNumber,
    required PhoneVerificationCompleted verificationCompleted,
    required PhoneVerificationFailed verificationFailed,
    required PhoneCodeSent codeSent,
    required PhoneCodeAutoRetrievalTimeout codeAutoRetrievalTimeout,
    String? autoRetrievedSmsCodeForTesting,
    Duration timeout = const Duration(seconds: 30),
    int? forceResendingToken,
    MultiFactorSession? multiFactorSession,
    PhoneMultiFactorInfo? multiFactorInfo,
  }) async {
    smsCalls++;
    this.verificationCompleted = verificationCompleted;
    codeSent('synthetic', null);
  }
}

class _User extends Fake implements User {
  _User(this.uid, {this.anonymous = false});
  final bool anonymous;
  @override
  final String uid;
  @override
  bool get isAnonymous => anonymous;
}

class _Google extends GoogleSignInPlatform {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
  int calls = 0;
  @override
  Future<void> init(InitParameters parameters) async {}
  @override
  Stream<AuthenticationEvent>? get authenticationEvents => null;
  @override
  Future<AuthenticationResults> authenticate(
    AuthenticateParameters parameters,
  ) async {
    calls++;
    throw FirebaseAuthException(code: 'network-request-failed');
  }
}
