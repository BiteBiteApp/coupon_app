import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:cloud_functions/cloud_functions.dart';
import 'package:coupon_app/services/customer_browser_location_service.dart';
import 'package:coupon_app/services/bitescore_service.dart'
    show BiteScoreHomeEntry;
import 'package:coupon_app/services/customer_website_routes.dart';
import 'package:coupon_app/services/customer_bitescore_reads.dart';
import 'package:coupon_app/screens/customer_website_detail_screen.dart';
import 'package:coupon_app/screens/customer_bitesaver_browse_destinations.dart';
// Local synthetic browser qualification. No Firebase initialization or transport.
// ignore_for_file: invalid_use_of_visible_for_testing_member
import 'dart:async';
import 'package:coupon_app/main.dart' show CouponApp;
import 'package:coupon_app/models/bitesaver_restaurant_media.dart';
import 'package:coupon_app/models/customer_bitesaver_search.dart';
import 'package:coupon_app/screens/bitescore_home_screen.dart';
import 'package:coupon_app/screens/bitescore_dish_detail_screen.dart';
import 'package:coupon_app/screens/bitescore_restaurant_dishes_screen.dart';
import 'package:coupon_app/models/customer_bitescore_search.dart';
import 'package:coupon_app/services/restaurant_customer_link_service.dart';
import 'package:coupon_app/screens/coupon_detail_screen.dart';
import 'package:coupon_app/screens/customer_bitesaver_browse_screen.dart';
import 'package:coupon_app/screens/main_navigation_screen.dart';
import 'package:coupon_app/screens/restaurant_menu_screen.dart';
import 'package:coupon_app/screens/restaurant_profile_screen.dart';
import 'package:coupon_app/services/app_mode_state_service.dart';
import 'package:coupon_app/services/customer_bitesaver_guest_usage_store.dart';
import 'package:coupon_app/services/customer_bitesaver_public_profile.dart';
import 'package:coupon_app/services/customer_bitesaver_search_coordinator.dart';
import 'package:coupon_app/services/customer_bitesaver_service.dart';
import 'package:coupon_app/services/shared_location_state_service.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'score_data.dart'
    show FakeSearchApi, dishProjection, restaurantProjection, response;
import 'data.dart';

final fixtureNow = DateTime.fromMillisecondsSinceEpoch(
  websiteResponses['restaurantPage']['evaluationContext']['evaluationAtMillis']
      as int,
);
Map<String, dynamic> fixtureRestaurant({bool profile = false}) {
  final restaurant = copyWebsiteData(
    (websiteResponses['restaurantPage']['restaurants'] as List).first,
  );
  restaurant['imageUrl'] = null;
  restaurant['catalogBindingAvailable'] = true;
  restaurant['displayName'] = 'LOCAL FIXTURE Cafe';
  final base = copyWebsiteData((restaurant['offers'] as List).first);
  restaurant['offers'] = [
    for (final (index, policy) in [
      'unlimited',
      'oncePerDay',
      'oncePerCustomer',
      'reusableAfterTimer',
      'special',
    ].indexed)
      if (profile || index < 2)
        {
          ...base,
          'offerId': 'bso_${String.fromCharCode(97 + index) * 43}',
          'title': policy == 'special'
              ? 'LOCAL Daily Special'
              : 'LOCAL $policy coupon',
          'imageUrl': null,
          'offerType': policy == 'special' ? 'dailySpecial' : 'coupon',
          'usagePolicy': policy == 'special' ? null : policy,
          'available': true,
          'usageState': 'available',
          'usageRule': policy,
          'redemptionPolicyLabel': policy,
          'availabilityMode': 'specificDays',
          'daysOfWeek': [1, 5],
          'allDay': false,
          'startTime': '11:00',
          'endTime': '14:00',
          'expiresText': '',
          'expiresAtMillis': fixtureNow
              .add(const Duration(days: 5))
              .millisecondsSinceEpoch,
        },
  ];
  restaurant['hasMoreOffers'] = false;
  restaurant['usableOfferCount'] = (restaurant['offers'] as List).length;
  return restaurant;
}

Map<String, dynamic> fixtureMenu(Map<String, dynamic> request) => {
  'schemaVersion': 1,
  'state': 'available',
  'attemptGeneration': request['attemptGeneration'] ?? 0,
  'queryFingerprint':
      request['queryFingerprint'] ??
      websiteResponses['start']['queryFingerprint'],
  'restaurantId':
      request['restaurantId'] ?? fixtureRestaurant()['restaurantId'],
  'menuStyle': 'biteSaver',
  'entries': [
    {
      'kind': 'item',
      'key': 'bsme_${'a' * 43}',
      'name': 'LOCAL Garden Salad',
      'description': 'Synthetic public menu item',
      'price': '\$12',
      'category': 'Lunch',
      'sortOrder': 0,
    },
  ],
  'nextCursor': null,
  'hasMore': false,
};

CustomerBiteScoreReads fixtureScoreReads(String restaurantId) =>
    CustomerBiteScoreReads(
      actorKey: () => 'guest',
      boundary: (name, request) async {
        if (name == 'getCustomerBiteScoreDetail') {
          return {
            'kind': request['kind'],
            'dish': dishProjection(request['id'] as String)
              ..['restaurantSourceDocumentId'] = restaurantId,
            'restaurant': restaurantProjection(restaurantId)
              ..['displayName'] = 'LOCAL BiteScore Cafe',
            'isFavorite': false,
            'canManage': false,
          };
        }
        if (name == 'pageCustomerBiteScoreImages' ||
            name == 'pageCustomerBiteScoreReviews') {
          return {'items': [], 'nextCursor': null};
        }
        throw StateError('Unexpected synthetic read $name');
      },
    );

Widget fixtureDish(BiteScoreHomeEntry entry, bool reviews) =>
    BiteScoreDishDetailScreen(
      entry: entry,
      scrollToReviewSection: reviews,
      testCustomerReads: fixtureScoreReads(entry.restaurant.id),
      testCurrentUserProvider: () => null,
      testSuppressLocalExpertBadgeRecalculation: true,
    );

Widget fixtureNested(CustomerWebsiteDetailRoute d) {
  if (d.isBiteScore &&
      (d.kind == CustomerWebsiteDetailKind.dish ||
          d.kind == CustomerWebsiteDetailKind.reviews)) {
    // Inject the existing no-Auth dish widget at the app's route-builder seam.
    // Production uses CustomerWebsiteDetailScreen and real Firebase auth.
    final entry = CustomerBiteScorePublicData.entry(
      dishProjection(d.detailId!)
        ..['restaurantSourceDocumentId'] = d.restaurantId,
    );
    return fixtureDish(entry, d.kind == CustomerWebsiteDetailKind.reviews);
  }
  return CustomerWebsiteDetailScreen(
    destination: d,
    profileLoader: (id) async => fixtureProfile(id),
    biteScoreReads: fixtureScoreReads(d.restaurantId),
    testOfferBuilder: fixtureCoupon,
  );
}

CustomerBiteSaverPublicProfile fixtureProfile(String catalogId) {
  final result = CustomerBiteSaverPublicProfileResult.fromJson({
    'schemaVersion': 1,
    'kind': 'publicProfile',
    'state': 'available',
    'catalogRestaurantId': catalogId,
    'restaurant': fixtureRestaurant(profile: true),
    'favoriteStates': [],
    'nextCursor': null,
    'hasMore': false,
    'partial': false,
  });
  return CustomerBiteSaverPublicProfile(
    CustomerBiteSaverService(
      transport: (_, request) async => fixtureMenu(request),
    ),
    result,
    () async => (timeZone: 'America/New_York', utcOffsetMinutes: -240),
    (_) async => result,
    (_) => null,
    () => fixtureNow.millisecondsSinceEpoch,
    ChangeNotifier(),
    () {},
  );
}

Widget fixtureCoupon(
  CustomerBiteSaverPublicProfile profile,
  CustomerBiteSaverOffer offer, {
  Future<CustomerBiteSaverRedemptionPresentation> Function(BuildContext)? use,
}) => CouponDetailScreen.fromPublicProfile(
  profile: profile,
  offer: offer,
  useBoundedCoupon:
      use ?? (_) async => throw StateError('BROWSER MUST NEVER USE COUPONS'),
  openBoundedRestaurant: (context) async => Navigator.pop(context),
);

Widget fixtureRestaurantScreen(String catalogId) {
  final profile = fixtureProfile(catalogId);
  return RestaurantProfileScreen.fromPublicProfile(
    profile: profile,
    loadMedia: (_) async => BiteSaverRestaurantMedia(
      restaurantId: profile.restaurant!.restaurantId.value,
      gallery: const [],
      photoBoard: false,
    ),
    openBoundedOffer: (context, offer) async =>
        Navigator.of(context).push<void>(
          MaterialPageRoute(
            settings: RouteSettings(
              name: CustomerWebsiteDetailRoute(
                'coupons',
                catalogId,
                CustomerWebsiteDetailKind.offer,
                detailId: offer.offerId.value,
              ).location,
            ),
            builder: (_) => fixtureCoupon(profile, offer),
          ),
        ),
    openBoundedMenu: (context) async => Navigator.of(context).push<void>(
      MaterialPageRoute(
        settings: RouteSettings(
          name: CustomerWebsiteDetailRoute(
            'coupons',
            catalogId,
            CustomerWebsiteDetailKind.menu,
          ).location,
        ),
        builder: (_) => RestaurantMenuScreen.fromCustomerBiteSaver(
          restaurantName: 'LOCAL FIXTURE Cafe',
          pageLoader: (_) async => CustomerBiteSaverMenuPageResult.fromJson({
            'schemaVersion': 1,
            'state': 'available',
            'attemptGeneration': 0,
            'queryFingerprint': 'a' * 64,
            'restaurantId': profile.restaurant!.restaurantId.value,
            'menuStyle': 'biteSaver',
            'entries': [
              {
                'kind': 'item',
                'key': 'bsme_${'a' * 43}',
                'name': 'LOCAL Garden Salad',
                'description': 'Fixture public menu item',
                'price': '\$12',
                'category': 'Lunch',
                'sortOrder': 0,
              },
            ],
            'nextCursor': null,
            'hasMore': false,
          }),
          openImageViewer: (context, builder) async => Navigator.of(
            context,
          ).push<void>(MaterialPageRoute(builder: builder)),
        ),
      ),
    ),
  );
}

Widget fixtureCustomerDestination(RestaurantCustomerDeepLink link) {
  debugPrint('LOCAL fixture catalog ID: ${link.restaurantId}');
  if (link.isCoupon) return fixtureRestaurantScreen(link.restaurantId);
  final restaurant = CustomerBiteScorePublicData.restaurant(
    restaurantProjection(link.restaurantId)
      ..['displayName'] = 'LOCAL BiteScore Cafe',
  );
  final entry = CustomerBiteScorePublicData.entry(
    dishProjection('local-dish')
      ..['restaurantSourceDocumentId'] = link.restaurantId,
  );
  return BiteScoreRestaurantDishesScreen(
    restaurant: restaurant,
    entries: [entry],
    testCurrentUserProvider: () => null,
    testDishDetailBuilder: fixtureDish,
    testInitialDataLoader: () async =>
        (restaurant: restaurant, entries: [entry], isFavorite: false),
  );
}

const localLocationFixture = bool.fromEnvironment(
  'BITESTAR_LOCAL_LOCATION_FIXTURE',
);
final fixtureProviderCalls = ValueNotifier<int>(0);
final fixtureCriteria = ValueNotifier<String>('No confirmed search center');
void recordFixtureCriteria(String mode, Map<String, Object?> request) {
  if (!localLocationFixture) return;
  final criteria =
      request['criteria'] ?? (request.containsKey('latitude') ? request : null);
  if (criteria is! Map) return;
  final summary = {
    for (final key in [
      'latitude',
      'longitude',
      'radiusMiles',
      'location',
      'center',
    ])
      if (criteria.containsKey(key)) key: criteria[key],
  };
  scheduleMicrotask(
    () => fixtureCriteria.value = '$mode criteria: ${jsonEncode(summary)}',
  );
}

Widget fixtureLocationFrame(Widget child) => !localLocationFixture
    ? child
    : Material(
        child: Column(
          children: [
            const Text(
              'LOCAL MOCK GOOGLE — no provider network or production connection',
              style: TextStyle(fontSize: 12),
            ),
            ValueListenableBuilder<int>(
              valueListenable: fixtureProviderCalls,
              builder: (_, count, _) => Text(
                'Mock Google calls: $count',
                style: const TextStyle(fontSize: 12),
              ),
            ),
            ValueListenableBuilder<String>(
              valueListenable: fixtureCriteria,
              builder: (_, value, _) => Text(
                value,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 11),
              ),
            ),
            Expanded(child: child),
          ],
        ),
      );

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  if (!localLocationFixture) SharedPreferences.setMockInitialValues({});
  if (localLocationFixture) {
    SharedLocationStateService.setBrowserResolverForTesting(
      CustomerBrowserLocationService(
        transport: (request) async {
          final response = await http.post(
            Uri.base.resolve('/__location'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({'data': request}),
          );
          final payload = jsonDecode(response.body) as Map<String, dynamic>;
          fixtureProviderCalls.value = payload['mockProviderCalls'] as int;
          if (payload['error'] != null) {
            final error = payload['error'] as Map<String, dynamic>;
            throw FirebaseFunctionsException(
              code: error['code'] as String,
              message: error['message'] as String,
            );
          }
          return payload['result'];
        },
      ),
    );
  } else {
    SharedLocationStateService.saveTypedLocation(
      latitude: 28.5,
      longitude: -81.3,
      label: 'Orlando, FL',
      searchText: '32801',
    );
  }
  runApp(
    CouponApp(
      testInitializePlatformServices: false,
      testWrapCelebrationHosts: false,
      testCustomerRouteBuilder: fixtureCustomerDestination,
      testWebsiteDetailBuilder: fixtureNested,
      testNavigationBuilder: (link, invite) => Builder(
        builder: (context) {
          final route = ModalRoute.of(context)?.settings.name;
          return fixtureLocationFrame(
            MainNavigationScreen(
              initializePlatformServices: false,
              initialMode: route == '/browse/bitescore'
                  ? AppMode.biteScore
                  : AppMode.biteSaver,
              initialIndex: route == '/account' ? 2 : 0,
              initialCustomerDeepLink: link,
              initialInviteDeepLink: invite,
              initialDeepLinkRouteName: link == null
                  ? null
                  : Uri(
                      pathSegments: ['', 'r', link.side, link.restaurantId],
                    ).toString(),
              testCustomerAuthRealmProvider: () => 'signed:local-fixture',
              testCustomerDeepLinkBuilder: fixtureCustomerDestination,
              testModeHomeBuilder: (mode, _) => mode == AppMode.biteSaver
                  ? FixtureBrowse()
                  : BiteScoreHomeScreen(
                      testRestaurantDetailBuilder: (restaurant, entries) =>
                          fixtureCustomerDestination(
                            RestaurantCustomerDeepLink(
                              side: 'bitescore',
                              restaurantId: restaurant.id,
                            ),
                          ),
                      testSearchApi: FakeSearchApi((name, request) async {
                        recordFixtureCriteria('BiteScore', request);
                        return response(
                          items: name.startsWith('get')
                              ? [dishProjection('local-dish')]
                              : [],
                        );
                      }),
                      testDishDetailBuilder: (_, entry, _) =>
                          fixtureDish(entry, false),
                    ),
              testPagesBuilder: (_) => const [
                SizedBox(),
                SizedBox(),
                Center(child: Text('LOCAL account fixture — no sign-in')),
              ],
            ),
          );
        },
      ),
    ),
  );
}

class FixtureBrowse extends StatefulWidget {
  const FixtureBrowse({super.key, this.usagePreferences});
  final CustomerBiteSaverGuestUsagePreferences? usagePreferences;
  @override
  State<FixtureBrowse> createState() => _FixtureBrowseState();
}

class _FixtureBrowseState extends State<FixtureBrowse> {
  @override
  void initState() {
    super.initState();
    late CustomerBiteSaverSearchCoordinator owner;
    owner = CustomerBiteSaverSearchCoordinator(
      api: CustomerBiteSaverService(
        transport: (name, request) async {
          if (name == CustomerBiteSaverService.startCallableName) {
            recordFixtureCriteria('BiteSaver', request);
            return copyWebsiteData(websiteResponses['start'])
              ..['state'] = 'ready';
          }
          if (name == CustomerBiteSaverService.menuPageCallableName) {
            return fixtureMenu(request);
          }
          if (name == CustomerBiteSaverService.restaurantPageCallableName) {
            return copyWebsiteData(websiteResponses['restaurantPage'])
              ..['restaurants'] = [fixtureRestaurant()];
          }
          if (name == CustomerBiteSaverService.favoriteStatesCallableName) {
            return {
              'schemaVersion': 1,
              'states': [
                for (final id in [
                  ...request['restaurantIds'] as List,
                  ...request['offerIds'] as List,
                ])
                  {'id': id, 'state': 'notFavorite'},
              ],
            };
          }
          throw StateError('Unexpected fixture operation $name');
        },
      ),
      initialAuth: const CustomerBiteSaverAuthSnapshot.signed('local-fixture'),
      authSnapshotProvider: () => owner.auth,
      guestUsageStore: CustomerBiteSaverGuestUsageStore(
        guestDeviceId: 'local-preview',
        preferences: widget.usagePreferences,
        clock: () => fixtureNow,
      ),
      clientInstanceId: 'local-browser-fixture',
      clock: () => fixtureNow,
    );
    coordinator = owner;
  }

  late final CustomerBiteSaverSearchCoordinator coordinator;
  @override
  void dispose() {
    coordinator.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Column(
    children: [
      const Text('LOCAL SYNTHETIC DATA — no production connection'),
      Expanded(
        child: CustomerBiteSaverBrowseScreen(
          coordinator: coordinator,
          disposeCoordinator: false,
          timeContextProvider: () async => const CustomerBiteSaverTimeContext(
            timeZone: 'America/New_York',
            utcOffsetMinutes: -240,
          ),
          onAction: const CustomerBiteSaverBrowseDestinationHandler().call,
        ),
      ),
    ],
  );
}
