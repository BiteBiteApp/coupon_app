import 'dart:async';

import 'package:coupon_app/models/customer_bitesaver_favorite.dart';
import 'package:coupon_app/models/customer_bitesaver_saved.dart';
import 'package:coupon_app/models/customer_bitesaver_search.dart';
import 'package:coupon_app/screens/coupon_detail_screen.dart';
import 'package:coupon_app/screens/customer_account_screen.dart';
import 'package:coupon_app/screens/customer_profile_screen.dart';
import 'package:coupon_app/screens/main_navigation_screen.dart';
import 'package:coupon_app/screens/restaurant_menu_screen.dart';
import 'package:coupon_app/screens/restaurant_profile_screen.dart';
import 'package:coupon_app/services/app_mode_state_service.dart';
import 'package:coupon_app/services/bitescore_service.dart';
import 'package:coupon_app/services/customer_bitesaver_device_use_service.dart';
import 'package:coupon_app/services/customer_bitesaver_saved_coordinator.dart';
import 'package:coupon_app/services/customer_bitesaver_search_coordinator.dart';
import 'package:coupon_app/services/customer_bitesaver_service.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/customer_bitesaver_device_use_fixture.dart';

String get _restaurantId => 'bsr_${'R' * 43}';
String get _offerId => 'bso_${'O' * 43}';

Map<String, Object?> _restaurant() => <String, Object?>{
  'restaurantId': _restaurantId,
  'displayName': 'Canonical Saved Restaurant',
  'streetAddress': '1 Public Way',
  'city': 'Orlando',
  'state': 'FL',
  'zipCode': '32801',
  'formattedAddress': '1 Public Way, Orlando, FL 32801',
  'imageUrl': null,
  'phone': null,
  'website': null,
  'businessHours': <Object?>[],
  'bio': 'Public profile',
  'distanceMiles': 0.0,
  'isLocal': false,
  'catalogBindingAvailable': false,
  'offers': <Object?>[],
  'hasMoreOffers': false,
  'usableOfferCount': null,
  'offerCountState': 'unknown',
  'favoriteState': 'unknown',
};

Map<String, Object?> _offer() => <String, Object?>{
  'offerId': _offerId,
  'offerOccurrence': 'bsoc1.${'a' * 43}',
  'offerType': 'coupon',
  'title': 'Canonical Saved Coupon',
  'details': 'Safe coupon details',
  'couponCode': 'SAVE',
  'couponNumber': null,
  'usageRule': 'Once per customer',
  'usagePolicy': 'oncePerCustomer',
  'availabilityMode': null,
  'daysOfWeek': <Object?>[],
  'allDay': null,
  'startTime': null,
  'endTime': null,
  'startAtMillis': null,
  'endAtMillis': null,
  'expiresAtMillis': null,
  'expiresText': null,
  'isProximityOnly': false,
  'proximityRadiusMiles': null,
  'imageUrl': null,
  'sourceCreatedAtMillis': 1,
  'available': false,
  'availabilityReason': 'savedReadOnly',
  'redemptionPolicyLabel': 'Once per customer',
  'activeTimerExpiresAtMillis': null,
  'nextAvailableAtMillis': null,
  'usageState': 'unknown',
};

CustomerBiteSaverSavedPageResult _savedPage(
  CustomerBiteSaverSavedSection section,
) => CustomerBiteSaverSavedPageResult.fromJson(<String, Object?>{
  'schemaVersion': 1,
  'section': section.name,
  'entries': <Object?>[
    <String, Object?>{
      'favoriteKind': section == CustomerBiteSaverSavedSection.restaurants
          ? 'bitesaverRestaurant'
          : 'bitesaverCoupon',
      'restaurantId': _restaurantId,
      'offerId': section == CustomerBiteSaverSavedSection.coupons
          ? _offerId
          : null,
      'availability': 'available',
      'restaurant': _restaurant(),
      'offer': section == CustomerBiteSaverSavedSection.coupons
          ? _offer()
          : null,
      'accessToken': 'bssv1.${section.name}-access',
    },
  ],
  'nextCursor': null,
  'hasMore': false,
  'partial': false,
});

final class _SavedApi implements CustomerBiteSaverSavedApi {
  final List<CustomerBiteSaverSavedSection> pageCalls =
      <CustomerBiteSaverSavedSection>[];
  int menuCalls = 0;
  int validationCalls = 0;
  int startCalls = 0;
  static const int evaluationAtMillis = 1_789_560_000_000;

  @override
  Future<
    CustomerBiteSaverEndpointResponse<
      CustomerBiteSaverRedemptionValidationResult
    >
  >
  validateCustomerBiteSaverSavedOfferRedemptionStart(
    CustomerBiteSaverSavedRedemptionValidationRequest request,
  ) async {
    validationCalls += 1;
    throw StateError('Legacy Saved validation must remain unused.');
  }

  @override
  Future<CustomerBiteSaverRedemptionStartResult>
  startCustomerBiteSaverSavedOfferRedemption(
    CustomerBiteSaverSavedRedemptionStartRequest request,
  ) async {
    startCalls += 1;
    throw StateError('Legacy Saved start must remain unused.');
  }

  @override
  Future<CustomerBiteSaverSavedPageResult> getCustomerBiteSaverSavedPage(
    CustomerBiteSaverSavedPageRequest request,
  ) async {
    pageCalls.add(request.section);
    return _savedPage(request.section);
  }

  @override
  Future<CustomerBiteSaverMenuPageResult> getCustomerBiteSaverSavedMenuPage(
    CustomerBiteSaverSavedMenuPageRequest request,
  ) async {
    menuCalls += 1;
    return CustomerBiteSaverMenuPageResult.fromJson(<String, Object?>{
      'schemaVersion': 1,
      'state': 'available',
      'attemptGeneration': 0,
      'queryFingerprint': 'f' * 64,
      'restaurantId': _restaurantId,
      'menuStyle': 'biteSaver',
      'entries': <Object?>[
        <String, Object?>{
          'kind': 'item',
          'key': 'bsme_${'M' * 43}',
          'name': 'Saved Menu Item',
          'description': '',
          'price': r'$12',
          'category': 'Dinner',
          'sortOrder': 0,
        },
      ],
      'nextCursor': null,
      'hasMore': false,
    });
  }
}

final class _SavedWrites {
  final List<String> calls = <String>[];

  CustomerBiteSaverSavedFavoriteActions get actions =>
      CustomerBiteSaverSavedFavoriteActions(
        upsertRestaurant: (identity, userId) async {
          calls.add('save-r:${identity.restaurantId.value}:$userId');
        },
        removeRestaurant: (id, userId) async {
          calls.add('remove-r:${id.value}:$userId');
        },
        upsertCoupon: (identity, userId) async {
          calls.add('save-c:${identity.offerId.value}:$userId');
        },
        removeCoupon: (id, userId) async {
          calls.add('remove-c:${id.value}:$userId');
        },
      );
}

const BiteScoreUserProfileData _emptyProfile = BiteScoreUserProfileData(
  publicDisplayName: 'Saved Owner',
  chosenUsername: null,
  fallbackUsername: 'owner',
  favoriteRestaurants: [],
  favoriteSaverRestaurants: [],
  favoriteDishEntries: [],
  favoriteCoupons: [],
  reviews: [],
  badgeLabel: 'New Reviewer',
  reviewCount: 0,
  helpfulVotesReceived: 0,
  accountAgeDays: 1,
  moderationFlagCount: 0,
  contributionPoints: 0,
);

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    AppModeStateService.setMode(AppMode.biteSaver);
  });

  testWidgets(
    'paired bounded Account lists, opens, navigates Menu, and removes canonical Saved',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(900, 1200);
      addTearDown(tester.view.reset);
      final user = _SavedUser('owner-a');
      final api = _SavedApi();
      final writes = _SavedWrites();
      final device = CustomerBiteSaverDeviceUseFixture();
      addTearDown(device.dispose);
      final coordinator = CustomerBiteSaverSavedCoordinator(
        userId: user.uid,
        api: api,
        favoriteActions: writes.actions,
        isAccountCurrent: (userId) => userId == user.uid,
        requestIdGenerator: () =>
            'saved-widget-request-${api.pageCalls.length + api.menuCalls + 1000}',
        deviceUseService: device.service,
      );
      addTearDown(coordinator.dispose);

      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: rootNavigatorKey,
          scaffoldMessengerKey: rootScaffoldMessengerKey,
          home: MainNavigationScreen(
            initialIndex: 2,
            initializePlatformServices: false,
            testCustomerAuthRealmProvider: () => 'signed:${user.uid}',
            biteSaverBrowseHomeBuilder:
                (context, navigationRefreshGeneration, authRealm) =>
                    const Scaffold(body: Text('Bounded Browse')),
            biteSaverSavedAccountBuilder: (context, authRealm) {
              expect(authRealm, 'signed:${user.uid}');
              return CustomerAccountScreen(
                userStream: Stream<User?>.value(user),
                profileDestinationBuilder: (context, currentUser) =>
                    CustomerProfileScreen.fromCustomerBiteSaver(
                      currentUser: currentUser,
                      savedCoordinator: coordinator,
                      testCurrentUserProvider: () => user,
                      testProfileLoader: (_) async => _emptyProfile,
                      testLocalExpertBadgesLoader: (_) async => const [],
                    ),
              );
            },
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(CustomerAccountScreen), findsOneWidget);
      await tester.tap(find.text('My Profile'));
      await tester.pumpAndSettle();

      expect(api.pageCalls, <CustomerBiteSaverSavedSection>[
        CustomerBiteSaverSavedSection.restaurants,
        CustomerBiteSaverSavedSection.coupons,
      ]);
      expect(
        coordinator.errorFor(CustomerBiteSaverSavedSection.coupons),
        isNull,
      );
      expect(
        coordinator.entries(CustomerBiteSaverSavedSection.coupons),
        hasLength(1),
      );
      expect(find.text('Canonical Saved Restaurant'), findsOneWidget);

      await tester.tap(find.text('Canonical Saved Restaurant'));
      await tester.pumpAndSettle();
      expect(find.byType(RestaurantProfileScreen), findsOneWidget);
      expect(find.byTooltip('Unsave restaurant'), findsOneWidget);

      await tester.tap(find.text('Restaurant Information'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Menu'));
      await tester.pumpAndSettle();
      expect(find.byType(RestaurantMenuScreen), findsOneWidget);
      expect(find.text('Saved Menu Item'), findsOneWidget);
      expect(api.menuCalls, 1);

      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.byType(RestaurantProfileScreen), findsOneWidget);
      await tester.tap(find.byTooltip('Unsave restaurant'));
      await tester.pumpAndSettle();
      expect(writes.calls, contains('remove-r:$_restaurantId:owner-a'));

      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.byType(CustomerProfileScreen), findsOneWidget);
      expect(find.text('Canonical Saved Restaurant'), findsNothing);
      expect(
        find.text(
          'No saved restaurants yet. Tap a heart on a restaurant page to save one.',
        ),
        findsOneWidget,
      );

      expect(
        coordinator.entries(CustomerBiteSaverSavedSection.coupons),
        hasLength(1),
      );
      await tester.ensureVisible(find.text('Coupons'));
      await tester.tap(find.text('Coupons'));
      await tester.pumpAndSettle();
      expect(find.text('Canonical Saved Coupon'), findsOneWidget);
      await tester.tap(find.text('Canonical Saved Coupon'));
      await tester.pumpAndSettle();
      expect(find.byType(CouponDetailScreen), findsOneWidget);
      expect(find.text('Use Coupon Unavailable'), findsOneWidget);
      expect(find.byTooltip('Unsave coupon'), findsOneWidget);
      final savedDetail = tester.widget<CouponDetailScreen>(
        find.byType(CouponDetailScreen),
      );
      expect(savedDetail.boundedSession, isNull);
      expect(savedDetail.boundedAccess, isNull);
      expect(savedDetail.boundedSavedAccess?.isCurrent, isTrue);

      await tester.tap(
        find.byKey(BiteSaverCouponDetailInfoSection.restaurantPillKey),
      );
      await tester.pumpAndSettle();
      expect(find.byType(RestaurantProfileScreen), findsOneWidget);
      final couponParent = tester.widget<RestaurantProfileScreen>(
        find.byType(RestaurantProfileScreen),
      );
      expect(couponParent.boundedRestaurant?.restaurantId.value, _restaurantId);
      expect(couponParent.boundedSavedCoordinator, same(coordinator));
      expect(find.byTooltip('Save restaurant'), findsOneWidget);

      await tester.tap(find.text('Restaurant Information'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Menu'));
      await tester.pumpAndSettle();
      expect(find.byType(RestaurantMenuScreen), findsOneWidget);
      expect(find.text('Saved Menu Item'), findsOneWidget);
      expect(api.menuCalls, 2);

      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.byType(RestaurantProfileScreen), findsOneWidget);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.byType(CouponDetailScreen), findsOneWidget);
      expect(
        coordinator.entries(CustomerBiteSaverSavedSection.coupons),
        hasLength(1),
      );
      expect(api.pageCalls, <CustomerBiteSaverSavedSection>[
        CustomerBiteSaverSavedSection.restaurants,
        CustomerBiteSaverSavedSection.coupons,
      ]);

      await tester.tap(find.byTooltip('Unsave coupon'));
      await tester.pumpAndSettle();
      expect(writes.calls, contains('remove-c:$_offerId:owner-a'));

      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.text('Canonical Saved Coupon'), findsNothing);
      expect(
        find.text(
          'No saved coupons yet. Tap a heart on a coupon page to save one.',
        ),
        findsOneWidget,
      );
      expect(device.stages, isEmpty);
      expect(api.validationCalls, 0);
      expect(api.startCalls, 0);
      expect(tester.takeException(), isNull);
    },
  );

  for (final stage in <String>['proof', 'use']) {
    testWidgets(
      'Saved Back during $stage preserves committed use and original remaining timer',
      (tester) async {
        final harness = await _openSavedBackHarness(tester);
        final release = Completer<void>();
        harness.device.beforeStage = (currentStage) async {
          if (currentStage == stage) await release.future;
        };
        await _confirmSavedUse(tester);
        await _pumpUntil(tester, () => harness.device.stages.contains(stage));
        expect(harness.device.submissions, hasLength(stage == 'use' ? 1 : 0));

        await _backFromSavedCoupon(tester);
        await _reopenSavedCoupon(tester);
        await _confirmSavedUse(tester);
        await _backFromSavedCoupon(tester);
        expect(
          harness.device.submissions,
          hasLength(stage == 'use' ? 1 : 0),
          reason: 'A repeated final tap must share the still-pending attempt.',
        );
        release.complete();
        await _pumpUntil(tester, () => harness.presentation != null);
        expect(
          find.byType(CouponDetailScreen, skipOffstage: false),
          findsNothing,
        );
        expect(
          find.text('Your 5-minute coupon timer has started.'),
          findsNothing,
        );
        expect(harness.device.submissions, hasLength(1));
        expect(
          harness.device.stages.where((value) => value == 'proof'),
          hasLength(1),
        );
        expect(
          harness.presentation!.timerStartedAtMillis,
          _SavedApi.evaluationAtMillis,
        );
        expect(
          harness.presentation!.timerExpiresAtMillis,
          _SavedApi.evaluationAtMillis + 300000,
        );
        expect(tester.takeException(), isNull);

        harness.nowMillis += 60000;
        await _reopenSavedCoupon(tester);
        expect(find.textContaining('Timer active: 04:00'), findsOneWidget);
        expect(find.textContaining('Timer active: 05:00'), findsNothing);
        expect(find.text('Redeem Timer Active'), findsOneWidget);
        expect(harness.device.submissions, hasLength(1));
        harness.expectNoLegacyUse();
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets('Saved timer expiry while away retains used state on return', (
    tester,
  ) async {
    final harness = await _openSavedBackHarness(tester);
    await _confirmSavedUse(tester);
    await _pumpUntil(tester, () => harness.presentation != null);
    final originalPresentation = harness.presentation;
    await _backFromSavedCoupon(tester);

    harness.nowMillis += 300001;
    await tester.pump(const Duration(milliseconds: 300001));
    await _reopenSavedCoupon(tester);
    expect(harness.presentation, same(originalPresentation));
    expect(harness.presentation!.isActiveAt(harness.nowMillis), isFalse);
    expect(find.textContaining('Timer active:'), findsNothing);
    expect(find.text('Use Coupon'), findsOneWidget);
    expect(
      tester
          .widget<ElevatedButton>(
            find.widgetWithText(ElevatedButton, 'Use Coupon'),
          )
          .onPressed,
      isNull,
    );
    expect(harness.device.submissions, hasLength(1));
    harness.expectNoLegacyUse();
    expect(tester.takeException(), isNull);
  });

  for (final response in <String>['denied', 'rejected']) {
    testWidgets('Saved $response after Back creates no successful timer', (
      tester,
    ) async {
      final harness = await _openSavedBackHarness(tester);
      final release = Completer<void>();
      harness.device.status = response == 'denied' ? 'denied' : 'started';
      harness.device.beforeStage = (stage) async {
        if (stage != 'use') return;
        await release.future;
        if (response == 'rejected') {
          throw const CustomerBiteSaverDeviceUseTransportException(
            code: 'permission-denied',
            ambiguous: false,
          );
        }
      };
      await _confirmSavedUse(tester);
      await _pumpUntil(tester, () => harness.device.submissions.isNotEmpty);
      await _backFromSavedCoupon(tester);
      release.complete();
      await tester.pumpAndSettle();
      expect(harness.presentation, isNull);
      expect(
        find.byType(CouponDetailScreen, skipOffstage: false),
        findsNothing,
      );
      expect(
        find.text('Your 5-minute coupon timer has started.'),
        findsNothing,
      );
      expect(tester.takeException(), isNull);

      await _reopenSavedCoupon(tester);
      expect(find.text('Use Coupon'), findsOneWidget);
      expect(find.textContaining('Timer active:'), findsNothing);
      expect(harness.device.submissions, hasLength(1));
      harness.expectNoLegacyUse();
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets(
    'Saved ambiguous response after Back recovers the exact request',
    (tester) async {
      final harness = await _openSavedBackHarness(tester);
      final release = Completer<void>();
      harness.device.beforeStage = (stage) async {
        if (stage == 'use' && harness.device.submissions.length == 1) {
          await release.future;
          throw const CustomerBiteSaverDeviceUseTransportException(
            code: 'unavailable',
            ambiguous: true,
          );
        }
      };
      await _confirmSavedUse(tester);
      await _pumpUntil(tester, () => harness.device.submissions.isNotEmpty);
      final originalSubmission = harness.device.submissions.single;
      await _backFromSavedCoupon(tester);
      release.complete();
      await tester.pumpAndSettle();
      expect(harness.presentation, isNull);
      expect(tester.takeException(), isNull);

      harness.nowMillis += 60000;
      harness.device.status = 'active';
      await _reopenSavedCoupon(tester);
      await _confirmSavedUse(tester);
      await _pumpUntil(tester, () => harness.presentation != null);
      expect(harness.device.submissions, hasLength(2));
      expect(harness.device.submissions.last, equals(originalSubmission));
      expect(
        harness.device.stages.where((value) => value == 'proof'),
        hasLength(1),
      );
      expect(
        harness.device.stages.where((value) => value == 'challenge'),
        hasLength(1),
      );
      expect(
        harness.presentation!.timerStartedAtMillis,
        _SavedApi.evaluationAtMillis,
      );
      expect(
        harness.presentation!.timerExpiresAtMillis,
        _SavedApi.evaluationAtMillis + 300000,
      );
      expect(find.textContaining('Timer active: 04:00'), findsOneWidget);
      harness.expectNoLegacyUse();
      expect(tester.takeException(), isNull);
    },
  );

  for (final openConfirmation in <bool>[false, true]) {
    testWidgets(
      'Saved Back before final tap consumes nothing with confirmation=$openConfirmation',
      (tester) async {
        final harness = await _openSavedBackHarness(tester);
        if (openConfirmation) {
          await tester.tap(find.text('Use Coupon'));
          await tester.pumpAndSettle();
          expect(find.text('Use this coupon now?'), findsOneWidget);
          await tester.binding.handlePopRoute();
          await tester.pumpAndSettle();
        }
        await _backFromSavedCoupon(tester);
        expect(harness.device.stages, isEmpty);
        expect(harness.device.submissions, isEmpty);
        expect(harness.presentation, isNull);
        await _reopenSavedCoupon(tester);
        expect(find.text('Use Coupon'), findsOneWidget);
        expect(harness.device.stages, isEmpty);
        harness.expectNoLegacyUse();
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets(
    'signed Saved explicit use is device authoritative and reopens original timer',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(900, 1200);
      addTearDown(tester.view.reset);
      final user = _SavedUser('owner-a');
      final api = _SavedApi();
      final writes = _SavedWrites();
      final device = CustomerBiteSaverDeviceUseFixture();
      addTearDown(device.dispose);
      var requestSequence = 0;
      var nowMillis = _SavedApi.evaluationAtMillis;
      final coordinator = CustomerBiteSaverSavedCoordinator(
        userId: user.uid,
        api: api,
        favoriteActions: writes.actions,
        isAccountCurrent: (userId) => userId == user.uid,
        requestIdGenerator: () =>
            'saved-widget-use-${(++requestSequence).toString().padLeft(5, '0')}',
        timeContextProvider: () async =>
            (timeZone: 'America/New_York', utcOffsetMinutes: -240),
        deviceUseService: device.service,
        clock: () => DateTime.fromMillisecondsSinceEpoch(nowMillis),
      );
      addTearDown(coordinator.dispose);

      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: rootNavigatorKey,
          scaffoldMessengerKey: rootScaffoldMessengerKey,
          home: MainNavigationScreen(
            initialIndex: 2,
            initializePlatformServices: false,
            testCustomerAuthRealmProvider: () => 'signed:${user.uid}',
            biteSaverBrowseHomeBuilder:
                (context, navigationRefreshGeneration, authRealm) =>
                    const Scaffold(body: Text('Bounded Browse')),
            biteSaverSavedAccountBuilder: (context, authRealm) =>
                CustomerAccountScreen(
                  userStream: Stream<User?>.value(user),
                  profileDestinationBuilder: (context, currentUser) =>
                      CustomerProfileScreen.fromCustomerBiteSaver(
                        currentUser: currentUser,
                        savedCoordinator: coordinator,
                        testCurrentUserProvider: () => user,
                        testProfileLoader: (_) async => _emptyProfile,
                        testLocalExpertBadgesLoader: (_) async => const [],
                      ),
                ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('My Profile'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Coupons'));
      await tester.tap(find.text('Coupons'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Canonical Saved Coupon'));
      await tester.pumpAndSettle();

      expect(find.text('Use Coupon'), findsOneWidget);
      expect(api.validationCalls, 0);
      expect(api.startCalls, 0);
      await tester.tap(find.text('Use Coupon'));
      await tester.pumpAndSettle();
      expect(find.text('Use this coupon now?'), findsOneWidget);
      expect(
        device.stages,
        isEmpty,
        reason: 'Opening confirmation does not consume.',
      );
      await tester.tap(
        find.byKey(const ValueKey<String>('bitesaver_use_confirm')),
      );
      await _pumpUntil(
        tester,
        () => find.text('Redeem Timer Active').evaluate().isNotEmpty,
      );

      expect(api.validationCalls, 0);
      expect(api.startCalls, 0);
      expect(device.submissions, hasLength(1));
      expect(
        (device.submissions.single['request']
            as Map<String, Object?>)['origin'],
        <String, Object?>{
          'kind': 'saved',
          'accessToken': 'bssv1.coupons-access',
        },
      );
      expect(find.textContaining('Timer active: 05:00'), findsOneWidget);
      await tester.pump(const Duration(milliseconds: 400));
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.textContaining('Coupon timer active'), findsOneWidget);
      await tester.tap(find.text('Canonical Saved Coupon'));
      await _pumpUntil(
        tester,
        () => find.byType(CouponDetailScreen).evaluate().isNotEmpty,
      );
      expect(find.text('Redeem Timer Active'), findsOneWidget);
      expect(find.textContaining('Timer active: 05:00'), findsOneWidget);
      expect(api.validationCalls, 0);
      expect(api.startCalls, 0);
      expect(device.submissions, hasLength(1));

      nowMillis +=
          CustomerBiteSaverSearchContract.redemptionTimerMilliseconds + 1;
      await tester.pump(
        const Duration(
          milliseconds:
              CustomerBiteSaverSearchContract.redemptionTimerMilliseconds + 1,
        ),
      );
      await tester.pump();
      expect(
        find.byType(CouponDetailScreen),
        findsOneWidget,
        reason: 'The still-current Saved read lease owns the detail route.',
      );
      expect(api.validationCalls, 0);
      expect(api.startCalls, 0);
      expect(device.submissions, hasLength(1));
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'confirmed expiry retires a stale Saved route without network work',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(900, 1200);
      addTearDown(tester.view.reset);
      final user = _SavedUser('owner-a');
      final api = _SavedApi();
      final writes = _SavedWrites();
      final device = CustomerBiteSaverDeviceUseFixture();
      addTearDown(device.dispose);
      var requestSequence = 0;
      var nowMillis = _SavedApi.evaluationAtMillis;
      var accountCurrent = true;
      final coordinator = CustomerBiteSaverSavedCoordinator(
        userId: user.uid,
        api: api,
        favoriteActions: writes.actions,
        isAccountCurrent: (userId) => accountCurrent && userId == user.uid,
        requestIdGenerator: () =>
            'saved-expiry-${(++requestSequence).toString().padLeft(8, '0')}',
        timeContextProvider: () async =>
            (timeZone: 'America/New_York', utcOffsetMinutes: -240),
        deviceUseService: device.service,
        clock: () => DateTime.fromMillisecondsSinceEpoch(nowMillis),
      );
      addTearDown(coordinator.dispose);

      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: rootNavigatorKey,
          scaffoldMessengerKey: rootScaffoldMessengerKey,
          home: MainNavigationScreen(
            initialIndex: 2,
            initializePlatformServices: false,
            testCustomerAuthRealmProvider: () => 'signed:${user.uid}',
            biteSaverBrowseHomeBuilder:
                (context, navigationRefreshGeneration, authRealm) =>
                    const Scaffold(body: Text('Bounded Browse')),
            biteSaverSavedAccountBuilder: (context, authRealm) =>
                CustomerAccountScreen(
                  userStream: Stream<User?>.value(user),
                  profileDestinationBuilder: (context, currentUser) =>
                      CustomerProfileScreen.fromCustomerBiteSaver(
                        currentUser: currentUser,
                        savedCoordinator: coordinator,
                        testCurrentUserProvider: () => user,
                        testProfileLoader: (_) async => _emptyProfile,
                        testLocalExpertBadgesLoader: (_) async => const [],
                      ),
                ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('My Profile'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Coupons'));
      await tester.tap(find.text('Coupons'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Canonical Saved Coupon'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Use Coupon'));
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(const ValueKey<String>('bitesaver_use_confirm')),
      );
      await _pumpUntil(
        tester,
        () => find.text('Redeem Timer Active').evaluate().isNotEmpty,
      );
      expect(find.byType(CouponDetailScreen), findsOneWidget);

      accountCurrent = false;
      nowMillis +=
          CustomerBiteSaverSearchContract.redemptionTimerMilliseconds + 1;
      await tester.pump(
        const Duration(
          milliseconds:
              CustomerBiteSaverSearchContract.redemptionTimerMilliseconds + 1,
        ),
      );
      await tester.pump();

      expect(find.byType(CouponDetailScreen), findsNothing);
      expect(api.validationCalls, 0);
      expect(api.startCalls, 0);
      expect(device.submissions, hasLength(1));
      expect(tester.takeException(), isNull);
    },
  );

  for (final nextRealm in <String>['signed:owner-b', 'guest']) {
    testWidgets(
      'confirmed Saved timer survives $nextRealm offline until original expiry',
      (tester) async {
        tester.view.devicePixelRatio = 1;
        tester.view.physicalSize = const Size(900, 1200);
        addTearDown(tester.view.reset);
        final user = _SavedUser('owner-a');
        User? currentUser = user;
        var authRealm = 'signed:owner-a';
        final authChanges = StreamController<String>.broadcast(sync: true);
        addTearDown(authChanges.close);
        final api = _SavedApi();
        final writes = _SavedWrites();
        final device = CustomerBiteSaverDeviceUseFixture();
        addTearDown(device.dispose);
        var requestSequence = 0;
        const originalStart = _SavedApi.evaluationAtMillis;
        var nowMillis = originalStart;
        final coordinator = CustomerBiteSaverSavedCoordinator(
          userId: user.uid,
          api: api,
          favoriteActions: writes.actions,
          isAccountCurrent: (uid) => currentUser?.uid == uid,
          requestIdGenerator: () =>
              'saved-auth-timer-${(++requestSequence).toString().padLeft(5, '0')}',
          timeContextProvider: () async =>
              (timeZone: 'America/New_York', utcOffsetMinutes: -240),
          deviceUseService: device.service,
          clock: () => DateTime.fromMillisecondsSinceEpoch(nowMillis),
        );
        addTearDown(coordinator.dispose);
        await tester.pumpWidget(
          MaterialApp(
            navigatorKey: rootNavigatorKey,
            scaffoldMessengerKey: rootScaffoldMessengerKey,
            home: MainNavigationScreen(
              initialIndex: 2,
              initializePlatformServices: false,
              testCustomerAuthRealmProvider: () => authRealm,
              testCustomerAuthRealmChanges: authChanges.stream,
              biteSaverBrowseHomeBuilder: (_, _, _) =>
                  const Scaffold(body: Text('Bounded Browse')),
              biteSaverSavedAccountBuilder: (context, realm) =>
                  realm != 'signed:owner-a'
                  ? const Scaffold(body: Text('Replacement account'))
                  : CustomerAccountScreen(
                      userStream: Stream<User?>.value(user),
                      profileDestinationBuilder: (_, signedUser) =>
                          CustomerProfileScreen.fromCustomerBiteSaver(
                            currentUser: signedUser,
                            savedCoordinator: coordinator,
                            testCurrentUserProvider: () => currentUser,
                            testProfileLoader: (_) async => _emptyProfile,
                            testLocalExpertBadgesLoader: (_) async => const [],
                          ),
                    ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.text('My Profile'));
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.text('Coupons'));
        await tester.tap(find.text('Coupons'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Canonical Saved Coupon'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Use Coupon'));
        await tester.pumpAndSettle();
        await tester.tap(
          find.byKey(const ValueKey<String>('bitesaver_use_confirm')),
        );
        await _pumpUntil(
          tester,
          () => find.text('Redeem Timer Active').evaluate().isNotEmpty,
        );
        await tester.pump(const Duration(milliseconds: 400));
        final stageCount = device.stages.length;
        final pageCount = api.pageCalls.length;
        device.beforeStage = (_) async =>
            throw StateError('Device network is offline.');
        currentUser = nextRealm == 'guest' ? null : _SavedUser('owner-b');
        authRealm = nextRealm;
        coordinator.dispose();
        authChanges.add(authRealm);
        await tester.pump(const Duration(milliseconds: 400));
        expect(find.byType(CouponDetailScreen), findsOneWidget);
        expect(find.textContaining('Timer active: 05:00'), findsOneWidget);
        expect(
          tester
              .widget<ElevatedButton>(
                find.widgetWithText(ElevatedButton, 'Redeem Timer Active'),
              )
              .onPressed,
          isNull,
        );
        expect(
          tester
              .widget<IconButton>(
                find.ancestor(
                  of: find.byTooltip('Saved status unavailable'),
                  matching: find.byType(IconButton),
                ),
              )
              .onPressed,
          isNull,
        );
        expect(
          tester
              .widget<BiteSaverCouponRestaurantLink>(
                find.byKey(BiteSaverCouponDetailInfoSection.restaurantPillKey),
              )
              .onTap,
          isNull,
        );
        expect(
          find.byType(CustomerProfileScreen, skipOffstage: false),
          findsNothing,
        );
        expect(writes.calls, isEmpty);
        expect(api.pageCalls, hasLength(pageCount));
        expect(api.menuCalls, 0);
        expect(device.stages, hasLength(stageCount));
        expect(device.submissions, hasLength(1));

        nowMillis = originalStart + 60000;
        await tester.pump(const Duration(seconds: 1));
        expect(find.textContaining('Timer active: 04:00'), findsOneWidget);
        nowMillis = originalStart + 299999;
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.inactive,
        );
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.resumed,
        );
        await tester.pump();
        expect(find.byType(CouponDetailScreen), findsOneWidget);
        nowMillis = originalStart + 300000;
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.inactive,
        );
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.resumed,
        );
        await _pumpUntil(
          tester,
          () => find.byType(CouponDetailScreen).evaluate().isEmpty,
        );
        expect(device.stages, hasLength(stageCount));
        expect(device.submissions, hasLength(1));
        expect(api.validationCalls, 0);
        expect(api.startCalls, 0);
        expect(tester.takeException(), isNull);
      },
    );
  }

  test('default navigation entry keeps both bounded builders absent', () {
    const screen = MainNavigationScreen(initializePlatformServices: false);
    expect(screen.biteSaverBrowseHomeBuilder, isNull);
    expect(screen.biteSaverSavedAccountBuilder, isNull);
  });

  test('bounded Home cannot be composed with a legacy-only Account', () {
    expect(
      () => MainNavigationScreen(
        initializePlatformServices: false,
        biteSaverBrowseHomeBuilder: (_, _, _) => const SizedBox.shrink(),
      ),
      throwsAssertionError,
    );
  });
}

final class _SavedBackHarness {
  _SavedBackHarness() {
    var sequence = 0;
    coordinator = CustomerBiteSaverSavedCoordinator(
      userId: user.uid,
      api: api,
      favoriteActions: _SavedWrites().actions,
      isAccountCurrent: (uid) => uid == user.uid,
      requestIdGenerator: () =>
          'saved-back-${(++sequence).toString().padLeft(8, '0')}',
      timeContextProvider: () async =>
          (timeZone: 'America/New_York', utcOffsetMinutes: -240),
      deviceUseService: device.service,
      clock: () => DateTime.fromMillisecondsSinceEpoch(nowMillis),
    );
  }

  final user = _SavedUser('owner-a');
  final api = _SavedApi();
  final device = CustomerBiteSaverDeviceUseFixture();
  late final CustomerBiteSaverSavedCoordinator coordinator;
  int nowMillis = _SavedApi.evaluationAtMillis;

  CustomerBiteSaverRedemptionPresentation? get presentation =>
      coordinator.redemptionPresentationFor(CustomerBiteSaverOfferId(_offerId));

  void expectNoLegacyUse() {
    expect(api.validationCalls, 0);
    expect(api.startCalls, 0);
  }
}

Future<_SavedBackHarness> _openSavedBackHarness(WidgetTester tester) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = const Size(900, 1200);
  addTearDown(tester.view.reset);
  final harness = _SavedBackHarness();
  addTearDown(harness.device.dispose);
  addTearDown(harness.coordinator.dispose);
  await tester.pumpWidget(
    MaterialApp(
      navigatorKey: rootNavigatorKey,
      scaffoldMessengerKey: rootScaffoldMessengerKey,
      home: MainNavigationScreen(
        initialIndex: 2,
        initializePlatformServices: false,
        testCustomerAuthRealmProvider: () => 'signed:${harness.user.uid}',
        biteSaverBrowseHomeBuilder: (_, _, _) =>
            const Scaffold(body: Text('Bounded Browse')),
        biteSaverSavedAccountBuilder: (_, _) => CustomerAccountScreen(
          userStream: Stream<User?>.value(harness.user),
          profileDestinationBuilder: (_, user) =>
              CustomerProfileScreen.fromCustomerBiteSaver(
                currentUser: user,
                savedCoordinator: harness.coordinator,
                testCurrentUserProvider: () => harness.user,
                testProfileLoader: (_) async => _emptyProfile,
                testLocalExpertBadgesLoader: (_) async => const [],
              ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  await tester.tap(find.text('My Profile'));
  await tester.pumpAndSettle();
  await tester.ensureVisible(find.text('Coupons'));
  await tester.tap(find.text('Coupons'));
  await tester.pumpAndSettle();
  await _reopenSavedCoupon(tester);
  return harness;
}

Future<void> _reopenSavedCoupon(WidgetTester tester) async {
  await tester.tap(find.text('Canonical Saved Coupon'));
  await tester.pumpAndSettle();
  expect(find.byType(CouponDetailScreen), findsOneWidget);
}

Future<void> _confirmSavedUse(WidgetTester tester) async {
  await tester.tap(find.text('Use Coupon'));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const ValueKey<String>('bitesaver_use_confirm')));
}

Future<void> _backFromSavedCoupon(WidgetTester tester) async {
  await tester.pump(const Duration(milliseconds: 400));
  await tester.binding.handlePopRoute();
  await tester.pumpAndSettle();
  expect(find.byType(CouponDetailScreen, skipOffstage: false), findsNothing);
}

final class _SavedUser extends Fake implements User {
  _SavedUser(this.uid);

  @override
  final String uid;

  @override
  bool get isAnonymous => false;

  @override
  String? get email => 'owner@example.test';

  @override
  String? get displayName => null;

  @override
  bool get emailVerified => true;

  @override
  List<UserInfo> get providerData => const <UserInfo>[];
}

Future<void> _pumpUntil(WidgetTester tester, bool Function() condition) async {
  for (var attempt = 0; attempt < 80; attempt += 1) {
    await tester.pump(const Duration(milliseconds: 10));
    if (condition()) return;
  }
  fail('Timed out waiting for the Saved BiteSaver fixture.');
}
