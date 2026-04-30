import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../models/bitescore_dish.dart';
import '../models/bitescore_restaurant.dart';
import '../models/dish_review.dart';
import '../models/restaurant.dart';
import '../services/app_error_text.dart';
import '../services/app_mode_state_service.dart';
import '../services/bitescore_service.dart';
import '../widgets/biterater_theme.dart';
import 'bitescore_create_rate_screen.dart';
import 'bitescore_dish_detail_screen.dart';
import 'main_navigation_screen.dart';

class BiteScoreOwnerScreen extends StatefulWidget {
  final User currentUser;

  const BiteScoreOwnerScreen({super.key, required this.currentUser});

  @override
  State<BiteScoreOwnerScreen> createState() => _BiteScoreOwnerScreenState();
}

class _BiteScoreOwnerScreenState extends State<BiteScoreOwnerScreen> {
  Future<_OwnerRatingData>? _dataFuture;
  String? _selectedRestaurantId;
  bool _bioExpanded = false;
  bool _hoursExpanded = false;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  void _refresh() {
    _dataFuture = _loadData();
  }

  Future<_OwnerRatingData> _loadData() async {
    final restaurants = await BiteScoreService.loadOwnedRestaurantsForUser(
      widget.currentUser.uid,
    );

    BitescoreRestaurant? selectedRestaurant;
    if (restaurants.isNotEmpty) {
      final selectedId = _selectedRestaurantId;
      selectedRestaurant = restaurants.firstWhere(
        (restaurant) => restaurant.id == selectedId,
        orElse: () => restaurants.first,
      );
      _selectedRestaurantId = selectedRestaurant.id;
    }

    final entries = selectedRestaurant == null
        ? const <BiteScoreHomeEntry>[]
        : await BiteScoreService.loadEntriesForRestaurant(
            selectedRestaurant,
            includeInactive: true,
          );

    entries.sort(
      (a, b) =>
          b.aggregate.overallBiteScore.compareTo(a.aggregate.overallBiteScore),
    );

    final reviewLists = await Future.wait(
      entries.map((entry) => BiteScoreService.loadDishReviews(entry.dish.id)),
    );
    final reviewEntries = <_OwnerReviewEntry>[];
    for (var index = 0; index < entries.length; index++) {
      for (final review in reviewLists[index]) {
        reviewEntries.add(
          _OwnerReviewEntry(entry: entries[index], review: review),
        );
      }
    }
    reviewEntries.sort((a, b) {
      final byDate = _reviewTimestamp(
        b.review,
      ).compareTo(_reviewTimestamp(a.review));
      if (byDate != 0) {
        return byDate;
      }
      return a.entry.dish.name.toLowerCase().compareTo(
        b.entry.dish.name.toLowerCase(),
      );
    });

    return _OwnerRatingData(
      restaurants: restaurants,
      selectedRestaurant: selectedRestaurant,
      entries: entries,
      reviewEntries: reviewEntries,
    );
  }

  static DateTime _reviewTimestamp(DishReview review) {
    return review.createdAt ??
        review.updatedAt ??
        DateTime.fromMillisecondsSinceEpoch(0);
  }

  void _showSnackBar(String message) {
    if (!mounted) {
      return;
    }
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(content: Text(message), duration: const Duration(seconds: 3)),
      );
  }

  Future<void> _selectRestaurant(String restaurantId) async {
    setState(() {
      _selectedRestaurantId = restaurantId;
      _bioExpanded = false;
      _hoursExpanded = false;
      _refresh();
    });
  }

  Future<void> _openRestaurantEditor(BitescoreRestaurant restaurant) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) => _OwnerRestaurantEditDialog(restaurant: restaurant),
    );

    if (saved == true && mounted) {
      setState(_refresh);
      _showSnackBar('Restaurant information updated.');
    }
  }

  Future<void> _openDishEditor(BiteScoreHomeEntry entry) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) => _OwnerDishEditDialog(dish: entry.dish),
    );

    if (saved == true && mounted) {
      setState(_refresh);
      _showSnackBar('Dish updated.');
    }
  }

  Future<void> _openAddDish(BitescoreRestaurant restaurant) async {
    final created = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) =>
            BiteScoreCreateRateScreen(existingRestaurant: restaurant),
      ),
    );

    if (created == true && mounted) {
      setState(_refresh);
      _showSnackBar('Dish created.');
    }
  }

  Future<void> _openMergeDialog(List<BiteScoreHomeEntry> entries) async {
    final activeDishes = entries
        .map((entry) => entry.dish)
        .where((dish) => dish.isActive)
        .toList();
    if (activeDishes.length < 2) {
      _showSnackBar('Add at least two active dishes before merging.');
      return;
    }

    final merged = await showDialog<bool>(
      context: context,
      builder: (context) => _OwnerDishMergeDialog(dishes: activeDishes),
    );

    if (merged == true && mounted) {
      setState(_refresh);
      _showSnackBar('Dish merge applied.');
    }
  }

  Widget _buildBioSection(BitescoreRestaurant restaurant) {
    final bio = (restaurant.bio ?? '').trim();
    if (bio.isEmpty) {
      return const SizedBox.shrink();
    }

    final isLong = bio.length > 180;

    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Bio / Info',
            style: TextStyle(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 6),
          Text(
            bio,
            maxLines: _bioExpanded || !isLong ? null : 4,
            overflow: _bioExpanded || !isLong
                ? TextOverflow.visible
                : TextOverflow.ellipsis,
          ),
          if (isLong)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: () {
                  setState(() {
                    _bioExpanded = !_bioExpanded;
                  });
                },
                child: Text(_bioExpanded ? 'Show less' : 'Show more'),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildRestaurantCard(_OwnerRatingData data) {
    final restaurant = data.selectedRestaurant!;
    final restaurants = data.restaurants;
    final hasPhone =
        restaurant.phone != null && restaurant.phone!.trim().isNotEmpty;

    return BiteRaterTheme.liftedCard(
      radius: 24,
      borderColor: BiteRaterTheme.coral.withOpacity(0.16),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (restaurants.length > 1) ...[
              DropdownButtonFormField<String>(
                key: ValueKey<String>(restaurant.id),
                initialValue: restaurant.id,
                decoration: const InputDecoration(
                  labelText: 'Restaurant',
                  border: OutlineInputBorder(),
                ),
                items: restaurants
                    .map(
                      (item) => DropdownMenuItem<String>(
                        value: item.id,
                        child: Text(item.name),
                      ),
                    )
                    .toList(),
                onChanged: (value) {
                  if (value != null && value != restaurant.id) {
                    _selectRestaurant(value);
                  }
                },
              ),
              const SizedBox(height: 16),
            ],
            Text(
              restaurant.name,
              style: const TextStyle(
                color: BiteRaterTheme.ink,
                fontSize: 22,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              '${restaurant.address}, ${restaurant.city}, ${restaurant.state} ${restaurant.zipCode}',
            ),
            const SizedBox(height: 6),
            Text(
              hasPhone ? 'Phone: ${restaurant.phone!}' : 'Phone: Not available',
              style: const TextStyle(
                color: BiteRaterTheme.mutedInk,
                fontWeight: FontWeight.w600,
              ),
            ),
            _buildHoursSection(restaurant),
            _buildBioSection(restaurant),
            BiteRaterTheme.softDivider(),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                SizedBox(
                  width: 180,
                  child: _buildOwnerActionButton(
                    onPressed: () => _openRestaurantEditor(restaurant),
                    icon: Icons.edit_outlined,
                    label: 'Edit Restaurant Info',
                  ),
                ),
                SizedBox(
                  width: 140,
                  child: _buildOwnerActionButton(
                    onPressed: () => _openAddDish(restaurant),
                    icon: Icons.add,
                    label: 'Add Dish',
                  ),
                ),
                SizedBox(
                  width: 160,
                  child: _buildOwnerActionButton(
                    onPressed: () => _openMergeDialog(data.entries),
                    icon: Icons.merge_type,
                    label: 'Merge Dishes',
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  String _ownerScoreLabel(double value) {
    if (value <= 0) {
      return '--';
    }
    return value.toStringAsFixed(0);
  }

  String _ownerAverageScoreLabel(double value) {
    if (value <= 0) {
      return '--';
    }
    return value.round().toString();
  }

  Future<void> _openBiteScoreBrowse() async {
    await Navigator.of(context, rootNavigator: true).pushAndRemoveUntil(
      MaterialPageRoute(
        builder: (_) => const MainNavigationScreen(
          initialMode: AppMode.biteScore,
          initialIndex: 0,
        ),
      ),
      (route) => false,
    );
  }

  String _ownerDateLabel(DateTime date) {
    const monthNames = <String>[
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
    return '${monthNames[date.month - 1]} ${date.day}';
  }

  _OwnerInsights _buildInsights(
    List<BiteScoreHomeEntry> entries,
    List<_OwnerReviewEntry> reviewEntries,
  ) {
    final ratedEntries = entries
        .where((entry) => entry.aggregate.ratingCount > 0)
        .toList(growable: false);

    var totalRatings = 0;
    var totalDishScore = 0.0;
    for (final entry in ratedEntries) {
      totalRatings += entry.aggregate.ratingCount;
      totalDishScore += entry.aggregate.overallBiteScore;
    }

    final topDishPool = List<BiteScoreHomeEntry>.from(ratedEntries)
      ..sort((a, b) {
        final byScore = b.aggregate.overallBiteScore.compareTo(
          a.aggregate.overallBiteScore,
        );
        if (byScore != 0) {
          return byScore;
        }

        final byCount = b.aggregate.ratingCount.compareTo(
          a.aggregate.ratingCount,
        );
        if (byCount != 0) {
          return byCount;
        }

        return a.dish.name.toLowerCase().compareTo(b.dish.name.toLowerCase());
      });

    return _OwnerInsights(
      totalRatings: totalRatings,
      averageBiteScore: ratedEntries.isEmpty
          ? 0
          : (totalDishScore / ratedEntries.length),
      topDishes: topDishPool.take(3).toList(growable: false),
      recentRatings: reviewEntries.take(4).toList(growable: false),
      newestReviews: reviewEntries
          .where(
            (entry) =>
                (entry.review.headline ?? '').trim().isNotEmpty ||
                (entry.review.notes ?? '').trim().isNotEmpty,
          )
          .take(3)
          .toList(growable: false),
      topDishThisWeek: _topDishThisWeek(reviewEntries),
      trend: _trendIndicator(reviewEntries),
    );
  }

  _OwnerTopDish? _topDishThisWeek(List<_OwnerReviewEntry> reviewEntries) {
    final weekAgo = DateTime.now().subtract(const Duration(days: 7));
    final recentReviews = reviewEntries
        .where((entry) => _reviewTimestamp(entry.review).isAfter(weekAgo))
        .toList(growable: false);
    if (recentReviews.isEmpty) {
      return null;
    }

    final grouped = <String, List<_OwnerReviewEntry>>{};
    for (final reviewEntry in recentReviews) {
      grouped
          .putIfAbsent(reviewEntry.entry.dish.id, () => <_OwnerReviewEntry>[])
          .add(reviewEntry);
    }

    final ranked =
        grouped.values.map((dishReviews) {
          final scoreTotal = dishReviews.fold<double>(
            0,
            (sum, item) => sum + item.review.overallBiteScore,
          );
          final latestDate = dishReviews
              .map((item) => _reviewTimestamp(item.review))
              .reduce((a, b) => a.isAfter(b) ? a : b);

          return _OwnerTopDish(
            entry: dishReviews.first.entry,
            weeklyAverageScore: scoreTotal / dishReviews.length,
            weeklyRatingCount: dishReviews.length,
            latestReviewDate: latestDate,
          );
        }).toList()..sort((a, b) {
          final byScore = b.weeklyAverageScore.compareTo(a.weeklyAverageScore);
          if (byScore != 0) {
            return byScore;
          }
          final byCount = b.weeklyRatingCount.compareTo(a.weeklyRatingCount);
          if (byCount != 0) {
            return byCount;
          }
          final byLatest = b.latestReviewDate.compareTo(a.latestReviewDate);
          if (byLatest != 0) {
            return byLatest;
          }
          return a.entry.dish.name.toLowerCase().compareTo(
            b.entry.dish.name.toLowerCase(),
          );
        });

    return ranked.first;
  }

  _OwnerTrend _trendIndicator(List<_OwnerReviewEntry> reviewEntries) {
    final now = DateTime.now();
    final oneWeekAgo = now.subtract(const Duration(days: 7));
    final twoWeeksAgo = now.subtract(const Duration(days: 14));

    final thisWeek = reviewEntries
        .where((entry) => _reviewTimestamp(entry.review).isAfter(oneWeekAgo))
        .toList(growable: false);
    final previousWeek = reviewEntries
        .where((entry) {
          final timestamp = _reviewTimestamp(entry.review);
          return timestamp.isAfter(twoWeeksAgo) &&
              !timestamp.isAfter(oneWeekAgo);
        })
        .toList(growable: false);

    if (thisWeek.isEmpty || previousWeek.isEmpty) {
      return const _OwnerTrend(label: 'Flat', icon: Icons.trending_flat);
    }

    final thisWeekAverage =
        thisWeek.fold<double>(
          0,
          (sum, item) => sum + item.review.overallBiteScore,
        ) /
        thisWeek.length;
    final previousWeekAverage =
        previousWeek.fold<double>(
          0,
          (sum, item) => sum + item.review.overallBiteScore,
        ) /
        previousWeek.length;
    final delta = thisWeekAverage - previousWeekAverage;

    if (delta >= 2) {
      return const _OwnerTrend(label: 'Up', icon: Icons.trending_up);
    }
    if (delta <= -2) {
      return const _OwnerTrend(label: 'Down', icon: Icons.trending_down);
    }
    return const _OwnerTrend(label: 'Flat', icon: Icons.trending_flat);
  }

  Color _trendIconColor(_OwnerTrend trend) {
    return switch (trend.label) {
      'Up' => BiteRaterTheme.ocean,
      'Down' => BiteRaterTheme.coral,
      _ => BiteRaterTheme.mutedInk,
    };
  }

  Widget _buildInsightStatCard({required String label, required String value}) {
    return BiteRaterTheme.liftedCard(
      radius: 18,
      borderColor: BiteRaterTheme.grape.withOpacity(0.18),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: const TextStyle(
                fontSize: 12,
                color: BiteRaterTheme.mutedInk,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.2,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              value,
              style: TextStyle(
                color: label.contains('BiteScore')
                    ? BiteRaterTheme.scoreFlame
                    : BiteRaterTheme.ink,
                fontSize: 28,
                height: 1.0,
                fontWeight: FontWeight.w900,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHoursSection(BitescoreRestaurant restaurant) {
    if (restaurant.businessHours.isEmpty) {
      return const SizedBox.shrink();
    }

    final weeklyHours = RestaurantBusinessHours.normalizedWeek(
      restaurant.businessHours,
    );
    final todayHours = weeklyHours[DateTime.now().weekday % 7];

    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Hours', style: TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          Text(
            todayHours.closed
                ? 'Closed today'
                : 'Open today: ${todayHours.opensAt} - ${todayHours.closesAt}',
            style: const TextStyle(
              color: BiteRaterTheme.ink,
              fontWeight: FontWeight.w700,
            ),
          ),
          if (_hoursExpanded) ...[
            const SizedBox(height: 8),
            ...weeklyHours.map(
              (entry) => Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text(
                  '${entry.day}: ${entry.summaryLabel}',
                  style: const TextStyle(
                    color: BiteRaterTheme.mutedInk,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ),
          ],
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              onPressed: () {
                setState(() {
                  _hoursExpanded = !_hoursExpanded;
                });
              },
              child: Text(_hoursExpanded ? 'Hide hours' : 'Show all hours'),
            ),
          ),
        ],
      ),
    );
  }

  ButtonStyle _ownerActionButtonStyle() {
    return OutlinedButton.styleFrom(
      minimumSize: const Size.fromHeight(48),
      foregroundColor: BiteRaterTheme.grape,
      backgroundColor: BiteRaterTheme.grape.withOpacity(0.06),
      side: BorderSide(color: BiteRaterTheme.grape.withOpacity(0.22)),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
    );
  }

  Widget _buildOwnerActionButton({
    required IconData icon,
    required String label,
    required VoidCallback onPressed,
  }) {
    return OutlinedButton.icon(
      onPressed: onPressed,
      style: _ownerActionButtonStyle(),
      icon: Icon(icon, size: 18),
      label: Text(label),
    );
  }

  Widget _buildInsightBox({
    required String title,
    required Widget child,
    Color? titleAccentColor,
    IconData? titleIcon,
    double titleIconSize = 18,
  }) {
    final colorScheme = Theme.of(context).colorScheme;

    return BiteRaterTheme.liftedCard(
      radius: 18,
      borderColor: (titleAccentColor ?? BiteRaterTheme.coral).withOpacity(0.18),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 14, 14, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            _buildInsightSectionTitle(
              title,
              accentColor: titleAccentColor,
              leadingIcon: titleIcon,
              leadingIconSize: titleIconSize,
            ),
            BiteRaterTheme.softDivider(),
            child,
          ],
        ),
      ),
    );
  }

  Widget _buildTrendInsightBox(_OwnerTrend trend) {
    final colorScheme = Theme.of(context).colorScheme;
    final trendColor = _trendIconColor(trend);

    return BiteRaterTheme.liftedCard(
      radius: 18,
      borderColor: trendColor.withOpacity(0.18),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 14, 14, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                Container(
                  width: 4,
                  height: 22,
                  decoration: BoxDecoration(
                    color: trendColor.withOpacity(0.14),
                    borderRadius: BorderRadius.circular(999),
                  ),
                ),
                const SizedBox(width: 10),
                Icon(Icons.refresh, size: 24, color: trendColor),
                const SizedBox(width: 8),
                Text(
                  'Trend',
                  style: TextStyle(
                    fontSize: 15.5,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.2,
                    color: colorScheme.onSurface,
                    height: 1.15,
                  ),
                ),
              ],
            ),
            BiteRaterTheme.softDivider(),
            Row(
              children: [
                Icon(trend.icon, size: 20, color: trendColor),
                const SizedBox(width: 8),
                Flexible(
                  child: Text(
                    trend.label,
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                      color: colorScheme.onSurfaceVariant,
                      letterSpacing: 0.1,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInsightSectionTitle(
    String title, {
    Color? accentColor,
    IconData? leadingIcon,
    double leadingIconSize = 18,
  }) {
    final colorScheme = Theme.of(context).colorScheme;
    final sectionStyle = switch (title) {
      'Top Dish This Week' => (
        icon: Icons.local_fire_department_outlined,
        color: BiteRaterTheme.coral,
      ),
      'Highest Rated Dishes' => (
        icon: Icons.star_outline,
        color: BiteRaterTheme.coral,
      ),
      'Recent Ratings' => (
        icon: Icons.insights_outlined,
        color: BiteRaterTheme.ocean,
      ),
      'Newest Reviews' => (
        icon: Icons.rate_review_outlined,
        color: BiteRaterTheme.grape,
      ),
      _ => (icon: Icons.label_important_outline, color: colorScheme.primary),
    };
    final resolvedAccentColor = accentColor ?? sectionStyle.color;
    final resolvedIcon = leadingIcon ?? sectionStyle.icon;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Container(
          width: 4,
          height: 22,
          decoration: BoxDecoration(
            color: resolvedAccentColor.withOpacity(0.14),
            borderRadius: BorderRadius.circular(999),
          ),
        ),
        const SizedBox(width: 10),
        Icon(resolvedIcon, size: leadingIconSize, color: resolvedAccentColor),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            title,
            style: TextStyle(
              fontSize: 15.5,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.2,
              color: colorScheme.onSurface,
              height: 1.15,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildCompactInsightRow({
    required Widget left,
    required Widget right,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(child: left),
        const SizedBox(width: 12),
        Expanded(child: right),
      ],
    );
  }

  Widget _buildCompactInsightsCard(_OwnerInsights insights) {
    return BiteRaterTheme.liftedCard(
      radius: 24,
      borderColor: BiteRaterTheme.ocean.withOpacity(0.16),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Insights',
              style: TextStyle(
                color: BiteRaterTheme.ink,
                fontSize: 22,
                fontWeight: FontWeight.w900,
                letterSpacing: 0.2,
              ),
            ),
            BiteRaterTheme.softDivider(),
            Row(
              children: [
                Expanded(
                  child: _buildInsightStatCard(
                    label: 'Total Ratings',
                    value: '${insights.totalRatings}',
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _buildInsightStatCard(
                    label: 'Average BiteScore',
                    value: _ownerAverageScoreLabel(insights.averageBiteScore),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            _buildCompactInsightRow(
              left: _buildTrendInsightBox(insights.trend),
              right: _buildInsightBox(
                title: 'Top Dish This Week',
                child: insights.topDishThisWeek == null
                    ? const Text(
                        'No new ratings yet.',
                        style: TextStyle(
                          color: BiteRaterTheme.mutedInk,
                          height: 1.25,
                        ),
                      )
                    : Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            insights.topDishThisWeek!.entry.dish.name,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: BiteRaterTheme.ink,
                              fontSize: 15.5,
                              fontWeight: FontWeight.w800,
                              height: 1.2,
                            ),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            'BiteScore ${_ownerScoreLabel(insights.topDishThisWeek!.weeklyAverageScore)}',
                            style: const TextStyle(
                              color: BiteRaterTheme.scoreFlame,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            '${insights.topDishThisWeek!.weeklyRatingCount} recent ratings',
                            style: const TextStyle(
                              fontSize: 12,
                              color: BiteRaterTheme.mutedInk,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
              ),
            ),
            const SizedBox(height: 12),
            _buildInsightBox(
              title: 'Highest Rated Dishes',
              child: insights.topDishes.isEmpty
                  ? const Text(
                      'No rated dishes yet.',
                      style: TextStyle(
                        color: BiteRaterTheme.mutedInk,
                        height: 1.25,
                      ),
                    )
                  : Column(
                      children: insights.topDishes.take(3).map((entry) {
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Expanded(
                                child: Text(
                                  entry.dish.name,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    color: BiteRaterTheme.ink,
                                    fontWeight: FontWeight.w800,
                                    height: 1.2,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Text(
                                '${_ownerScoreLabel(entry.aggregate.overallBiteScore)} | '
                                '${entry.aggregate.ratingCount}',
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: BiteRaterTheme.scoreFlame,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ],
                          ),
                        );
                      }).toList(),
                    ),
            ),
            const SizedBox(height: 12),
            _buildCompactInsightRow(
              left: _buildInsightBox(
                title: 'Recent Ratings',
                child: insights.recentRatings.isEmpty
                    ? const Text(
                        'No ratings yet.',
                        style: TextStyle(
                          color: BiteRaterTheme.mutedInk,
                          height: 1.25,
                        ),
                      )
                    : Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: insights.recentRatings.take(3).map((entry) {
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  entry.entry.dish.name,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    color: BiteRaterTheme.ink,
                                    fontWeight: FontWeight.w800,
                                    height: 1.2,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  '${_ownerScoreLabel(entry.review.overallBiteScore)} | '
                                  '${_ownerDateLabel(_reviewTimestamp(entry.review))}',
                                  style: const TextStyle(
                                    fontSize: 12,
                                    color: BiteRaterTheme.scoreFlame,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ],
                            ),
                          );
                        }).toList(),
                      ),
              ),
              right: _buildInsightBox(
                title: 'Newest Reviews',
                child: insights.newestReviews.isEmpty
                    ? const Text(
                        'No written reviews yet.',
                        style: TextStyle(
                          color: BiteRaterTheme.mutedInk,
                          height: 1.25,
                        ),
                      )
                    : Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: insights.newestReviews.take(2).map((entry) {
                          final headline = (entry.review.headline ?? '').trim();
                          final notes = (entry.review.notes ?? '').trim();
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  entry.entry.dish.name,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    color: BiteRaterTheme.ink,
                                    fontWeight: FontWeight.w800,
                                    height: 1.2,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  headline.isNotEmpty ? headline : notes,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  'BiteScore ${_ownerScoreLabel(entry.review.overallBiteScore)} | '
                                  '${_ownerDateLabel(_reviewTimestamp(entry.review))}',
                                  style: const TextStyle(
                                    fontSize: 12,
                                    color: BiteRaterTheme.scoreFlame,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ],
                            ),
                          );
                        }).toList(),
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInsightsSection(_OwnerRatingData data) {
    final insights = _buildInsights(data.entries, data.reviewEntries);
    return _buildCompactInsightsCard(insights);

    return BiteRaterTheme.liftedCard(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Insights',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: _buildInsightStatCard(
                    label: 'Total Ratings',
                    value: '${insights.totalRatings}',
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _buildInsightStatCard(
                    label: 'Average BiteScore',
                    value: _ownerAverageScoreLabel(insights.averageBiteScore),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Icon(
                  insights.trend.icon,
                  size: 20,
                  color: _trendIconColor(insights.trend),
                ),
                const SizedBox(width: 8),
                Text(
                  'Trend: ${insights.trend.label}',
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
              ],
            ),
            const SizedBox(height: 16),
            const Text(
              'Top Dishes',
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 10),
            if (insights.topDishes.isEmpty)
              const Text(
                'No rated dishes yet for this restaurant.',
                style: TextStyle(color: Colors.black54),
              )
            else
              Column(
                children: insights.topDishes.map((entry) {
                  return ListTile(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    title: Text(
                      entry.dish.name,
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    subtitle: Text(
                      'BiteScore ${_ownerScoreLabel(entry.aggregate.overallBiteScore)} • '
                      '${entry.aggregate.ratingCount} ratings',
                    ),
                  );
                }).toList(),
              ),
            const SizedBox(height: 16),
            const Text(
              'Top Dish This Week',
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 10),
            if (insights.topDishThisWeek == null)
              const Text(
                'No new ratings this week yet.',
                style: TextStyle(color: Colors.black54),
              )
            else
              ListTile(
                contentPadding: EdgeInsets.zero,
                dense: true,
                title: Text(
                  insights.topDishThisWeek!.entry.dish.name,
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
                subtitle: Text(
                  'Weekly BiteScore ${_ownerScoreLabel(insights.topDishThisWeek!.weeklyAverageScore)} | '
                  '${insights.topDishThisWeek!.weeklyRatingCount} recent ratings',
                ),
              ),
            const SizedBox(height: 16),
            const Text(
              'Recent Ratings',
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 10),
            if (insights.recentRatings.isEmpty)
              const Text(
                'No ratings yet for this restaurant.',
                style: TextStyle(color: Colors.black54),
              )
            else
              Column(
                children: insights.recentRatings.map((entry) {
                  return ListTile(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    title: Text(
                      entry.entry.dish.name,
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    subtitle: Text(
                      'BiteScore ${_ownerScoreLabel(entry.review.overallBiteScore)} | '
                      '${_ownerDateLabel(_reviewTimestamp(entry.review))}',
                    ),
                  );
                }).toList(),
              ),
            const SizedBox(height: 16),
            const Text(
              'Newest Reviews',
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 10),
            if (insights.newestReviews.isEmpty)
              const Text(
                'No written reviews yet for this restaurant.',
                style: TextStyle(color: Colors.black54),
              )
            else
              Column(
                children: insights.newestReviews.map((entry) {
                  final headline = (entry.review.headline ?? '').trim();
                  final notes = (entry.review.notes ?? '').trim();
                  return Container(
                    width: double.infinity,
                    margin: const EdgeInsets.only(bottom: 10),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Theme.of(context).colorScheme.surfaceContainerLow,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          entry.entry.dish.name,
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          headline.isNotEmpty ? headline : notes,
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 6),
                        Text(
                          _ownerDateLabel(_reviewTimestamp(entry.review)),
                          style: const TextStyle(
                            fontSize: 12,
                            color: Colors.black54,
                          ),
                        ),
                      ],
                    ),
                  );
                }).toList(),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildDishList(
    List<BiteScoreHomeEntry> entries, {
    required String emptyMessage,
  }) {
    if (entries.isEmpty) {
      return BiteRaterTheme.liftedCard(
        radius: 20,
        borderColor: BiteRaterTheme.ocean.withOpacity(0.16),
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Text(
            emptyMessage,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: BiteRaterTheme.mutedInk,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      );
    }

    return Column(
      children: entries.map((entry) {
        final dish = entry.dish;
        final scoreLabel = entry.aggregate.overallBiteScore > 0
            ? entry.aggregate.overallBiteScore.toStringAsFixed(0)
            : '--';

        return BiteRaterTheme.liftedCard(
          margin: const EdgeInsets.only(bottom: 12),
          radius: 20,
          borderColor: BiteRaterTheme.grape.withOpacity(0.14),
          child: ListTile(
            onTap: () {
              Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => BiteScoreDishDetailScreen(
                    entry: entry,
                    distanceLabel: null,
                  ),
                ),
              );
            },
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 18,
              vertical: 12,
            ),
            title: Text(
              dish.name,
              style: const TextStyle(
                color: BiteRaterTheme.ink,
                fontSize: 16,
                fontWeight: FontWeight.w900,
              ),
            ),
            subtitle: Text.rich(
              TextSpan(
                style: const TextStyle(
                  color: BiteRaterTheme.mutedInk,
                  fontWeight: FontWeight.w600,
                  height: 1.35,
                ),
                children: [
                  if ((dish.category ?? '').trim().isNotEmpty)
                    TextSpan(text: '${dish.category!.trim()}\n'),
                  if ((dish.priceLabel ?? '').trim().isNotEmpty)
                    TextSpan(text: '${dish.priceLabel!.trim()}\n'),
                  TextSpan(
                    text: 'BiteScore: $scoreLabel',
                    style: const TextStyle(
                      color: BiteRaterTheme.scoreFlame,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  TextSpan(text: '\nRatings: ${entry.aggregate.ratingCount}'),
                ],
              ),
            ),
            isThreeLine: true,
            trailing: TextButton(
              onPressed: () => _openDishEditor(entry),
              style: TextButton.styleFrom(
                foregroundColor: BiteRaterTheme.coral,
              ),
              child: const Text('Edit'),
            ),
          ),
        );
      }).toList(),
    );
  }

  Widget _buildNoBiteScoreAccountState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: BiteRaterTheme.liftedCard(
            radius: 24,
            borderColor: BiteRaterTheme.mint.withOpacity(0.16),
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.verified_outlined, size: 52),
                  const SizedBox(height: 16),
                  const Text(
                    'No BiteScore Restaurant Account Yet',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: BiteRaterTheme.ink,
                      fontSize: 24,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 12),
                  const Text(
                    'You don\'t have a BiteScore restaurant account yet. You can claim a restaurant to use the rating side.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: BiteRaterTheme.mutedInk,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 20),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: _openBiteScoreBrowse,
                      child: const Text(
                        'Browse BiteScore and Claim a Restaurant',
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildLoadErrorState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: BiteRaterTheme.liftedCard(
            radius: 24,
            borderColor: BiteRaterTheme.mint.withOpacity(0.16),
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.storefront_outlined, size: 52),
                  const SizedBox(height: 16),
                  const Text(
                    'No BiteRater Restaurant Claimed Yet',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: BiteRaterTheme.ink,
                      fontSize: 24,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 12),
                  const Text(
                    'You’ll need to claim a restaurant before you can use BiteRater tools.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: BiteRaterTheme.mutedInk,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Submit a restaurant claim to get started.',
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 20),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: _openBiteScoreBrowse,
                      child: const Text(
                        'Browse BiteRater and Claim a Restaurant',
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: BiteRaterTheme.pageBackground,
      appBar: AppBar(title: const Text('Rating Side Owner'), centerTitle: true),
      body: FutureBuilder<_OwnerRatingData>(
        future: _dataFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }

          if (snapshot.hasError) {
            return _buildLoadErrorState();
          }

          final data = snapshot.data ?? const _OwnerRatingData.empty();
          if (data.selectedRestaurant == null) {
            return _buildNoBiteScoreAccountState();
          }

          final activeEntries = data.entries
              .where((entry) => entry.dish.isActive && !entry.dish.isMerged)
              .toList(growable: false);
          final unavailableEntries = data.entries
              .where((entry) => !entry.dish.isActive && !entry.dish.isMerged)
              .toList(growable: false);

          return SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildRestaurantCard(data),
                const SizedBox(height: 16),
                _buildInsightsSection(data),
                const SizedBox(height: 16),
                const Text(
                  'Active Dishes',
                  style: TextStyle(
                    color: BiteRaterTheme.ink,
                    fontSize: 18,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 12),
                _buildDishList(
                  activeEntries,
                  emptyMessage:
                      'No available dishes found for this restaurant yet.',
                ),
                if (unavailableEntries.isNotEmpty) ...[
                  const SizedBox(height: 24),
                  const Text(
                    'Unavailable Dishes',
                    style: TextStyle(
                      color: BiteRaterTheme.ink,
                      fontSize: 18,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 12),
                  _buildDishList(
                    unavailableEntries,
                    emptyMessage:
                        'No unavailable dishes found for this restaurant yet.',
                  ),
                ],
              ],
            ),
          );
        },
      ),
    );
  }
}

class _OwnerRatingData {
  final List<BitescoreRestaurant> restaurants;
  final BitescoreRestaurant? selectedRestaurant;
  final List<BiteScoreHomeEntry> entries;
  final List<_OwnerReviewEntry> reviewEntries;

  const _OwnerRatingData({
    required this.restaurants,
    required this.selectedRestaurant,
    required this.entries,
    required this.reviewEntries,
  });

  const _OwnerRatingData.empty()
    : restaurants = const <BitescoreRestaurant>[],
      selectedRestaurant = null,
      entries = const <BiteScoreHomeEntry>[],
      reviewEntries = const <_OwnerReviewEntry>[];
}

class _OwnerInsights {
  final int totalRatings;
  final double averageBiteScore;
  final List<BiteScoreHomeEntry> topDishes;
  final List<_OwnerReviewEntry> recentRatings;
  final List<_OwnerReviewEntry> newestReviews;
  final _OwnerTopDish? topDishThisWeek;
  final _OwnerTrend trend;

  const _OwnerInsights({
    required this.totalRatings,
    required this.averageBiteScore,
    required this.topDishes,
    required this.recentRatings,
    required this.newestReviews,
    required this.topDishThisWeek,
    required this.trend,
  });
}

class _OwnerReviewEntry {
  final BiteScoreHomeEntry entry;
  final DishReview review;

  const _OwnerReviewEntry({required this.entry, required this.review});
}

class _OwnerTopDish {
  final BiteScoreHomeEntry entry;
  final double weeklyAverageScore;
  final int weeklyRatingCount;
  final DateTime latestReviewDate;

  const _OwnerTopDish({
    required this.entry,
    required this.weeklyAverageScore,
    required this.weeklyRatingCount,
    required this.latestReviewDate,
  });
}

class _OwnerTrend {
  final String label;
  final IconData icon;

  const _OwnerTrend({required this.label, required this.icon});
}

class _OwnerTextField extends StatelessWidget {
  final TextEditingController controller;
  final String label;
  final int maxLines;
  final TextInputType? keyboardType;

  const _OwnerTextField({
    required this.controller,
    required this.label,
    this.maxLines = 1,
    this.keyboardType,
  });

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      maxLines: maxLines,
      keyboardType: keyboardType,
      decoration: InputDecoration(
        labelText: label,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
      ),
    );
  }
}

class _OwnerRestaurantEditDialog extends StatefulWidget {
  final BitescoreRestaurant restaurant;

  const _OwnerRestaurantEditDialog({required this.restaurant});

  @override
  State<_OwnerRestaurantEditDialog> createState() =>
      _OwnerRestaurantEditDialogState();
}

class _OwnerRestaurantEditDialogState
    extends State<_OwnerRestaurantEditDialog> {
  static final List<String> _businessHourOptions = _buildBusinessHourOptions();

  late final TextEditingController _nameController;
  late final TextEditingController _addressController;
  late final TextEditingController _cityController;
  late final TextEditingController _stateController;
  late final TextEditingController _zipController;
  late final TextEditingController _phoneController;
  late final TextEditingController _bioController;
  late List<RestaurantBusinessHours> _businessHours;
  late final Map<String, bool> _copyPreviousDay;
  bool _businessHoursDirty = false;
  bool _isSaving = false;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.restaurant.name);
    _addressController = TextEditingController(text: widget.restaurant.address);
    _cityController = TextEditingController(text: widget.restaurant.city);
    _stateController = TextEditingController(text: widget.restaurant.state);
    _zipController = TextEditingController(text: widget.restaurant.zipCode);
    _phoneController = TextEditingController(
      text: widget.restaurant.phone ?? '',
    );
    _bioController = TextEditingController(text: widget.restaurant.bio ?? '');
    _businessHours = RestaurantBusinessHours.normalizedWeek(
      widget.restaurant.businessHours,
    );
    _copyPreviousDay = {
      for (final day in Restaurant.businessDayNames) day: false,
    };
  }

  @override
  void dispose() {
    _nameController.dispose();
    _addressController.dispose();
    _cityController.dispose();
    _stateController.dispose();
    _zipController.dispose();
    _phoneController.dispose();
    _bioController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _isSaving = true;
    });

    try {
      await BiteScoreService.updateRestaurantAsOwner(
        restaurant: widget.restaurant,
        name: _nameController.text,
        address: _addressController.text,
        city: _cityController.text,
        state: _stateController.text,
        zipCode: _zipController.text,
        phone: _phoneController.text,
        bio: _bioController.text,
        businessHours:
            widget.restaurant.businessHours.isNotEmpty || _businessHoursDirty
            ? _businessHours
            : widget.restaurant.businessHours,
      );
      if (!mounted) {
        return;
      }
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            AppErrorText.friendly(
              error,
              fallback: 'Could not update the restaurant right now.',
            ),
          ),
        ),
      );
      setState(() {
        _isSaving = false;
      });
    }
  }

  static List<String> _buildBusinessHourOptions() {
    final options = <String>[];
    const periods = ['AM', 'PM'];
    for (final period in periods) {
      for (var hour = 1; hour <= 12; hour += 1) {
        for (final minute in const ['00', '30']) {
          options.add('$hour:$minute $period');
        }
      }
    }
    return options;
  }

  void _updateBusinessHoursEntry(
    int dayIndex,
    RestaurantBusinessHours updatedEntry,
  ) {
    setState(() {
      _businessHoursDirty = true;
      _businessHours = [
        for (var index = 0; index < _businessHours.length; index += 1)
          index == dayIndex ? updatedEntry : _businessHours[index],
      ];
    });
  }

  void _setBusinessDayClosed(int dayIndex, bool closed) {
    _updateBusinessHoursEntry(
      dayIndex,
      _businessHours[dayIndex].copyWith(closed: closed),
    );
  }

  void _copyPreviousBusinessDayHours(int dayIndex, bool shouldCopy) {
    final day = Restaurant.businessDayNames[dayIndex];
    final previousDayIndex =
        (dayIndex - 1 + _businessHours.length) % _businessHours.length;

    setState(() {
      _businessHoursDirty = true;
      _copyPreviousDay[day] = shouldCopy;
      if (shouldCopy) {
        final previousEntry = _businessHours[previousDayIndex];
        _businessHours = [
          for (var index = 0; index < _businessHours.length; index += 1)
            index == dayIndex
                ? _businessHours[index].copyWith(
                    opensAt: previousEntry.opensAt,
                    closesAt: previousEntry.closesAt,
                    closed: previousEntry.closed,
                  )
                : _businessHours[index],
        ];
      }
    });
  }

  InputDecoration _hoursFieldDecoration(String label) {
    return InputDecoration(
      labelText: label,
      isDense: true,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
    );
  }

  Widget _buildBusinessHoursEditor() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Hours',
          style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 6),
        const Text(
          'Set weekly hours and copy the previous day for repeat schedules.',
          style: TextStyle(
            fontSize: 12,
            color: BiteRaterTheme.mutedInk,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 12),
        ...List.generate(
          _businessHours.length,
          (index) => _buildBusinessDayRow(index),
        ),
      ],
    );
  }

  Widget _buildBusinessDayRow(int dayIndex) {
    final entry = _businessHours[dayIndex];
    final previousDayIndex =
        (dayIndex - 1 + _businessHours.length) % _businessHours.length;
    final copiedFromPrevious = _copyPreviousDay[entry.day] ?? false;

    return Container(
      margin: EdgeInsets.only(
        bottom: dayIndex == _businessHours.length - 1 ? 0 : 12,
      ),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  entry.day,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              const Text(
                'Closed',
                style: TextStyle(
                  fontSize: 13,
                  color: BiteRaterTheme.ink,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(width: 6),
              Switch(
                value: entry.closed,
                onChanged: (value) => _setBusinessDayClosed(dayIndex, value),
              ),
            ],
          ),
          CheckboxListTile(
            value: copiedFromPrevious,
            onChanged: (value) {
              _copyPreviousBusinessDayHours(dayIndex, value ?? false);
            },
            dense: true,
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            visualDensity: VisualDensity.compact,
            title: Text(
              'Copy ${_businessHours[previousDayIndex].day}',
              style: const TextStyle(fontSize: 13),
            ),
          ),
          if (!entry.closed) ...[
            const SizedBox(height: 8),
            LayoutBuilder(
              builder: (context, constraints) {
                final openField = DropdownButtonFormField<String>(
                  key: ValueKey('${entry.day}-open-${entry.opensAt}'),
                  isExpanded: true,
                  initialValue: _businessHourOptions.contains(entry.opensAt)
                      ? entry.opensAt
                      : '9:00 AM',
                  decoration: _hoursFieldDecoration('Open'),
                  items: _businessHourOptions
                      .map(
                        (option) => DropdownMenuItem<String>(
                          value: option,
                          child: Text(option, overflow: TextOverflow.ellipsis),
                        ),
                      )
                      .toList(),
                  onChanged: (value) {
                    if (value == null) {
                      return;
                    }
                    _updateBusinessHoursEntry(
                      dayIndex,
                      entry.copyWith(opensAt: value),
                    );
                  },
                );

                final closeField = DropdownButtonFormField<String>(
                  key: ValueKey('${entry.day}-close-${entry.closesAt}'),
                  isExpanded: true,
                  initialValue: _businessHourOptions.contains(entry.closesAt)
                      ? entry.closesAt
                      : '5:00 PM',
                  decoration: _hoursFieldDecoration('Close'),
                  items: _businessHourOptions
                      .map(
                        (option) => DropdownMenuItem<String>(
                          value: option,
                          child: Text(option, overflow: TextOverflow.ellipsis),
                        ),
                      )
                      .toList(),
                  onChanged: (value) {
                    if (value == null) {
                      return;
                    }
                    _updateBusinessHoursEntry(
                      dayIndex,
                      entry.copyWith(closesAt: value),
                    );
                  },
                );

                if (constraints.maxWidth < 420) {
                  return Column(
                    children: [
                      openField,
                      const SizedBox(height: 10),
                      closeField,
                    ],
                  );
                }

                return Row(
                  children: [
                    Expanded(child: openField),
                    const SizedBox(width: 10),
                    Expanded(child: closeField),
                  ],
                );
              },
            ),
          ],
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Edit Restaurant Info'),
      content: SizedBox(
        width: 420,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _OwnerTextField(
                controller: _nameController,
                label: 'Restaurant name',
              ),
              const SizedBox(height: 12),
              _OwnerTextField(
                controller: _addressController,
                label: 'Street address',
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: _OwnerTextField(
                      controller: _cityController,
                      label: 'City',
                    ),
                  ),
                  const SizedBox(width: 12),
                  SizedBox(
                    width: 90,
                    child: _OwnerTextField(
                      controller: _stateController,
                      label: 'State',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: _OwnerTextField(
                      controller: _zipController,
                      label: 'ZIP code',
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _OwnerTextField(
                      controller: _phoneController,
                      label: 'Phone',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              _OwnerTextField(
                controller: _bioController,
                label: 'Bio / Notes',
                maxLines: 5,
              ),
              const SizedBox(height: 16),
              _buildBusinessHoursEditor(),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isSaving ? null : () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _isSaving ? null : _save,
          child: Text(_isSaving ? 'Saving...' : 'Save'),
        ),
      ],
    );
  }
}

class _OwnerDishEditDialog extends StatefulWidget {
  final BitescoreDish dish;

  const _OwnerDishEditDialog({required this.dish});

  @override
  State<_OwnerDishEditDialog> createState() => _OwnerDishEditDialogState();
}

class _OwnerDishEditDialogState extends State<_OwnerDishEditDialog> {
  late final TextEditingController _nameController;
  late final TextEditingController _categoryController;
  late final TextEditingController _priceController;
  late bool _isActive;
  bool _isSaving = false;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.dish.name);
    _categoryController = TextEditingController(
      text: widget.dish.category ?? '',
    );
    _priceController = TextEditingController(
      text: widget.dish.priceLabel ?? '',
    );
    _isActive = widget.dish.isActive;
  }

  @override
  void dispose() {
    _nameController.dispose();
    _categoryController.dispose();
    _priceController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _isSaving = true;
    });

    try {
      await BiteScoreService.updateDishAsOwner(
        dish: widget.dish,
        name: _nameController.text,
        category: _categoryController.text,
        priceLabel: _priceController.text,
        isActive: _isActive,
      );
      if (!mounted) {
        return;
      }
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            AppErrorText.friendly(
              error,
              fallback: 'Could not update the dish right now.',
            ),
          ),
        ),
      );
      setState(() {
        _isSaving = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Edit Dish'),
      content: SizedBox(
        width: 420,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _OwnerTextField(controller: _nameController, label: 'Dish name'),
              const SizedBox(height: 12),
              _OwnerTextField(
                controller: _categoryController,
                label: 'Category (optional)',
              ),
              const SizedBox(height: 12),
              _OwnerTextField(
                controller: _priceController,
                label: 'Price label',
              ),
              const SizedBox(height: 12),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                value: _isActive,
                title: const Text('Dish available'),
                onChanged: (value) {
                  setState(() {
                    _isActive = value;
                  });
                },
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isSaving ? null : () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _isSaving ? null : _save,
          child: Text(_isSaving ? 'Saving...' : 'Save'),
        ),
      ],
    );
  }
}

class _OwnerDishMergeDialog extends StatefulWidget {
  final List<BitescoreDish> dishes;

  const _OwnerDishMergeDialog({required this.dishes});

  @override
  State<_OwnerDishMergeDialog> createState() => _OwnerDishMergeDialogState();
}

class _OwnerDishMergeDialogState extends State<_OwnerDishMergeDialog> {
  String? _sourceDishId;
  String? _targetDishId;
  bool _isSaving = false;

  List<BitescoreDish> get _targetOptions {
    if (_sourceDishId == null) {
      return widget.dishes;
    }
    return widget.dishes.where((dish) => dish.id != _sourceDishId).toList();
  }

  Future<void> _save() async {
    BitescoreDish? sourceDish;
    BitescoreDish? targetDish;
    for (final dish in widget.dishes) {
      if (dish.id == _sourceDishId) {
        sourceDish = dish;
      }
      if (dish.id == _targetDishId) {
        targetDish = dish;
      }
    }
    if (sourceDish == null || targetDish == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Choose both dishes to merge.')),
      );
      return;
    }

    setState(() {
      _isSaving = true;
    });

    try {
      await BiteScoreService.mergeDishesAsOwner(
        sourceDish: sourceDish,
        mergeTargetDish: targetDish,
      );
      if (!mounted) {
        return;
      }
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            AppErrorText.friendly(
              error,
              fallback: 'Could not merge the dishes right now.',
            ),
          ),
        ),
      );
      setState(() {
        _isSaving = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final targetOptions = _targetOptions;
    final canSave =
        !_isSaving && _sourceDishId != null && _targetDishId != null;

    return AlertDialog(
      title: const Text('Merge Dishes'),
      content: SizedBox(
        width: 420,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            DropdownButtonFormField<String>(
              initialValue: _sourceDishId,
              decoration: const InputDecoration(
                labelText: 'Duplicate dish',
                border: OutlineInputBorder(),
              ),
              items: widget.dishes
                  .map(
                    (dish) => DropdownMenuItem<String>(
                      value: dish.id,
                      child: Text(dish.name),
                    ),
                  )
                  .toList(),
              onChanged: _isSaving
                  ? null
                  : (value) {
                      setState(() {
                        _sourceDishId = value;
                        if (_targetDishId == _sourceDishId) {
                          _targetDishId = null;
                        }
                      });
                    },
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _targetDishId,
              decoration: const InputDecoration(
                labelText: 'Keep this dish',
                border: OutlineInputBorder(),
              ),
              items: targetOptions
                  .map(
                    (dish) => DropdownMenuItem<String>(
                      value: dish.id,
                      child: Text(dish.name),
                    ),
                  )
                  .toList(),
              onChanged: _isSaving
                  ? null
                  : (value) {
                      setState(() {
                        _targetDishId = value;
                      });
                    },
            ),
            const SizedBox(height: 12),
            const Text(
              'This keeps one dish visible and marks the duplicate dish unavailable.',
              style: TextStyle(color: Colors.black54),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isSaving ? null : () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: canSave ? _save : null,
          child: Text(_isSaving ? 'Merging...' : 'Merge Dishes'),
        ),
      ],
    );
  }
}
