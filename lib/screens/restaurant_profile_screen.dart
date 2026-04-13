import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/demo_redemption_store.dart';
import '../models/restaurant.dart';
import '../services/app_error_text.dart';
import '../services/bitescore_sign_in_gate.dart';
import '../services/bitescore_service.dart';
import '../services/restaurant_account_service.dart';
import '../widgets/app_mode_switcher_bar.dart';
import 'coupon_detail_screen.dart';

class RestaurantProfileScreen extends StatefulWidget {
  final Restaurant restaurant;

  const RestaurantProfileScreen({super.key, required this.restaurant});

  @override
  State<RestaurantProfileScreen> createState() =>
      _RestaurantProfileScreenState();
}

class _RestaurantProfileScreenState extends State<RestaurantProfileScreen> {
  bool _isFavoriteRestaurant = false;
  bool _isSavingFavoriteRestaurant = false;
  bool _showAbout = false;
  bool _showHours = false;
  bool _showRestaurantInfo = false;
  late Restaurant _restaurant;

  Restaurant get restaurant => _restaurant;

  @override
  void initState() {
    super.initState();
    _restaurant = widget.restaurant;
    _loadFavoriteState();
    _refreshRestaurantDetails();
  }

  Future<void> _loadFavoriteState() async {
    final isFavorite =
        await BiteScoreService.isSaverRestaurantFavoritedByCurrentUser(
      restaurant,
    );
    if (!mounted) {
      return;
    }

    setState(() {
      _isFavoriteRestaurant = isFavorite;
    });
  }

  bool get hasPhone =>
      restaurant.phone != null && restaurant.phone!.trim().isNotEmpty;

  bool get hasWebsite =>
      restaurant.website != null && restaurant.website!.trim().isNotEmpty;

  bool get hasStreetAddress =>
      restaurant.streetAddress != null &&
      restaurant.streetAddress!.trim().isNotEmpty;

  bool get hasBio =>
      restaurant.bio != null && restaurant.bio!.trim().isNotEmpty;

  List<RestaurantBusinessHours> get weeklyHours => restaurant.businessHours.isEmpty
      ? const []
      : RestaurantBusinessHours.normalizedWeek(restaurant.businessHours);

  Future<void> _refreshRestaurantDetails() async {
    try {
      Restaurant? freshRestaurant;

      final uid = restaurant.uid?.trim();
      if (uid != null && uid.isNotEmpty) {
        final accountData = await RestaurantAccountService.getAccountData(uid);
        if (accountData != null) {
          freshRestaurant = Restaurant.fromFirestore(
            accountData,
            coupons: restaurant.coupons,
          );
        }
      }

      freshRestaurant ??= await _findMatchingApprovedRestaurant();

      if (!mounted || freshRestaurant == null) {
        return;
      }

      setState(() {
        _restaurant = freshRestaurant!;
      });
    } catch (_) {
      return;
    }
  }

  Future<Restaurant?> _findMatchingApprovedRestaurant() async {
    final approvedRestaurants =
        await RestaurantAccountService.loadApprovedRestaurantsWithCoupons();

    for (final candidate in approvedRestaurants) {
      if (_matchesRestaurantIdentity(candidate, restaurant)) {
        return candidate;
      }
    }

    return null;
  }

  bool _matchesRestaurantIdentity(
    Restaurant candidate,
    Restaurant currentRestaurant,
  ) {
    return _normalizeRestaurantIdentity(candidate.name) ==
            _normalizeRestaurantIdentity(currentRestaurant.name) &&
        _normalizeRestaurantIdentity(candidate.city) ==
            _normalizeRestaurantIdentity(currentRestaurant.city) &&
        _normalizeRestaurantIdentity(candidate.zipCode) ==
            _normalizeRestaurantIdentity(currentRestaurant.zipCode) &&
        _normalizeRestaurantIdentity(candidate.streetAddress ?? '') ==
            _normalizeRestaurantIdentity(currentRestaurant.streetAddress ?? '');
  }

  String _normalizeRestaurantIdentity(String value) {
    return value
        .trim()
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9]+'), '');
  }

  Future<void> _showLaunchError(
    BuildContext context,
    String message,
  ) async {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          duration: const Duration(seconds: 3),
        ),
      );
  }

  Future<void> _callRestaurant(BuildContext context) async {
    if (!hasPhone) {
      await _showLaunchError(context, 'No phone number available.');
      return;
    }

    final cleanedPhone = restaurant.phone!.replaceAll(RegExp(r'[^0-9+]'), '');
    final uri = Uri(scheme: 'tel', path: cleanedPhone);

    final launched = await launchUrl(uri);
    if (!launched && context.mounted) {
      await _showLaunchError(
        context,
        'Could not open the phone dialer.',
      );
    }
  }

  Future<void> _openWebsite(BuildContext context) async {
    if (!hasWebsite) {
      await _showLaunchError(context, 'No website available.');
      return;
    }

    final rawWebsite = restaurant.website!.trim();
    final normalizedWebsite = rawWebsite.startsWith('http://') ||
            rawWebsite.startsWith('https://')
        ? rawWebsite
        : 'https://$rawWebsite';

    final uri = Uri.parse(normalizedWebsite);

    final launched = await launchUrl(
      uri,
      mode: LaunchMode.externalApplication,
    );

    if (!launched && context.mounted) {
      await _showLaunchError(
        context,
        'Could not open the website.',
      );
    }
  }

  Future<void> _getDirections(BuildContext context) async {
    final fullAddress = hasStreetAddress
        ? '${restaurant.streetAddress}, ${restaurant.city}, ${restaurant.zipCode}'
        : '${restaurant.city}, ${restaurant.zipCode}';

    final uri = Uri.parse(
      'https://www.google.com/maps/search/?api=1&query=${Uri.encodeComponent(fullAddress)}',
    );

    final launched = await launchUrl(
      uri,
      mode: LaunchMode.externalApplication,
    );

    if (!launched && context.mounted) {
      await _showLaunchError(
        context,
        'Could not open directions.',
      );
    }
  }

  Future<void> _toggleRestaurantFavorite() async {
    final canSave =
        await BiteScoreSignInGate.ensureSignedInForFavorites(context);
    if (!canSave || !mounted || _isSavingFavoriteRestaurant) {
      return;
    }

    final nextIsFavorite = !_isFavoriteRestaurant;

    setState(() {
      _isSavingFavoriteRestaurant = true;
      _isFavoriteRestaurant = nextIsFavorite;
    });

    try {
      await BiteScoreService.setSaverRestaurantFavorite(
        restaurant: restaurant,
        isFavorite: nextIsFavorite,
      );
      if (!mounted) {
        return;
      }
      await _showLaunchError(
        context,
        nextIsFavorite
            ? 'Saved restaurant to your profile.'
            : 'Removed restaurant from your saved list.',
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _isFavoriteRestaurant = !nextIsFavorite;
      });
      await _showLaunchError(
        context,
        AppErrorText.friendly(
          error,
          fallback: 'Could not update this saved restaurant right now.',
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isSavingFavoriteRestaurant = false;
        });
      }
    }
  }

  Widget buildActionButton({
    required IconData icon,
    required String label,
    required bool enabled,
    required VoidCallback onPressed,
  }) {
    return Expanded(
      child: ElevatedButton.icon(
        onPressed: enabled ? onPressed : null,
        icon: Icon(icon, size: 18),
        label: Text(label),
        style: ElevatedButton.styleFrom(
          padding: const EdgeInsets.symmetric(vertical: 14),
        ),
      ),
    );
  }

  Widget _buildExpandableInfoTile({
    required String title,
    required String summary,
    required bool isExpanded,
    required ValueChanged<bool> onExpansionChanged,
    required Widget child,
  }) {
    return Card(
      margin: EdgeInsets.zero,
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          initiallyExpanded: false,
          tilePadding: const EdgeInsets.symmetric(horizontal: 14),
          childrenPadding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
          onExpansionChanged: onExpansionChanged,
          title: Text(
            title,
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w700,
            ),
          ),
          subtitle: Text(
            summary,
            maxLines: isExpanded ? 3 : 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 13,
              color: Colors.black54,
            ),
          ),
          children: [
            Align(
              alignment: Alignment.centerLeft,
              child: child,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHoursSection() {
    final summary = weeklyHours.isEmpty
        ? 'Hours not set'
        : (weeklyHours[DateTime.now().weekday % 7].closed
            ? 'Closed today'
            : 'Open today: '
                '${weeklyHours[DateTime.now().weekday % 7].opensAt} - '
                '${weeklyHours[DateTime.now().weekday % 7].closesAt}');

    return _buildExpandableInfoTile(
      title: 'Hours',
      summary: summary,
      isExpanded: _showHours,
      onExpansionChanged: (expanded) {
        setState(() {
          _showHours = expanded;
        });
      },
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (weeklyHours.isEmpty)
            const Text('Hours not set')
          else
            for (final dayHours in weeklyHours)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(
                  children: [
                    SizedBox(
                      width: 92,
                      child: Text(
                        dayHours.day,
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                    ),
                    Expanded(
                      child: Text(dayHours.summaryLabel),
                    ),
                  ],
                ),
              ),
        ],
      ),
    );
  }

  Widget _buildRestaurantInfoSection() {
    final details = <String>[
      if (hasStreetAddress) restaurant.streetAddress!,
      '${restaurant.city}, ${restaurant.zipCode}',
      if (hasPhone) restaurant.phone!,
      if (hasWebsite) restaurant.website!,
    ];

    return _buildExpandableInfoTile(
      title: 'Restaurant Info',
      summary: details.isEmpty
          ? 'Address and contact details'
          : details.first,
      isExpanded: _showRestaurantInfo,
      onExpansionChanged: (expanded) {
        setState(() {
          _showRestaurantInfo = expanded;
        });
      },
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (hasStreetAddress) ...[
            InkWell(
              onTap: () {
                _getDirections(context);
              },
              borderRadius: BorderRadius.circular(8),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Text(
                  'Address: ${restaurant.streetAddress!}',
                  style: TextStyle(
                    color: Theme.of(context).colorScheme.primary,
                    decoration: TextDecoration.underline,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 6),
          ],
          Text('City: ${restaurant.city}'),
          const SizedBox(height: 6),
          Text('ZIP: ${restaurant.zipCode}'),
          if (hasPhone) ...[
            const SizedBox(height: 6),
            Text('Phone: ${restaurant.phone!}'),
          ],
          if (hasWebsite) ...[
            const SizedBox(height: 6),
            Text('Website: ${restaurant.website!}'),
          ],
        ],
      ),
    );
  }

  Widget? _buildAboutSection() {
    if (!hasBio) {
      return null;
    }

    return _buildExpandableInfoTile(
      title: 'About',
      summary: restaurant.bio!,
      isExpanded: _showAbout,
      onExpansionChanged: (expanded) {
        setState(() {
          _showAbout = expanded;
        });
      },
      child: Text(
        restaurant.bio!,
        style: const TextStyle(fontSize: 14),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<int>(
      valueListenable: DemoRedemptionStore.changes,
      builder: (context, _, __) {
        final now = DateTime.now();
        final activeCoupons = restaurant.coupons
            .where(
              (coupon) =>
                  coupon.isActiveAt(now) &&
                  DemoRedemptionStore.isAvailable(
                    coupon.id,
                    coupon.usageRule,
                  ),
            )
            .toList();

        return Scaffold(
          appBar: AppBar(),
          body: Column(
            children: [
              buildPersistentAppModeSwitcher(context),
              Expanded(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.center,
                              children: [
                                Text(
                                  restaurant.name,
                                  textAlign: TextAlign.center,
                                  style: const TextStyle(
                                    fontSize: 24,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                                const SizedBox(height: 6),
                                Text(
                                  '${restaurant.distance} - ${restaurant.city}, ${restaurant.zipCode}',
                                  textAlign: TextAlign.center,
                                  style: const TextStyle(
                                    fontSize: 14,
                                    color: Colors.black54,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 8),
                          IconButton(
                            tooltip: _isFavoriteRestaurant
                                ? 'Unsave restaurant'
                                : 'Save restaurant',
                            onPressed: _isSavingFavoriteRestaurant
                                ? null
                                : _toggleRestaurantFavorite,
                            icon: Icon(
                              _isFavoriteRestaurant
                                  ? Icons.favorite
                                  : Icons.favorite_border,
                              color: _isFavoriteRestaurant
                                  ? Colors.red.shade400
                                  : null,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 14),
                Row(
                  children: [
                    buildActionButton(
                      icon: Icons.call,
                      label: 'Call',
                      enabled: hasPhone,
                      onPressed: () {
                        _callRestaurant(context);
                      },
                    ),
                    const SizedBox(width: 10),
                    buildActionButton(
                      icon: Icons.language,
                      label: 'Website',
                      enabled: hasWebsite,
                      onPressed: () {
                        _openWebsite(context);
                      },
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    onPressed: () {
                      _getDirections(context);
                    },
                    icon: const Icon(Icons.directions),
                    label: const Text('Get Directions'),
                    style: ElevatedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                  ),
                ),
                      const SizedBox(height: 12),
                      _buildHoursSection(),
                      if (hasBio) ...[
                        const SizedBox(height: 10),
                        _buildAboutSection()!,
                      ],
                      const SizedBox(height: 10),
                      _buildRestaurantInfoSection(),
                      const SizedBox(height: 20),
                const Text(
                  'Available Coupons',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 12),
                if (activeCoupons.isEmpty)
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: Colors.grey.shade100,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Text('No available coupons right now.'),
                  )
                else
                  Column(
                    children: activeCoupons.map((coupon) {
                      final isProximity = coupon.isProximityOnly;
                      final scheduleText = coupon.shortExpiresLabel;

                      return Card(
                        margin: const EdgeInsets.only(bottom: 10),
                        child: ListTile(
                          title: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              if (isProximity)
                                Container(
                                  margin: const EdgeInsets.only(bottom: 6),
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 8,
                                    vertical: 4,
                                  ),
                                  decoration: BoxDecoration(
                                    color: Colors.deepOrange,
                                    borderRadius: BorderRadius.circular(999),
                                  ),
                                  child: const Text(
                                    'Proximity Deal',
                                    style: TextStyle(
                                      color: Colors.white,
                                      fontSize: 11,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                ),
                              Text(
                                coupon.title,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ],
                          ),
                          subtitle: Text(
                            isProximity
                                ? '$scheduleText - ${coupon.usageRule} - Unlocked nearby'
                                : (coupon.couponCode == null
                                    ? '$scheduleText - ${coupon.usageRule}'
                                    : '$scheduleText - ${coupon.usageRule} - Code: ${coupon.couponCode}'),
                          ),
                          trailing: const Icon(Icons.chevron_right),
                          onTap: () {
                            Navigator.push(
                              context,
                              MaterialPageRoute(
                                builder: (context) =>
                                    CouponDetailScreen(coupon: coupon),
                              ),
                            );
                          },
                        ),
                      );
                    }).toList(),
                  ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
