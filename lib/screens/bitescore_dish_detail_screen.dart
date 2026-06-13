import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../models/bitescore_dish.dart';
import '../models/bitescore_dish_image.dart';
import '../models/bitescore_dish_image_vote.dart';
import '../models/bitescore_restaurant.dart';
import '../models/dish_rating_aggregate.dart';
import '../models/dish_review.dart';
import '../models/local_expert_badge.dart';
import '../models/review_feedback_vote.dart';
import '../services/admin_access_service.dart';
import '../services/app_error_text.dart';
import '../services/bitescore_image_upload_service.dart';
import '../services/app_mode_state_service.dart';
import '../services/bitescore_sign_in_gate.dart';
import '../services/bitescore_service.dart';
import '../services/local_expert_badge_recalculation_service.dart';
import '../services/local_expert_badge_service.dart';
import '../widgets/app_mode_switcher_bar.dart';
import '../widgets/bitescore_category_picker.dart';
import '../widgets/biterater_theme.dart';
import '../widgets/local_expert_badge_widget.dart';
import '../widgets/owner_dish_merge_dialog.dart';
import '../widgets/persistent_bottom_navigation.dart';
import '../widgets/reviewer_activity_pill.dart';
import 'bitescore_restaurant_dishes_screen.dart';
import 'public_reviewer_profile_screen.dart';

class BiteScoreResponsiveDishTitle extends StatelessWidget {
  static const double normalFontSize = 26;
  static const double minFontSize = 18;

  final String title;

  const BiteScoreResponsiveDishTitle({super.key, required this.title});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth == double.infinity
            ? MediaQuery.sizeOf(context).width
            : constraints.maxWidth;
        final fontSize = fittedFontSizeFor(text: title, availableWidth: width);
        final displayTitle = hyphenatedTitleFor(
          text: title,
          availableWidth: width,
          fontSize: fontSize,
        );
        return Text(
          displayTitle,
          softWrap: true,
          overflow: TextOverflow.visible,
          style: TextStyle(
            color: BiteRaterTheme.ink,
            fontSize: fontSize,
            fontWeight: FontWeight.w900,
            letterSpacing: 0.1,
            height: 1.08,
          ),
          textScaler: const TextScaler.linear(1),
        );
      },
    );
  }

  static double fittedFontSizeFor({
    required String text,
    required double availableWidth,
    double normalFontSize = BiteScoreResponsiveDishTitle.normalFontSize,
    double minFontSize = BiteScoreResponsiveDishTitle.minFontSize,
  }) {
    if (text.trim().isEmpty || availableWidth <= 0) {
      return normalFontSize;
    }

    final longestWord = longestWordIn(text);
    if (longestWord.isEmpty) {
      return normalFontSize;
    }

    final longestWordWidth = _textWidth(longestWord, fontSize: normalFontSize);

    if (longestWordWidth <= availableWidth) {
      return normalFontSize;
    }

    final scaledSize = normalFontSize * (availableWidth / longestWordWidth);
    return scaledSize.clamp(minFontSize, normalFontSize).toDouble();
  }

  static String longestWordIn(String text) {
    final words = text
        .trim()
        .split(RegExp(r'\s+'))
        .where((word) => word.trim().isNotEmpty);
    if (words.isEmpty) {
      return '';
    }
    return words.reduce((a, b) => a.length >= b.length ? a : b);
  }

  static String hyphenatedTitleFor({
    required String text,
    required double availableWidth,
    required double fontSize,
  }) {
    if (availableWidth <= 0 || text.trim().isEmpty) {
      return text;
    }

    final words = text.trim().split(RegExp(r'\s+'));
    return words
        .map((word) {
          if (_textWidth(word, fontSize: fontSize) <= availableWidth) {
            return word;
          }
          return _hyphenateWord(
            word: word,
            availableWidth: availableWidth,
            fontSize: fontSize,
          );
        })
        .join(' ');
  }

  static String _hyphenateWord({
    required String word,
    required double availableWidth,
    required double fontSize,
  }) {
    final buffer = StringBuffer();
    var remaining = word;

    while (remaining.isNotEmpty &&
        _textWidth(remaining, fontSize: fontSize) > availableWidth) {
      var splitIndex = remaining.length - 1;
      while (splitIndex > 1 &&
          _textWidth(
                '${remaining.substring(0, splitIndex)}-',
                fontSize: fontSize,
              ) >
              availableWidth) {
        splitIndex -= 1;
      }

      if (splitIndex <= 1) {
        break;
      }

      buffer
        ..write(remaining.substring(0, splitIndex))
        ..write('-\n');
      remaining = remaining.substring(splitIndex);
    }

    buffer.write(remaining);
    return buffer.toString();
  }

  static double _textWidth(String text, {required double fontSize}) {
    final painter = TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(
          fontSize: fontSize,
          fontWeight: FontWeight.w900,
          letterSpacing: 0.1,
        ),
      ),
      maxLines: 1,
      textDirection: TextDirection.ltr,
      textScaler: const TextScaler.linear(1),
    )..layout();
    return painter.width;
  }
}

class BiteScoreDishDetailScreen extends StatefulWidget {
  final BiteScoreHomeEntry entry;
  final String? distanceLabel;
  final String? targetReviewId;

  const BiteScoreDishDetailScreen({
    super.key,
    required this.entry,
    this.distanceLabel,
    this.targetReviewId,
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
  Future<_DishDetailData>? _detailFuture;
  final ScrollController _scrollController = ScrollController();
  final GlobalKey _reviewSectionKey = GlobalKey();
  final Map<String, GlobalKey> _reviewCardKeys = <String, GlobalKey>{};
  final TextEditingController _headlineController = TextEditingController();
  final TextEditingController _notesController = TextEditingController();
  Timer? _highlightTimer;
  BiteScorePickedDishImage? _selectedDishImage;
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
  bool _didHandleTargetReview = false;
  String? _highlightedReviewId;
  User? get _currentUser => FirebaseAuth.instance.currentUser;
  bool get _isOwner =>
      _currentUser != null &&
      !_currentUser!.isAnonymous &&
      _currentEntry.restaurant.ownerUserId?.trim() == _currentUser!.uid;
  bool get _isAdmin => AdminAccessService.isAdminUser(_currentUser);
  bool get _canManageDish => _isOwner || _isAdmin;

  String _displayText(String value, String fallback) {
    final trimmed = value.trim();
    return trimmed.isEmpty ? fallback : trimmed;
  }

  String _restaurantLocationLabel(BitescoreRestaurant restaurant) {
    final city = restaurant.city.trim();
    final zipCode = restaurant.zipCode.trim();
    if (city.isNotEmpty && zipCode.isNotEmpty) {
      return '$city, $zipCode';
    }
    if (city.isNotEmpty) {
      return city;
    }
    if (zipCode.isNotEmpty) {
      return zipCode;
    }
    return 'Location unavailable';
  }

  @override
  void initState() {
    super.initState();
    _currentEntry = widget.entry;
    _refresh();
  }

  @override
  void dispose() {
    _highlightTimer?.cancel();
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
      BiteScoreService.loadDishImages(refreshedDish.id),
    ]);
    final aggregate =
        (dishLoadResults[0] as DishRatingAggregate?) ?? _currentEntry.aggregate;
    final reviews = dishLoadResults[1] as List<DishReview>;
    final loadedDishImages = dishLoadResults[2];
    final dishImages = loadedDishImages is List<BiteScoreDishImage>
        ? loadedDishImages
        : const <BiteScoreDishImage>[];
    final reviewImageByReviewId = <String, BiteScoreDishImage>{};
    for (final image in dishImages) {
      final reviewId = image.reviewId?.trim();
      if (reviewId != null && reviewId.isNotEmpty) {
        reviewImageByReviewId.putIfAbsent(reviewId, () => image);
      }
    }

    final reviewMetadataResults = await Future.wait<Object>([
      BiteScoreService.loadReviewTrustSummaries(
        reviews,
        currentUserId: _currentUser?.uid,
      ),
      BiteScoreService.loadReviewerPublicReviewCounts(reviews),
      BiteScoreService.loadReviewerDisplayNames(reviews),
      LocalExpertBadgeService.loadBadgesForUsers(
        reviews.map((review) => review.userId),
      ),
    ]);
    final trustByReviewId =
        reviewMetadataResults[0] as Map<String, ReviewTrustSummary>;
    final reviewerReviewCountsByUserId =
        reviewMetadataResults[1] as Map<String, int>;
    final reviewerNamesByUserId =
        reviewMetadataResults[2] as Map<String, String>;
    final localExpertBadgesByUserId =
        reviewMetadataResults[3] as Map<String, List<LocalExpertBadge>>;

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
      dishImages: dishImages,
      trustByReviewId: trustByReviewId,
      reviewImageByReviewId: reviewImageByReviewId,
      reviewerReviewCountsByUserId: reviewerReviewCountsByUserId,
      reviewerNamesByUserId: reviewerNamesByUserId,
      localExpertBadgesByUserId: localExpertBadgesByUserId,
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

    final selection = await showDialog<BitescoreCategorySelection>(
      context: context,
      builder: (context) {
        return _DishCategoryDialog(
          initialSelection: BitescoreCategorySelection.fromDish(dish),
        );
      },
    );

    if (selection == null || !mounted) {
      return;
    }

    try {
      await BiteScoreService.updateDishAsOwner(
        dish: dish,
        name: dish.name,
        category: selection.categoryForSave ?? '',
        subcategory: selection.subcategoryForSave,
        categoryManualKeywords: selection.manualKeywordsForSave,
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

  GlobalKey _reviewCardKeyFor(String reviewId) {
    return _reviewCardKeys.putIfAbsent(reviewId, GlobalKey.new);
  }

  void _scheduleTargetReviewReveal(List<DishReview> sortedReviews) {
    if (_didHandleTargetReview) {
      return;
    }

    final targetReviewId = widget.targetReviewId?.trim();
    if (targetReviewId == null || targetReviewId.isEmpty) {
      _didHandleTargetReview = true;
      return;
    }

    final targetExists = sortedReviews.any(
      (review) => review.id == targetReviewId,
    );
    if (!targetExists) {
      _didHandleTargetReview = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          _showSnackBar('That review could not be located.');
        }
      });
      return;
    }

    _didHandleTargetReview = true;
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted) {
        return;
      }
      final targetContext = _reviewCardKeys[targetReviewId]?.currentContext;
      if (targetContext == null) {
        _showSnackBar('That review could not be located.');
        return;
      }

      setState(() {
        _highlightedReviewId = targetReviewId;
      });
      await Scrollable.ensureVisible(
        targetContext,
        duration: const Duration(milliseconds: 360),
        curve: Curves.easeOutCubic,
        alignment: 0.12,
      );
      _highlightTimer?.cancel();
      _highlightTimer = Timer(const Duration(seconds: 2), () {
        if (mounted && _highlightedReviewId == targetReviewId) {
          setState(() {
            _highlightedReviewId = null;
          });
        }
      });
    });
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
      final saveResult = await BiteScoreService.addReviewForDish(
        dish: _currentEntry.dish,
        restaurant: _currentEntry.restaurant,
        overallImpression: overallImpression,
        headline: _headlineController.text,
        notes: _notesController.text,
        tastinessScore: tastinessScore,
        qualityScore: qualityScore,
        valueScore: valueScore,
      );

      await _uploadSelectedDishImage(saveResult);

      _headlineController.clear();
      _notesController.clear();
      _selectedDishImage = null;

      if (!mounted) {
        return;
      }

      _showSnackBar('Review saved.');
      unawaited(_requestLocalExpertBadgeRecalculation());

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

  Future<void> _pickDishImage() async {
    try {
      final image = await BiteScoreImageUploadService.pickDishImage();
      if (image == null || !mounted) {
        return;
      }
      setState(() {
        _selectedDishImage = image;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not select that image right now.',
        ),
      );
    }
  }

  Future<void> _uploadSelectedDishImage(
    BiteScoreReviewSaveResult saveResult,
  ) async {
    final selectedImage = _selectedDishImage;
    if (selectedImage == null) {
      return;
    }

    try {
      final uploadedImage = await BiteScoreImageUploadService.uploadDishImage(
        dishId: saveResult.dish.id,
        pickedImage: selectedImage,
      );
      await BiteScoreService.addDishImageRecord(
        dish: saveResult.dish,
        restaurant: saveResult.restaurant,
        reviewId: saveResult.review.id,
        uploadedByUserId: saveResult.review.userId,
        imageUrl: uploadedImage.imageUrl,
        storagePath: uploadedImage.storagePath,
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Review saved, but the dish image could not be uploaded.',
        ),
      );
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

  Widget _buildDishImagePreview(
    BitescoreDish dish,
    List<BiteScoreDishImage>? images,
  ) {
    final imageUrl = dish.primaryImageUrl?.trim();
    if (imageUrl == null || imageUrl.isEmpty) {
      return const SizedBox.shrink();
    }

    final safeImages = images ?? const <BiteScoreDishImage>[];
    final hiddenImageCount = safeImages.length > 1 ? safeImages.length - 1 : 0;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 7),
        InkWell(
          onTap: () => _openImageViewer(
            images: safeImages,
            initialImageUrl: imageUrl,
            title: dish.name,
          ),
          borderRadius: BorderRadius.circular(16),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(16),
            child: Image.network(
              imageUrl,
              width: 150,
              height: 110,
              fit: BoxFit.cover,
              errorBuilder: (context, error, stackTrace) => Container(
                width: 150,
                height: 110,
                alignment: Alignment.center,
                color: const Color(0xFFF4F8FD),
                child: const Icon(
                  Icons.restaurant_menu,
                  color: BiteRaterTheme.mutedInk,
                ),
              ),
            ),
          ),
        ),
        if (hiddenImageCount > 0) ...[
          const SizedBox(height: 3),
          TextButton(
            onPressed: () => _openImageViewer(
              images: safeImages,
              initialImageUrl: imageUrl,
              title: dish.name,
            ),
            style: TextButton.styleFrom(
              foregroundColor: BiteRaterTheme.ocean,
              padding: EdgeInsets.zero,
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: Text(
              hiddenImageCount == 1
                  ? 'View more images'
                  : 'View $hiddenImageCount more images',
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w800,
                decoration: TextDecoration.underline,
              ),
            ),
          ),
        ],
      ],
    );
  }

  Future<void> _openImageViewer({
    required List<BiteScoreDishImage>? images,
    required String initialImageUrl,
    String? title,
  }) async {
    final safeImages = images ?? const <BiteScoreDishImage>[];
    final imageUrls = safeImages
        .map((image) => image.imageUrl.trim())
        .where((url) => url.isNotEmpty)
        .toList();
    final trimmedInitialUrl = initialImageUrl.trim();

    if (imageUrls.isEmpty && trimmedInitialUrl.isEmpty) {
      return;
    }
    if (imageUrls.isEmpty) {
      imageUrls.add(trimmedInitialUrl);
    } else if (trimmedInitialUrl.isNotEmpty &&
        !imageUrls.contains(trimmedInitialUrl)) {
      imageUrls.add(trimmedInitialUrl);
    }

    final initialIndex = imageUrls.indexOf(trimmedInitialUrl);

    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _BiteScoreImageViewerScreen(
          images: safeImages,
          imageUrls: imageUrls,
          initialIndex: initialIndex < 0 ? 0 : initialIndex,
          title: title,
        ),
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

  Future<void> _requestLocalExpertBadgeRecalculation() async {
    try {
      await LocalExpertBadgeRecalculationService.recalculateMyLocalExpertBadges();
    } catch (error) {
      debugPrint('Local Expert badge recalculation failed: $error');
    }
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
    BiteScoreDishImage? reviewImage,
    List<BiteScoreDishImage>? dishImages,
    int reviewerPublicReviewCount,
    String? reviewerDisplayName,
    List<LocalExpertBadge> reviewerLocalExpertBadges,
    bool isHighlighted,
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
    final prioritizedLocalExpertBadges =
        LocalExpertBadgePrioritizer.prioritizeForDish(
          badges: reviewerLocalExpertBadges,
          dishName: _currentEntry.dish.name,
          categoryName: _currentEntry.dish.category,
          subcategory: _currentEntry.dish.subcategory,
          categoryTags: _currentEntry.dish.categoryTags,
        );
    final localExpertSummary = LocalExpertBadgeOverflowSummary.fromBadges(
      prioritizedLocalExpertBadges,
      maxVisible: 2,
    );
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

    return KeyedSubtree(
      key: _reviewCardKeyFor(review.id),
      child: BiteRaterTheme.liftedCard(
        margin: const EdgeInsets.only(bottom: 8),
        radius: 22,
        borderColor: isHighlighted
            ? BiteRaterTheme.ocean.withValues(alpha: 0.55)
            : BiteRaterTheme.grape.withOpacity(0.09),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOutCubic,
          decoration: BoxDecoration(
            color: isHighlighted
                ? BiteRaterTheme.ocean.withValues(alpha: 0.06)
                : Colors.transparent,
            borderRadius: BorderRadius.circular(21),
          ),
          padding: const EdgeInsets.fromLTRB(9, 6, 9, 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  Expanded(
                    child: Wrap(
                      spacing: 4,
                      runSpacing: 3,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        reviewerNameWidget,
                        ReviewerActivityPill(
                          reviewCount: reviewerPublicReviewCount,
                        ),
                        for (final badge in localExpertSummary.visibleBadges)
                          InkWell(
                            borderRadius: BorderRadius.circular(999),
                            onTap: () => showLocalExpertBadgeDetails(
                              context,
                              badge,
                              reviewerUserId: review.userId,
                              reviewerDisplayName: publicDisplayName,
                            ),
                            child: LocalExpertBadgeWidget(
                              badge: badge,
                              mode: LocalExpertBadgeDisplayMode.compact,
                            ),
                          ),
                        if (localExpertSummary.hiddenCount > 0)
                          InkWell(
                            borderRadius: BorderRadius.circular(999),
                            onTap: () => _showLocalExpertBadgeList(
                              prioritizedLocalExpertBadges,
                              reviewerUserId: review.userId,
                              reviewerDisplayName: publicDisplayName,
                            ),
                            child: LocalExpertBadgeOverflowPill(
                              hiddenCount: localExpertSummary.hiddenCount,
                            ),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
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
              Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  _buildReviewScoreBadge(review.overallBiteScore),
                  const Spacer(),
                  if (reviewImage != null)
                    SizedBox(
                      width: 74,
                      child: Align(
                        alignment: Alignment.centerRight,
                        child: Padding(
                          padding: const EdgeInsets.only(right: 2),
                          child: _buildReviewImageThumbnail(
                            reviewImage.imageUrl,
                            dishImages,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
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
                    onTap: () => _toggleReviewVote(
                      review,
                      ReviewFeedbackVote.voteHelpful,
                    ),
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
      ),
    );
  }

  Widget _buildReviewImageThumbnail(
    String imageUrl,
    List<BiteScoreDishImage>? images,
  ) {
    final trimmedUrl = imageUrl.trim();
    if (trimmedUrl.isEmpty) {
      return const SizedBox.shrink();
    }

    return InkWell(
      onTap: () => _openImageViewer(
        images: images,
        initialImageUrl: trimmedUrl,
        title: 'Review image',
      ),
      borderRadius: BorderRadius.circular(12),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: Image.network(
          trimmedUrl,
          width: 70,
          height: 54,
          fit: BoxFit.cover,
          errorBuilder: (context, error, stackTrace) => Container(
            width: 70,
            height: 54,
            alignment: Alignment.center,
            color: const Color(0xFFF4F8FD),
            child: const Icon(
              Icons.image_not_supported_outlined,
              size: 16,
              color: BiteRaterTheme.mutedInk,
            ),
          ),
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

  Future<void> _showLocalExpertBadgeList(
    List<LocalExpertBadge> badges, {
    required String reviewerUserId,
    required String reviewerDisplayName,
  }) {
    return showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (context) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Local Expert Badges',
                  style: TextStyle(
                    color: BiteRaterTheme.ink,
                    fontSize: 20,
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
                          reviewerUserId: reviewerUserId,
                          reviewerDisplayName: reviewerDisplayName,
                        ),
                        child: LocalExpertBadgeWidget(badge: badge),
                      ),
                  ],
                ),
              ],
            ),
          ),
        );
      },
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
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: _isSaving ? null : _pickDishImage,
                style: BiteRaterTheme.outlinedButtonStyle(
                  accentColor: BiteRaterTheme.ocean,
                ),
                icon: const Icon(Icons.image_outlined),
                label: Text(
                  _selectedDishImage == null
                      ? 'Add dish image'
                      : 'Dish image selected',
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

  Future<void> _openOwnerMergeDialog() async {
    final entries = await BiteScoreService.loadEntriesForRestaurant(
      _currentEntry.restaurant,
      includeInactive: true,
    );
    final activeDishes = entries
        .map((entry) => entry.dish)
        .where((dish) => dish.isActive)
        .toList();
    if (!mounted) {
      return;
    }
    if (activeDishes.length < 2) {
      _showSnackBar('Add at least two active dishes before merging.');
      return;
    }

    final merged = await showDialog<bool>(
      context: context,
      builder: (context) => OwnerDishMergeDialog(dishes: activeDishes),
    );

    if (merged == true && mounted) {
      _hasDishChanges = true;
      _showSnackBar('Dish merge applied.');
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
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => _openDishManagementDialog(dish),
                      style: BiteRaterTheme.outlinedButtonStyle(
                        accentColor: BiteRaterTheme.ocean,
                      ),
                      icon: const Icon(Icons.edit_outlined, size: 18),
                      label: const Text('Edit Dish'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _openOwnerMergeDialog,
                      style: BiteRaterTheme.outlinedButtonStyle(
                        accentColor: BiteRaterTheme.grape,
                      ),
                      icon: const Icon(Icons.merge_type, size: 18),
                      label: const Text('Merge Dish'),
                    ),
                  ),
                ],
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
          leadingWidth: 64,
          leading: IconButton(
            tooltip: MaterialLocalizations.of(context).backButtonTooltip,
            onPressed: _popWithDishChanges,
            padding: const EdgeInsets.all(16),
            constraints: const BoxConstraints(minWidth: 56, minHeight: 56),
            icon: const BackButtonIcon(),
          ),
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
        bottomNavigationBar: const PersistentBottomNavigation(
          mode: AppMode.biteScore,
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
                  dishImages: const <BiteScoreDishImage>[],
                  trustByReviewId: const <String, ReviewTrustSummary>{},
                  reviewImageByReviewId: const <String, BiteScoreDishImage>{},
                  reviewerReviewCountsByUserId: const <String, int>{},
                  reviewerNamesByUserId: const <String, String>{},
                  localExpertBadgesByUserId:
                      const <String, List<LocalExpertBadge>>{},
                );
            final currentDish = detail.dish;
            final currentRestaurant = detail.restaurant;
            final sortedReviews = _sortedReviewsForDisplay(detail.reviews);
            _scheduleTargetReviewReveal(sortedReviews);
            final targetReviewId = widget.targetReviewId?.trim();
            final targetReviewIndex =
                targetReviewId == null || targetReviewId.isEmpty
                ? -1
                : sortedReviews.indexWhere(
                    (review) => review.id == targetReviewId,
                  );
            final effectiveVisibleReviewCount = targetReviewIndex >= 0
                ? (targetReviewIndex + 1 > _visibleReviewCount
                      ? targetReviewIndex + 1
                      : _visibleReviewCount)
                : _visibleReviewCount;
            final visibleReviews = sortedReviews
                .take(
                  effectiveVisibleReviewCount > sortedReviews.length
                      ? sortedReviews.length
                      : effectiveVisibleReviewCount,
                )
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
                                              BiteScoreResponsiveDishTitle(
                                                title: _displayText(
                                                  currentDish.name,
                                                  'Unnamed dish',
                                                ),
                                              ),
                                              const SizedBox(height: 6),
                                              _buildDishCategoryControl(
                                                currentDish,
                                              ),
                                              _buildDishImagePreview(
                                                currentDish,
                                                detail.dishImages,
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
                                                                _displayText(
                                                                  currentRestaurant
                                                                      .name,
                                                                  'Restaurant',
                                                                ),
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
                                                          _restaurantLocationLabel(
                                                            currentRestaurant,
                                                          ),
                                                          style: const TextStyle(
                                                            color:
                                                                BiteRaterTheme
                                                                    .mutedInk,
                                                            fontSize: 12,
                                                            fontWeight:
                                                                FontWeight.w500,
                                                          ),
                                                        ),
                                                        if (widget.distanceLabel
                                                                ?.trim()
                                                                .isNotEmpty ==
                                                            true) ...[
                                                          const SizedBox(
                                                            height: 0,
                                                          ),
                                                          Text(
                                                            widget
                                                                .distanceLabel!
                                                                .trim(),
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
                                    const SizedBox(height: 6),
                                    BiteRaterTheme.softDivider(),
                                    const SizedBox(height: 8),
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
                                          const SizedBox(height: 4),
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
                                  detail.reviewImageByReviewId[review.id],
                                  detail.dishImages,
                                  detail.reviewerReviewCountsByUserId[review
                                          .userId] ??
                                      0,
                                  detail.reviewerNamesByUserId[review.userId],
                                  detail.localExpertBadgesByUserId[review
                                          .userId] ??
                                      const <LocalExpertBadge>[],
                                  _highlightedReviewId == review.id,
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
  final List<BiteScoreDishImage>? _dishImages;
  final Map<String, ReviewTrustSummary> trustByReviewId;
  final Map<String, BiteScoreDishImage> reviewImageByReviewId;
  final Map<String, int> reviewerReviewCountsByUserId;
  final Map<String, String> reviewerNamesByUserId;
  final Map<String, List<LocalExpertBadge>> localExpertBadgesByUserId;

  List<BiteScoreDishImage> get dishImages =>
      _dishImages ?? const <BiteScoreDishImage>[];

  const _DishDetailData({
    required this.dish,
    required this.restaurant,
    required this.aggregate,
    required this.reviews,
    required List<BiteScoreDishImage>? dishImages,
    required this.trustByReviewId,
    required this.reviewImageByReviewId,
    required this.reviewerReviewCountsByUserId,
    required this.reviewerNamesByUserId,
    required this.localExpertBadgesByUserId,
  }) : _dishImages = dishImages;
}

class _BiteScoreImageViewerScreen extends StatefulWidget {
  final List<BiteScoreDishImage> images;
  final List<String> imageUrls;
  final int initialIndex;
  final String? title;

  const _BiteScoreImageViewerScreen({
    required this.images,
    required this.imageUrls,
    required this.initialIndex,
    this.title,
  });

  @override
  State<_BiteScoreImageViewerScreen> createState() =>
      _BiteScoreImageViewerScreenState();
}

class _BiteScoreImageViewerScreenState
    extends State<_BiteScoreImageViewerScreen> {
  late List<BiteScoreDishImage> _images;
  late List<String> _imageUrls;
  late int _selectedIndex;
  Map<String, String> _currentVotesByImageId = const <String, String>{};
  bool _isVoting = false;

  @override
  void initState() {
    super.initState();
    _images = List<BiteScoreDishImage>.from(widget.images);
    _imageUrls = widget.imageUrls
        .map((url) => url.trim())
        .where((url) => url.isNotEmpty)
        .toList();
    if (_imageUrls.isEmpty) {
      _imageUrls = _images
          .map((image) => image.imageUrl.trim())
          .where((url) => url.isNotEmpty)
          .toList();
    }
    final lastIndex = _imageUrls.isEmpty ? 0 : _imageUrls.length - 1;
    _selectedIndex = widget.initialIndex.clamp(0, lastIndex);
    _loadCurrentVotes();
  }

  void _selectImage(int index) {
    if (index < 0 || index >= _imageUrls.length) {
      return;
    }
    setState(() {
      _selectedIndex = index;
    });
  }

  BiteScoreDishImage? get _selectedImage {
    if (_selectedIndex < 0 || _selectedIndex >= _imageUrls.length) {
      return null;
    }
    final selectedUrl = _imageUrls[_selectedIndex].trim();
    for (final image in _images) {
      if (image.imageUrl.trim() == selectedUrl) {
        return image;
      }
    }
    return null;
  }

  Future<void> _loadCurrentVotes() async {
    final imageIds = _images
        .map((image) => image.id.trim())
        .where((id) => id.isNotEmpty)
        .toList();
    if (imageIds.isEmpty) {
      return;
    }

    final votes = await BiteScoreService.loadCurrentUserDishImageVotes(
      imageIds,
    );
    if (!mounted) {
      return;
    }
    setState(() {
      _currentVotesByImageId = votes;
    });
  }

  Future<void> _toggleImageVote(String voteType) async {
    final image = _selectedImage;
    if (image == null || _isVoting) {
      return;
    }

    final canWrite = await BiteScoreSignInGate.ensureSignedInForWrite(
      context,
      message: 'Please sign in to vote on dish images.',
    );
    if (!canWrite || !mounted) {
      return;
    }

    setState(() {
      _isVoting = true;
    });

    try {
      final result = await BiteScoreService.toggleDishImageVote(
        image: image,
        voteType: voteType,
      );
      if (!mounted) {
        return;
      }
      setState(() {
        final index = _images.indexWhere(
          (candidate) => candidate.id == result.image.id,
        );
        if (index >= 0) {
          _images[index] = result.image;
        }

        final votes = Map<String, String>.from(_currentVotesByImageId);
        final currentVote = result.currentUserVoteType;
        if (currentVote == null) {
          votes.remove(result.image.id);
        } else {
          votes[result.image.id] = currentVote;
        }
        _currentVotesByImageId = votes;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            behavior: SnackBarBehavior.floating,
            content: Text(
              AppErrorText.friendly(
                error,
                fallback: 'Could not save your vote on this image right now.',
              ),
            ),
          ),
        );
    } finally {
      if (mounted) {
        setState(() {
          _isVoting = false;
        });
      }
    }
  }

  Widget _buildVoteButton({
    required IconData icon,
    required IconData selectedIcon,
    required String label,
    required int count,
    required String voteType,
  }) {
    final image = _selectedImage;
    final selected =
        image != null && _currentVotesByImageId[image.id] == voteType;

    return Semantics(
      label: '$label count $count',
      button: true,
      selected: selected,
      child: OutlinedButton.icon(
        onPressed: image == null || _isVoting
            ? null
            : () => _toggleImageVote(voteType),
        icon: Icon(selected ? selectedIcon : icon, size: 18),
        label: Text('$count'),
        style: OutlinedButton.styleFrom(
          foregroundColor: selected ? BiteRaterTheme.ocean : BiteRaterTheme.ink,
          minimumSize: const Size(86, 38),
          padding: const EdgeInsets.symmetric(horizontal: 12),
          side: BorderSide(
            color: selected ? BiteRaterTheme.ocean : BiteRaterTheme.lineBlue,
          ),
          textStyle: const TextStyle(fontWeight: FontWeight.w800),
        ),
      ),
    );
  }

  Widget _buildVoteControls() {
    final image = _selectedImage;
    if (image == null) {
      return const SizedBox.shrink();
    }

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          _buildVoteButton(
            icon: Icons.thumb_up_alt_outlined,
            selectedIcon: Icons.thumb_up_alt,
            label: 'Helpful',
            count: image.helpfulCount,
            voteType: BiteScoreDishImageVote.voteHelpful,
          ),
          const SizedBox(width: 10),
          _buildVoteButton(
            icon: Icons.thumb_down_alt_outlined,
            selectedIcon: Icons.thumb_down_alt,
            label: 'Not helpful',
            count: image.notHelpfulCount,
            voteType: BiteScoreDishImageVote.voteNotHelpful,
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final hasImages = _imageUrls.isNotEmpty;
    final imageUrl = hasImages ? _imageUrls[_selectedIndex] : '';
    final hasMultipleImages = _imageUrls.length > 1;

    return Scaffold(
      backgroundColor: BiteRaterTheme.pageBackground,
      appBar: AppBar(
        title: Text(
          widget.title?.trim().isNotEmpty == true
              ? widget.title!.trim()
              : 'Image',
        ),
        backgroundColor: BiteRaterTheme.pageBackground,
        surfaceTintColor: BiteRaterTheme.pageBackground,
      ),
      body: SafeArea(
        child: hasImages
            ? Column(
                children: [
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(8, 8, 8, 10),
                      child: Center(
                        child: LayoutBuilder(
                          builder: (context, constraints) {
                            return ClipRRect(
                              borderRadius: BorderRadius.circular(18),
                              child: InteractiveViewer(
                                minScale: 1,
                                maxScale: 4,
                                child: Image.network(
                                  imageUrl,
                                  width: constraints.maxWidth,
                                  height: constraints.maxHeight,
                                  fit: BoxFit.contain,
                                  errorBuilder: (context, error, stackTrace) =>
                                      Container(
                                        width: constraints.maxWidth,
                                        height: constraints.maxHeight,
                                        alignment: Alignment.center,
                                        color: const Color(0xFFF4F8FD),
                                        child: const Text(
                                          'Image unavailable',
                                          style: TextStyle(
                                            color: BiteRaterTheme.mutedInk,
                                            fontWeight: FontWeight.w700,
                                          ),
                                        ),
                                      ),
                                ),
                              ),
                            );
                          },
                        ),
                      ),
                    ),
                  ),
                  _buildVoteControls(),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
                    child: Row(
                      children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: !hasMultipleImages || _selectedIndex == 0
                                ? null
                                : () => _selectImage(_selectedIndex - 1),
                            icon: const Icon(Icons.chevron_left),
                            label: const Text('Previous'),
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 12),
                          child: Text(
                            '${_selectedIndex + 1} / ${_imageUrls.length}',
                            style: const TextStyle(
                              color: BiteRaterTheme.mutedInk,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed:
                                !hasMultipleImages ||
                                    _selectedIndex >= _imageUrls.length - 1
                                ? null
                                : () => _selectImage(_selectedIndex + 1),
                            icon: const Icon(Icons.chevron_right),
                            label: const Text('Next'),
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (hasMultipleImages)
                    SizedBox(
                      height: 72,
                      child: ListView.separated(
                        padding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
                        scrollDirection: Axis.horizontal,
                        itemCount: _imageUrls.length,
                        separatorBuilder: (context, index) =>
                            const SizedBox(width: 8),
                        itemBuilder: (context, index) {
                          final selected = index == _selectedIndex;
                          return InkWell(
                            onTap: () => _selectImage(index),
                            borderRadius: BorderRadius.circular(12),
                            child: Container(
                              padding: const EdgeInsets.all(2),
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(
                                  color: selected
                                      ? BiteRaterTheme.ocean
                                      : BiteRaterTheme.lineBlue,
                                  width: selected ? 2 : 1,
                                ),
                              ),
                              child: ClipRRect(
                                borderRadius: BorderRadius.circular(9),
                                child: Image.network(
                                  _imageUrls[index],
                                  width: 54,
                                  height: 54,
                                  fit: BoxFit.cover,
                                  errorBuilder: (context, error, stackTrace) =>
                                      Container(
                                        width: 54,
                                        height: 54,
                                        alignment: Alignment.center,
                                        color: const Color(0xFFF4F8FD),
                                        child: const Icon(
                                          Icons.image_not_supported_outlined,
                                          size: 16,
                                          color: BiteRaterTheme.mutedInk,
                                        ),
                                      ),
                                ),
                              ),
                            ),
                          );
                        },
                      ),
                    ),
                ],
              )
            : const Center(
                child: Text(
                  'No images available.',
                  style: TextStyle(
                    color: BiteRaterTheme.mutedInk,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
      ),
    );
  }
}

class _DishCategoryDialog extends StatefulWidget {
  final BitescoreCategorySelection initialSelection;

  const _DishCategoryDialog({required this.initialSelection});

  @override
  State<_DishCategoryDialog> createState() => _DishCategoryDialogState();
}

class _DishCategoryDialogState extends State<_DishCategoryDialog> {
  late BitescoreCategorySelection _selection;
  bool _showCategoryValidation = false;

  @override
  void initState() {
    super.initState();
    _selection = widget.initialSelection;
  }

  void _submitCategory() {
    final validationError = _selection.validate();
    if (validationError != null) {
      setState(() {
        _showCategoryValidation = true;
      });
      return;
    }
    Navigator.of(context).pop(_selection);
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Add category'),
      content: SingleChildScrollView(
        child: SizedBox(
          width: 420,
          child: BitescoreCategoryPicker(
            selection: _selection,
            showError: _showCategoryValidation,
            onChanged: (selection) {
              setState(() {
                _selection = selection;
                _showCategoryValidation = false;
              });
            },
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        ElevatedButton(
          onPressed: _submitCategory,
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
  late final TextEditingController _priceController;
  late BitescoreCategorySelection _categorySelection;
  late bool _isActive;
  bool _isSaving = false;
  bool _showCategoryValidation = false;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.dish.name);
    _categorySelection = BitescoreCategorySelection.fromDish(widget.dish);
    _priceController = TextEditingController(
      text: widget.dish.priceLabel ?? '',
    );
    _isActive = widget.dish.isActive;
  }

  @override
  void dispose() {
    _nameController.dispose();
    _priceController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final categoryValidationError = _categorySelection.validate();
    if (categoryValidationError != null) {
      setState(() {
        _showCategoryValidation = true;
      });
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            content: Text(categoryValidationError),
            duration: const Duration(seconds: 3),
          ),
        );
      return;
    }

    setState(() {
      _isSaving = true;
    });

    try {
      await BiteScoreService.updateDishAsOwner(
        dish: widget.dish,
        name: _nameController.text,
        category: _categorySelection.categoryForSave ?? '',
        subcategory: _categorySelection.subcategoryForSave,
        categoryManualKeywords: _categorySelection.manualKeywordsForSave,
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
              BitescoreCategoryPicker(
                selection: _categorySelection,
                showError: _showCategoryValidation,
                onChanged: (selection) {
                  setState(() {
                    _categorySelection = selection;
                    _showCategoryValidation = false;
                  });
                },
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
    final proposedName = _nameController.text.trim();
    if (proposedName.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Suggested dish name is required.')),
      );
      return;
    }
    if (proposedName.toLowerCase() == widget.dish.name.trim().toLowerCase()) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('That dish already uses this name.')),
      );
      return;
    }

    setState(() {
      _isSaving = true;
    });

    try {
      await BiteScoreService.submitDishRenameSuggestion(
        dish: widget.dish,
        proposedName: proposedName,
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
