import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../models/dish_rating_aggregate.dart';
import '../models/local_expert_badge.dart';
import '../services/app_error_text.dart';
import '../services/app_mode_state_service.dart';
import '../services/bitescore_service.dart';
import '../services/local_expert_badge_service.dart';
import '../widgets/biterater_theme.dart';
import '../widgets/local_expert_badge_widget.dart';
import '../widgets/persistent_bottom_navigation.dart';
import '../widgets/reviewer_activity_pill.dart';
import 'bitescore_dish_detail_screen.dart';

typedef PublicReviewerProfileLoader =
    Future<BiteScorePublicReviewerProfileData> Function(String userId);
typedef PublicReviewerBadgesLoader =
    Future<List<LocalExpertBadge>> Function(String userId);
typedef PublicReviewerReviewEntryLoader =
    Future<BiteScoreUserReviewEntry?> Function(BiteScoreUserReviewEntry entry);
typedef PublicReviewerAggregateLoader =
    Future<DishRatingAggregate?> Function(String dishId);
typedef PublicReviewerDishDestinationBuilder =
    Widget Function({
      required BiteScoreHomeEntry entry,
      required String? targetReviewId,
      required bool scrollToReviewSection,
      required String? editReviewId,
    });

class PublicReviewerProfileScreen extends StatefulWidget {
  final String userId;
  final PublicReviewerProfileLoader? profileLoader;
  final PublicReviewerBadgesLoader? badgesLoader;
  final PublicReviewerReviewEntryLoader? reviewEntryLoader;
  final PublicReviewerAggregateLoader? aggregateLoader;
  final PublicReviewerDishDestinationBuilder? dishDestinationBuilder;
  final bool Function(BiteScoreUserReviewEntry entry)? canEditReview;

  const PublicReviewerProfileScreen({
    super.key,
    required this.userId,
    this.profileLoader,
    this.badgesLoader,
    this.reviewEntryLoader,
    this.aggregateLoader,
    this.dishDestinationBuilder,
    this.canEditReview,
  });

  @override
  State<PublicReviewerProfileScreen> createState() =>
      _PublicReviewerProfileScreenState();
}

class _PublicReviewerProfileScreenState
    extends State<PublicReviewerProfileScreen> {
  late Future<BiteScorePublicReviewerProfileData> _profileFuture;
  late Future<List<LocalExpertBadge>> _localExpertBadgesFuture;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  void _refresh() {
    final profileLoader = widget.profileLoader;
    _profileFuture = profileLoader == null
        ? BiteScoreService.loadPublicReviewerProfileData(widget.userId)
        : profileLoader(widget.userId);
    final badgesLoader = widget.badgesLoader;
    _localExpertBadgesFuture = badgesLoader == null
        ? LocalExpertBadgeService.loadBadgesForUser(widget.userId)
        : badgesLoader(widget.userId);
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

  bool _canEditReview(BiteScoreUserReviewEntry entry) {
    final canEditReview = widget.canEditReview;
    if (canEditReview != null) {
      return canEditReview(entry);
    }
    final user = FirebaseAuth.instance.currentUser;
    return user != null &&
        !user.isAnonymous &&
        entry.review.userId.trim() == user.uid;
  }

  Future<void> _openDishReview(
    BiteScoreUserReviewEntry entry, {
    bool editReview = false,
  }) async {
    try {
      final reviewEntryLoader = widget.reviewEntryLoader;
      final refreshedEntry = reviewEntryLoader == null
          ? await _loadCustomerVisibleReviewEntry(entry)
          : await reviewEntryLoader(entry);
      if (refreshedEntry == null ||
          !BiteScoreService.isCustomerVisibleReviewEntry(refreshedEntry)) {
        _showSnackBar('This dish is no longer available.');
        return;
      }
      final dish = refreshedEntry.dish!;
      final restaurant = refreshedEntry.restaurant!;

      final aggregateLoader = widget.aggregateLoader;
      final aggregate =
          (aggregateLoader == null
              ? await BiteScoreService.loadDishRatingAggregate(dish.id)
              : await aggregateLoader(dish.id)) ??
          DishRatingAggregate(dishId: dish.id, restaurantId: restaurant.id);
      if (!mounted) {
        return;
      }

      final destinationBuilder = widget.dishDestinationBuilder;
      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) {
            final homeEntry = BiteScoreHomeEntry(
              dish: dish,
              restaurant: restaurant,
              aggregate: aggregate,
            );
            if (destinationBuilder != null) {
              return destinationBuilder(
                entry: homeEntry,
                targetReviewId: editReview ? null : entry.review.id,
                scrollToReviewSection: editReview,
                editReviewId: editReview ? entry.review.id : null,
              );
            }
            return BiteScoreDishDetailScreen(
              entry: homeEntry,
              targetReviewId: editReview ? null : entry.review.id,
              scrollToReviewSection: editReview,
              editReviewId: editReview ? entry.review.id : null,
            );
          },
        ),
      );

      if (mounted) {
        setState(_refresh);
      }
    } catch (error) {
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not open that dish right now.',
        ),
      );
    }
  }

  Future<BiteScoreUserReviewEntry?> _loadCustomerVisibleReviewEntry(
    BiteScoreUserReviewEntry entry,
  ) {
    return BiteScoreService.loadCustomerVisibleReviewEntry(entry.review);
  }

  Widget _buildBadgeCard(BiteScorePublicReviewerProfileData profileData) {
    return BiteRaterTheme.liftedCard(
      radius: 24,
      borderColor: BiteRaterTheme.ocean.withValues(alpha: 0.18),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: 10,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(
                  profileData.publicDisplayName,
                  style: const TextStyle(
                    color: BiteRaterTheme.ink,
                    fontSize: 24,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                ReviewerActivityPill(reviewCount: profileData.reviewCount),
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
                  '${profileData.accountAgeDays} days active',
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
        color: BiteRaterTheme.ocean.withOpacity(0.08),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: BiteRaterTheme.ocean.withOpacity(0.14)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: BiteRaterTheme.ocean),
          const SizedBox(width: 6),
          Text(
            label,
            style: const TextStyle(
              color: BiteRaterTheme.ink,
              fontSize: 12,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildReviewCard(BiteScoreUserReviewEntry entry) {
    final headline = entry.review.headline?.trim() ?? '';
    final notes = entry.review.notes?.trim() ?? '';
    final category = entry.categoryDisplayName;
    final canEditReview = _canEditReview(entry);

    return BiteRaterTheme.liftedCard(
      margin: const EdgeInsets.only(top: 12),
      radius: 20,
      borderColor: BiteRaterTheme.grape.withOpacity(0.14),
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: () => _openDishReview(entry),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          entry.dishName,
                          style: const TextStyle(
                            color: BiteRaterTheme.ink,
                            fontSize: 16,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          entry.restaurantName,
                          style: const TextStyle(
                            color: BiteRaterTheme.ocean,
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        if (category != null) ...[
                          const SizedBox(height: 3),
                          Text(
                            category,
                            style: const TextStyle(
                              color: BiteRaterTheme.mutedInk,
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
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
              if (headline.isNotEmpty) ...[
                const SizedBox(height: 10),
                Text(
                  headline,
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
              ],
              if (notes.isNotEmpty) ...[const SizedBox(height: 6), Text(notes)],
              const SizedBox(height: 10),
              Text(
                _dateLabel(entry.review.createdAt),
                style: const TextStyle(
                  fontSize: 12,
                  color: BiteRaterTheme.mutedInk,
                  fontWeight: FontWeight.w600,
                ),
              ),
              if (canEditReview) ...[
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerLeft,
                  child: OutlinedButton.icon(
                    onPressed: () => _openDishReview(entry, editReview: true),
                    icon: const Icon(Icons.edit_outlined, size: 15),
                    label: const Text('Edit review'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: BiteRaterTheme.grape,
                      side: BorderSide(
                        color: BiteRaterTheme.grape.withValues(alpha: 0.22),
                      ),
                      visualDensity: const VisualDensity(
                        horizontal: -2,
                        vertical: -2,
                      ),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 6,
                      ),
                      minimumSize: Size.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildLocalExpertBadgesSection(
    BiteScorePublicReviewerProfileData profileData,
  ) {
    return FutureBuilder<List<LocalExpertBadge>>(
      future: _localExpertBadgesFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Padding(
            padding: EdgeInsets.only(top: 16),
            child: Align(
              alignment: Alignment.centerLeft,
              child: SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
          );
        }

        if (snapshot.hasError ||
            snapshot.data == null ||
            snapshot.data!.isEmpty) {
          return const SizedBox.shrink();
        }

        final badges = snapshot.data!;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 24),
            const Text(
              'Local Expert Badges',
              style: TextStyle(
                color: BiteRaterTheme.ink,
                fontSize: 18,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                for (final badge in badges)
                  InkWell(
                    borderRadius: BorderRadius.circular(18),
                    onTap: () => showLocalExpertBadgeDetails(
                      context,
                      badge,
                      reviewerUserId: profileData.userId,
                      reviewerDisplayName: profileData.publicDisplayName,
                    ),
                    child: LocalExpertBadgeWidget(badge: badge),
                  ),
              ],
            ),
          ],
        );
      },
    );
  }

  Widget _buildBody(BiteScorePublicReviewerProfileData profileData) {
    final visibleReviews = profileData.reviews
        .where(BiteScoreService.isCustomerVisibleReviewEntry)
        .toList(growable: false);
    return RefreshIndicator(
      onRefresh: () async {
        setState(_refresh);
        await _profileFuture;
      },
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _buildBadgeCard(profileData),
          _buildLocalExpertBadgesSection(profileData),
          const SizedBox(height: 24),
          const Text(
            'Reviews',
            style: TextStyle(
              color: BiteRaterTheme.ink,
              fontSize: 18,
              fontWeight: FontWeight.w900,
            ),
          ),
          if (visibleReviews.isEmpty)
            BiteRaterTheme.liftedCard(
              margin: const EdgeInsets.only(top: 12),
              radius: 20,
              borderColor: BiteRaterTheme.lineBlue,
              child: const Padding(
                padding: EdgeInsets.all(16),
                child: Text(
                  'No public BiteScore reviews yet.',
                  style: TextStyle(
                    color: BiteRaterTheme.mutedInk,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            )
          else
            ...visibleReviews.map(_buildReviewCard),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: BiteRaterTheme.pageBackground,
      appBar: AppBar(
        leadingWidth: 64,
        leading: IconButton(
          tooltip: MaterialLocalizations.of(context).backButtonTooltip,
          onPressed: () => Navigator.of(context).maybePop(),
          padding: const EdgeInsets.all(16),
          constraints: const BoxConstraints(minWidth: 56, minHeight: 56),
          icon: const BackButtonIcon(),
        ),
        title: const Text('Reviewer Profile'),
        centerTitle: true,
      ),
      bottomNavigationBar: const PersistentBottomNavigation(
        mode: AppMode.biteScore,
      ),
      body: FutureBuilder<BiteScorePublicReviewerProfileData>(
        future: _profileFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
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
                            StateError(
                              'Could not load that profile right now.',
                            ),
                        fallback: 'Could not load that profile right now.',
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

          final profileData =
              snapshot.data ??
              BiteScorePublicReviewerProfileData(
                userId: widget.userId,
                publicDisplayName: 'Reviewer',
                chosenUsername: null,
                fallbackUsername: 'Reviewer',
                reviews: const <BiteScoreUserReviewEntry>[],
                badgeLabel: 'New Reviewer',
                reviewCount: 0,
                helpfulVotesReceived: 0,
                accountAgeDays: 0,
                moderationFlagCount: 0,
                contributionPoints: 0,
              );
          return _buildBody(profileData);
        },
      ),
    );
  }
}
