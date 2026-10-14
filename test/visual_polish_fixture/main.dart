import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/models/bitescore_dish.dart';
import 'package:coupon_app/models/restaurant.dart';
import 'package:coupon_app/screens/bitescore_dish_detail_screen.dart';
import 'package:coupon_app/screens/bitescore_home_screen.dart';
import 'package:coupon_app/screens/home_screen.dart';
import 'package:coupon_app/screens/main_navigation_screen.dart';
import 'package:coupon_app/services/app_mode_state_service.dart';
import 'package:coupon_app/services/shared_location_state_service.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart' show FirebaseAuth;
// ignore: depend_on_referenced_packages
import 'package:firebase_core_platform_interface/firebase_core_platform_interface.dart';
// ignore: depend_on_referenced_packages
import 'package:firebase_auth_platform_interface/firebase_auth_platform_interface.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../detail_route_history_fixture/main.dart'
    show historyDish, historyRestaurant;

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  initializeVisualFixture();
  runApp(const VisualPolishFixture());
}

void initializeVisualFixture() {
  SharedPreferences.setMockInitialValues({});
  SharedLocationStateService.resetForTesting();
  SharedLocationStateService.saveTypedLocation(
    latitude: 29.1872,
    longitude: -82.1401,
    label: 'Ocala, FL',
    searchText: 'Ocala, FL',
  );
  FirebasePlatform.instance = visualCore;
  Firebase.delegatePackingProperty = visualCore;
  visualAuth.currentUser = VisualUser(visualAuth);
  FirebaseAuthPlatform.instance = visualAuth;
}

final visualRestaurants = List<Restaurant>.generate(
  20,
  (_) => historyRestaurant,
);
const visualMergeDish = BitescoreDish(
  id: 'local-merge-target',
  restaurantId: 'history-score-restaurant',
  restaurantName: 'History Score Cafe',
  name: 'Garden Soup',
  normalizedName: 'garden soup',
  category: 'Test',
);
Widget visualDish() => BiteScoreDishDetailScreen(
  entry: historyDish,
  testInitialLoader: () async {},
  testCurrentUserProvider: () => FirebaseAuth.instance.currentUser,
  testMergeCandidatesLoader: () async => [historyDish.dish, visualMergeDish],
);

class VisualPolishFixture extends StatelessWidget {
  const VisualPolishFixture({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    home: MainNavigationScreen(
      initializePlatformServices: false,
      testCustomerAuthRealmProvider: () => 'signed:visual-fixture',
      testCustomerAuthRealmChanges: const Stream<String>.empty(),
      testPagesBuilder: (mode) => [
        mode == AppMode.biteSaver
            ? HomeScreen(
                approvedAccountsStream:
                    const Stream<QuerySnapshot<Map<String, dynamic>>>.empty(),
                restaurantLoader: () async => visualRestaurants,
                initializeFirebaseBackedState: false,
              )
            : BiteScoreHomeScreen(
                testHomeEntriesLoader: () async => [historyDish],
                testDishDetailBuilder: (_, _, _) => visualDish(),
              ),
        Builder(
          builder: (context) => Center(
            child: FilledButton(
              onPressed: () => Navigator.of(
                context,
              ).push(MaterialPageRoute<void>(builder: (_) => visualDish())),
              child: const Text('Open local dish'),
            ),
          ),
        ),
        const Center(child: Text('LOCAL SYNTHETIC FIXTURE')),
      ],
    ),
  );
}

final visualCore = VisualCore();
final visualAuth = VisualAuth();

class VisualCore extends FirebasePlatform {
  static int sequence = 0;
  final fixtureName = "visual-${++sequence}";
  @override
  FirebaseAppPlatform app([String name = '[DEFAULT]']) => FirebaseAppPlatform(
    fixtureName,
    const FirebaseOptions(
      apiKey: 'synthetic',
      appId: 'synthetic',
      messagingSenderId: 'synthetic',
      projectId: 'demo-visual-polish',
    ),
  );
}

class VisualAuth extends FirebaseAuthPlatform {
  VisualAuth({bool verified = true}) {
    currentUser = VisualUser(this, verified: verified);
  }
  @override
  UserPlatform? currentUser;
  @override
  FirebaseAuthPlatform delegateFor({required FirebaseApp app}) => this;
  @override
  FirebaseAuthPlatform setInitialValues({
    InternalUserDetails? currentUser,
    String? languageCode,
  }) => this;
  @override
  Stream<UserPlatform?> userChanges() => Stream.value(currentUser);
  @override
  Stream<UserPlatform?> authStateChanges() => Stream.value(currentUser);
}

class VisualMultiFactor extends MultiFactorPlatform {
  VisualMultiFactor(super.auth);
}

class VisualUser extends UserPlatform {
  VisualUser(FirebaseAuthPlatform auth, {bool verified = true})
    : super(
        auth,
        VisualMultiFactor(auth),
        InternalUserDetails(
          userInfo: InternalUserInfo(
            uid: 'visual-fixture',
            email: 'fixture@example.test',
            isAnonymous: false,
            isEmailVerified: verified,
          ),
          providerData: [
            {
              'uid': 'visual-fixture',
              'providerId': 'password',
              'isAnonymous': false,
              'isEmailVerified': verified,
            },
          ],
        ),
      );
  @override
  Future<void> reload() async {}
  @override
  Future<String?> getIdToken([bool forceRefresh = false]) async =>
      'synthetic-token';
}
