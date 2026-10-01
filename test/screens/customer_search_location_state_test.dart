import 'dart:async';

import 'package:coupon_app/screens/bitescore_home_screen.dart';
import 'package:coupon_app/services/shared_location_state_service.dart';
import 'package:firebase_core/firebase_core.dart';
// ignore: depend_on_referenced_packages
import 'package:firebase_core_platform_interface/firebase_core_platform_interface.dart';
// ignore: depend_on_referenced_packages
import 'package:firebase_auth_platform_interface/firebase_auth_platform_interface.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
// ignore: depend_on_referenced_packages
import 'package:geocoding_platform_interface/geocoding_platform_interface.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../services/customer_bitescore_search_service_test.dart'
    show FakeSearchApi, response;

class _Core extends FirebasePlatform {
  @override
  FirebaseAppPlatform app([String name = '[DEFAULT]']) => FirebaseAppPlatform(
    name,
    const FirebaseOptions(
      apiKey: 'fixture',
      appId: 'fixture',
      messagingSenderId: 'fixture',
      projectId: 'demo-search',
    ),
  );
}

class _Auth extends FirebaseAuthPlatform {
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
  Stream<UserPlatform?> authStateChanges() async* {
    yield currentUser;
    yield* events.stream;
  }
}

class _MultiFactor extends MultiFactorPlatform {
  _MultiFactor(super.auth);
}

class _User extends UserPlatform {
  _User(FirebaseAuthPlatform auth, String uid, {bool anonymous = false})
    : super(
        auth,
        _MultiFactor(auth),
        InternalUserDetails(
          userInfo: InternalUserInfo(
            uid: uid,
            isAnonymous: anonymous,
            isEmailVerified: false,
          ),
          providerData: [],
        ),
      );
}

class _Geocoder extends GeocodingPlatform {
  final calls = <String>[];
  Future<List<Location>> Function(String) resolve = (query) async => [
    Location(
      latitude: query == '32801' ? 28.5 : 30.3,
      longitude: -81.3,
      timestamp: DateTime.utc(2026),
    ),
  ];
  @override
  Future<List<Location>> locationFromAddress(String address) {
    calls.add(address);
    return resolve(address);
  }
}

void _choose(String text, double latitude) {
  SharedLocationStateService.saveTypedLocation(
    latitude: latitude,
    longitude: -81.3,
    label: text,
    searchText: text,
  );
}

Finder get _locationField => find.byWidgetPredicate(
  (widget) =>
      widget is TextField && widget.decoration?.hintText == 'City or zip code',
);

void main() {
  final auth = _Auth();
  late _Geocoder geocoder;
  setUpAll(() {
    FirebasePlatform.instance = _Core();
    FirebaseAuthPlatform.instance = auth;
  });
  setUp(() {
    auth.currentUser = null;
    SharedPreferences.setMockInitialValues({});
    SharedLocationStateService.resetForTesting();
    geocoder = _Geocoder();
    GeocodingPlatform.instance = geocoder;
  });
  tearDown(() {
    SharedLocationStateService.resetForTesting();
  });

  Future<void> mount(WidgetTester t, FakeSearchApi api) async {
    t.view.physicalSize = const Size(1000, 1600);
    t.view.devicePixelRatio = 1;
    addTearDown(t.view.reset);
    await t.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: const MediaQueryData(textScaler: TextScaler.linear(.5)),
          child: BiteScoreHomeScreen(testSearchApi: api),
        ),
      ),
    );
    await t.pumpAndSettle();
  }

  for (final initiallyEmpty in [true, false]) {
    testWidgets(
      'retained Score receives confirmed A B C (empty=$initiallyEmpty)',
      (t) async {
        if (!initiallyEmpty) _choose('34461', 28.7);
        final requests = <Map<String, Object?>>[];
        final api = FakeSearchApi((name, data) async {
          if (name.startsWith('start')) requests.add(data);
          return response();
        });
        await mount(t, api);
        final dynamic state = t.state(find.byType(BiteScoreHomeScreen));
        for (final entry in [
          ('34461', 28.7),
          ('32801', 28.5),
          ('32247', 30.3),
        ]) {
          _choose(entry.$1, entry.$2);
          await t.pumpAndSettle();
          expect(state.locationSearchController.text, entry.$1);
          expect(state.typedSearchCenter.latitude, entry.$2);
          final criteria = requests.last['criteria']! as Map;
          expect(criteria['locationText'], entry.$1);
          expect((criteria['center'] as Map)['latitude'], entry.$2);
        }
        await t.pumpWidget(const SizedBox());
      },
    );
  }

  testWidgets('draft ZIP does not dispatch with the previous center', (
    t,
  ) async {
    _choose('34461', 28.7);
    final requests = <Map<String, Object?>>[];
    final api = FakeSearchApi((name, data) async {
      if (name.startsWith('start')) requests.add(data);
      return response();
    });
    await mount(t, api);
    final count = requests.length;
    await t.enterText(_locationField, '32801');
    final dynamic state = t.state(find.byType(BiteScoreHomeScreen));
    state.setState(() => state.selectedRadius = '10 miles');
    await t.pump();
    await t.pump(const Duration(milliseconds: 300));
    await t.pumpAndSettle();
    expect(requests.length, count + 1);
    expect((requests.last['criteria'] as Map)['locationText'], '34461');
    expect(SharedLocationStateService.state.searchText, '34461');
    await t.pumpWidget(const SizedBox());
  });

  testWidgets(
    'superseded geocode settles local spinner without publishing stale state',
    (t) async {
      _choose('34461', 28.7);
      final pending = Completer<List<Location>>();
      geocoder.resolve = (_) => pending.future;
      await mount(t, FakeSearchApi((_, _) async => response()));
      await t.enterText(_locationField, '32801');
      await t.testTextInput.receiveAction(TextInputAction.search);
      await t.pump();
      final dynamic state = t.state(find.byType(BiteScoreHomeScreen));
      expect(state.isSearchingLocation, isTrue);
      _choose('32247', 30.3);
      pending.complete([
        Location(
          latitude: 28.5,
          longitude: -81.3,
          timestamp: DateTime.utc(2026),
        ),
      ]);
      await t.pump();
      expect(state.isSearchingLocation, isFalse);
      expect(state.typedSearchCenter.latitude, 30.3);
      expect(state.locationSearchController.text, '32247');
      await t.pumpWidget(const SizedBox());
    },
  );

  testWidgets('unchanged confirmed ZIP does not geocode again', (t) async {
    _choose('34461', 28.7);
    await mount(t, FakeSearchApi((_, _) async => response()));
    await t.tap(_locationField);
    await t.testTextInput.receiveAction(TextInputAction.search);
    await t.pump();
    expect(geocoder.calls, isEmpty);
    expect(SharedLocationStateService.state.typedLatitude, 28.7);
    await t.pumpWidget(const SizedBox());
  });

  testWidgets(
    'never resolving geocode times out and retains draft and confirmed center',
    (t) async {
      _choose('34461', 28.7);
      final pending = Completer<List<Location>>();
      geocoder.resolve = (_) => pending.future;
      await mount(t, FakeSearchApi((_, _) async => response()));
      await t.enterText(_locationField, '32801');
      await t.testTextInput.receiveAction(TextInputAction.search);
      await t.pump();
      await t.pump(const Duration(seconds: 16));
      final dynamic state = t.state(find.byType(BiteScoreHomeScreen));
      expect(state.isSearchingLocation, isFalse);
      expect(state.locationSearchController.text, '32801');
      expect(state.typedSearchCenter.latitude, 28.7);
      pending.complete([
        Location(
          latitude: 28.5,
          longitude: -81.3,
          timestamp: DateTime.utc(2026),
        ),
      ]);
      await t.pumpAndSettle();
      expect(SharedLocationStateService.state.searchText, '34461');
      await t.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'real account changes and later same-account notifications refresh',
    (t) async {
      _choose('34461', 28.7);
      auth.currentUser = _User(auth, 'actor-a');
      final api = FakeSearchApi((_, _) async => response());
      await mount(t, api);
      expect(api.calls.where((name) => name.startsWith('start')), hasLength(1));
      for (final user in [
        _User(auth, 'actor-b'),
        _User(auth, 'actor-b'),
        null,
      ]) {
        final count = api.calls
            .where((name) => name.startsWith('start'))
            .length;
        auth.currentUser = user;
        auth.events.add(user);
        await t.pumpAndSettle();
        expect(
          api.calls.where((name) => name.startsWith('start')),
          hasLength(count + 1),
        );
      }
      await t.pumpWidget(const SizedBox());
    },
  );

  testWidgets('old completion cannot clear a newer Score geocode busy state', (
    t,
  ) async {
    _choose('34461', 28.7);
    final old = Completer<List<Location>>(),
        newer = Completer<List<Location>>();
    geocoder.resolve = (query) => query == '32801' ? old.future : newer.future;
    await mount(t, FakeSearchApi((_, _) async => response()));
    await t.enterText(_locationField, '32801');
    await t.testTextInput.receiveAction(TextInputAction.search);
    await t.pump();
    await t.enterText(_locationField, '32247');
    await t.testTextInput.receiveAction(TextInputAction.search);
    await t.pump();
    final dynamic state = t.state(find.byType(BiteScoreHomeScreen));
    old.complete([
      Location(latitude: 28.5, longitude: -81.3, timestamp: DateTime.utc(2026)),
    ]);
    await t.pump();
    expect(state.isSearchingLocation, isTrue);
    newer.complete([
      Location(latitude: 30.3, longitude: -81.3, timestamp: DateTime.utc(2026)),
    ]);
    await t.pumpAndSettle();
    expect(state.isSearchingLocation, isFalse);
    expect(SharedLocationStateService.state.searchText, '32247');
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('initial auth notification does not duplicate the initial search', (
    t,
  ) async {
    _choose('34461', 28.7);
    final api = FakeSearchApi((_, _) async => response());
    await mount(t, api);
    expect(api.calls.where((name) => name.startsWith('start')), hasLength(1));
    // Later events are not globally suppressed: they may represent a new context.
    auth.events.add(null);
    await t.pumpAndSettle();
    expect(api.calls.where((name) => name.startsWith('start')), hasLength(2));
    await t.pumpWidget(const SizedBox());
  });
}
