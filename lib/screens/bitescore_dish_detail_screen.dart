import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../models/bitescore_dish.dart';
import '../models/bitescore_restaurant.dart';
import '../models/dish_rating_aggregate.dart';
import '../models/dish_review.dart';
import '../models/review_feedback_vote.dart';
import '../services/admin_access_service.dart';
import '../services/app_error_text.dart';
import '../services/bitescore_sign_in_gate.dart';
import '../services/bitescore_service.dart';
import '../widgets/app_mode_switcher_bar.dart';
import '../widgets/biterater_theme.dart';
import 'bitescore_restaurant_dishes_screen.dart';
import 'public_reviewer_profile_screen.dart';

class BiteScoreDishDetailScreen extends StatefulWidget {
  final BiteScoreHomeEntry entry;
  final String? distanceLabel;

  const BiteScoreDishDetailScreen({
    super.key,
    required this.entry,
    this.distanceLabel,
  });

  @override
  State<BiteScoreDishDetailScreen> createState() =>
      _BiteScoreDishDetailScreenState();
}

class _BiteScoreDishDetailScreenState extends State<BiteScoreDishDetailScreen> {
  static const String _reviewSortMostHelpful = 'Most helpful';
  static const String _reviewSortMostRecent = 'Most recent';
  static const String _reviewSortHighestScore = 'Highest score';
  static const String _reviewSortLowestScore = 'Lowest score';
  static const List<String> _reviewSortOptions = <String>[
    _reviewSortMostHelpful,
    _reviewSortMostRecent,
    _reviewSortHighestScore,
    _reviewSortLowestScore,
  ];
  static const List<String> _dishCategoryOptions = <String>[
    'Pizza',
    'Sandwich',
    'Burger',
    'Tacos',
    'Pasta',
    'Wings',
    'Breakfast',
    'Seafood',
    'Steak',
    'Salad',
    'Dessert',
    'Appetizer',
  ];

  Future<_DishDetailData>? _detailFuture;
  final ScrollController _scrollController = ScrollController();
  final GlobalKey _reviewSectionKey = GlobalKey();
  final TextEditingController _headlineController = TextEditingController();
  final TextEditingController _notesController = TextEditingController();
  late BiteScoreHomeEntry _currentEntry;

  double? _overallImpression;
  double? _tastinessScore;
  double? _qualityScore;
  double? _valueScore;
  bool _isSaving = false;
  bool _isFavoriteDish = false;
  bool _isSavingFavoriteDish = false;
  bool _hasDishChanges = false;
  int _visibleReviewCount = 3;
  String _selectedReviewSort = _reviewSortMostHelpful;
  User? get _currentUser => FirebaseAuth.instance.currentUser;
  bool get _isOwner =>
      _currentUser != null &&
      !_currentUser!.isAnonymous &&
      _currentEntry.restaurant.ownerUserId?.trim() == _currentUser!.uid;
  bool get _isAdmin => AdminAccessService.isAdminUser(_currentUser);
  bool get _canManageDish => _isOwner || _isAdmin;

  @override
  void initState() {
    super.initState();
    _currentEntry = widget.entry;
    _refresh();
  }

  @override
  void dispose() {
    _scrollController.dispose();
    _headlineController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  void _refresh() {
    _detailFuture = _loadDetailData();
  }

  void _popWithDishChanges() {
    Navigator.of(context).pop(_hasDishChanges);
  }

  Future<_DishDetailData> _loadDetailData() async {
    await BiteScoreService.evaluatePendingDishEditSuggestionsForDish(
      _currentEntry.dish.id,
    );
    final baseLoadResults = await Future.wait<Object?>([
      BiteScoreService.loadDishById(_currentEntry.dish.id),
      BiteScoreService.loadRestaurantById(_currentEntry.restaurant.id),
      BiteScoreService.isDishFavoritedByCurrentUser(_currentEntry.dish.id),
    ]);
    final refreshedDish =
        (baseLoadResults[0] as BitescoreDish?) ?? _currentEntry.dish;
    final refreshedRestaurant =
        (baseLoadResults[1] as BitescoreRestaurant?) ??
        _currentEntry.restaurant;
    final isFavoriteDish = baseLoadResults[2] as bool;

    final dishLoadResults = await Future.wait<Object?>([
      BiteScoreService.loadDishRatingAggregate(refreshedDish.id),
      BiteScoreService.loadDishReviews(refreshedDish.id),
    ]);
    final aggregate =
        (dishLoadResults[0] as DishRatingAggregate?) ?? _currentEntry.aggregate;
    final reviews = dishLoadResults[1] as List<DishReview>;

    final reviewMetadataResults = await Future.wait<Object>([
      BiteScoreService.loadReviewTrustSummaries(
        reviews,
        currentUserId: _currentUser?.uid,
      ),
      BiteScoreService.loadReviewerBadgeLabels(reviews),
      BiteScoreService.loadReviewerDisplayNames(reviews),
    ]);
    final trustByReviewId =
        reviewMetadataResults[0] as Map<String, ReviewTrustSummary>;
    final reviewerBadgesByUserId =
        reviewMetadataResults[1] as Map<String, String>;
    final reviewerNamesByUserId =
        reviewMetadataResults[2] as Map<String, String>;

    reviews.sort((a, b) {
      final aTrust = trustByReviewId[a.id] ?? const ReviewTrustSummary();
      final bTrust = trustByReviewId[b.id] ?? const ReviewTrustSummary();

      final byHelpfulScore = bTrust.helpfulScore.compareTo(aTrust.helpfulScore);
      if (byHelpfulScore != 0) {
        return byHelpfulScore;
      }

      final aDate = a.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
      final bDate = b.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
      final byDate = bDate.compareTo(aDate);
      if (byDate != 0) {
        return byDate;
      }

      return a.id.compareTo(b.id);
    });
    _currentEntry = BiteScoreHomeEntry(
      dish: refreshedDish,
      restaurant: refreshedRestaurant,
      aggregate: aggregate,
    );
    _isFavoriteDish = isFavoriteDish;

    return _DishDetailData(
      dish: refreshedDish,
      restaurant: refreshedRestaurant,
      aggregate: aggregate,
      reviews: reviews,
      trustByReviewId: trustByReviewId,
      reviewerBadgesByUserId: reviewerBadgesByUserId,
      reviewerNamesByUserId: reviewerNamesByUserId,
    );
  }

  List<DishReview> _sortedReviewsForDisplay(List<DishReview> reviews) {
    final sortedReviews = List<DishReview>.from(reviews);
    if (_selectedReviewSort == _reviewSortMostHelpful) {
      return sortedReviews;
    }

    sortedReviews.sort((a, b) {
      if (_selectedReviewSort == _reviewSortMostRecent) {
        final aDate = a.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
        final bDate = b.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
        final byDate = bDate.compareTo(aDate);
        return byDate != 0 ? byDate : a.id.compareTo(b.id);
      }

      final byScore = _selectedReviewSort == _reviewSortHighestScore
          ? b.overallBiteScore.compareTo(a.overallBiteScore)
          : a.overallBiteScore.compareTo(b.overallBiteScore);
      if (byScore != 0) {
        return byScore;
      }

      final aDate = a.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
      final bDate = b.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
      final byDate = bDate.compareTo(aDate);
      return byDate != 0 ? byDate : a.id.compareTo(b.id);
    });
    return sortedReviews;
  }

  Widget _buildReviewSortDropdown() {
    return DropdownButtonHideUnderline(
      child: DropdownButton<String>(
        value: _selectedReviewSort,
        isDense: true,
        borderRadius: BorderRadius.circular(14),
        iconSize: 18,
        style: const TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w700,
          color: BiteRaterTheme.grape,
        ),
        items: _reviewSortOptions
            .map(
              (option) =>
                  DropdownMenuItem<String>(value: option, child: Text(option)),
            )
            .toList(),
        onChanged: (value) {
          if (value == null) {
            return;
          }
          setState(() {
            _selectedReviewSort = value;
          });
        },
      ),
    );
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

  Future<void> _openDishCategoryEditor(BitescoreDish dish) async {
    final canWrite = await BiteScoreSignInGate.ensureSignedInForWrite(context);
    if (!canWrite || !mounted) {
      return;
    }

    final category = await showDialog<String>(
      context: context,
      builder: (context) {
        return _DishCategoryDialog(
          initialCategory: dish.category,
          categoryOptions: _dishCategoryOptions,
        );
      },
    );

    if (category == null || !mounted) {
      return;
    }

    try {
      await BiteScoreService.updateDishAsOwner(
        dish: dish,
        name: dish.name,
        category: category,
        priceLabel: dish.priceLabel ?? '',
        isActive: dish.isActive,
      );
      if (!mounted) {
        return;
      }
      _hasDishChanges = true;
      setState(_refresh);
      _showSnackBar('Category updated.');
    } catch (error) {
      if (!mounted) {
        return;
      }
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not update this category right now.',
        ),
      );
    }
  }

  Future<void> _scrollToReviewSection() async {
    final context = _reviewSectionKey.currentContext;
    if (context == null) {
      return;
    }

    await Scrollable.ensureVisible(
      context,
      duration: const Duration(milliseconds: 280),
      curve: Curves.easeOutCubic,
      alignment: 0.05,
    );
  }

  Future<void> _openRestaurantPage() async {
    final restaurantEntries = await BiteScoreService.loadEntriesForRestaurant(
      _currentEntry.restaurant,
    );
    if (!mounted) {
      return;
    }

    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => BiteScoreRestaurantDishesScreen(
          restaurant: _currentEntry.restaurant,
          entries: restaurantEntries,
        ),
      ),
    );
  }

  Future<void> _openReviewerProfile(String reviewerUserId) async {
    final trimmedUserId = reviewerUserId.trim();
    if (trimmedUserId.isEmpty) {
      return;
    }

    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => PublicReviewerProfileScreen(userId: trimmedUserId),
      ),
    );
  }

  Future<void> _toggleDishFavorite() async {
    final canSave = await BiteScoreSignInGate.ensureSignedInForFavorites(
      context,
    );
    if (!canSave || !mounted || _isSavingFavoriteDish) {
      return;
    }

    final nextIsFavorite = !_isFavoriteDish;

    setState(() {
      _isSavingFavoriteDish = true;
      _isFavoriteDish = nextIsFavorite;
    });

    try {
      await BiteScoreService.setDishFavorite(
        dish: _currentEntry.dish,
        restaurant: _currentEntry.restaurant,
        isFavorite: nextIsFavorite,
      );
      if (!mounted) {
        return;
      }
      _showSnackBar(
        nextIsFavorite
            ? 'Saved dish to your profile.'
            : 'Removed dish from your saved list.',
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _isFavoriteDish = !nextIsFavorite;
      });
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not update this saved dish right now.',
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isSavingFavoriteDish = false;
        });
      }
    }
  }

  Future<void> _submitReview() async {
    final overallImpression = _overallImpression;
    final tastinessScore = _tastinessScore;
    final qualityScore = _qualityScore;
    final valueScore = _valueScore;
    if (overallImpression == null ||
        tastinessScore == null ||
        qualityScore == null ||
        valueScore == null) {
      _showSnackBar('Please rate each category before submitting.');
      return;
    }

    final canWrite = await BiteScoreSignInGate.ensureSignedInForWrite(context);
    if (!canWrite || !mounted) {
      return;
    }

    setState(() {
      _isSaving = true;
    });

    try {
      await BiteScoreService.addReviewForDish(
        dish: _currentEntry.dish,
        restaurant: _currentEntry.restaurant,
        overallImpression: overallImpression,
        headline: _headlineController.text,
        notes: _notesController.text,
        tastinessScore: tastinessScore,
        qualityScore: qualityScore,
        valueScore: valueScore,
      );

      _headlineController.clear();
      _notesController.clear();

      if (!mounted) {
        return;
      }

      _showSnackBar('Review saved.');

      setState(() {
        _visibleReviewCount += 1;
        _refresh();
      });
    } catch (error) {
      if (!mounted) {
        return;
      }

      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not save your review right now.',
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isSaving = false;
        });
      }
    }
  }

  bool get _hasRequiredScores =>
      _overallImpression != null &&
      _tastinessScore != null &&
      _qualityScore != null &&
      _valueScore != null;

  double? get _overallBiteScore {
    if (!_hasRequiredScores) {
      return null;
    }
    return BiteScoreService.computeOverallBiteScore(
      overallImpression: _overallImpression!,
      tastinessScore: _tastinessScore!,
      qualityScore: _qualityScore!,
      valueScore: _valueScore!,
    );
  }

  ButtonStyle _bitescoreActionButtonStyle() {
    return BiteRaterTheme.filledButtonStyle();
  }

  Widget _buildBiteScoreActionButton({
    required String label,
    required VoidCallback? onPressed,
  }) {
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: BiteRaterTheme.brandGradient,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: BiteRaterTheme.ocean.withOpacity(0.18),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: ElevatedButton(
        onPressed: onPressed,
        style: _bitescoreActionButtonStyle(),
        child: Container(
          alignment: Alignment.center,
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 13),
          child: Text(label),
        ),
      ),
    );
  }

  InputDecoration _inputDecoration({
    required String label,
    required String hint,
  }) {
    return InputDecoration(
      labelText: label,
      hintText: hint,
      filled: true,
      fillColor: BiteRaterTheme.cardSurface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: BiteRaterTheme.lineBlue),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: BiteRaterTheme.grape, width: 1.4),
      ),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(16)),
    );
  }

  Widget _buildScoreSlider({
    required String label,
    required String helperText,
    required double? value,
    required ValueChanged<double> onChanged,
  }) {
    final isRated = value != null;
    final sliderValue = value ?? 1.0;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                label,
                style: TextStyle(
                  color: BiteRaterTheme.ink,
                  fontWeight: FontWeight.w700,
                  fontSize: 15,
                ),
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BiteRaterTheme.chipDecoration(BiteRaterTheme.coral),
              child: Text(
                isRated ? value.toStringAsFixed(1) : '--',
                style: TextStyle(
                  color: isRated
                      ? BiteRaterTheme.scoreFlame
                      : BiteRaterTheme.mutedInk,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 4),
        Text(
          helperText,
          style: const TextStyle(
            fontSize: 12,
            color: BiteRaterTheme.mutedInk,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 2),
        Slider(
          value: sliderValue,
          min: 1,
          max: 10,
          divisions: 18,
          label: isRated ? value.toStringAsFixed(1) : 'Choose',
          onChanged: onChanged,
        ),
      ],
    );
  }

  Widget _buildRequiredScoreSection({
    required String title,
    required String helperText,
    required double? value,
    required ValueChanged<double> onChanged,
  }) {
    return _buildScoreSlider(
      label: '$title (Required)',
      helperText: helperText,
      value: value,
      onChanged: onChanged,
    );
  }

  String _scoreLabel(double? value, {int decimals = 1}) {
    if (value == null || value <= 0) {
      return 'Not rated';
    }
    return value.toStringAsFixed(decimals);
  }

  String _compactScoreLabel(double value) {
    final roundedWhole = value.roundToDouble();
    if ((value - roundedWhole).abs() < 0.05) {
      if (roundedWhole >= 10) {
        return roundedWhole.toInt().toString();
      }
      return roundedWhole.toStringAsFixed(1);
    }
    return value.toStringAsFixed(1);
  }

  String _dateLabel(DateTime? value) {
    if (value == null) {
      return 'Recent';
    }

    final local = value.toLocal();
    final monthNames = <String>[
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
    return '${monthNames[local.month - 1]} ${local.day}, ${local.year}';
  }

  Widget _buildBreakdownChip(String label, double? value) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0xFFF7F9FC),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: BiteRaterTheme.lineBlue.withOpacity(0.65)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(
              fontSize: 11,
              color: BiteRaterTheme.mutedInk,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: 1),
          Text(
            _scoreLabel(value),
            style: const TextStyle(
              color: BiteRaterTheme.ink,
              fontSize: 19,
              fontWeight: FontWeight.w900,
              height: 1.0,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMiniMetric(String label, double? value) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 5),
      decoration: BoxDecoration(
        color: BiteRaterTheme.ocean.withOpacity(0.07),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: BiteRaterTheme.ocean.withOpacity(0.16)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: TextStyle(
              color: BiteRaterTheme.mutedInk.withOpacity(0.84),
              fontSize: 9.5,
              fontWeight: FontWeight.w500,
              height: 1.0,
            ),
          ),
          const SizedBox(height: 1),
          Text(
            value == null ? 'Not rated' : _compactScoreLabel(value),
            style: const TextStyle(
              color: BiteRaterTheme.ink,
              fontSize: 13,
              fontWeight: FontWeight.w900,
              height: 1.0,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDishCategoryChip(String category) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      decoration: BoxDecoration(
        color: BiteRaterTheme.ocean.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: BiteRaterTheme.ocean.withValues(alpha: 0.18)),
      ),
      child: Text(
        category,
        style: const TextStyle(
          color: BiteRaterTheme.ocean,
          fontSize: 11.5,
          fontWeight: FontWeight.w700,
          height: 1.0,
        ),
      ),
    );
  }

  Widget _buildDishCategoryControl(BitescoreDish dish) {
    final category = dish.category?.trim() ?? '';

    if (category.isNotEmpty) {
      return _buildDishCategoryChip(category);
    }

    return TextButton(
      onPressed: () => _openDishCategoryEditor(dish),
      style: TextButton.styleFrom(
        foregroundColor: BiteRaterTheme.mutedInk,
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
        minimumSize: Size.zero,
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        side: const BorderSide(color: BiteRaterTheme.lineBlue),
        shape: const StadiumBorder(),
      ),
      child: const Text(
        '+ Add category',
        style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800),
      ),
    );
  }

  Widget _buildReviewMetricGrid(DishReview review) {
    final metrics = <Widget>[
      _buildMiniMetric('Enjoyment', review.overallImpression),
      if (review.tastinessScore != null)
        _buildMiniMetric('Tastiness', review.tastinessScore),
      if (review.qualityScore != null)
        _buildMiniMetric('Quality', review.qualityScore),
      if (review.valueScore != null)
        _buildMiniMetric('Value', review.valueScore),
    ];

    final rows = <Widget>[];
    for (var i = 0; i < metrics.length; i += 2) {
      final hasTrailing = i + 1 < metrics.length;
      rows.add(
        Row(
          children: [
            Expanded(child: metrics[i]),
            const SizedBox(width: 10),
            Expanded(
              child: hasTrailing ? metrics[i + 1] : const SizedBox.shrink(),
            ),
          ],
        ),
      );
    }

    return LayoutBuilder(
      builder: (context, constraints) {
        final gridWidth = constraints.maxWidth > 236
            ? 236.0
            : constraints.maxWidth;

        return Align(
          alignment: Alignment.centerLeft,
          child: SizedBox(
            width: gridWidth,
            child: Column(
              children: [
                for (var i = 0; i < rows.length; i++) ...[
                  if (i > 0) const SizedBox(height: 6),
                  rows[i],
                ],
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> _toggleReviewVote(DishReview review, String voteType) async {
    final canWrite = await BiteScoreSignInGate.ensureSignedInForWrite(context);
    if (!canWrite || !mounted) {
      return;
    }

    try {
      await BiteScoreService.toggleReviewFeedbackVote(
        review: review,
        voteType: voteType,
      );
      if (!mounted) {
        return;
      }
      setState(_refresh);
    } catch (error) {
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not save your feedback on this review right now.',
        ),
      );
    }
  }

  Future<void> _reportReview(DishReview review) async {
    final canWrite = await BiteScoreSignInGate.ensureSignedInForWrite(context);
    if (!canWrite || !mounted) {
      return;
    }

    final reason = await showDialog<String?>(
      context: context,
      builder: (context) => const _ReviewReportDialog(),
    );

    if (reason == null || !mounted) {
      return;
    }

    try {
      final submitted = await BiteScoreService.submitReviewReport(
        review: review,
        reason: reason,
      );
      if (!mounted) {
        return;
      }
      _showSnackBar(
        submitted ? 'Review reported.' : 'You already reported this review.',
      );
      setState(_refresh);
    } catch (error) {
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not report this review right now.',
        ),
      );
    }
  }

  Future<void> _reportDish() async {
    final canWrite = await BiteScoreSignInGate.ensureSignedInForWrite(context);
    if (!canWrite || !mounted) {
      return;
    }

    final reason = await showDialog<String?>(
      context: context,
      builder: (context) => const _DishReportDialog(),
    );

    if (reason == null || !mounted) {
      return;
    }

    if (reason == _DishReportDialog.duplicateReason) {
      final submitted = await showDialog<bool>(
        context: context,
        builder: (context) => _DishMergeSuggestionDialog(
          sourceDish: _currentEntry.dish,
          restaurant: _currentEntry.restaurant,
          submitAsDuplicateReport: true,
        ),
      );

      if (!mounted || submitted != true) {
        return;
      }

      _showSnackBar('Merge suggestion submitted for admin review.');
      return;
    }

    try {
      final submitted = await BiteScoreService.submitDishReport(
        dish: _currentEntry.dish,
        reason: reason,
      );
      if (!mounted) {
        return;
      }
      _showSnackBar(
        submitted
            ? 'Dish reported for admin review.'
            : 'You already reported this dish.',
      );
    } catch (error) {
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not report this dish right now.',
        ),
      );
    }
  }

  Widget _buildReviewVoteButton({
    required IconData icon,
    required String label,
    required int count,
    required bool selected,
    required VoidCallback onTap,
    bool showLabel = true,
  }) {
    final selectedColor = BiteRaterTheme.ocean;
    final resolvedLabel = showLabel
        ? '$label${count > 0 ? ' $count' : ''}'
        : count > 0
        ? '$count'
        : '';
    return OutlinedButton.icon(
      onPressed: onTap,
      icon: Icon(
        icon,
        size: 14,
        color: selected ? selectedColor : BiteRaterTheme.restaurantTitle,
      ),
      label: resolvedLabel.isEmpty
          ? const SizedBox.shrink()
          : Text(
              resolvedLabel,
              style: TextStyle(
                color: selected
                    ? selectedColor
                    : BiteRaterTheme.restaurantTitle,
                fontSize: 12,
                fontWeight: selected ? FontWeight.w700 : FontWeight.w600,
              ),
            ),
      style: OutlinedButton.styleFrom(
        side: BorderSide(
          color: selected
              ? selectedColor.withOpacity(0.70)
              : BiteRaterTheme.lineBlue.withOpacity(0.82),
        ),
        backgroundColor: selected
            ? selectedColor.withOpacity(0.10)
            : Colors.white,
        minimumSize: const Size(0, 32),
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        padding: EdgeInsets.symmetric(
          horizontal: showLabel ? 8 : 6,
          vertical: 7,
        ),
        visualDensity: const VisualDensity(horizontal: -2, vertical: -2),
      ),
    );
  }

  Widget _buildReviewCard(
    DishReview review,
    ReviewTrustSummary trustSummary,
    String? reviewerBadgeLabel,
    String? reviewerDisplayName,
  ) {
    final headline = (review.headline ?? '').trim();
    final notes = (review.notes ?? '').trim();
    final publicDisplayName = (reviewerDisplayName ?? '').trim().isEmpty
        ? 'Reviewer'
        : reviewerDisplayName!.trim();
    final reviewerNameWidget = InkWell(
      borderRadius: BorderRadius.circular(999),
      onTap: () => _openReviewerProfile(review.userId),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 1),
        child: Text(
          publicDisplayName,
          style: const TextStyle(
            color: BiteRaterTheme.grape,
            fontSize: 13,
            fontWeight: FontWeight.w800,
          ),
        ),
      ),
    );
    final reviewerBadgeWidget =
        reviewerBadgeLabel != null && reviewerBadgeLabel.trim().isNotEmpty
        ? _buildReviewerBadgeChip(reviewerBadgeLabel)
        : null;
    final reviewDateWidget = Text(
      _dateLabel(review.createdAt),
      style: const TextStyle(
        color: BiteRaterTheme.mutedInk,
        fontSize: 11.5,
        fontWeight: FontWeight.w600,
      ),
    );
    final reviewMenuWidget = PopupMenuButton<String>(
      tooltip: 'Review actions',
      padding: EdgeInsets.zero,
      position: PopupMenuPosition.under,
      onSelected: (_) => _reportReview(review),
      itemBuilder: (context) => [
        PopupMenuItem<String>(
          value: 'report',
          enabled: !trustSummary.hasPendingUserReport,
          child: Text(
            trustSummary.hasPendingUserReport
                ? 'Review reported'
                : 'Report review',
          ),
        ),
      ],
      child: const SizedBox(
        width: 22,
        height: 22,
        child: Center(child: Icon(Icons.more_vert, size: 18)),
      ),
    );

    return BiteRaterTheme.liftedCard(
      margin: const EdgeInsets.only(bottom: 8),
      radius: 22,
      borderColor: BiteRaterTheme.grape.withOpacity(0.09),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(9, 6, 9, 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Row(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    reviewerNameWidget,
                    if (reviewerBadgeWidget != null) ...[
                      const SizedBox(width: 4),
                      reviewerBadgeWidget,
                    ],
                  ],
                ),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    reviewDateWidget,
                    const SizedBox(width: 3),
                    reviewMenuWidget,
                  ],
                ),
              ],
            ),
            const SizedBox(height: 6),
            _buildReviewScoreBadge(review.overallBiteScore),
            Container(
              height: 0.5,
              margin: const EdgeInsets.only(top: 6, bottom: 6),
              color: BiteRaterTheme.lineBlue.withOpacity(0.35),
            ),
            if (headline.isNotEmpty) ...[
              Text(
                headline,
                style: const TextStyle(
                  color: BiteRaterTheme.ink,
                  fontSize: 16,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
            if (notes.isNotEmpty) ...[
              SizedBox(height: headline.isNotEmpty ? 4 : 0),
              Text(notes),
            ],
            if (headline.isNotEmpty || notes.isNotEmpty)
              const SizedBox(height: 10),
            _buildReviewMetricGrid(review),
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 4,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                _buildReviewVoteButton(
                  icon: Icons.thumb_up_alt_outlined,
                  label: 'Helpful',
                  count: trustSummary.helpfulCount,
                  selected: trustSummary.userMarkedHelpful,
                  onTap: () =>
                      _toggleReviewVote(review, ReviewFeedbackVote.voteHelpful),
                ),
                _buildReviewVoteButton(
                  icon: Icons.thumb_down_alt_outlined,
                  label: 'Not Helpful',
                  count: trustSummary.notHelpfulCount,
                  selected: trustSummary.userMarkedNotHelpful,
                  showLabel: false,
                  onTap: () => _toggleReviewVote(
                    review,
                    ReviewFeedbackVote.voteNotHelpful,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildReviewScoreBadge(double overallBiteScore) {
    return Container(
      width: 38,
      height: 32,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: const Color(0xFFFFF2EC),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: const Color(0xFFDA8672), width: 1.3),
        boxShadow: const [
          BoxShadow(
            color: Color(0x08B4533A),
            blurRadius: 2,
            offset: Offset(0, 1),
          ),
        ],
      ),
      child: Text(
        overallBiteScore.toStringAsFixed(0),
        style: const TextStyle(
          color: Color(0xFFD62828),
          fontSize: 15.8,
          fontWeight: FontWeight.w900,
          height: 1.0,
          letterSpacing: -0.25,
        ),
        textAlign: TextAlign.center,
      ),
    );
  }

  Widget _buildReviewerBadgeChip(String badgeLabel) {
    final badgeStyle = switch (badgeLabel) {
      'Top Contributor' => (
        BiteRaterTheme.ocean,
        Icons.workspace_premium_outlined,
      ),
      'Trusted Reviewer' => (BiteRaterTheme.grape, Icons.verified_outlined),
      'Active Reviewer' => (BiteRaterTheme.ocean, Icons.auto_awesome_outlined),
      _ => (BiteRaterTheme.coral, Icons.local_fire_department_outlined),
    };

    return Container(
      width: 18,
      height: 18,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: badgeStyle.$1.withOpacity(0.07),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: badgeStyle.$1.withOpacity(0.14)),
      ),
      child: Tooltip(
        message: badgeLabel,
        child: Icon(
          badgeStyle.$2,
          size: 11,
          color: badgeStyle.$1.withOpacity(0.84),
        ),
      ),
    );
  }

  Widget _buildInlineReviewForm() {
    final calculatedBiteScore = _overallBiteScore;

    return Container(
      key: _reviewSectionKey,
      child: BiteRaterTheme.liftedCard(
        radius: 22,
        borderColor: BiteRaterTheme.coral.withOpacity(0.16),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Rate & Review',
                style: TextStyle(
                  color: BiteRaterTheme.ink,
                  fontSize: 20,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 4),
              const Text(
                'All four score sliders are required for a complete BiteScore review.',
                style: TextStyle(
                  color: BiteRaterTheme.mutedInk,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _headlineController,
                decoration: _inputDecoration(
                  label: 'Review Headline (Optional)',
                  hint: 'Optional short headline',
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _notesController,
                minLines: 4,
                maxLines: 6,
                decoration: _inputDecoration(
                  label: 'Review Notes (Optional)',
                  hint: 'Optional notes about what stood out',
                ),
              ),
              const SizedBox(height: 14),
              _buildScoreSlider(
                label: 'Enjoyment (Required)',
                helperText: 'How much you enjoyed the dish overall.',
                value: _overallImpression,
                onChanged: (value) {
                  setState(() {
                    _overallImpression = value;
                  });
                },
              ),
              const SizedBox(height: 8),
              _buildRequiredScoreSection(
                title: 'Flavor',
                helperText: 'Taste, seasoning, and craveability.',
                value: _tastinessScore,
                onChanged: (value) {
                  setState(() {
                    _tastinessScore = value;
                  });
                },
              ),
              const SizedBox(height: 4),
              _buildRequiredScoreSection(
                title: 'Quality',
                helperText:
                    'Freshness, preparation, and how well-made it felt.',
                value: _qualityScore,
                onChanged: (value) {
                  setState(() {
                    _qualityScore = value;
                  });
                },
              ),
              const SizedBox(height: 4),
              _buildRequiredScoreSection(
                title: 'Value',
                helperText:
                    'How fair the price felt for the portion and quality.',
                value: _valueScore,
                onChanged: (value) {
                  setState(() {
                    _valueScore = value;
                  });
                },
              ),
              const SizedBox(height: 14),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(10),
                decoration: BiteRaterTheme.heroSurfaceDecoration(
                  accentColor: BiteRaterTheme.scoreFlame,
                  radius: 16,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Calculated BiteScore',
                      style: TextStyle(
                        color: BiteRaterTheme.ink,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      calculatedBiteScore?.toStringAsFixed(0) ?? '--',
                      style: TextStyle(
                        fontSize: 32,
                        fontWeight: FontWeight.w900,
                        color: calculatedBiteScore == null
                            ? BiteRaterTheme.mutedInk
                            : BiteRaterTheme.scoreFlame,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 18),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _isSaving ? null : _submitReview,
                  style:
                      BiteRaterTheme.outlinedButtonStyle(
                        accentColor: BiteRaterTheme.coral,
                      ).copyWith(
                        minimumSize: WidgetStateProperty.all(
                          const Size.fromHeight(48),
                        ),
                      ),
                  child: Text(_isSaving ? 'Saving...' : 'Save Review'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _openRenameSuggestionDialog(BitescoreDish dish) async {
    final canWrite = await BiteScoreSignInGate.ensureSignedInForWrite(context);
    if (!canWrite || !mounted) {
      return;
    }

    final submitted = await showDialog<bool>(
      context: context,
      builder: (context) => _DishRenameSuggestionDialog(dish: dish),
    );
    if (submitted == true) {
      _showSnackBar('Rename suggestion submitted.');
      if (mounted) {
        setState(_refresh);
      }
    }
  }

  Future<void> _openMergeSuggestionDialog(BitescoreDish dish) async {
    final canWrite = await BiteScoreSignInGate.ensureSignedInForWrite(context);
    if (!canWrite || !mounted) {
      return;
    }

    final submitted = await showDialog<bool>(
      context: context,
      builder: (context) => _DishMergeSuggestionDialog(
        sourceDish: dish,
        restaurant: _currentEntry.restaurant,
      ),
    );
    if (submitted == true) {
      _showSnackBar('Merge suggestion submitted.');
      if (mounted) {
        setState(_refresh);
      }
    }
  }

  Future<void> _openDishManagementDialog(BitescoreDish dish) async {
    final updated = await showDialog<bool>(
      context: context,
      builder: (context) => _DishManagementDialog(dish: dish),
    );
    if (updated == true && mounted) {
      _showSnackBar('Dish updated.');
      setState(_refresh);
    }
  }

  Widget _buildSuggestionCard(BitescoreDish dish) {
    if (_canManageDish) {
      final helperText = _isAdmin
          ? 'Admin access: edit this dish directly using the owner management flow.'
          : 'Edit this dish directly with your owner tools.';

      return BiteRaterTheme.liftedCard(
        radius: 22,
        borderColor: BiteRaterTheme.ocean.withOpacity(0.10),
        child: Padding(
          padding: const EdgeInsets.all(13),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Dish Management',
                style: TextStyle(
                  color: BiteRaterTheme.ink,
                  fontSize: 18,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                helperText,
                style: const TextStyle(
                  color: BiteRaterTheme.mutedInk,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: () => _openDishManagementDialog(dish),
                  style: BiteRaterTheme.outlinedButtonStyle(
                    accentColor: BiteRaterTheme.ocean,
                  ),
                  icon: const Icon(Icons.edit_outlined, size: 18),
                  label: const Text('Edit Dish'),
                ),
              ),
            ],
          ),
        ),
      );
    }

    return Container(
      decoration: BoxDecoration(
        color: BiteRaterTheme.cardSurface,
        borderRadius: BorderRadius.circular(21),
        border: Border.all(color: BiteRaterTheme.ocean.withOpacity(0.08)),
        boxShadow: const [
          BoxShadow(
            color: Color(0x07000000),
            blurRadius: 3,
            offset: Offset(0, 1),
          ),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Suggest dish edits',
              style: TextStyle(
                color: BiteRaterTheme.mutedInk.withOpacity(0.86),
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 3),
            LayoutBuilder(
              builder: (context, constraints) {
                const buttonGap = 5.0;
                final useSideBySide = constraints.maxWidth >= 220;

                final renameButton = OutlinedButton(
                  onPressed: () => _openRenameSuggestionDialog(dish),
                  style:
                      BiteRaterTheme.outlinedButtonStyle(
                        accentColor: BiteRaterTheme.ocean,
                      ).copyWith(
                        minimumSize: const WidgetStatePropertyAll(Size(0, 38)),
                        padding: const WidgetStatePropertyAll(
                          EdgeInsets.symmetric(horizontal: 10, vertical: 0),
                        ),
                        visualDensity: const VisualDensity(
                          horizontal: -2,
                          vertical: -3,
                        ),
                      ),
                  child: const FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text('Suggest Rename', textAlign: TextAlign.center),
                  ),
                );

                final mergeButton = OutlinedButton(
                  onPressed: () => _openMergeSuggestionDialog(dish),
                  style:
                      BiteRaterTheme.outlinedButtonStyle(
                        accentColor: BiteRaterTheme.ocean,
                      ).copyWith(
                        minimumSize: const WidgetStatePropertyAll(Size(0, 38)),
                        padding: const WidgetStatePropertyAll(
                          EdgeInsets.symmetric(horizontal: 10, vertical: 0),
                        ),
                        visualDensity: const VisualDensity(
                          horizontal: -2,
                          vertical: -3,
                        ),
                      ),
                  child: const FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text('Suggest Merge', textAlign: TextAlign.center),
                  ),
                );

                if (!useSideBySide) {
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      renameButton,
                      const SizedBox(height: buttonGap),
                      mergeButton,
                    ],
                  );
                }

                return Row(
                  children: [
                    Expanded(child: renameButton),
                    const SizedBox(width: buttonGap),
                    Expanded(child: mergeButton),
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildAverageRatingGrid(DishRatingAggregate aggregate) {
    return LayoutBuilder(
      builder: (context, constraints) {
        const chipGap = 8.0;
        final useTwoColumns = constraints.maxWidth >= 220;

        if (!useTwoColumns) {
          return Column(
            children: [
              _buildBreakdownChip(
                'Enjoyment',
                aggregate.overallImpressionAverage,
              ),
              const SizedBox(height: chipGap),
              _buildBreakdownChip('Tastiness', aggregate.tastinessScoreAverage),
              const SizedBox(height: chipGap),
              _buildBreakdownChip('Quality', aggregate.qualityScoreAverage),
              const SizedBox(height: chipGap),
              _buildBreakdownChip('Value', aggregate.valueScoreAverage),
            ],
          );
        }

        return Column(
          children: [
            Row(
              children: [
                Expanded(
                  child: _buildBreakdownChip(
                    'Enjoyment',
                    aggregate.overallImpressionAverage,
                  ),
                ),
                const SizedBox(width: chipGap),
                Expanded(
                  child: _buildBreakdownChip(
                    'Tastiness',
                    aggregate.tastinessScoreAverage,
                  ),
                ),
              ],
            ),
            const SizedBox(height: chipGap),
            Row(
              children: [
                Expanded(
                  child: _buildBreakdownChip(
                    'Quality',
                    aggregate.qualityScoreAverage,
                  ),
                ),
                const SizedBox(width: chipGap),
                Expanded(
                  child: _buildBreakdownChip(
                    'Value',
                    aggregate.valueScoreAverage,
                  ),
                ),
              ],
            ),
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final entry = _currentEntry;

    return PopScope<bool>(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) {
        if (didPop) {
          return;
        }
        _popWithDishChanges();
      },
      child: Scaffold(
        backgroundColor: BiteRaterTheme.pageBackground,
        appBar: AppBar(
          leading: BackButton(onPressed: _popWithDishChanges),
          title: const Text('Dish Details'),
          centerTitle: true,
          actions: [
            IconButton(
              tooltip: _isFavoriteDish ? 'Unsave dish' : 'Save dish',
              onPressed: _isSavingFavoriteDish ? null : _toggleDishFavorite,
              icon: Icon(
                _isFavoriteDish ? Icons.favorite : Icons.favorite_border,
                color: _isFavoriteDish
                    ? BiteRaterTheme.coral
                    : BiteRaterTheme.grape,
              ),
            ),
            PopupMenuButton<String>(
              tooltip: 'Dish actions',
              onSelected: (_) => _reportDish(),
              itemBuilder: (context) => const [
                PopupMenuItem<String>(
                  value: 'report_dish',
                  child: Text('Report dish'),
                ),
              ],
            ),
          ],
        ),
        body: FutureBuilder<_DishDetailData>(
          future: _detailFuture,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return Column(
                children: [
                  buildPersistentAppModeSwitcher(context),
                  const Expanded(
                    child: Center(child: CircularProgressIndicator()),
                  ),
                ],
              );
            }

            if (snapshot.hasError) {
              return Column(
                children: [
                  buildPersistentAppModeSwitcher(context),
                  Expanded(
                    child: Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Text(
                              'Could not load dish details.',
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
                    ),
                  ),
                ],
              );
            }

            final detail =
                snapshot.data ??
                _DishDetailData(
                  dish: entry.dish,
                  restaurant: entry.restaurant,
                  aggregate: entry.aggregate,
                  reviews: const <DishReview>[],
                  trustByReviewId: const <String, ReviewTrustSummary>{},
                  reviewerBadgesByUserId: const <String, String>{},
                  reviewerNamesByUserId: const <String, String>{},
                );
            final currentDish = detail.dish;
            final currentRestaurant = detail.restaurant;
            final sortedReviews = _sortedReviewsForDisplay(detail.reviews);
            final visibleReviews = sortedReviews
                .take(_visibleReviewCount)
                .toList();
            final hasMoreReviews = sortedReviews.length > visibleReviews.length;

            return Column(
              children: [
                buildPersistentAppModeSwitcher(context),
                Expanded(
                  child: SafeArea(
                    top: false,
                    child: ScrollConfiguration(
                      behavior: ScrollConfiguration.of(
                        context,
                      ).copyWith(overscroll: false),
                      child: SingleChildScrollView(
                        controller: _scrollController,
                        physics: const ClampingScrollPhysics(),
                        padding: EdgeInsets.fromLTRB(
                          16,
                          16,
                          16,
                          24 + MediaQuery.of(context).viewPadding.bottom,
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            BiteRaterTheme.liftedCard(
                              radius: 24,
                              borderColor: BiteRaterTheme.peach.withOpacity(
                                0.22,
                              ),
                              child: Padding(
                                padding: const EdgeInsets.all(16),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Expanded(
                                          child: Column(
                                            crossAxisAlignment:
                                                CrossAxisAlignment.start,
                                            children: [
                                              Text(
                                                currentDish.name,
                                                style: const TextStyle(
                                                  color: BiteRaterTheme.ink,
                                                  fontSize: 26,
                                                  fontWeight: FontWeight.w900,
                                                  letterSpacing: 0.1,
                                                  height: 1.08,
                                                ),
                                                maxLines: 3,
                                                overflow: TextOverflow.ellipsis,
                                              ),
                                              const SizedBox(height: 6),
                                              _buildDishCategoryControl(
                                                currentDish,
                                              ),
                                            ],
                                          ),
                                        ),
                                        const SizedBox(width: 16),
                                        Flexible(
                                          child: Column(
                                            crossAxisAlignment:
                                                CrossAxisAlignment.start,
                                            children: [
                                              _buildBiteScoreActionButton(
                                                onPressed:
                                                    _scrollToReviewSection,
                                                label: 'Rate & Review',
                                              ),
                                              const SizedBox(height: 5),
                                              Padding(
                                                padding: const EdgeInsets.only(
                                                  left: 18,
                                                ),
                                                child: InkWell(
                                                  onTap: _openRestaurantPage,
                                                  borderRadius:
                                                      BorderRadius.circular(8),
                                                  splashColor: BiteRaterTheme
                                                      .ocean
                                                      .withValues(alpha: 0.08),
                                                  highlightColor: BiteRaterTheme
                                                      .ocean
                                                      .withValues(alpha: 0.04),
                                                  child: Padding(
                                                    padding:
                                                        const EdgeInsets.symmetric(
                                                          vertical: 2,
                                                        ),
                                                    child: Column(
                                                      crossAxisAlignment:
                                                          CrossAxisAlignment
                                                              .start,
                                                      children: [
                                                        Row(
                                                          mainAxisSize:
                                                              MainAxisSize.min,
                                                          children: [
                                                            Flexible(
                                                              child: Text(
                                                                currentRestaurant
                                                                    .name,
                                                                style: const TextStyle(
                                                                  fontSize:
                                                                      14.5,
                                                                  fontWeight:
                                                                      FontWeight
                                                                          .w900,
                                                                  color: BiteRaterTheme
                                                                      .restaurantTitle,
                                                                ),
                                                                maxLines: 1,
                                                                overflow:
                                                                    TextOverflow
                                                                        .ellipsis,
                                                              ),
                                                            ),
                                                            const SizedBox(
                                                              width: 3,
                                                            ),
                                                            const Icon(
                                                              Icons
                                                                  .chevron_right,
                                                              size: 15,
                                                              color: BiteRaterTheme
                                                                  .restaurantTitle,
                                                            ),
                                                          ],
                                                        ),
                                                        const SizedBox(
                                                          height: 0,
                                                        ),
                                                        Text(
                                                          '${currentRestaurant.city}, ${currentRestaurant.zipCode}',
                                                          style: const TextStyle(
                                                            color:
                                                                BiteRaterTheme
                                                                    .mutedInk,
                                                            fontSize: 12,
                                                            fontWeight:
                                                                FontWeight.w500,
                                                          ),
                                                        ),
                                                        if (widget
                                                                .distanceLabel !=
                                                            null) ...[
                                                          const SizedBox(
                                                            height: 0,
                                                          ),
                                                          Text(
                                                            widget
                                                                .distanceLabel!,
                                                            style: const TextStyle(
                                                              color:
                                                                  BiteRaterTheme
                                                                      .mutedInk,
                                                              fontSize: 12,
                                                              fontWeight:
                                                                  FontWeight
                                                                      .w500,
                                                            ),
                                                          ),
                                                        ],
                                                      ],
                                                    ),
                                                  ),
                                                ),
                                              ),
                                            ],
                                          ),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 12),
                                    BiteRaterTheme.softDivider(),
                                    const SizedBox(height: 12),
                                    Center(
                                      child: Column(
                                        children: [
                                          Text(
                                            detail.aggregate.overallBiteScore >
                                                    0
                                                ? detail
                                                      .aggregate
                                                      .overallBiteScore
                                                      .toStringAsFixed(0)
                                                : '--',
                                            style: const TextStyle(
                                              fontSize: 66,
                                              fontWeight: FontWeight.w900,
                                              height: 0.80,
                                              letterSpacing: -0.9,
                                              color: BiteRaterTheme.scoreFlame,
                                            ),
                                          ),
                                          const SizedBox(height: 6),
                                          const Text(
                                            'BiteScore',
                                            style: TextStyle(
                                              fontSize: 9,
                                              fontWeight: FontWeight.w500,
                                              letterSpacing: 0.12,
                                              color: BiteRaterTheme.mutedInk,
                                              height: 1.0,
                                            ),
                                          ),
                                          const SizedBox(height: 1),
                                          Text(
                                            '${detail.aggregate.ratingCount} ratings',
                                            style: const TextStyle(
                                              color: BiteRaterTheme.mutedInk,
                                              fontSize: 9.5,
                                              fontWeight: FontWeight.w500,
                                              height: 1.0,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                    const SizedBox(height: 16),
                                    _buildAverageRatingGrid(detail.aggregate),
                                    const SizedBox(height: 12),
                                    Align(
                                      alignment: Alignment.centerLeft,
                                      child: TextButton.icon(
                                        onPressed: _reportDish,
                                        icon: const Icon(
                                          Icons.flag_outlined,
                                          size: 15,
                                        ),
                                        style: TextButton.styleFrom(
                                          foregroundColor:
                                              BiteRaterTheme.mutedInk,
                                          padding: const EdgeInsets.symmetric(
                                            horizontal: 4,
                                            vertical: 4,
                                          ),
                                          minimumSize: Size.zero,
                                          tapTargetSize:
                                              MaterialTapTargetSize.shrinkWrap,
                                        ),
                                        label: const Text(
                                          'Report dish',
                                          style: TextStyle(fontSize: 12),
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                            const SizedBox(height: 12),
                            _buildSuggestionCard(currentDish),
                            const SizedBox(height: 12),
                            const Text(
                              'Reviews',
                              style: TextStyle(
                                color: BiteRaterTheme.ink,
                                fontSize: 20,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            if (detail.reviews.isNotEmpty) ...[
                              const SizedBox(height: 4),
                              _buildReviewSortDropdown(),
                            ],
                            const SizedBox(height: 12),
                            if (detail.reviews.isEmpty)
                              Container(
                                width: double.infinity,
                                padding: const EdgeInsets.all(16),
                                decoration: BiteRaterTheme.surfaceDecoration(
                                  accentColor: BiteRaterTheme.ocean,
                                  radius: 16,
                                ),
                                child: const Text(
                                  'No reviews yet for this dish.',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                    color: BiteRaterTheme.mutedInk,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              )
                            else ...[
                              ...visibleReviews.map(
                                (review) => _buildReviewCard(
                                  review,
                                  detail.trustByReviewId[review.id] ??
                                      const ReviewTrustSummary(),
                                  detail.reviewerBadgesByUserId[review.userId],
                                  detail.reviewerNamesByUserId[review.userId],
                                ),
                              ),
                              if (hasMoreReviews) ...[
                                const SizedBox(height: 2),
                                Center(
                                  child: OutlinedButton(
                                    onPressed: () {
                                      setState(() {
                                        _visibleReviewCount += 3;
                                      });
                                    },
                                    style: BiteRaterTheme.outlinedButtonStyle(
                                      accentColor: BiteRaterTheme.grape,
                                    ),
                                    child: const Text('Load more'),
                                  ),
                                ),
                              ],
                            ],
                            const SizedBox(height: 20),
                            _buildInlineReviewForm(),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _DishDetailData {
  final BitescoreDish dish;
  final BitescoreRestaurant restaurant;
  final DishRatingAggregate aggregate;
  final List<DishReview> reviews;
  final Map<String, ReviewTrustSummary> trustByReviewId;
  final Map<String, String> reviewerBadgesByUserId;
  final Map<String, String> reviewerNamesByUserId;

  const _DishDetailData({
    required this.dish,
    required this.restaurant,
    required this.aggregate,
    required this.reviews,
    required this.trustByReviewId,
    required this.reviewerBadgesByUserId,
    required this.reviewerNamesByUserId,
  });
}

class _DishCategoryDialog extends StatefulWidget {
  final String? initialCategory;
  final List<String> categoryOptions;

  const _DishCategoryDialog({
    required this.initialCategory,
    required this.categoryOptions,
  });

  @override
  State<_DishCategoryDialog> createState() => _DishCategoryDialogState();
}

class _DishCategoryDialogState extends State<_DishCategoryDialog> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.initialCategory ?? '');
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _submitManualCategory() {
    final category = _controller.text.trim();
    if (category.isEmpty) {
      return;
    }
    Navigator.of(context).pop(category);
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Add category'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextField(
              controller: _controller,
              autofocus: true,
              textInputAction: TextInputAction.done,
              onSubmitted: (_) => _submitManualCategory(),
              decoration: InputDecoration(
                labelText: 'Enter manually',
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
            ),
            const SizedBox(height: 14),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: widget.categoryOptions.map((category) {
                return ActionChip(
                  label: Text(category),
                  onPressed: () => Navigator.of(context).pop(category),
                  backgroundColor: Colors.white,
                  side: const BorderSide(color: BiteRaterTheme.lineBlue),
                  labelStyle: const TextStyle(
                    color: BiteRaterTheme.ink,
                    fontWeight: FontWeight.w700,
                  ),
                );
              }).toList(),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        ElevatedButton(
          onPressed: _submitManualCategory,
          style: BiteRaterTheme.filledButtonStyle(),
          child: const Text('Save'),
        ),
      ],
    );
  }
}

class _DishManagementDialog extends StatefulWidget {
  final BitescoreDish dish;

  const _DishManagementDialog({required this.dish});

  @override
  State<_DishManagementDialog> createState() => _DishManagementDialogState();
}

class _DishManagementDialogState extends State<_DishManagementDialog> {
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
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            content: Text(
              AppErrorText.friendly(
                error,
                fallback: 'Could not update the dish right now.',
              ),
            ),
            duration: const Duration(seconds: 3),
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
              TextField(
                controller: _nameController,
                decoration: InputDecoration(
                  labelText: 'Dish name',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _categoryController,
                decoration: InputDecoration(
                  labelText: 'Category',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _priceController,
                decoration: InputDecoration(
                  labelText: 'Price label',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
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

class _ReviewReportDialog extends StatefulWidget {
  const _ReviewReportDialog();

  @override
  State<_ReviewReportDialog> createState() => _ReviewReportDialogState();
}

class _ReviewReportDialogState extends State<_ReviewReportDialog> {
  static const List<String> _reasons = <String>[
    'Spam',
    'Harassment',
    'Off-topic',
    'Suspicious or fake',
    'Other',
  ];

  String? _selectedReason;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Report Review'),
      content: DropdownButtonFormField<String>(
        value: _selectedReason,
        hint: const Text('Select a reason'),
        decoration: const InputDecoration(
          labelText: 'Reason (Optional)',
          border: OutlineInputBorder(),
        ),
        items: _reasons
            .map(
              (reason) =>
                  DropdownMenuItem<String>(value: reason, child: Text(reason)),
            )
            .toList(),
        onChanged: (value) {
          setState(() {
            _selectedReason = value;
          });
        },
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(null),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(_selectedReason ?? ''),
          child: const Text('Submit'),
        ),
      ],
    );
  }
}

class _DishReportDialog extends StatefulWidget {
  static const String duplicateReason = 'Report duplicate (merge)';

  const _DishReportDialog();

  @override
  State<_DishReportDialog> createState() => _DishReportDialogState();
}

class _DishReportDialogState extends State<_DishReportDialog> {
  static const List<String> _reasons = <String>[
    'Wrong dish information',
    _DishReportDialog.duplicateReason,
    'Dish no longer available',
    'Spam',
    'Other',
  ];

  String? _selectedReason;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Report Dish'),
      content: DropdownButtonFormField<String>(
        value: _selectedReason,
        hint: const Text('Select a reason'),
        decoration: const InputDecoration(
          labelText: 'Reason (Optional)',
          border: OutlineInputBorder(),
        ),
        items: _reasons
            .map(
              (reason) =>
                  DropdownMenuItem<String>(value: reason, child: Text(reason)),
            )
            .toList(),
        onChanged: (value) {
          setState(() {
            _selectedReason = value;
          });
        },
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(null),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(_selectedReason ?? ''),
          child: const Text('Submit'),
        ),
      ],
    );
  }
}

class _DishRenameSuggestionDialog extends StatefulWidget {
  final BitescoreDish dish;

  const _DishRenameSuggestionDialog({required this.dish});

  @override
  State<_DishRenameSuggestionDialog> createState() =>
      _DishRenameSuggestionDialogState();
}

class _DishRenameSuggestionDialogState
    extends State<_DishRenameSuggestionDialog> {
  late final TextEditingController _nameController;
  bool _isSaving = false;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.dish.name);
  }

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _isSaving = true;
    });

    try {
      await BiteScoreService.submitDishRenameSuggestion(
        dish: widget.dish,
        proposedName: _nameController.text,
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
              fallback: 'Could not submit your rename suggestion right now.',
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
      title: const Text('Suggest Rename'),
      content: TextField(
        controller: _nameController,
        decoration: const InputDecoration(
          labelText: 'Suggested dish name',
          border: OutlineInputBorder(),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isSaving ? null : () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _isSaving ? null : _submit,
          child: Text(_isSaving ? 'Submitting...' : 'Submit'),
        ),
      ],
    );
  }
}

class _DishMergeSuggestionDialog extends StatefulWidget {
  final BitescoreDish sourceDish;
  final BitescoreRestaurant restaurant;
  final bool submitAsDuplicateReport;

  const _DishMergeSuggestionDialog({
    required this.sourceDish,
    required this.restaurant,
    this.submitAsDuplicateReport = false,
  });

  @override
  State<_DishMergeSuggestionDialog> createState() =>
      _DishMergeSuggestionDialogState();
}

class _DishMergeSuggestionDialogState
    extends State<_DishMergeSuggestionDialog> {
  String? _selectedDishId;
  bool _isSaving = false;
  late final Future<List<BitescoreDish>> _candidatesFuture;

  @override
  void initState() {
    super.initState();
    _candidatesFuture = _loadMergeCandidates();
  }

  Future<List<BitescoreDish>> _loadMergeCandidates() async {
    final dishes = await BiteScoreService.loadDishesForRestaurant(
      widget.restaurant.id,
    );
    return dishes
        .where((dish) => dish.id != widget.sourceDish.id && dish.isActive)
        .toList();
  }

  Future<void> _submit(List<BitescoreDish> dishes) async {
    BitescoreDish? selectedDish;
    for (final dish in dishes) {
      if (dish.id == _selectedDishId) {
        selectedDish = dish;
        break;
      }
    }
    if (selectedDish == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Choose a dish to merge into.')),
      );
      return;
    }

    setState(() {
      _isSaving = true;
    });

    try {
      if (widget.submitAsDuplicateReport) {
        await BiteScoreService.submitDuplicateDishMergeSuggestion(
          sourceDish: widget.sourceDish,
          mergeTargetDish: selectedDish,
        );
      } else {
        await BiteScoreService.submitDishMergeSuggestion(
          sourceDish: widget.sourceDish,
          mergeTargetDish: selectedDish,
        );
      }
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
              fallback: 'Could not submit your merge suggestion right now.',
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
      title: const Text('Suggest Merge'),
      content: FutureBuilder<List<BitescoreDish>>(
        future: _candidatesFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const SizedBox(
              height: 120,
              child: Center(child: CircularProgressIndicator()),
            );
          }

          if (snapshot.hasError) {
            return Text(AppErrorText.load('merge options'));
          }

          final dishes = snapshot.data ?? const <BitescoreDish>[];
          if (dishes.isEmpty) {
            return const Text(
              'No other active dishes are available for merge suggestions here.',
            );
          }

          return DropdownButtonFormField<String>(
            value: _selectedDishId,
            decoration: const InputDecoration(
              labelText: 'Merge into',
              border: OutlineInputBorder(),
            ),
            items: dishes
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
                      _selectedDishId = value;
                    });
                  },
          );
        },
      ),
      actions: [
        TextButton(
          onPressed: _isSaving ? null : () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FutureBuilder<List<BitescoreDish>>(
          future: _candidatesFuture,
          builder: (context, snapshot) {
            final dishes = snapshot.data ?? const <BitescoreDish>[];
            return FilledButton(
              onPressed: _isSaving || dishes.isEmpty
                  ? null
                  : () => _submit(dishes),
              child: Text(_isSaving ? 'Submitting...' : 'Submit'),
            );
          },
        ),
      ],
    );
  }
}
