import 'package:flutter/material.dart';

import '../models/coupon.dart';
import '../models/demo_redemption_store.dart';
import '../models/restaurant.dart';
import 'coupon_detail_screen.dart';

class NearMeScreen extends StatefulWidget {
  const NearMeScreen({super.key});

  @override
  State<NearMeScreen> createState() => _NearMeScreenState();
}

class _NearMeScreenState extends State<NearMeScreen> {
  final List<Restaurant> nearbyRestaurants = const [
    Restaurant(
      name: 'Taco Town',
      distance: '0.2 miles away',
      city: 'Lecanto',
      zipCode: '34461',
      coupons: [
        Coupon(
          id: 'taco_town_1',
          restaurant: 'Taco Town',
          title: 'Free Drink with 2 Tacos',
          distance: '0.2 miles away',
          expires: 'Expires today',
          usageRule: 'Once per day',
        ),
      ],
    ),
    Restaurant(
      name: 'Pasta Place',
      distance: '0.5 miles away',
      city: 'Inverness',
      zipCode: '34450',
      coupons: [
        Coupon(
          id: 'pasta_place_1',
          restaurant: 'Pasta Place',
          title: '20% Off Any Pasta Dish',
          distance: '0.5 miles away',
          expires: 'Expires tomorrow',
          usageRule: 'Once per customer',
          couponCode: 'PASTA20',
        ),
      ],
    ),
    Restaurant(
      name: 'Grill House',
      distance: '0.8 miles away',
      city: 'Crystal River',
      zipCode: '34429',
      coupons: [
        Coupon(
          id: 'grill_house_1',
          restaurant: 'Grill House',
          title: 'Free Appetizer with Entree',
          distance: '0.8 miles away',
          expires: 'Expires this weekend',
          usageRule: 'Unlimited',
          couponCode: 'APPFREE',
        ),
      ],
    ),
  ];

  @override
  void initState() {
    super.initState();
    DemoRedemptionStore.ensureInitialized();
  }

  List<Restaurant> filteredNearbyRestaurants() {
    final now = DateTime.now();

    return nearbyRestaurants.map((restaurant) {
      final availableCoupons = restaurant.coupons.where((coupon) {
        return coupon.isActiveAt(now) &&
            DemoRedemptionStore.isAvailable(coupon.id, coupon.usageRule);
      }).toList();

      return Restaurant(
        name: restaurant.name,
        distance: restaurant.distance,
        city: restaurant.city,
        zipCode: restaurant.zipCode,
        coupons: availableCoupons,
      );
    }).where((restaurant) => restaurant.coupons.isNotEmpty).toList();
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<int>(
      valueListenable: DemoRedemptionStore.changes,
      builder: (context, _, __) {
        final restaurants = filteredNearbyRestaurants();

        return Scaffold(
          appBar: AppBar(
            title: const Text('Near Me'),
            centerTitle: true,
          ),
          body: Column(
            children: [
              Container(
                width: double.infinity,
                margin: const EdgeInsets.all(16),
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.orange.shade50,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.orange.shade200),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.location_on, color: Colors.orange),
                    SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Showing restaurants and coupons near your current location',
                        style: TextStyle(fontSize: 16),
                      ),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: restaurants.isEmpty
                    ? const Center(
                        child: Text(
                          'No available nearby coupons right now.',
                          style: TextStyle(fontSize: 16),
                          textAlign: TextAlign.center,
                        ),
                      )
                    : ListView.builder(
                        itemCount: restaurants.length,
                        itemBuilder: (context, index) {
                          final restaurant = restaurants[index];
                          return Card(
                            margin: const EdgeInsets.symmetric(
                              horizontal: 16,
                              vertical: 8,
                            ),
                            child: Padding(
                              padding: const EdgeInsets.all(16),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    restaurant.name,
                                    style: const TextStyle(
                                      fontSize: 18,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    '${restaurant.distance} - ${restaurant.city}, ${restaurant.zipCode}',
                                    style: const TextStyle(
                                      color: Colors.black54,
                                    ),
                                  ),
                                  const SizedBox(height: 12),
                                  ...restaurant.coupons.map(
                                    (coupon) => Card(
                                      color: Colors.orange.shade50,
                                      margin: const EdgeInsets.only(bottom: 8),
                                      child: ListTile(
                                        title: Text(
                                          coupon.title,
                                          style: const TextStyle(
                                            fontWeight: FontWeight.w600,
                                          ),
                                        ),
                                        subtitle: Text(
                                          coupon.couponCode == null
                                              ? '${coupon.shortExpiresLabel} - ${coupon.usageRule}'
                                              : '${coupon.shortExpiresLabel} - ${coupon.usageRule} - Code: ${coupon.couponCode}',
                                        ),
                                        trailing:
                                            const Icon(Icons.chevron_right),
                                        onTap: () async {
                                          await Navigator.push(
                                            context,
                                            MaterialPageRoute(
                                              builder: (context) =>
                                                  CouponDetailScreen(
                                                    coupon: coupon,
                                                  ),
                                            ),
                                          );
                                          if (mounted) {
                                            setState(() {});
                                          }
                                        },
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
              ),
            ],
          ),
        );
      },
    );
  }
}
