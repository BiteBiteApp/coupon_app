import 'package:flutter/material.dart';

import '../models/bitescore_restaurant.dart';
import '../models/coupon.dart';
import '../models/restaurant.dart';
import '../services/app_error_text.dart';
import '../services/bitescore_service.dart';
import 'bitescore_dish_detail_screen.dart';
import 'bitescore_restaurant_dishes_screen.dart';
import 'coupon_detail_screen.dart';
import 'restaurant_profile_screen.dart';

enum _SavedSection {
  restaurants,
  dishes,
  coupons,
}

class CustomerProfileScreen extends StatefulWidget {
  const CustomerProfileScreen({super.key});

  @override
  State<CustomerProfileScreen> createState() => _CustomerProfileScreenState();
}

class _CustomerProfileScreenState extends State<CustomerProfileScreen> {
  late Future<BiteScoreUserProfileData> _profileFuture;
  final TextEditingController _usernameController = TextEditingController();
  bool _hasSeededUsernameField = false;
  bool _isCheckingUsername = false;
  bool _isSavingUsername = false;
  bool _isEditingUsername = false;
  String? _usernameStatusMessage;
  bool? _isUsernameAvailable;
  _SavedSection _savedSection = _SavedSection.restaurants;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  void _refresh() {
    _profileFuture = BiteScoreService.loadCurrentUserProfileData();
  }

  @override
  void dispose() {
    _usernameController.dispose();
    super.dispose();
  }

  void _showSnackBar(String message) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          duration: const Duration(seconds: 3),
        ),
      );
  }

  Future<void> _checkUsernameAvailability() async {
    if (_isCheckingUsername || _isSavingUsername) {
      return;
    }

    setState(() {
      _isCheckingUsername = true;
      _usernameStatusMessage = null;
      _isUsernameAvailable = null;
    });

    try {
      final available = await BiteScoreService.isPublicUsernameAvailable(
        _usernameController.text,
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _isUsernameAvailable = available;
        _usernameStatusMessage = available
            ? 'That username is available.'
            : 'That username is already taken.';
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _isUsernameAvailable = false;
        _usernameStatusMessage = AppErrorText.friendly(
          error,
          fallback: 'Could not check that username right now.',
        );
      });
    } finally {
      if (mounted) {
        setState(() {
          _isCheckingUsername = false;
        });
      }
    }
  }

  Future<void> _saveUsername() async {
    if (_isCheckingUsername || _isSavingUsername) {
      return;
    }

    setState(() {
      _isSavingUsername = true;
      _usernameStatusMessage = null;
      _isUsernameAvailable = null;
    });

    try {
      await BiteScoreService.saveCurrentUserPublicUsername(
        _usernameController.text,
      );
      if (!mounted) {
        return;
      }
      _showSnackBar('Your username was updated.');
      setState(() {
        _hasSeededUsernameField = false;
        _isEditingUsername = false;
        _usernameStatusMessage = 'Saved successfully.';
        _isUsernameAvailable = true;
        _refresh();
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _isUsernameAvailable = false;
        _usernameStatusMessage = AppErrorText.friendly(
          error,
          fallback: 'Could not save that username right now.',
        );
      });
    } finally {
      if (mounted) {
        setState(() {
          _isSavingUsername = false;
        });
      }
    }
  }

  Future<void> _openRestaurant(BitescoreRestaurant restaurant) async {
    try {
      final entries =
          await BiteScoreService.loadEntriesForRestaurant(restaurant);
      if (!mounted) {
        return;
      }

      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => BiteScoreRestaurantDishesScreen(
            restaurant: restaurant,
            entries: entries,
          ),
        ),
      );

      if (mounted) {
        setState(_refresh);
      }
    } catch (error) {
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not open that restaurant right now.',
        ),
      );
    }
  }

  Future<void> _openDish(BiteScoreHomeEntry entry) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => BiteScoreDishDetailScreen(entry: entry),
      ),
    );

    if (mounted) {
      setState(_refresh);
    }
  }

  Future<void> _openSaverRestaurant(Restaurant restaurant) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => RestaurantProfileScreen(restaurant: restaurant),
      ),
    );

    if (mounted) {
      setState(_refresh);
    }
  }

  Future<void> _openCoupon(Coupon coupon) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => CouponDetailScreen(coupon: coupon),
      ),
    );

    if (mounted) {
      setState(_refresh);
    }
  }

  Future<void> _removeSavedRestaurant(BitescoreRestaurant restaurant) async {
    try {
      await BiteScoreService.setRestaurantFavorite(
        restaurant: restaurant,
        isFavorite: false,
      );
      if (!mounted) {
        return;
      }
      _showSnackBar('Removed restaurant from Saved.');
      setState(_refresh);
    } catch (error) {
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not update your saved restaurants right now.',
        ),
      );
    }
  }

  Future<void> _removeSavedSaverRestaurant(Restaurant restaurant) async {
    try {
      await BiteScoreService.setSaverRestaurantFavorite(
        restaurant: restaurant,
        isFavorite: false,
      );
      if (!mounted) {
        return;
      }
      _showSnackBar('Removed restaurant from Saved.');
      setState(_refresh);
    } catch (error) {
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not update your saved restaurants right now.',
        ),
      );
    }
  }

  Future<void> _removeSavedDish(BiteScoreHomeEntry entry) async {
    try {
      await BiteScoreService.setDishFavorite(
        dish: entry.dish,
        restaurant: entry.restaurant,
        isFavorite: false,
      );
      if (!mounted) {
        return;
      }
      _showSnackBar('Removed dish from Saved.');
      setState(_refresh);
    } catch (error) {
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not update your saved dishes right now.',
        ),
      );
    }
  }

  Future<void> _removeSavedCoupon(Coupon coupon) async {
    try {
      await BiteScoreService.setCouponFavorite(
        coupon: coupon,
        isFavorite: false,
      );
      if (!mounted) {
        return;
      }
      _showSnackBar('Removed coupon from Saved.');
      setState(_refresh);
    } catch (error) {
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not update your saved coupons right now.',
        ),
      );
    }
  }

  String _scoreLabel(double value) {
    if (value <= 0) {
      return '--';
    }
    return value.toStringAsFixed(0);
  }

  String _dateLabel(DateTime? value) {
    if (value == null) {
      return 'Recent';
    }

    final local = value.toLocal();
    final months = <String>[
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return '${months[local.month - 1]} ${local.day}, ${local.year}';
  }

  Widget _buildSectionHeader(String title, IconData icon) {
    return Row(
      children: [
        Icon(
          icon,
          size: 20,
          color: Theme.of(context).colorScheme.primary,
        ),
        const SizedBox(width: 8),
        Text(
          title,
          style: const TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w800,
          ),
        ),
      ],
    );
  }

  Widget _buildEmptyCard(String message) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Text(
          message,
          style: const TextStyle(color: Colors.black54),
        ),
      ),
    );
  }

  Widget _buildSavedSectionTabs() {
    return SegmentedButton<_SavedSection>(
      segments: const [
        ButtonSegment<_SavedSection>(
          value: _SavedSection.restaurants,
          label: Text('Restaurants'),
          icon: Icon(Icons.storefront_outlined),
        ),
        ButtonSegment<_SavedSection>(
          value: _SavedSection.dishes,
          label: Text('Dishes'),
          icon: Icon(Icons.restaurant_menu_outlined),
        ),
        ButtonSegment<_SavedSection>(
          value: _SavedSection.coupons,
          label: Text('Coupons'),
          icon: Icon(Icons.local_offer_outlined),
        ),
      ],
      selected: <_SavedSection>{_savedSection},
      showSelectedIcon: false,
      style: SegmentedButton.styleFrom(
        visualDensity: VisualDensity.compact,
        textStyle: const TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w700,
        ),
      ),
      onSelectionChanged: (selection) {
        setState(() {
          _savedSection = selection.first;
        });
      },
    );
  }

  Widget _buildSavedRestaurantCard(BitescoreRestaurant restaurant) {
    return Card(
      margin: const EdgeInsets.only(top: 12),
      child: ListTile(
        dense: true,
        contentPadding: const EdgeInsets.fromLTRB(14, 6, 6, 6),
        leading: Icon(
          Icons.favorite,
          color: Colors.red.shade400,
          size: 22,
        ),
        title: Text(
          restaurant.name,
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        subtitle: Text(
          '${restaurant.city}, ${restaurant.state} ${restaurant.zipCode}'.trim(),
        ),
        trailing: Wrap(
          children: [
            IconButton(
              tooltip: 'Remove from Saved',
              onPressed: () => _removeSavedRestaurant(restaurant),
              icon: Icon(
                Icons.favorite,
                color: Colors.red.shade400,
                size: 20,
              ),
            ),
            const Icon(Icons.chevron_right),
          ],
        ),
        onTap: () => _openRestaurant(restaurant),
      ),
    );
  }

  Widget _buildSavedSaverRestaurantCard(Restaurant restaurant) {
    return Card(
      margin: const EdgeInsets.only(top: 12),
      child: ListTile(
        dense: true,
        contentPadding: const EdgeInsets.fromLTRB(14, 6, 6, 6),
        leading: Icon(
          Icons.favorite,
          color: Colors.red.shade400,
          size: 22,
        ),
        title: Text(
          restaurant.name,
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        subtitle: Text(
          '${restaurant.city}, ${restaurant.zipCode}'.trim(),
        ),
        trailing: Wrap(
          children: [
            IconButton(
              tooltip: 'Remove from Saved',
              onPressed: () => _removeSavedSaverRestaurant(restaurant),
              icon: Icon(
                Icons.favorite,
                color: Colors.red.shade400,
                size: 20,
              ),
            ),
            const Icon(Icons.chevron_right),
          ],
        ),
        onTap: () => _openSaverRestaurant(restaurant),
      ),
    );
  }

  Widget _buildSavedDishCard(BiteScoreHomeEntry entry) {
    final ratingCount = entry.aggregate.ratingCount;
    final scoreLabel = _scoreLabel(entry.aggregate.overallBiteScore);

    return Card(
      margin: const EdgeInsets.only(top: 12),
      child: ListTile(
        dense: true,
        contentPadding: const EdgeInsets.fromLTRB(14, 8, 6, 8),
        leading: Icon(
          Icons.favorite,
          color: Colors.red.shade400,
          size: 22,
        ),
        title: Text(
          entry.dish.name,
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        subtitle: Text(entry.restaurant.name),
        trailing: Wrap(
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Padding(
              padding: const EdgeInsets.only(right: 4),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    scoreLabel,
                    style: TextStyle(
                      color: Colors.red.shade700,
                      fontSize: 18,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  Text(
                    '$ratingCount ratings',
                    style: const TextStyle(
                      fontSize: 11,
                      color: Colors.black54,
                    ),
                  ),
                ],
              ),
            ),
            IconButton(
              tooltip: 'Remove from Saved',
              onPressed: () => _removeSavedDish(entry),
              icon: Icon(
                Icons.favorite,
                color: Colors.red.shade400,
                size: 20,
              ),
            ),
            const Icon(Icons.chevron_right),
          ],
        ),
        onTap: () => _openDish(entry),
      ),
    );
  }

  Widget _buildSavedCouponCard(Coupon coupon) {
    return Card(
      margin: const EdgeInsets.only(top: 12),
      child: ListTile(
        leading: Icon(
          Icons.favorite,
          color: Colors.red.shade400,
        ),
        title: Text(
          coupon.title,
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        subtitle: Text('${coupon.restaurant} • ${coupon.expires}'),
        trailing: const Icon(Icons.chevron_right),
        onTap: () => _openCoupon(coupon),
      ),
    );
  }

  Widget _buildSavedCouponTile(Coupon coupon) {
    return Card(
      margin: const EdgeInsets.only(top: 12),
      child: ListTile(
        dense: true,
        contentPadding: const EdgeInsets.fromLTRB(14, 6, 6, 6),
        leading: Icon(
          Icons.favorite,
          color: Colors.red.shade400,
          size: 22,
        ),
        title: Text(
          coupon.title,
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        subtitle: Text('${coupon.restaurant} - ${coupon.expires}'),
        trailing: Wrap(
          children: [
            IconButton(
              tooltip: 'Remove from Saved',
              onPressed: () => _removeSavedCoupon(coupon),
              icon: Icon(
                Icons.favorite,
                color: Colors.red.shade400,
                size: 20,
              ),
            ),
            const Icon(Icons.chevron_right),
          ],
        ),
        onTap: () => _openCoupon(coupon),
      ),
    );
  }

  List<Widget> _buildSavedSectionCards(BiteScoreUserProfileData profileData) {
    switch (_savedSection) {
      case _SavedSection.restaurants:
        if (profileData.favoriteRestaurants.isEmpty &&
            profileData.favoriteSaverRestaurants.isEmpty) {
          return <Widget>[
            _buildEmptyCard(
              'No saved restaurants yet. Tap a heart on a restaurant page to save one.',
            ),
          ];
        }
        return <Widget>[
          ...profileData.favoriteSaverRestaurants.map(
            _buildSavedSaverRestaurantCard,
          ),
          ...profileData.favoriteRestaurants.map(_buildSavedRestaurantCard),
        ];
      case _SavedSection.dishes:
        if (profileData.favoriteDishEntries.isEmpty) {
          return <Widget>[
            _buildEmptyCard(
              'No saved dishes yet. Tap a heart on a dish page to save one.',
            ),
          ];
        }
        return profileData.favoriteDishEntries
            .map(_buildSavedDishCard)
            .toList();
      case _SavedSection.coupons:
        if (profileData.favoriteCoupons.isEmpty) {
          return <Widget>[
            _buildEmptyCard(
              'No saved coupons yet. Tap a heart on a coupon page to save one.',
            ),
          ];
        }
        return profileData.favoriteCoupons
            .map(_buildSavedCouponTile)
            .toList();
    }
  }

  Widget _buildReviewCard(BiteScoreUserReviewEntry entry) {
    final headline = entry.review.headline?.trim();
    final notes = entry.review.notes?.trim();

    return Card(
      margin: const EdgeInsets.only(top: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    entry.dishName,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Text(
                  _scoreLabel(entry.review.overallBiteScore),
                  style: TextStyle(
                    color: Colors.red.shade700,
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              entry.restaurantName,
              style: const TextStyle(
                color: Colors.black54,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            if (headline != null && headline.isNotEmpty)
              Text(
                headline,
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
            if (headline != null &&
                headline.isNotEmpty &&
                notes != null &&
                notes.isNotEmpty)
              const SizedBox(height: 4),
            if (notes != null && notes.isNotEmpty)
              Text(notes),
            const SizedBox(height: 10),
            Text(
              _dateLabel(entry.review.createdAt),
              style: const TextStyle(
                fontSize: 12,
                color: Colors.black54,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildProfileBody(BiteScoreUserProfileData profileData) {
    if (!_hasSeededUsernameField) {
      _usernameController.text = profileData.chosenUsername ?? '';
      _hasSeededUsernameField = true;
    }

    return RefreshIndicator(
      onRefresh: () async {
        setState(_refresh);
        await _profileFuture;
      },
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _buildPublicUsernameCard(profileData),
          const SizedBox(height: 16),
          _buildBadgeCard(profileData),
          const SizedBox(height: 24),
          _buildSectionHeader('Saved', Icons.favorite_border),
          const SizedBox(height: 12),
          _buildSavedSectionTabs(),
          ..._buildSavedSectionCards(profileData),
          const SizedBox(height: 28),
          _buildSectionHeader('Your Reviews', Icons.rate_review_outlined),
          if (profileData.reviews.isEmpty)
            _buildEmptyCard(
              'You have not posted a BiteScore review yet.',
            )
          else
            ...profileData.reviews.map(_buildReviewCard),
        ],
      ),
    );
  }

  Widget _buildPublicUsernameCard(BiteScoreUserProfileData profileData) {
    final chosenUsername = profileData.chosenUsername?.trim() ?? '';
    final hasChosenUsername = chosenUsername.isNotEmpty;
    final statusColor = _isUsernameAvailable == true
        ? Colors.green.shade700
        : Colors.red.shade700;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Public Username',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w800,
              ),
            ),
            if (!hasChosenUsername) ...[
              const SizedBox(height: 6),
              Text(
                'Shown on your reviews as ${profileData.publicDisplayName}. If you do not set a username, we use ${profileData.fallbackUsername}.',
                style: const TextStyle(
                  color: Colors.black54,
                  fontSize: 13,
                  height: 1.35,
                ),
              ),
              const SizedBox(height: 14),
            ] else
              const SizedBox(height: 12),
            if (hasChosenUsername && !_isEditingUsername) ...[
              Row(
                children: [
                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 12,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.grey.shade50,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: Colors.grey.shade300,
                        ),
                      ),
                      child: RichText(
                        text: TextSpan(
                          style: const TextStyle(
                            color: Colors.black87,
                            fontSize: 14,
                          ),
                          children: [
                            const TextSpan(
                              text: 'Username: ',
                              style: TextStyle(
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            TextSpan(
                              text: chosenUsername,
                              style: const TextStyle(
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  TextButton(
                    onPressed: () {
                      setState(() {
                        _isEditingUsername = true;
                        _usernameController.text = chosenUsername;
                        _usernameStatusMessage = null;
                        _isUsernameAvailable = null;
                      });
                    },
                    child: const Text('Change'),
                  ),
                ],
              ),
              if (_usernameStatusMessage != null) ...[
                const SizedBox(height: 10),
                Text(
                  _usernameStatusMessage!,
                  style: TextStyle(
                    color: statusColor,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ] else ...[
              TextField(
                controller: _usernameController,
                textInputAction: TextInputAction.done,
                decoration: const InputDecoration(
                  labelText: 'Choose a username',
                  hintText: 'letters, numbers, underscores',
                  border: OutlineInputBorder(),
                ),
                onChanged: (_) {
                  if (_usernameStatusMessage == null &&
                      _isUsernameAvailable == null) {
                    return;
                  }
                  setState(() {
                    _usernameStatusMessage = null;
                    _isUsernameAvailable = null;
                  });
                },
                onSubmitted: (_) => _checkUsernameAvailability(),
              ),
              if (_usernameStatusMessage != null) ...[
                const SizedBox(height: 10),
                Text(
                  _usernameStatusMessage!,
                  style: TextStyle(
                    color: statusColor,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: _isCheckingUsername || _isSavingUsername
                          ? null
                          : _checkUsernameAvailability,
                      child: Text(
                        _isCheckingUsername
                            ? 'Checking...'
                            : 'Check availability',
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton(
                      onPressed: _isCheckingUsername || _isSavingUsername
                          ? null
                          : _saveUsername,
                      child: Text(
                        _isSavingUsername ? 'Saving...' : 'Save username',
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildBadgeCard(BiteScoreUserProfileData profileData) {
    final badgeColors = _badgeColors(profileData.badgeLabel);

    return Card(
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          border: Border(
            left: BorderSide(
              color: badgeColors.$1.withOpacity(0.35),
              width: 4,
            ),
          ),
        ),
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: badgeColors.$1.withOpacity(0.14),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Icon(
                    badgeColors.$2,
                    color: badgeColors.$1,
                    size: 24,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Reviewer Badge',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: Colors.black54,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        profileData.badgeLabel,
                        style: const TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                _buildStatChip(
                  '${profileData.reviewCount} reviews',
                  Icons.rate_review_outlined,
                ),
                _buildStatChip(
                  '${profileData.helpfulVotesReceived} helpful votes',
                  Icons.thumb_up_alt_outlined,
                ),
                _buildStatChip(
                  '${profileData.accountAgeDays} days on BiteScore',
                  Icons.calendar_today_outlined,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStatChip(String label, IconData icon) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.grey.shade100,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            size: 14,
            color: Colors.black54,
          ),
          const SizedBox(width: 6),
          Text(
            label,
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: Colors.black87,
            ),
          ),
        ],
      ),
    );
  }

  (Color, IconData) _badgeColors(String badgeLabel) {
    switch (badgeLabel) {
      case 'Top Contributor':
        return (Colors.deepPurple, Icons.workspace_premium_outlined);
      case 'Trusted Reviewer':
        return (Colors.green.shade700, Icons.verified_outlined);
      case 'Active Reviewer':
        return (Colors.blue.shade700, Icons.auto_awesome_outlined);
      default:
        return (Colors.orange.shade700, Icons.local_fire_department_outlined);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('My Profile'),
        centerTitle: true,
      ),
      body: FutureBuilder<BiteScoreUserProfileData>(
        future: _profileFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(
              child: CircularProgressIndicator(),
            );
          }

          if (snapshot.hasError) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      AppErrorText.friendly(
                        snapshot.error ??
                            StateError('Could not load your profile right now.'),
                        fallback: 'Could not load your profile right now.',
                      ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 12),
                    ElevatedButton(
                      onPressed: () {
                        setState(_refresh);
                      },
                      child: const Text('Try Again'),
                    ),
                  ],
                ),
              ),
            );
          }

          return _buildProfileBody(
            snapshot.data ??
                const BiteScoreUserProfileData(
                  publicDisplayName: 'Reviewer',
                  chosenUsername: null,
                  fallbackUsername: 'anon1',
                  favoriteRestaurants: <BitescoreRestaurant>[],
                  favoriteSaverRestaurants: <Restaurant>[],
                  favoriteDishEntries: <BiteScoreHomeEntry>[],
                  favoriteCoupons: <Coupon>[],
                  reviews: <BiteScoreUserReviewEntry>[],
                  badgeLabel: 'New Reviewer',
                  reviewCount: 0,
                  helpfulVotesReceived: 0,
                  accountAgeDays: 0,
                  moderationFlagCount: 0,
                ),
          );
        },
      ),
    );
  }
}
