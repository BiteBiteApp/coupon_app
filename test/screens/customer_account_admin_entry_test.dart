import 'dart:async';

import 'package:coupon_app/models/local_expert_badge.dart';
import 'package:coupon_app/screens/admin_gate_screen.dart';
import 'package:coupon_app/screens/customer_account_screen.dart';
import 'package:coupon_app/screens/customer_profile_screen.dart';
import 'package:coupon_app/screens/main_navigation_screen.dart';
import 'package:coupon_app/services/bitescore_service.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{});
  });

  testWidgets('authorized administrator sees Admin Workspace', (tester) async {
    await tester.pumpWidget(_testApp(Stream<User?>.value(_adminUser())));
    await tester.pumpAndSettle();

    expect(find.text('Admin Workspace'), findsOneWidget);
  });

  testWidgets('authenticated non-admin does not see Admin Workspace', (
    tester,
  ) async {
    await tester.pumpWidget(
      _testApp(Stream<User?>.value(_user(email: 'person@example.com'))),
    );
    await tester.pumpAndSettle();

    expect(find.text('Admin Workspace'), findsNothing);
  });

  testWidgets('anonymous and signed-out users do not see Admin Workspace', (
    tester,
  ) async {
    await tester.pumpWidget(
      _testApp(Stream<User?>.value(_user(email: null, isAnonymous: true))),
    );
    await tester.pumpAndSettle();
    expect(find.text('Admin Workspace'), findsNothing);

    await tester.pumpWidget(_testApp(Stream<User?>.value(null)));
    await tester.pumpAndSettle();
    expect(find.text('Admin Workspace'), findsNothing);
  });

  testWidgets('loading and auth error states fail closed', (tester) async {
    final loadingController = StreamController<User?>();
    addTearDown(loadingController.close);

    await tester.pumpWidget(_testApp(loadingController.stream));
    await tester.pump();
    expect(find.text('Admin Workspace'), findsNothing);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    await tester.pumpWidget(
      _testApp(Stream<User?>.error(StateError('Injected auth error'))),
    );
    await tester.pumpAndSettle();
    expect(find.text('Admin Workspace'), findsNothing);
  });

  testWidgets('Admin Workspace opens the independently enforcing gate', (
    tester,
  ) async {
    final nonAdmin = _user(email: 'person@example.com');

    await tester.pumpWidget(
      _testApp(
        Stream<User?>.value(_adminUser()),
        adminDestinationBuilder: (_) =>
            AdminGateScreen(userStream: Stream<User?>.value(nonAdmin)),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Admin Workspace'));
    await tester.pumpAndSettle();

    expect(find.byType(AdminGateScreen), findsOneWidget);
    expect(find.text('Admin Access Denied'), findsOneWidget);
  });

  testWidgets(
    'Admin Workspace is a full route and returning restores Account',
    (tester) async {
      const customerNavigationKey = ValueKey('customer-bottom-navigation');
      final admin = _adminUser();

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: CustomerAccountScreen(
              userStream: Stream<User?>.value(admin),
              adminDestinationBuilder: (_) => AdminGateScreen(
                userStream: Stream<User?>.value(admin),
                couponAdminBuilder: (_) =>
                    const SizedBox.expand(key: ValueKey('admin-route-content')),
                ratingAdminBuilder: (_) => const SizedBox.shrink(),
                linkGenerationBuilder: (_) => const SizedBox.shrink(),
              ),
            ),
            bottomNavigationBar: const SizedBox(
              key: customerNavigationKey,
              height: 67,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(customerNavigationKey), findsOneWidget);
      await tester.tap(find.text('Admin Workspace'));
      await tester.pumpAndSettle();

      expect(find.byType(AdminGateScreen), findsOneWidget);
      expect(find.byKey(const ValueKey('admin-route-content')), findsOneWidget);
      expect(find.byKey(customerNavigationKey), findsNothing);

      await tester.pageBack();
      await tester.pumpAndSettle();

      expect(find.byType(AdminGateScreen), findsNothing);
      expect(find.byKey(customerNavigationKey), findsOneWidget);
      expect(find.text('Admin Workspace'), findsOneWidget);
    },
  );

  for (final replacement in <({String label, User? user, String realm})>[
    (
      label: 'A-to-B replacement',
      user: _user(email: 'profile-b@example.com', uid: 'profile-user-b'),
      realm: 'signed:profile-user-b',
    ),
    (label: 'sign-out', user: null, realm: 'guest'),
  ]) {
    testWidgets(
      'Account profile ${replacement.label} retires A data and ignores a late A load',
      (tester) async {
        final accountUsers = StreamController<User?>.broadcast(sync: true);
        final authRealms = StreamController<String>.broadcast(sync: true);
        final profileLoad = Completer<BiteScoreUserProfileData>();
        addTearDown(accountUsers.close);
        addTearDown(authRealms.close);
        final openingUser = _user(
          email: 'profile-a@example.com',
          uid: 'profile-user-a',
        );
        User? currentUser = openingUser;
        var currentRealm = 'signed:${openingUser.uid}';
        final profileOriginUserIds = <String>[];
        final profileLoadUserIds = <String>[];
        final badgeLoadUserIds = <String>[];

        await tester.pumpWidget(
          _profileNavigationApp(
            accountUsers: accountUsers.stream,
            authRealms: authRealms.stream,
            currentRealm: () => currentRealm,
            profileDestinationBuilder: (context, originUser) {
              profileOriginUserIds.add(originUser.uid);
              return CustomerProfileScreen(
                currentUser: originUser,
                testCurrentUserProvider: () => currentUser,
                testProfileLoader: (user) {
                  profileLoadUserIds.add(user.uid);
                  return profileLoad.future;
                },
                testLocalExpertBadgesLoader: (userId) async {
                  badgeLoadUserIds.add(userId);
                  return <LocalExpertBadge>[];
                },
              );
            },
          ),
        );
        accountUsers.add(openingUser);
        await tester.pumpAndSettle();

        await tester.tap(find.text('My Profile'));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 350));

        expect(profileOriginUserIds, <String>['profile-user-a']);
        expect(profileLoadUserIds, <String>['profile-user-a']);
        expect(badgeLoadUserIds, <String>['profile-user-a']);
        expect(find.byType(CustomerProfileScreen), findsOneWidget);

        currentUser = replacement.user;
        currentRealm = replacement.realm;
        accountUsers.add(replacement.user);
        authRealms.add(replacement.realm);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 350));

        profileLoad.complete(
          _profileData(
            publicDisplayName: 'PRIVATE PROFILE A',
            chosenUsername: 'private_user_a',
          ),
        );
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 350));

        expect(find.byType(CustomerProfileScreen), findsNothing);
        expect(find.textContaining('PRIVATE PROFILE A'), findsNothing);
        expect(find.textContaining('private_user_a'), findsNothing);
        expect(
          find.byType(MainNavigationScreen, skipOffstage: false),
          findsOneWidget,
        );
      },
    );
  }

  testWidgets(
    'Account profile refuses an A username save after replacement by B',
    (tester) async {
      final accountUsers = StreamController<User?>.broadcast(sync: true);
      final authRealms = StreamController<String>.broadcast(sync: true);
      addTearDown(accountUsers.close);
      addTearDown(authRealms.close);
      final openingUser = _user(
        email: 'save-a@example.com',
        uid: 'save-user-a',
      );
      final replacementUser = _user(
        email: 'save-b@example.com',
        uid: 'save-user-b',
      );
      User? currentUser = openingUser;
      var currentRealm = 'signed:${openingUser.uid}';
      final profileOriginUserIds = <String>[];
      final saveDispatchUserIds = <String?>[];
      final savedUsernames = <String>[];

      await tester.pumpWidget(
        _profileNavigationApp(
          accountUsers: accountUsers.stream,
          authRealms: authRealms.stream,
          currentRealm: () => currentRealm,
          profileDestinationBuilder: (context, originUser) {
            profileOriginUserIds.add(originUser.uid);
            return CustomerProfileScreen(
              currentUser: originUser,
              testCurrentUserProvider: () => currentUser,
              testProfileLoader: (user) async => _profileData(
                publicDisplayName: 'Profile A',
                chosenUsername: null,
              ),
              testLocalExpertBadgesLoader: (userId) async =>
                  <LocalExpertBadge>[],
              testUsernameSaver: (username) async {
                saveDispatchUserIds.add(currentUser?.uid);
                savedUsernames.add(username);
              },
            );
          },
        ),
      );
      accountUsers.add(openingUser);
      await tester.pumpAndSettle();

      await tester.tap(find.text('My Profile'));
      await tester.pumpAndSettle();
      expect(profileOriginUserIds, <String>['save-user-a']);

      final usernameField = find.byType(TextField);
      expect(usernameField, findsOneWidget);
      await tester.enterText(usernameField, 'must_not_save_for_b');

      currentUser = replacementUser;
      await tester.tap(find.text('Save username'));
      await tester.pump();

      expect(saveDispatchUserIds, isEmpty);
      expect(savedUsernames, isEmpty);

      currentRealm = 'signed:${replacementUser.uid}';
      accountUsers.add(replacementUser);
      authRealms.add(currentRealm);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      expect(find.byType(CustomerProfileScreen), findsNothing);
    },
  );
}

Widget _profileNavigationApp({
  required Stream<User?> accountUsers,
  required Stream<String> authRealms,
  required String Function() currentRealm,
  required Widget Function(BuildContext context, User user)
  profileDestinationBuilder,
}) {
  return MaterialApp(
    navigatorKey: rootNavigatorKey,
    scaffoldMessengerKey: rootScaffoldMessengerKey,
    home: MainNavigationScreen(
      initialIndex: 2,
      initializePlatformServices: false,
      testCustomerAuthRealmProvider: currentRealm,
      testCustomerAuthRealmChanges: authRealms,
      testPagesBuilder: (_) => <Widget>[
        const SizedBox.shrink(),
        const SizedBox.shrink(),
        CustomerAccountScreen(
          userStream: accountUsers,
          profileDestinationBuilder: profileDestinationBuilder,
        ),
      ],
    ),
  );
}

BiteScoreUserProfileData _profileData({
  required String publicDisplayName,
  required String? chosenUsername,
}) {
  return BiteScoreUserProfileData(
    publicDisplayName: publicDisplayName,
    chosenUsername: chosenUsername,
    fallbackUsername: 'fallback_user',
    favoriteRestaurants: const [],
    favoriteSaverRestaurants: const [],
    favoriteDishEntries: const [],
    favoriteCoupons: const [],
    reviews: const [],
    badgeLabel: 'New Reviewer',
    reviewCount: 0,
    helpfulVotesReceived: 0,
    accountAgeDays: 0,
    moderationFlagCount: 0,
    contributionPoints: 0,
  );
}

Widget _testApp(
  Stream<User?> userStream, {
  WidgetBuilder? adminDestinationBuilder,
}) {
  return MaterialApp(
    home: CustomerAccountScreen(
      userStream: userStream,
      adminDestinationBuilder: adminDestinationBuilder,
    ),
  );
}

User _adminUser() => _user(email: 'schuyler.cole@gmail.com');

User _user({
  required String? email,
  bool isAnonymous = false,
  String uid = 'test-user',
}) {
  return _TestUser(email: email, isAnonymous: isAnonymous, uid: uid);
}

class _TestUser extends Fake implements User {
  @override
  final String? email;

  @override
  final bool isAnonymous;

  @override
  final String uid;

  _TestUser({
    required this.email,
    required this.isAnonymous,
    required this.uid,
  });

  @override
  String? get displayName => null;

  @override
  bool get emailVerified => true;

  @override
  List<UserInfo> get providerData => const <UserInfo>[];
}
