// Exercises the default FirebaseAuth path: each subscription asynchronously
// emits currentUser, matching the native userChanges implementation.
import 'dart:async';

import 'package:coupon_app/models/admin_restaurant_link_record.dart';
import 'package:coupon_app/screens/admin_gate_screen.dart';
import 'package:coupon_app/screens/main_navigation_screen.dart';
import 'package:coupon_app/services/admin_access_service.dart';
import 'package:coupon_app/widgets/rating_admin_paged_dashboard.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
// ignore: depend_on_referenced_packages
import 'package:firebase_core_platform_interface/firebase_core_platform_interface.dart';
// ignore: depend_on_referenced_packages
import 'package:firebase_auth_platform_interface/firebase_auth_platform_interface.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final auth = _Auth();
  final previousCore = FirebasePlatform.instance;
  final previousAuth = FirebaseAuthPlatform.instance;
  setUpAll(() {
    FirebasePlatform.instance = _Core();
    FirebaseAuthPlatform.instance = auth;
  });
  setUp(() => auth.currentUser = _User(auth));
  tearDownAll(() async {
    await auth.events.close();
    FirebasePlatform.instance = previousCore;
    FirebaseAuthPlatform.instance = previousAuth;
  });

  for (final registeredRoot in [false, true]) {
    for (final stableStream in [false, true]) {
      testWidgets(
        '${stableStream ? 'injected' : 'default'} auth preserves real Rating dropdowns, form and dialog (registeredRoot=$registeredRoot)',
        (tester) async {
          await _pumpGate(
            tester,
            registeredRoot: registeredRoot,
            userStream: stableStream
                ? FirebaseAuth.instance.userChanges()
                : null,
          );
          await _openRating(tester);
          final tabs = _tabs(tester);
          final ratingState = tester.state(
            find.byType(RatingAdminRestaurantPagedView),
          );
          final subscriptions = auth.userChangeSubscriptions;
          await tester.enterText(_location, '34461');
          await tester.enterText(_name, 'Retained restaurant');

          await tester.tap(
            find.byKey(const ValueKey('rating-admin-search-mode')),
          );
          await tester.pumpAndSettle();
          expect(_tabs(tester), same(tabs));
          expect(tabs.index, 1);
          expect(find.text('Exact ZIP'), findsOneWidget);
          expect(auth.userChangeSubscriptions, subscriptions);
          await tester.tap(find.text('Exact ZIP').last);
          await tester.pumpAndSettle();
          expect(find.text('ZIP code'), findsOneWidget);

          await tester.tap(
            find.byKey(const ValueKey('rating-admin-status-field')),
          );
          await tester.pumpAndSettle();
          await tester.tap(find.text('Hidden').last);
          await tester.pumpAndSettle();
          expect(
            tester
                .widget<DropdownButton<AdminBiteScoreStatus>>(
                  find.byType(DropdownButton<AdminBiteScoreStatus>),
                )
                .value,
            AdminBiteScoreStatus.inactive,
          );

          // Dismiss a popup without selecting an item as well.
          await tester.tap(
            find.byKey(const ValueKey('rating-admin-search-mode')),
          );
          await tester.pumpAndSettle();
          Navigator.of(tester.element(_location)).pop();
          await tester.pumpAndSettle();
          expect(find.text('ZIP code'), findsOneWidget);

          final dialog = _openDialog(tester);
          await tester.pumpAndSettle();
          expect(find.text('Admin test dialog'), findsOneWidget);
          expect(_tabs(tester), same(tabs));
          await tester.tap(find.text('Close test dialog'));
          await tester.pumpAndSettle();
          await dialog;
          expect(_tabs(tester), same(tabs));
          expect(tabs.index, 1);
          expect(
            tester.state(find.byType(RatingAdminRestaurantPagedView)),
            same(ratingState),
          );
          expect(
            tester.widget<TextFormField>(_location).controller!.text,
            '34461',
          );
          expect(
            tester.widget<TextFormField>(_name).controller!.text,
            'Retained restaurant',
          );
          expect(auth.userChangeSubscriptions, subscriptions);
          expect(tester.takeException(), isNull);
        },
      );
    }
  }

  testWidgets(
    'ordinary parent rebuild and same-user event preserve workspace',
    (tester) async {
      final rebuild = ValueNotifier<int>(0);
      addTearDown(rebuild.dispose);
      await _pumpGate(tester, rebuild: rebuild);
      await _openRating(tester);
      await tester.enterText(_name, 'Unsubmitted form');
      final gateState = tester.state(find.byType(AdminGateScreen));
      final ratingState = tester.state(
        find.byType(RatingAdminRestaurantPagedView),
      );
      final tabs = _tabs(tester);
      final subscriptions = auth.userChangeSubscriptions;

      rebuild.value++;
      await tester.pumpAndSettle();
      auth.emit(_User(auth));
      await tester.pumpAndSettle();

      expect(tester.state(find.byType(AdminGateScreen)), same(gateState));
      expect(
        tester.state(find.byType(RatingAdminRestaurantPagedView)),
        same(ratingState),
      );
      expect(_tabs(tester), same(tabs));
      expect(tabs.index, 1);
      expect(
        tester.widget<TextFormField>(_name).controller!.text,
        'Unsubmitted form',
      );
      expect(auth.userChangeSubscriptions, subscriptions);
    },
  );

  testWidgets(
    'normal Sign Out button removes Admin access on retained stream',
    (tester) async {
      await _pumpGate(tester);
      await _openRating(tester);
      final subscriptions = auth.userChangeSubscriptions;
      await tester.tap(find.text('Sign Out'));
      await tester.pumpAndSettle();

      expect(auth.signOutCalls, 1);
      expect(find.text('Admin Access Locked'), findsOneWidget);
      expect(find.byType(RatingAdminRestaurantPagedView), findsNothing);
      expect(find.byKey(const ValueKey('admin-workspace')), findsNothing);
      expect(auth.userChangeSubscriptions, subscriptions);

      // Signing in again constructs a fresh workspace, with no old form state.
      auth.emit(_User(auth));
      await tester.pumpAndSettle();
      expect(_tabs(tester).index, 0);
      await _openRating(tester);
      expect(tester.widget<TextFormField>(_name).controller!.text, isEmpty);
    },
  );

  for (final permissionLoss in [false, true]) {
    testWidgets(
      '${permissionLoss ? 'same-UID permission loss' : 'sign-out event'} clears private dialog on default stream',
      (tester) async {
        await _pumpGate(tester, registeredRoot: true);
        await _openRating(tester);
        final subscriptions = auth.userChangeSubscriptions;
        final dialog = _openDialog(tester);
        await tester.pumpAndSettle();
        expect(find.text('Admin test dialog'), findsOneWidget);

        auth.emit(
          permissionLoss ? _User(auth, email: 'person@example.com') : null,
        );
        await tester.pumpAndSettle();
        await dialog;
        expect(find.text('Admin test dialog'), findsNothing);
        expect(
          find.text(
            permissionLoss ? 'Admin Access Denied' : 'Admin Access Locked',
          ),
          findsOneWidget,
        );
        expect(find.byKey(const ValueKey('admin-workspace')), findsNothing);
        expect(auth.userChangeSubscriptions, subscriptions);
      },
    );
  }

  testWidgets(
    'auth error fails closed and subsequent user event still propagates',
    (tester) async {
      await _pumpGate(tester);
      await _openRating(tester);
      final subscriptions = auth.userChangeSubscriptions;
      auth.events.addError(StateError('Injected auth error'));
      await tester.pumpAndSettle();
      expect(find.text('Admin Access Locked'), findsOneWidget);
      expect(find.byKey(const ValueKey('admin-workspace')), findsNothing);
      auth.emit(_User(auth));
      await tester.pumpAndSettle();
      expect(_tabs(tester).index, 0);
      expect(auth.userChangeSubscriptions, subscriptions);
    },
  );

  testWidgets(
    'changed injected stream is adopted, waits and rejects unauthorized user',
    (tester) async {
      final first = StreamController<User?>.broadcast(sync: true);
      final replacement = StreamController<User?>.broadcast(sync: true);
      addTearDown(first.close);
      addTearDown(replacement.close);
      final stream = ValueNotifier<Stream<User?>?>(first.stream);
      addTearDown(stream.dispose);
      await _pumpGate(tester, streamSource: stream, waiting: true);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      first.add(FirebaseAuth.instance.currentUser);
      await tester.pumpAndSettle();
      await _openRating(tester);
      final gateState = tester.state(find.byType(AdminGateScreen));

      stream.value = replacement.stream;
      await tester.pump();
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(find.byKey(const ValueKey('admin-workspace')), findsNothing);
      first.add(FirebaseAuth.instance.currentUser);
      await tester.pump();
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      auth.currentUser = _User(auth, email: 'person@example.com');
      replacement.add(FirebaseAuth.instance.currentUser);
      await tester.pumpAndSettle();
      expect(find.text('Admin Access Denied'), findsOneWidget);
      expect(tester.state(find.byType(AdminGateScreen)), same(gateState));

      auth.currentUser = _User(auth);
      stream.value = null;
      await tester.pumpAndSettle();
      expect(_tabs(tester).index, 0);
      replacement.add(null);
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('admin-workspace')), findsOneWidget);
    },
  );
}

final _location = find.byKey(const ValueKey('rating-admin-location-field'));
final _name = find.byKey(const ValueKey('rating-admin-name-field'));

TabController _tabs(WidgetTester tester) => DefaultTabController.of(
  tester.element(find.byKey(const ValueKey('admin-workspace'))),
);

Future<void> _openRating(WidgetTester tester) async {
  await tester.tap(find.text('Rating Side'));
  await tester.pumpAndSettle();
  expect(_tabs(tester).index, 1);
}

Future<void> _openDialog(WidgetTester tester) => showDialog<void>(
  context: tester.element(find.byType(RatingAdminRestaurantPagedView)),
  builder: (context) => AlertDialog(
    title: const Text('Admin test dialog'),
    actions: [
      TextButton(
        onPressed: () => Navigator.of(context).pop(),
        child: const Text('Close test dialog'),
      ),
    ],
  ),
);

Future<void> _pumpGate(
  WidgetTester tester, {
  bool registeredRoot = false,
  Stream<User?>? userStream,
  ValueNotifier<int>? rebuild,
  ValueNotifier<Stream<User?>?>? streamSource,
  bool waiting = false,
}) async {
  tester.view.physicalSize = const Size(800, 1200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  Widget gate() => AdminGateScreen(
    userStream: streamSource == null ? userStream : streamSource.value,
    couponAdminBuilder: (_) => const Center(child: Text('Coupon destination')),
    ratingAdminBuilder: (_) => RatingAdminRestaurantPagedView(
      onManageDishes: (_) {},
      onEditRestaurant: (_) async => null,
    ),
    linkGenerationBuilder: (_) => const SizedBox.shrink(),
  );
  Widget destination() {
    if (rebuild != null) {
      return ValueListenableBuilder<int>(
        valueListenable: rebuild,
        builder: (_, value, child) => gate(),
      );
    }
    if (streamSource != null) {
      return ValueListenableBuilder<Stream<User?>?>(
        valueListenable: streamSource,
        builder: (_, value, child) => gate(),
      );
    }
    return gate();
  }

  Object? rootRegistration;
  addTearDown(() async {
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
    if (rootRegistration != null) {
      mainNavigationController.detach(rootRegistration!);
    }
  });
  if (registeredRoot) {
    final navKey = GlobalKey<NavigatorState>();
    await tester.pumpWidget(
      MaterialApp(
        navigatorKey: navKey,
        home: Builder(
          builder: (context) {
            rootRegistration ??= mainNavigationController.attach(
              navigator: Navigator.of(context),
              route: ModalRoute.of(context)!,
              selectDestination: (_, _, _) => true,
              refreshHomes: (_) => true,
              authRealm: 'signed:local-admin-fixture',
            );
            return const Scaffold(body: Text('Registered root'));
          },
        ),
      ),
    );
    await tester.pumpAndSettle();
    unawaited(
      navKey.currentState!.push<void>(
        MaterialPageRoute<void>(builder: (_) => destination()),
      ),
    );
  } else {
    await tester.pumpWidget(MaterialApp(home: destination()));
  }
  if (waiting) {
    await tester.pump();
  } else {
    await tester.pumpAndSettle();
  }
}

class _Core extends FirebasePlatform {
  @override
  FirebaseAppPlatform app([String name = '[DEFAULT]']) => FirebaseAppPlatform(
    name,
    const FirebaseOptions(
      apiKey: 'fixture',
      appId: 'fixture',
      messagingSenderId: 'fixture',
      projectId: 'demo-admin-gate',
    ),
  );
}

class _Auth extends FirebaseAuthPlatform {
  int userChangeSubscriptions = 0;
  int signOutCalls = 0;
  final events = StreamController<UserPlatform?>.broadcast(sync: true);
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
  Stream<UserPlatform?> userChanges() async* {
    userChangeSubscriptions++;
    yield currentUser;
    yield* events.stream;
  }

  void emit(UserPlatform? user) {
    currentUser = user;
    events.add(user);
  }

  @override
  Future<void> signOut() async {
    signOutCalls++;
    emit(null);
  }
}

class _MultiFactor extends MultiFactorPlatform {
  _MultiFactor(super.auth);
}

class _User extends UserPlatform {
  _User(FirebaseAuthPlatform auth, {String? email})
    : super(
        auth,
        _MultiFactor(auth),
        InternalUserDetails(
          userInfo: InternalUserInfo(
            uid: 'local-admin-fixture',
            email: email ?? AdminAccessService.allowedAdminEmails.first,
            isAnonymous: false,
            isEmailVerified: true,
          ),
          providerData: [],
        ),
      );
}
