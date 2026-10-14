// Local Android UI qualification only. No Firebase initialization or remote I/O.
// ignore_for_file: invalid_use_of_visible_for_testing_member
import 'dart:async';
import 'package:coupon_app/main.dart' show CouponApp;
import 'package:coupon_app/screens/main_navigation_screen.dart';
import 'package:coupon_app/screens/customer_account_screen.dart';
import 'package:coupon_app/screens/customer_profile_screen.dart';
import 'package:coupon_app/screens/admin_gate_screen.dart';
import 'package:coupon_app/services/app_mode_state_service.dart';
import 'package:coupon_app/services/bitescore_service.dart';
import 'package:coupon_app/widgets/persistent_bottom_navigation.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

User? current = FixtureUser();
final users = StreamController<User?>.broadcast(sync: true);
final realms = StreamController<String>.broadcast(sync: true);
Stream<User?> userChanges() => Stream<User?>.multi((c) {
  c.add(current);
  final subscription = users.stream.listen(c.add);
  c.onCancel = subscription.cancel;
});
void change(User? value) {
  current = value;
  users.add(value);
  realms.add(mainNavigationAuthRealmForUser(value));
}

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SharedPreferences.setMockInitialValues({});
  runApp(
    CouponApp(
      testWrapCelebrationHosts: false,
      testInitializePlatformServices: false,
      testNavigationBuilder: (_, _) => MainNavigationScreen(
        initializePlatformServices: false,
        testCustomerAuthRealmProvider: () =>
            mainNavigationAuthRealmForUser(current),
        testCustomerAuthRealmChanges: realms.stream,
        testPagesBuilder: (mode) => [
          Home(mode: mode),
          const Center(child: Text('Restaurant Hub — local fixture')),
          CustomerAccountScreen(
            userStreamFactory: userChanges,
            testSignOut: () async => change(null),
            adminDestinationBuilder: (_) => AdminGateScreen(
              userStream: userChanges(),
              couponAdminBuilder: (_) =>
                  const Center(child: Text('Coupon admin fixture')),
              ratingAdminBuilder: (_) =>
                  const Center(child: Text('Rating admin fixture')),
              linkGenerationBuilder: (_) => const SizedBox(),
            ),
            profileDestinationBuilder: (_, user) => CustomerProfileScreen(
              embedded: true,
              currentUser: user,
              testCurrentUserProvider: () => current,
              testProfileLoader: (_) async => profile,
              testLocalExpertBadgesLoader: (_) async => [],
            ),
          ),
        ],
      ),
    ),
  );
}

const profile = BiteScoreUserProfileData(
  publicDisplayName: 'Navigation Test Reviewer',
  chosenUsername: 'test_reviewer',
  fallbackUsername: 'test_reviewer',
  favoriteRestaurants: [],
  favoriteSaverRestaurants: [],
  favoriteDishEntries: [],
  favoriteCoupons: [],
  reviews: [],
  badgeLabel: 'New Reviewer',
  reviewCount: 0,
  helpfulVotesReceived: 0,
  accountAgeDays: 0,
  moderationFlagCount: 0,
  contributionPoints: 0,
);

class Home extends StatelessWidget {
  final AppMode mode;
  const Home({super.key, required this.mode});
  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(24),
    children: [
      Text(
        '${mode == AppMode.biteSaver ? 'BiteSaver' : 'BiteScore'} Home',
        style: Theme.of(context).textTheme.headlineMedium,
      ),
      const Text('LOCAL TEST FIXTURE • no production connection'),
      FilledButton(
        onPressed: () => Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => Scaffold(
              appBar: AppBar(title: const Text('Nested destination')),
              body: Center(
                child: FilledButton(
                  onPressed: () => showDialog<void>(
                    context: rootNavigatorKey.currentContext!,
                    builder: (_) => const AlertDialog(
                      title: Text('Dismiss with Android Back'),
                    ),
                  ),
                  child: const Text('Open dialog'),
                ),
              ),
              bottomNavigationBar: PersistentBottomNavigation(mode: mode),
            ),
          ),
        ),
        child: const Text('Open nested destination'),
      ),
      OutlinedButton(
        onPressed: () => change(FixtureUser(admin: true)),
        child: const Text('Use local Admin fixture'),
      ),
      OutlinedButton(
        onPressed: () => change(FixtureUser(verified: false)),
        child: const Text('Use local unverified fixture'),
      ),
      OutlinedButton(
        onPressed: () => change(FixtureUser()),
        child: const Text('Use local verified fixture'),
      ),
    ],
  );
}

class FixtureUser implements User {
  final bool admin;
  final bool verified;
  FixtureUser({this.admin = false, this.verified = true});
  @override
  String get uid => admin
      ? 'local-admin'
      : verified
      ? 'local-reviewer'
      : 'local-unverified';
  @override
  String? get email =>
      admin ? 'schuyler.cole@gmail.com' : 'fixture@example.test';
  @override
  bool get isAnonymous => false;
  @override
  bool get emailVerified => verified;
  @override
  String? get displayName => 'Local fixture';
  @override
  List<UserInfo> get providerData => verified ? [] : [PasswordInfo()];
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class PasswordInfo implements UserInfo {
  @override
  String get providerId => 'password';
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
