import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/main.dart';
import 'package:coupon_app/models/bitesaver_restaurant_media.dart';
import 'package:coupon_app/models/pagination/paged_models.dart';
import 'package:coupon_app/screens/home_screen.dart';
import 'package:coupon_app/screens/bitescore_home_screen.dart';
import 'package:coupon_app/screens/restaurant_profile_screen.dart';
import 'package:coupon_app/screens/customer_profile_screen.dart';
import 'package:coupon_app/screens/restaurant_owner_hub_screen.dart';
import 'package:coupon_app/screens/bitesaver_photo_viewer.dart';
import 'package:coupon_app/services/bitescore_service.dart';
import 'package:coupon_app/services/paged_query_controller.dart';
import 'package:coupon_app/widgets/paged_directory_view.dart';
import 'package:flutter/material.dart';
import '../visual_polish_fixture/main.dart'
    show initializeVisualFixture, visualDish, visualRestaurants;
import '../detail_route_history_fixture/main.dart'
    show historyRestaurant, historyDish, HistoryUser;

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  initializeVisualFixture();
  runApp(scrollHost(const OverscrollShowcase()));
}

Widget scrollHost(Widget child) => CouponApp(
  testWrapCelebrationHosts: false,
  testInitializePlatformServices: false,
  testNavigationBuilder: (_, _) => SafeArea(child: child),
);
final scrollUser = HistoryUser('local-scroll-user');
final scrollProfile = BiteScoreUserProfileData(
  publicDisplayName: 'Local Scroll User',
  chosenUsername: 'local_scroll',
  fallbackUsername: 'local_scroll',
  favoriteRestaurants: List.generate(12, (_) => historyDish.restaurant),
  favoriteSaverRestaurants: const [],
  favoriteDishEntries: [historyDish],
  favoriteCoupons: const [],
  reviews: const [],
  badgeLabel: 'Contributor',
  reviewCount: 0,
  helpfulVotesReceived: 0,
  accountAgeDays: 90,
  moderationFlagCount: 0,
  contributionPoints: 0,
);
Widget scrollMyProfile({Future<BiteScoreUserProfileData> Function()? load}) =>
    CustomerProfileScreen(
      currentUser: scrollUser,
      testCurrentUserProvider: () => scrollUser,
      testProfileLoader: (_) => load?.call() ?? Future.value(scrollProfile),
      testLocalExpertBadgesLoader: (_) async => [],
    );
final scrollCases = <String, Widget Function()>{
  'BiteSaver Home': () => HomeScreen(
    approvedAccountsStream:
        const Stream<QuerySnapshot<Map<String, dynamic>>>.empty(),
    restaurantLoader: () async => visualRestaurants,
    initializeFirebaseBackedState: false,
  ),
  'BiteScore Home': () =>
      BiteScoreHomeScreen(testHomeEntriesLoader: () async => [historyDish]),
  'Restaurant detail': () => RestaurantProfileScreen(
    restaurant: historyRestaurant,
    loadFavorite: (_) async => false,
    refreshRestaurant: (_) async => null,
    loadProjectionData: (_) async => null,
    loadMedia: (id) async => BiteSaverRestaurantMedia(
      restaurantId: id,
      gallery: const [],
      photoBoard: false,
    ),
  ),
  'Dish detail': visualDish,
  'My Profile and Saved': scrollMyProfile,
  'Restaurant Owner Hub': () =>
      Scaffold(body: RestaurantOwnerHubScreen(currentUser: scrollUser)),
  'Admin paged content': () => const LocalPagedScroll(),
  'Gallery': () => const BiteSaverPhotoViewer(
    title: 'Local gallery',
    imageUrl: 'https://example.test/local-a.png',
    additionalImageUrls: ['https://example.test/local-b.png'],
  ),
  'Refresh short list': () => const LocalRefreshScroll(short: true),
  'Refresh long list': () => const LocalRefreshScroll(short: false),
};

class OverscrollShowcase extends StatelessWidget {
  const OverscrollShowcase({super.key});
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Local scroll qualification')),
    body: ListView(
      children: [
        const ListTile(title: Text('SYNTHETIC DATA • no production writes')),
        for (final item in scrollCases.entries)
          ListTile(
            title: Text(item.key),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => SafeArea(child: item.value()),
              ),
            ),
          ),
      ],
    ),
  );
}

class LocalPagedScroll extends StatefulWidget {
  const LocalPagedScroll({super.key});
  @override
  State<LocalPagedScroll> createState() => LocalPagedScrollState();
}

class LocalPagedScrollState extends State<LocalPagedScroll> {
  int loads = 0;
  late final controller = PagedQueryController<String>(
    criteria: const {},
    pageLoader: (request) async {
      loads++;
      final page = request.cursor == null ? 1 : 2;
      return PagedResponse<String>(
        items: List.generate(30, (i) => 'Local admin row ${page * 100 + i}'),
        pageSize: 50,
        hasNext: page == 1,
        hasPrevious: page == 2,
        nextCursor: page == 1 ? 'next' : null,
        previousCursor: page == 2 ? 'previous' : null,
        pageNumber: PageNumberState(page),
        total: PagedTotal.exact(60),
        queryFingerprint: 'c' * 64,
        snapshotTimestampMs: 1786185600000,
        capabilities: PageCapabilities(
          first: page > 1,
          previous: page > 1,
          numberedVisitedPages: true,
          next: page == 1,
          last: page == 1,
        ),
      );
    },
  );
  @override
  void initState() {
    super.initState();
    controller.loadInitial();
  }

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Local Admin paged component')),
    body: PagedDirectoryView<String>(
      controller: controller,
      onRefresh: controller.refreshFirstPage,
      itemBuilder: (_, item, _) => ListTile(title: Text(item)),
    ),
  );
}

class LocalRefreshScroll extends StatefulWidget {
  const LocalRefreshScroll({super.key, required this.short});
  final bool short;
  @override
  State<LocalRefreshScroll> createState() => LocalRefreshScrollState();
}

class LocalRefreshScrollState extends State<LocalRefreshScroll> {
  int refreshes = 0;
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Local refresh')),
    body: RefreshIndicator(
      onRefresh: () async {
        setState(() => refreshes++);
      },
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          Text('Refreshes: $refreshes'),
          for (var i = 0; i < (widget.short ? 1 : 40); i++)
            ListTile(title: Text('Local row $i')),
        ],
      ),
    ),
  );
}
