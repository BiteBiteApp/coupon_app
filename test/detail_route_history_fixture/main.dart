// Synthetic Android/widget navigation fixture. No Firebase initialization.
// ignore_for_file: invalid_use_of_visible_for_testing_member
import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/main.dart' show CouponApp;
import 'package:coupon_app/models/bitesaver_restaurant_media.dart';
import 'package:coupon_app/models/bitescore_dish.dart';
import 'package:coupon_app/models/bitescore_restaurant.dart';
import 'package:coupon_app/models/coupon.dart';
import 'package:coupon_app/models/dish_rating_aggregate.dart';
import 'package:coupon_app/models/restaurant.dart';
import 'package:coupon_app/screens/bitescore_dish_detail_screen.dart';
import 'package:coupon_app/screens/bitescore_restaurant_dishes_screen.dart';
import 'package:coupon_app/screens/coupon_detail_screen.dart';
import 'package:coupon_app/screens/main_navigation_screen.dart';
import 'package:coupon_app/screens/restaurant_profile_screen.dart';
import 'package:coupon_app/services/app_mode_state_service.dart';
import 'package:coupon_app/services/bitescore_service.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SharedPreferences.setMockInitialValues({});
  runApp(const DetailHistoryFixture());
}

class DetailHistoryFixture extends StatefulWidget {
  const DetailHistoryFixture({super.key, this.initialMode = AppMode.biteSaver});
  final AppMode initialMode;
  @override
  State<DetailHistoryFixture> createState() => DetailHistoryFixtureState();
}

class DetailHistoryFixtureState extends State<DetailHistoryFixture> {
  final realms = StreamController<String>.broadcast(sync: true);
  User? user = HistoryUser('owner-a');
  void changeUser(String? uid) {
    user = uid == null ? null : HistoryUser(uid);
    realms.add(mainNavigationAuthRealmForUser(user));
  }

  @override
  void dispose() {
    realms.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => CouponApp(
    testWrapCelebrationHosts: false,
    testInitializePlatformServices: false,
    testNavigationBuilder: (_, _) => MainNavigationScreen(
      initialMode: widget.initialMode,
      initializePlatformServices: false,
      testCustomerAuthRealmProvider: () => mainNavigationAuthRealmForUser(user),
      testCustomerAuthRealmChanges: realms.stream,
      testPagesBuilder: (mode) => [
        HistoryHome(mode: mode, owner: this),
        const Center(child: Text('Local Restaurant Hub')),
        const Center(child: Text('Local My Profile')),
      ],
    ),
  );
}

class HistoryHome extends StatelessWidget {
  const HistoryHome({super.key, required this.mode, required this.owner});
  final AppMode mode;
  final DetailHistoryFixtureState owner;
  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(24),
    children: [
      Text('${mode.name} local Home'),
      const Text('LOCAL FIXTURE • no production connection'),
      FilledButton(
        onPressed: () => Navigator.of(context).push<void>(
          MaterialPageRoute(
            builder: (_) => RestaurantProfileScreen(
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
          ),
        ),
        child: const Text('Open restaurant detail'),
      ),
      FilledButton(
        onPressed: () => Navigator.of(context).push<void>(
          MaterialPageRoute(
            builder: (_) => BiteScoreDishDetailScreen(
              entry: historyDish,
              testInitialLoader: () async {},
              testCurrentUserProvider: () => owner.user,
            ),
          ),
        ),
        child: const Text('Open dish detail'),
      ),
      FilledButton(
        onPressed: () => Navigator.of(context).push<void>(
          MaterialPageRoute(
            builder: (_) => BiteScoreRestaurantDishesScreen(
              restaurant: historyDish.restaurant,
              entries: [historyDish],
              testCurrentUserProvider: () => owner.user,
              testInitialDataLoader: () async => (
                restaurant: historyDish.restaurant,
                entries: [historyDish],
                isFavorite: false,
              ),
            ),
          ),
        ),
        child: const Text('Open Score restaurant detail'),
      ),
      FilledButton(
        onPressed: () => pushMainNavigationPrivateRoute<void>(
          context,
          parentBinding: null,
          originatingAuthRealm: mainNavigationAuthRealmForUser(owner.user),
          builder: (_) => CouponDetailScreen(
            coupon: const Coupon(
              id: 'private-fixture-coupon',
              restaurant: 'Local Cafe',
              title: 'Private route fixture',
              distance: '',
              usageRule: 'Unlimited',
            ),
            loadFavoriteState: (_) async => false,
            loadCustomerVisibility: (_, _) async => true,
            initializeRedemptionStore: () async {},
          ),
        ),
        child: const Text('Open protected coupon detail'),
      ),
      OutlinedButton(
        onPressed: () => owner.changeUser(null),
        child: const Text('Local sign out'),
      ),
      OutlinedButton(
        onPressed: () => owner.changeUser('owner-b'),
        child: const Text('Local switch account'),
      ),
      OutlinedButton(
        onPressed: () => showDialog<void>(
          context: context,
          builder: (_) => const AlertDialog(title: Text('Local Back dialog')),
        ),
        child: const Text('Open local dialog'),
      ),
    ],
  );
}

const historyRestaurant = Restaurant(
  documentId: 'history-restaurant',
  name: 'History Cafe',
  distance: '',
  city: 'Ocala',
  state: 'FL',
  zipCode: '34470',
  latitude: 29.1872,
  longitude: -82.1401,
  coupons: [
    Coupon(
      id: 'history-coupon',
      restaurant: 'History Cafe',
      title: 'History offer',
      distance: '',
      usageRule: 'Unlimited',
    ),
  ],
);
final historyDish = BiteScoreHomeEntry(
  dish: const BitescoreDish(
    id: 'history-dish',
    restaurantId: 'history-score-restaurant',
    restaurantName: 'History Score Cafe',
    name: 'History Dish',
    normalizedName: 'history dish',
    category: 'Test',
  ),
  restaurant: const BitescoreRestaurant(
    id: 'history-score-restaurant',
    name: 'History Score Cafe',
    normalizedName: 'history score cafe',
    address: '1 Test Way',
    city: 'Ocala',
    state: 'FL',
    zipCode: '34470',
    location: GeoPoint(29.1872, -82.1401),
    restaurantWriteRevision: 0,
  ),
  aggregate: const DishRatingAggregate(
    dishId: 'history-dish',
    restaurantId: 'history-score-restaurant',
    overallBiteScore: 80,
    ratingCount: 1,
  ),
);

class HistoryUser implements User {
  HistoryUser(this.uid);
  @override
  final String uid;
  @override
  bool get isAnonymous => false;
  @override
  bool get emailVerified => true;
  @override
  String? get email => 'fixture@example.test';
  @override
  List<UserInfo> get providerData => [];
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
