import 'package:flutter/material.dart';

import '../models/dish_rating_aggregate.dart';
import '../services/app_error_text.dart';
import '../services/bitescore_service.dart';
import '../widgets/biterater_theme.dart';
import 'bitescore_dish_detail_screen.dart';

class PublicReviewerProfileScreen extends StatefulWidget {
  final String userId;

  const PublicReviewerProfileScreen({
    super.key,
    required this.userId,
  });

  @override
  State<PublicReviewerProfileScreen> createState() =>
      _PublicReviewerProfileScreenState();
}

class _PublicReviewerProfileScreenState
    extends State<PublicReviewerProfileScreen> {
  late Future<BiteScorePublicReviewerProfileData> _profileFuture;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  void _refresh() {
    _profileFuture =
        BiteScoreService.loadPublicReviewerProfileData(widget.userId);
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

  Future<void> _openDishReview(BiteScoreUserReviewEntry entry) async {
    final dish = entry.dish;
    final restaurant = entry.restaurant;
    if (dish == null || restaurant == null) {
      _showSnackBar('This dish is no longer available.');
      return;
    }

    try {
      final aggregate = await BiteScoreService.loadDishRatingAggregate(
            dish.id,
          ) ??
          DishRatingAggregate(
            dishId: dish.id,
            restaurantId: restaurant.id,
          );
      if (!mounted) {
        return;
      }

      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => BiteScoreDishDetailScreen(
            entry: BiteScoreHomeEntry(
              dish: dish,
              restaurant: restaurant,
              aggregate: aggregate,
            ),
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
          fallback: 'Could not open that dish right now.',
        ),
      );
    }
  }

  Widget _buildBadgeCard(BiteScorePublicReviewerProfileData profileData) {
    final badgeStyle = switch (profileData.badgeLabel) {
      'Top Contributor' => (
          BiteRaterTheme.ocean,
          Icons.workspace_premium_outlined,
        ),
      'Trusted Reviewer' => (
          BiteRaterTheme.grape,
          Icons.verified_outlined,
        ),
      'Active Reviewer' => (
          BiteRaterTheme.ocean,
          Icons.auto_awesome_outlined,
        ),
      _ => (
          BiteRaterTheme.coral,
          Icons.local_fire_department_outlined,
        ),
    };

    return BiteRaterTheme.liftedCard(
      radius: 24,
      borderColor: badgeStyle.$1.withOpacity(0.18),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: badgeStyle.$1.withOpacity(0.12),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Icon(
                    badgeStyle.$2,
                    color: badgeStyle.$1,
                    size: 24,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        profileData.publicDisplayName,
                        style: const TextStyle(
                          color: BiteRaterTheme.ink,
                          fontSize: 24,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        profileData.badgeLabel,
                        style: TextStyle(
                          color: badgeStyle.$1,
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
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
        border: Border.all(
          color: BiteRaterTheme.ocean.withOpacity(0.14),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            size: 14,
            color: BiteRaterTheme.ocean,
          ),
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
              if (notes.isNotEmpty) ...[
                const SizedBox(height: 6),
                Text(notes),
              ],
              const SizedBox(height: 10),
              Text(
                _dateLabel(entry.review.createdAt),
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

  Widget _buildBody(BiteScorePublicReviewerProfileData profileData) {
    return RefreshIndicator(
      onRefresh: () async {
        setState(_refresh);
        await _profileFuture;
      },
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _buildBadgeCard(profileData),
          const SizedBox(height: 24),
          const Text(
            'Reviews',
            style: TextStyle(
              color: BiteRaterTheme.ink,
              fontSize: 18,
              fontWeight: FontWeight.w900,
            ),
          ),
          if (profileData.reviews.isEmpty)
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
            ...profileData.reviews.map(_buildReviewCard),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: BiteRaterTheme.pageBackground,
      appBar: AppBar(
        title: const Text('Reviewer Profile'),
        centerTitle: true,
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

          final profileData = snapshot.data ??
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
              );
          return _buildBody(profileData);
        },
      ),
    );
  }
}
