import 'dart:async';
import 'dart:convert';
import 'package:coupon_app/screens/customer_account_screen.dart';
import 'package:coupon_app/screens/main_navigation_screen.dart';
import 'package:coupon_app/services/account_provider_service.dart';
import 'package:coupon_app/services/customer_auth_service.dart';
import 'package:coupon_app/services/bitescore_sign_in_gate.dart';
import 'package:coupon_app/services/restaurant_auth_service.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:coupon_app/models/demo_redemption_store.dart';
import 'package:firebase_core/firebase_core.dart';
// ignore: depend_on_referenced_packages
import 'package:firebase_core_platform_interface/firebase_core_platform_interface.dart';
// ignore: depend_on_referenced_packages
import 'package:firebase_auth_platform_interface/firebase_auth_platform_interface.dart';
// ignore: depend_on_referenced_packages
import 'package:cloud_firestore_platform_interface/cloud_firestore_platform_interface.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_sign_in_platform_interface/google_sign_in_platform_interface.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

const email = 'synthetic@example.test';
const password = 'synthetic-test-password';
// Regression for the observed Android result: successful Google confirmation
// returns an existing unverified account; linking must keep verification pending. Only the SDK/network transports are fake;
// the customer form, services, REST adapter and navigation lifecycle are real.
void main() {
  testWidgets(
    'unverified Google account completes actual Android customer submit once',
    (tester) async {
      expect(defaultTargetPlatform, TargetPlatform.android);
      final backend = Backend();
      final auth = Auth(backend);
      final firestore = Store();
      final google = Google();
      FirebasePlatform.instance = Core();
      FirebaseAuthPlatform.instance = auth;
      FirebaseFirestorePlatform.instance = firestore;
      GoogleSignInPlatform.instance = google;
      SharedPreferences.setMockInitialValues({});
      DemoRedemptionStore.retireLegacyWritersForBoundedCutover();
      tester.view.physicalSize = const Size(1000, 1800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await http.runWithClient(() async {
        await tester.pumpWidget(
          MaterialApp(
            home: MainNavigationScreen(
              initialIndex: 2,
              initializePlatformServices: false,
              testCustomerAuthRealmProvider: () =>
                  auth.current == null ? 'guest' : 'signed:original-uid',
              testCustomerAuthRealmChanges: auth.changes.stream.map(
                (user) => user == null ? 'guest' : 'signed:original-uid',
              ),
              testPagesBuilder: (_) => [
                const SizedBox(),
                const SizedBox(),
                const CustomerAccountScreen(),
              ],
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.text('Need an account? Create one'));
        await tester.pumpAndSettle();
        Finder field(String label) => find.byWidgetPredicate(
          (w) => w is TextField && w.decoration?.labelText == label,
        );
        await tester.enterText(field('Email'), email);
        await tester.enterText(field('Password'), password);
        await tester.enterText(field('Confirm Password'), password);
        final initiatingElement = tester.element(
          find.byType(CustomerAccountScreen),
        );
        await tester.ensureVisible(find.text('Create Customer Account'));
        await tester.tap(find.text('Create Customer Account'));
        await tester.pumpAndSettle();
        expect(find.byType(AlertDialog), findsNothing);
        expect(find.text('Continue with Google'), findsNothing);
        expect(google.calls, 1);
        expect(find.text('Please wait...'), findsWidgets);
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.inactive,
        );
        tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
        tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
        await tester.pump();
        tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.inactive,
        );
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.resumed,
        );
        google.release.complete(
          AuthenticationResults(
            user: GoogleSignInUserData(email: email, id: 'synthetic'),
            authenticationTokens: AuthenticationTokenData(
              idToken:
                  'header.${base64Url.encode(utf8.encode(jsonEncode({'email': email})))}.signature',
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.runAsync(() async => Future<void>.delayed(Duration.zero));
        await tester.pumpAndSettle();
        expect(backend.links, 1);
        expect(auth.logins, 2);
        expect(initiatingElement.mounted, isFalse);
        expect(AccountProviderService.activity.value, isTrue);
        expect(auth.verifications, 1);
        expect(find.text('Verify Your Email'), findsOneWidget);
        auth.verificationRelease.complete();
        await tester.pump();
        await tester.runAsync(() async => Future<void>.delayed(Duration.zero));
        await tester.pumpAndSettle();
        expect(auth.creates, 1);
        expect(auth.logins, 2);
        expect(backend.links, 1);
        expect(auth.current?.uid, 'original-uid');
        expect(auth.current?.isEmailVerified, isFalse);
        expect(
          FirebaseAuth.instance.currentUser!.providerData.map(
            (p) => p.providerId,
          ),
          unorderedEquals(['google.com', 'password']),
        );
        expect(BiteScoreSignInGate.canCurrentUserWrite, isFalse);
        expect(auth.verifications, 1);
        expect(auth.reloads, greaterThanOrEqualTo(2));
        expect(auth.emittedSignedIn, 1);
        expect(firestore.writes, ['user_profiles/original-uid']);
        expect(firestore.existingData['username'], 'unchanged');
        expect(firestore.existingData['review'], 'unchanged');
        expect(AccountProviderService.lastOperationSucceeded, isTrue);
        expect(find.text('Verify Your Email'), findsOneWidget);
        expect(find.text('Create Customer Account'), findsNothing);
        expect(find.text('Admin Workspace'), findsNothing);
        expect(
          CustomerAuthService.requiresEmailVerification(
            FirebaseAuth.instance.currentUser!,
          ),
          isTrue,
        );
        expect(
          RestaurantAuthService.requiresEmailVerification(
            FirebaseAuth.instance.currentUser!,
          ),
          isTrue,
        );
        // Existing controls stay usable without a second registration submit.
        await tester.ensureVisible(find.text('Resend verification email'));
        await tester.tap(find.text('Resend verification email'));
        await tester.pumpAndSettle();
        expect(auth.verifications, 2);
        expect(auth.current?.isEmailVerified, isFalse);
        final reloadsBeforeRefresh = auth.reloads;
        await tester.ensureVisible(find.text('Refresh Verification'));
        await tester.tap(find.text('Refresh Verification'));
        await tester.pumpAndSettle();
        expect(auth.reloads, greaterThan(reloadsBeforeRefresh));
        expect(auth.tokenRefreshes, 1);
        expect(find.text('Verify Your Email'), findsOneWidget);
        expect(auth.current?.isEmailVerified, isFalse);
        expect(auth.creates, 1);
        expect(backend.links, 1);

        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pumpAndSettle();
      }, () => MockClient(backend.handle));
      await auth.changes.close();
    },
    skip: kIsWeb,
  );
}

class Core extends FirebasePlatform {
  @override
  FirebaseAppPlatform app([String name = '[DEFAULT]']) => FirebaseAppPlatform(
    name,
    const FirebaseOptions(
      apiKey: 'synthetic',
      appId: 'synthetic',
      messagingSenderId: 'synthetic',
      projectId: 'synthetic',
    ),
  );
}

class Auth extends FirebaseAuthPlatform {
  Auth(this.backend);
  final Backend backend;
  final changes = StreamController<UserPlatform?>.broadcast();
  final verificationRelease = Completer<void>();
  UserPlatform? current;
  int creates = 0,
      logins = 0,
      verifications = 0,
      reloads = 0,
      tokenRefreshes = 0,
      emittedSignedIn = 0;
  @override
  FirebaseAuthPlatform delegateFor({required FirebaseApp app}) => this;
  @override
  FirebaseAuthPlatform setInitialValues({
    InternalUserDetails? currentUser,
    String? languageCode,
  }) => this;
  @override
  UserPlatform? get currentUser => current;
  @override
  Stream<UserPlatform?> authStateChanges() =>
      Stream<UserPlatform?>.multi((sink) {
        sink.add(current);
        final sub = changes.stream.listen(sink.add);
        sink.onCancel = sub.cancel;
      }, isBroadcast: true);
  @override
  Stream<UserPlatform?> userChanges() => authStateChanges();
  @override
  Future<UserCredentialPlatform> createUserWithEmailAndPassword(
    String email,
    String password,
  ) async {
    creates++;
    throw FirebaseAuthException(code: 'email-already-in-use');
  }

  @override
  Future<UserCredentialPlatform> signInWithEmailAndPassword(
    String email,
    String password,
  ) async {
    logins++;
    if (backend.links == 0) {
      throw FirebaseAuthException(code: 'invalid-credential');
    }
    current = Person(this);
    changes.add(current);
    emittedSignedIn++;
    return Credential(this, current!);
  }
}

class Multi extends MultiFactorPlatform {
  Multi(super.auth);
}

class Person extends UserPlatform {
  Person(this.owner)
    : super(
        owner,
        Multi(owner),
        InternalUserDetails(
          userInfo: InternalUserInfo(
            uid: 'original-uid',
            email: email,
            displayName: 'Existing name',
            isAnonymous: false,
            isEmailVerified: false,
          ),
          providerData: [
            {
              'providerId': 'google.com',
              'uid': 'synthetic-google-id',
              'isAnonymous': false,
              'isEmailVerified': true,
            },
            {
              'providerId': 'password',
              'uid': email,
              'isAnonymous': false,
              'isEmailVerified': true,
            },
          ],
        ),
      );
  final Auth owner;
  @override
  Future<void> reload() async {
    owner.reloads++;
  }

  @override
  Future<String?> getIdToken(bool forceRefresh) async {
    expect(forceRefresh, isTrue);
    owner.tokenRefreshes++;
    return 'synthetic-token';
  }

  @override
  Future<void> sendEmailVerification([ActionCodeSettings? settings]) async {
    owner.verifications++;
    await owner.verificationRelease.future;
  }
}

class Credential extends UserCredentialPlatform {
  Credential(FirebaseAuthPlatform auth, UserPlatform user)
    : super(auth: auth, user: user);
}

class Store extends FirebaseFirestorePlatform {
  final writes = <String>[];
  final existingData = <String, dynamic>{
    'username': 'unchanged',
    'review': 'unchanged',
  };
  @override
  FirebaseFirestorePlatform delegateFor({
    required FirebaseApp app,
    required String databaseId,
  }) => this;
  @override
  CollectionReferencePlatform collection(String path) => Collection(this, path);
}

class Collection extends CollectionReferencePlatform {
  Collection(super.firestore, super.path);
  @override
  DocumentReferencePlatform doc([String? child]) =>
      Doc(firestore, '$path/$child');
}

class Doc extends DocumentReferencePlatform {
  Doc(super.firestore, super.path);
  @override
  Future<void> set(Map<String, dynamic> data, [SetOptions? options]) async {
    expect(options?.merge, true);
    (firestore as Store).writes.add(path);
    (firestore as Store).existingData.addAll(data);
  }
}

class Backend {
  int links = 0;
  Future<http.Response> handle(http.Request req) async {
    final body = jsonDecode(req.body) as Map<String, dynamic>;
    final method = req.url.path.split(':').last;
    final id = {
      'localId': 'original-uid',
      'email': email,
      'emailVerified': false,
      'idToken': 'synthetic-firebase-token',
      'isNewUser': false,
    };
    if (method == 'signInWithIdp') {
      expect(body['autoCreate'], false);
      return http.Response(jsonEncode(id), 200);
    }
    if (method == 'lookup') {
      return http.Response(
        jsonEncode({
          'users': [
            {
              'localId': 'original-uid',
              'email': email,
              'emailVerified': false,
              'providerUserInfo': [
                {'providerId': 'google.com'},
                if (links > 0) {'providerId': 'password'},
              ],
            },
          ],
        }),
        200,
      );
    }
    if (method == 'signUp') {
      expect(body['idToken'], 'synthetic-firebase-token');
      expect(body['password'], password);
      links++;
      return http.Response(jsonEncode(id), 200);
    }
    fail('Unexpected method $method');
  }
}

class Google extends GoogleSignInPlatform {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
  final release = Completer<AuthenticationResults>();
  int calls = 0;
  @override
  Future<void> init(InitParameters p) async {}
  @override
  Stream<AuthenticationEvent>? get authenticationEvents => null;
  @override
  Future<AuthenticationResults> authenticate(AuthenticateParameters p) {
    calls++;
    return release.future;
  }
}
