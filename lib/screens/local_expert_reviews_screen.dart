import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import '../models/bitescore_restaurant.dart';
import '../models/dish_rating_aggregate.dart';
import '../services/app_error_text.dart';
import '../services/app_mode_state_service.dart';
import '../services/bitescore_service.dart';
import '../services/local_expert_review_service.dart';
import '../services/shared_location_state_service.dart';
import '../widgets/biterater_theme.dart';
import '../widgets/persistent_bottom_navigation.dart';
import 'bitescore_dish_detail_screen.dart';
import 'bitescore_restaurant_dishes_screen.dart';

enum LocalExpertReviewSort { mostRecent, highestRated, lowestRated, nearest }

class LocalExpertSelectedLocation {
  final String label;
  final double latitude;
  final double longitude;

  const LocalExpertSelectedLocation({
    required this.label,
    required this.latitude,
    required this.longitude,
  });
}

class LocalExpertReviewListPresenter {
  static const defaultSort = LocalExpertReviewSort.highestRated;
  static const hasPageSpecificLocationControls = false;
  static const nearestNoLocationMessage =
      'Select a location from the main BiteScore or BiteSaver screen to sort by nearest.';

  static List<LocalExpertReviewEntry> visibleEntries({
    required Iterable<LocalExpertReviewEntry> entries,
    required LocalExpertReviewSort sort,
    LocalExpertSelectedLocation? selectedLocation,
  }) {
    final filtered = entries.toList();

    filtered.sort((a, b) {
      final comparison = switch (sort) {
        LocalExpertReviewSort.highestRated => _compareScore(b, a),
        LocalExpertReviewSort.lowestRated => _compareScore(a, b),
        LocalExpertReviewSort.nearest when selectedLocation != null =>
          _compareDistance(a, b, selectedLocation),
        _ => _compareRecent(a, b),
      };
      return comparison == 0 ? a.review.id.compareTo(b.review.id) : comparison;
    });

    return filtered;
  }

  static LocalExpertSelectedLocation? selectedLocationFromSharedState(
    SharedLocationState state,
  ) {
    final currentPosition = state.currentPosition;
    if (state.usingCurrentLocation && currentPosition != null) {
      return LocalExpertSelectedLocation(
        label: state.searchText.trim().isNotEmpty
            ? state.searchText.trim()
            : 'Current location',
        latitude: currentPosition.latitude,
        longitude: currentPosition.longitude,
      );
    }

    final latitude = state.typedLatitude;
    final longitude = state.typedLongitude;
    if (state.usingTypedSearchLocation &&
        latitude != null &&
        longitude != null) {
      final label = state.typedLabel.trim().isNotEmpty
          ? state.typedLabel.trim()
          : state.searchText.trim();
      return LocalExpertSelectedLocation(
        label: label.isEmpty ? 'Selected location' : label,
        latitude: latitude,
        longitude: longitude,
      );
    }

    return null;
  }

  static double? distanceMilesFor(
    LocalExpertReviewEntry entry,
    LocalExpertSelectedLocation selectedLocation,
  ) {
    final latitude = entry.restaurant.latitude;
    final longitude = entry.restaurant.longitude;
    if (latitude == null || longitude == null) {
      return null;
    }
    final meters = Geolocator.distanceBetween(
      selectedLocation.latitude,
      selectedLocation.longitude,
      latitude,
      longitude,
    );
    return meters / 1609.344;
  }

  static String restaurantButtonLabel(BitescoreRestaurant restaurant) {
    final name = restaurant.name.trim();
    final city = restaurant.city.trim();
    final state = restaurant.state.trim();
    final location = [
      if (city.isNotEmpty) city,
      if (state.isNotEmpty) state,
    ].join(', ');
    if (location.isEmpty) {
      return name;
    }
    return '$name — $location';
  }

  static int _compareRecent(
    LocalExpertReviewEntry a,
    LocalExpertReviewEntry b,
  ) {
    final aDate = a.review.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
    final bDate = b.review.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
    return bDate.compareTo(aDate);
  }

  static int _compareScore(LocalExpertReviewEntry a, LocalExpertReviewEntry b) {
    final byScore = a.review.overallBiteScore.compareTo(
      b.review.overallBiteScore,
    );
    return byScore == 0 ? _compareRecent(a, b) : byScore;
  }

  static int _compareDistance(
    LocalExpertReviewEntry a,
    LocalExpertReviewEntry b,
    LocalExpertSelectedLocation selectedLocation,
  ) {
    final aDistance = distanceMilesFor(a, selectedLocation);
    final bDistance = distanceMilesFor(b, selectedLocation);
    if (aDistance == null && bDistance == null) {
      return _compareRecent(a, b);
    }
    if (aDistance == null) {
      return 1;
    }
    if (bDistance == null) {
      return -1;
    }
    final byDistance = aDistance.compareTo(bDistance);
    return byDistance == 0 ? _compareRecent(a, b) : byDistance;
  }
}

class LocalExpertReviewDestinationRow extends StatelessWidget {
  final String label;
  final IconData leadingIcon;
  final VoidCallback onTap;

  const LocalExpertReviewDestinationRow({
    super.key,
    required this.label,
    required this.leadingIcon,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: BiteRaterTheme.ocean.withValues(alpha: 0.045),
      borderRadius: BorderRadius.circular(13),
      child: InkWell(
        borderRadius: BorderRadius.circular(13),
        onTap: onTap,
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(13),
            border: Border.all(
              color: BiteRaterTheme.ocean.withValues(alpha: 0.15),
            ),
          ),
          child: Row(
            children: [
              Icon(leadingIcon, size: 17, color: BiteRaterTheme.ocean),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  label,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: BiteRaterTheme.ink,
                    fontWeight: FontWeight.w900,
                    decoration: TextDecoration.none,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              const Icon(
                Icons.chevron_right,
                size: 19,
                color: BiteRaterTheme.mutedInk,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class LocalExpertReviewContentRegion extends StatelessWidget {
  final String? distanceLabel;
  final String headline;
  final String notes;
  final String dateLabel;
  final VoidCallback onTap;

  const LocalExpertReviewContentRegion({
    super.key,
    this.distanceLabel,
    required this.headline,
    required this.notes,
    required this.dateLabel,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: BiteRaterTheme.ocean.withValues(alpha: 0.035),
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.fromLTRB(10, 9, 10, 8),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: BiteRaterTheme.ocean.withValues(alpha: 0.09),
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if ((distanceLabel ?? '').trim().isNotEmpty) ...[
                Text(
                  distanceLabel!.trim(),
                  style: const TextStyle(
                    color: BiteRaterTheme.mutedInk,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 6),
              ],
              if (headline.isNotEmpty) ...[
                Text(
                  headline,
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
              ],
              if (notes.isNotEmpty) ...[
                SizedBox(height: headline.isNotEmpty ? 6 : 0),
                Text(notes),
              ],
              if (headline.isEmpty && notes.isEmpty)
                const Text(
                  'Review details',
                  style: TextStyle(
                    color: BiteRaterTheme.mutedInk,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              const SizedBox(height: 10),
              const Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  Text(
                    'View review',
                    style: TextStyle(
                      color: BiteRaterTheme.ocean,
                      fontWeight: FontWeight.w900,
                      decoration: TextDecoration.none,
                    ),
                  ),
                  SizedBox(width: 3),
                  Icon(
                    Icons.chevron_right,
                    size: 19,
                    color: BiteRaterTheme.ocean,
                  ),
                ],
              ),
              const SizedBox(height: 2),
              Text(
                dateLabel,
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
    );
  }
}

class LocalExpertReviewsScreen extends StatefulWidget {
  final String reviewerUserId;
  final String reviewerDisplayName;
  final String expertTypeId;
  final String expertDisplayName;

  const LocalExpertReviewsScreen({
    super.key,
    required this.reviewerUserId,
    required this.reviewerDisplayName,
    required this.expertTypeId,
    required this.expertDisplayName,
  });

  static String emptyMessageFor(String expertDisplayName) {
    return 'No $expertDisplayName reviews are available.';
  }

  @override
  State<LocalExpertReviewsScreen> createState() =>
      _LocalExpertReviewsScreenState();
}

class _LocalExpertReviewsScreenState extends State<LocalExpertReviewsScreen> {
  late Future<List<LocalExpertReviewEntry>> _reviewsFuture;
  LocalExpertReviewSort _sort = LocalExpertReviewListPresenter.defaultSort;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  void _refresh() {
    _reviewsFuture = LocalExpertReviewService.loadExpertReviews(
      reviewerUserId: widget.reviewerUserId,
      expertTypeId: widget.expertTypeId,
    );
  }

  String get _title {
    final reviewerName = widget.reviewerDisplayName.trim().isEmpty
        ? 'Reviewer'
        : widget.reviewerDisplayName.trim();
    return "$reviewerName's ${widget.expertDisplayName} Reviews";
  }

  String _scoreLabel(double value) {
    return value <= 0 ? '--' : value.toStringAsFixed(0);
  }

  String _dateLabel(DateTime? value) {
    if (value == null) {
      return 'Recent';
    }

    final local = value.toLocal();
    const months = <String>[
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

  LocalExpertSelectedLocation? _sharedSelectedLocation() {
    return LocalExpertReviewListPresenter.selectedLocationFromSharedState(
      SharedLocationStateService.state,
    );
  }

  Future<void> _openReview(LocalExpertReviewEntry entry) async {
    await _openDishDetail(entry);
  }

  Future<void> _openExactReview(LocalExpertReviewEntry entry) async {
    await _openDishDetail(entry, targetReviewId: entry.review.id);
  }

  Future<void> _openDishDetail(
    LocalExpertReviewEntry entry, {
    String? targetReviewId,
  }) async {
    try {
      final aggregate =
          await BiteScoreService.loadDishRatingAggregate(entry.dish.id) ??
          DishRatingAggregate(
            dishId: entry.dish.id,
            restaurantId: entry.restaurant.id,
          );
      if (!mounted) {
        return;
      }

      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => BiteScoreDishDetailScreen(
            entry: BiteScoreHomeEntry(
              dish: entry.dish,
              restaurant: entry.restaurant,
              aggregate: aggregate,
            ),
            targetReviewId: targetReviewId,
          ),
        ),
      );

      if (mounted) {
        setState(_refresh);
      }
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            content: Text(
              AppErrorText.friendly(
                error,
                fallback: 'Could not open that review right now.',
              ),
            ),
          ),
        );
    }
  }

  Future<void> _openRestaurant(BitescoreRestaurant restaurant) async {
    try {
      final entries = await BiteScoreService.loadEntriesForRestaurant(
        restaurant,
      );
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
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            content: Text(
              AppErrorText.friendly(
                error,
                fallback: 'Could not open that restaurant right now.',
              ),
            ),
          ),
        );
    }
  }

  Widget _buildControls() {
    final selectedLocation = _sharedSelectedLocation();
    final nearestNeedsLocation =
        _sort == LocalExpertReviewSort.nearest && selectedLocation == null;

    return BiteRaterTheme.liftedCard(
      margin: const EdgeInsets.only(bottom: 14),
      radius: 18,
      borderColor: BiteRaterTheme.ocean.withValues(alpha: 0.12),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: 10,
              runSpacing: 10,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                SizedBox(
                  width: 158,
                  child: DropdownButtonFormField<LocalExpertReviewSort>(
                    initialValue: _sort,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      labelText: 'Sort',
                      isDense: true,
                      border: OutlineInputBorder(),
                      contentPadding: EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 7,
                      ),
                    ),
                    items: const [
                      DropdownMenuItem(
                        value: LocalExpertReviewSort.highestRated,
                        child: Text('Highest rated'),
                      ),
                      DropdownMenuItem(
                        value: LocalExpertReviewSort.mostRecent,
                        child: Text('Most recent'),
                      ),
                      DropdownMenuItem(
                        value: LocalExpertReviewSort.lowestRated,
                        child: Text('Lowest rated'),
                      ),
                      DropdownMenuItem(
                        value: LocalExpertReviewSort.nearest,
                        child: Text('Nearest my selected location'),
                      ),
                    ],
                    onChanged: (value) {
                      if (value == null) {
                        return;
                      }
                      setState(() {
                        _sort = value;
                      });
                    },
                  ),
                ),
              ],
            ),
            if (nearestNeedsLocation) ...[
              const SizedBox(height: 8),
              const Text(
                LocalExpertReviewListPresenter.nearestNoLocationMessage,
                style: TextStyle(
                  color: BiteRaterTheme.mutedInk,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildReviewCard(LocalExpertReviewEntry entry) {
    final headline = entry.review.headline?.trim() ?? '';
    final notes = entry.review.notes?.trim() ?? '';
    final selectedLocation = _sharedSelectedLocation();
    final distance = selectedLocation == null
        ? null
        : LocalExpertReviewListPresenter.distanceMilesFor(
            entry,
            selectedLocation,
          );

    return BiteRaterTheme.liftedCard(
      margin: const EdgeInsets.only(bottom: 12),
      radius: 20,
      borderColor: BiteRaterTheme.grape.withValues(alpha: 0.12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      LocalExpertReviewDestinationRow(
                        label: entry.dishName,
                        leadingIcon: Icons.restaurant_menu,
                        onTap: () => _openReview(entry),
                      ),
                      const SizedBox(height: 7),
                      LocalExpertReviewDestinationRow(
                        label:
                            LocalExpertReviewListPresenter.restaurantButtonLabel(
                              entry.restaurant,
                            ),
                        leadingIcon: Icons.storefront_outlined,
                        onTap: () => _openRestaurant(entry.restaurant),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 10),
                Text(
                  _scoreLabel(entry.review.overallBiteScore),
                  style: const TextStyle(
                    color: BiteRaterTheme.scoreFlame,
                    fontSize: 18,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            LocalExpertReviewContentRegion(
              distanceLabel: distance == null
                  ? null
                  : '${distance.toStringAsFixed(1)} mi away',
              headline: headline,
              notes: notes,
              dateLabel: _dateLabel(entry.review.createdAt),
              onTap: () => _openExactReview(entry),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Text(
          LocalExpertReviewsScreen.emptyMessageFor(widget.expertDisplayName),
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: BiteRaterTheme.mutedInk,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }

  Widget _buildErrorState(Object? error) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              AppErrorText.friendly(
                error ?? StateError('Could not load reviews.'),
                fallback: 'Could not load those reviews right now.',
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 12),
            ElevatedButton(
              onPressed: () => setState(_refresh),
              child: const Text('Try Again'),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: BiteRaterTheme.pageBackground,
      appBar: AppBar(title: Text(_title), centerTitle: true),
      bottomNavigationBar: const PersistentBottomNavigation(
        mode: AppMode.biteScore,
      ),
      body: FutureBuilder<List<LocalExpertReviewEntry>>(
        future: _reviewsFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(
              child: SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(strokeWidth: 2.4),
              ),
            );
          }

          if (snapshot.hasError) {
            return _buildErrorState(snapshot.error);
          }

          final reviews = LocalExpertReviewListPresenter.visibleEntries(
            entries: snapshot.data ?? const <LocalExpertReviewEntry>[],
            sort: _sort,
            selectedLocation: _sharedSelectedLocation(),
          );

          return RefreshIndicator(
            onRefresh: () async {
              setState(_refresh);
              await _reviewsFuture;
            },
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                _buildControls(),
                if (reviews.isEmpty)
                  SizedBox(height: 260, child: _buildEmptyState())
                else
                  ...reviews.map(_buildReviewCard),
              ],
            ),
          );
        },
      ),
    );
  }
}
