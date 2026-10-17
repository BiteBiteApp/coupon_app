import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:coupon_app/screens/bitescore_create_rate_screen.dart';
import 'package:coupon_app/screens/bitescore_home_screen.dart';
import 'package:coupon_app/screens/customer_bitesaver_browse_screen.dart';
import 'package:coupon_app/services/customer_bitesaver_guest_usage_store.dart';
import 'package:coupon_app/services/customer_bitesaver_search_coordinator.dart';
import 'package:coupon_app/services/customer_bitesaver_service.dart';
import 'package:coupon_app/services/customer_bitescore_search_service.dart';
import 'package:coupon_app/services/customer_search_candidate_runtime.dart';
import 'package:coupon_app/services/shared_location_state_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

// Explicit opt-in: real local HTTP -> verified Auth emulator -> native handlers
// -> Firestore emulator + real PostGIS. No response fixtures or fake provider.
const _url = String.fromEnvironment('BS_POSTGIS_HTTP_URL');
const _evidencePath = String.fromEnvironment('BS_POSTGIS_UI_EVIDENCE');

class _RealHttpOverrides extends HttpOverrides {}

class _Preferences implements CustomerBiteSaverGuestUsagePreferences {
  final Map<String, String> values = {};
  @override
  Future<String?> getString(String key) async => values[key];
  @override
  Future<void> setString(String key, String value) async => values[key] = value;
  @override
  Future<void> remove(String key) async => values.remove(key);
}

void main() {
  final observations = <Map<String, Object?>>[];
  HttpClient? http;
  Zone? networkZone;
  String? bearer;
  String? userId;
  final batch = DateTime.now().microsecondsSinceEpoch.toString();
  var calls = 0;
  var errors = 0;
  Future<Map<String, dynamic>> post(
    Uri uri,
    Object body, {
    bool signed = false,
    bool emulatorOwner = false,
  }) => networkZone!.run(() async {
    final request = await http!.postUrl(uri);
    request.headers.contentType = ContentType.json;
    if (signed) {
      request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $bearer');
    }
    if (emulatorOwner) {
      if (uri.host != "127.0.0.1" || uri.port != 9099) {
        throw StateError("Emulator owner is local-only.");
      }
      request.headers.set(HttpHeaders.authorizationHeader, "Bearer owner");
    }
    request.write(jsonEncode(body));
    final response = await request.close().timeout(const Duration(seconds: 15));
    return Map<String, dynamic>.from(
      jsonDecode(await utf8.decoder.bind(response).join()) as Map,
    );
  });

  Future<Object?> invoke(
    String name,
    Map<String, Object?> data, {
    bool signed = false,
  }) async {
    calls++;
    final response = await post(Uri.parse('$_url/$name'), {
      'data': data,
    }, signed: signed);
    if (response['error'] case final Map error) {
      errors++;
      throw CustomerBiteSaverCallableTransportException(
        code: (error['status'] as String).toLowerCase().replaceAll('_', '-'),
        message: error['message'] as String,
      );
    }
    final result = response['result'];
    return result;
  }

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    SharedLocationStateService.resetForTesting();
    CustomerSearchCandidateRuntime.testEnabled = true;
    calls = 0;
    errors = 0;
  });
  tearDown(() {
    CustomerSearchCandidateRuntime.testEnabled = null;
    SharedLocationStateService.resetForTesting();
  });
  tearDownAll(() {
    http?.close(force: true);
    if (_evidencePath.isNotEmpty) {
      File(_evidencePath).writeAsStringSync(
        const JsonEncoder.withIndent('  ').convert({
          'kind': 'actual-flutter-widget-local-http-firestore-auth-postgis',
          'hostedEvidence': false,
          'sampleCountsDoNotSupportHostedTailLatencyClaims': true,
          'observations': observations,
        }),
      );
    }
  });
  Future<void> initialize(WidgetTester tester) async {
    if (http != null) return;
    await tester.runAsync(() async {
      networkZone = Zone.current;
      http = HttpOverrides.runWithHttpOverrides(
        () => HttpClient(),
        _RealHttpOverrides(),
      );
      final credentials = {
        'targetProjectId': 'demo-bs-postgis-flutter',
        'email':
            'gate0-ui-${DateTime.now().microsecondsSinceEpoch}@example.test',
        'password': 'synthetic-test-only-password',
        'returnSecureToken': true,
      };
      await post(
        Uri.parse(
          'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=synthetic-local-key',
        ),
        credentials,
        emulatorOwner: true,
      );
      final result = await post(
        Uri.parse(
          'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=synthetic-local-key',
        ),
        credentials,
        emulatorOwner: true,
      );
      bearer = result['idToken'] as String;
      userId = result['localId'] as String;
    });
  }

  void location() => SharedLocationStateService.saveTypedLocation(
    latitude: 25.77,
    longitude: -80.19,
    label: 'Miami, FL',
    searchText: '33101',
  );
  Future<void> untilUseful(WidgetTester tester, Finder useful) async {
    for (
      var attempt = 0;
      attempt < 200 && useful.evaluate().isEmpty;
      attempt++
    ) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 20)),
      );
      await tester.pump(const Duration(milliseconds: 20));
    }
    expect(
      useful,
      findsWidgets,
      reason: tester.allWidgets
          .whereType<Text>()
          .map((text) => text.data)
          .whereType<String>()
          .join(" | "),
    );
    expect(tester.takeException(), isNull);
  }

  void record(String flow, Stopwatch watch, int run) {
    watch.stop();
    observations.add({
      'flow': flow,
      'run': run,
      'milliseconds': watch.elapsedMicroseconds / 1000,
      'httpCalls': calls,
      'errors': errors,
      'phase': run == 0 ? 'first-observation' : 'warm-observation',
    });
  }

  for (final signed in [false, true]) {
    testWidgets(
      'real local ${signed ? 'signed' : 'guest'} BiteSaver renders useful native offer cards',
      (tester) async {
        await initialize(tester);
        tester.view.physicalSize = const Size(1000, 1600);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        for (var run = 0; run < 3; run++) {
          calls = 0;
          errors = 0;
          SharedLocationStateService.resetForTesting();
          location();
          final auth = signed
              ? CustomerBiteSaverAuthSnapshot.signed(userId!)
              : const CustomerBiteSaverAuthSnapshot.signedOut();
          final coordinator = CustomerBiteSaverSearchCoordinator(
            api: CustomerBiteSaverService(
              transport: (name, data) => invoke(name, data, signed: signed),
            ),
            guestUsageStore: CustomerBiteSaverGuestUsageStore(
              guestDeviceId:
                  'gate0-ui-device-${signed ? 'signed' : 'guest'}-$run-$batch',
              preferences: _Preferences(),
            ),
            clientInstanceId:
                'gate0-ui-client-${signed ? 'signed' : 'guest'}-$run-$batch',
            initialAuth: auth,
            authSnapshotProvider: () => auth,
          );
          final watch = Stopwatch()..start();
          await tester.pumpWidget(
            MaterialApp(
              home: CustomerBiteSaverBrowseScreen(
                coordinator: coordinator,
                timeContextProvider: () async =>
                    const CustomerBiteSaverTimeContext(
                      timeZone: 'America/New_York',
                      utcOffsetMinutes: -240,
                    ),
                onAction: (_, selection) async {
                  expect(selection.isCurrent, isTrue);
                  return const CustomerBiteSaverBrowseActionResult();
                },
                locationRestoreLoader: () async => SharedLocationRestoreResult(
                  state: SharedLocationStateService.state,
                ),
              ),
            ),
          );
          await untilUseful(
            tester,
            find.textContaining('Synthetic noodle offer', findRichText: true),
          );
          expect(coordinator.restaurants, isNotEmpty);
          expect(coordinator.restaurants.first.offers, isNotEmpty);
          expect(
            coordinator.restaurants.first.restaurantId.value,
            startsWith('bsr_'),
          );
          expect(coordinator.error, isNull);
          record(signed ? 'bitesaver-signed' : 'bitesaver-guest', watch, run);
          await tester.pumpWidget(const SizedBox());
          await tester.pump();
        }
      },
      skip: _url.isEmpty,
    );
  }

  testWidgets('real local BiteScore Home renders useful dish cards', (
    tester,
  ) async {
    await initialize(tester);
    tester.view.physicalSize = const Size(1000, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    for (var run = 0; run < 3; run++) {
      calls = 0;
      errors = 0;
      SharedLocationStateService.resetForTesting();
      location();
      final api = CustomerBiteScoreSearchService(transport: invoke);
      final watch = Stopwatch()..start();
      await tester.pumpWidget(
        MaterialApp(
          home: MediaQuery(
            data: const MediaQueryData(textScaler: TextScaler.linear(0.5)),
            child: BiteScoreHomeScreen(
              testSearchApi: api,
              testHomeEntriesLoader: () =>
                  throw StateError('Unexpected legacy directory read.'),
            ),
          ),
        ),
      );
      await untilUseful(tester, find.text('Synthetic Hoagie'));
      record('bitescore-dish-home', watch, run);
      await tester.pumpWidget(const SizedBox());
      await tester.pump();
    }
  }, skip: _url.isEmpty);

  testWidgets(
    'real local Create and Rate Finder displays native restaurant suggestions',
    (tester) async {
      await initialize(tester);
      tester.view.physicalSize = const Size(1000, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      for (var run = 0; run < 3; run++) {
        calls = 0;
        errors = 0;
        final api = CustomerBiteScoreSearchService(transport: invoke);
        await tester.pumpWidget(
          MaterialApp(
            home: BiteScoreCreateRateScreen(
              testSearchApi: api,
              testRestaurantFinderLoader: () =>
                  throw StateError('Unexpected legacy directory read.'),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byType(DropdownButtonFormField<String>));
        await tester.pumpAndSettle();
        await tester.tap(find.text('FL').last);
        await tester.pumpAndSettle();
        final field = find.byWidgetPredicate(
          (widget) =>
              widget is TextField &&
              widget.decoration?.labelText == 'Restaurant Name',
        );
        final watch = Stopwatch()..start();
        await tester.enterText(field, 'Synthetic Gate0 Catalog');
        // Widget tests advance timers virtually. Include the real debounce
        // wait in elapsed-time evidence instead of claiming it was free.
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 300)),
        );
        await tester.pump(const Duration(milliseconds: 300));
        await untilUseful(
          tester,
          find.textContaining(
            'Synthetic Gate0 Catalog 0000000',
            findRichText: true,
          ),
        );
        record('create-rate-finder', watch, run);
        await tester.pumpWidget(const SizedBox());
        await tester.pump();
      }
    },
    skip: _url.isEmpty,
  );
}
