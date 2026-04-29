import 'dart:math';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:geocoding/geocoding.dart';

import 'admin_access_service.dart';
import '../models/bitescore_dish.dart';
import '../models/bitescore_restaurant.dart';
import '../models/coupon.dart';
import '../models/dish_report.dart';
import '../models/duplicate_restaurant_report.dart';
import '../models/dish_edit_proposal.dart';
import '../models/dish_rating_aggregate.dart';
import '../models/dish_review.dart';
import '../models/restaurant_report.dart';
import '../models/review_feedback_vote.dart';
import '../models/review_report.dart';
import '../models/restaurant.dart';
import '../models/restaurant_claim_request.dart';
import 'customer_auth_service.dart';
import 'restaurant_account_service.dart';

class BiteScoreHomeEntry {
  final BitescoreDish dish;
  final BitescoreRestaurant restaurant;
  final DishRatingAggregate aggregate;

  const BiteScoreHomeEntry({
    required this.dish,
    required this.restaurant,
    required this.aggregate,
  });
}

class BiteScoreUserReviewEntry {
  final DishReview review;
  final BitescoreDish? dish;
  final BitescoreRestaurant? restaurant;

  const BiteScoreUserReviewEntry({
    required this.review,
    required this.dish,
    required this.restaurant,
  });

  String get dishName => dish?.name ?? 'Dish no longer available';
  String get restaurantName =>
      restaurant?.name ?? dish?.restaurantName ?? 'Unknown restaurant';
}

class BiteScoreUserProfileData {
  final String publicDisplayName;
  final String? chosenUsername;
  final String fallbackUsername;
  final List<BitescoreRestaurant> favoriteRestaurants;
  final List<Restaurant> favoriteSaverRestaurants;
  final List<BiteScoreHomeEntry> favoriteDishEntries;
  final List<Coupon> favoriteCoupons;
  final List<BiteScoreUserReviewEntry> reviews;
  final String badgeLabel;
  final int reviewCount;
  final int helpfulVotesReceived;
  final int accountAgeDays;
  final int moderationFlagCount;

  const BiteScoreUserProfileData({
    required this.publicDisplayName,
    required this.chosenUsername,
    required this.fallbackUsername,
    required this.favoriteRestaurants,
    required this.favoriteSaverRestaurants,
    required this.favoriteDishEntries,
    required this.favoriteCoupons,
    required this.reviews,
    required this.badgeLabel,
    required this.reviewCount,
    required this.helpfulVotesReceived,
    required this.accountAgeDays,
    required this.moderationFlagCount,
  });
}

class BiteScorePublicReviewerProfileData {
  final String userId;
  final String publicDisplayName;
  final String? chosenUsername;
  final String fallbackUsername;
  final List<BiteScoreUserReviewEntry> reviews;
  final String badgeLabel;
  final int reviewCount;
  final int helpfulVotesReceived;
  final int accountAgeDays;
  final int moderationFlagCount;

  const BiteScorePublicReviewerProfileData({
    required this.userId,
    required this.publicDisplayName,
    required this.chosenUsername,
    required this.fallbackUsername,
    required this.reviews,
    required this.badgeLabel,
    required this.reviewCount,
    required this.helpfulVotesReceived,
    required this.accountAgeDays,
    required this.moderationFlagCount,
  });
}

class _PublicReviewerIdentity {
  final String userId;
  final String publicDisplayName;
  final String? chosenUsername;
  final String fallbackUsername;
  final DateTime? createdAt;

  const _PublicReviewerIdentity({
    required this.userId,
    required this.publicDisplayName,
    required this.chosenUsername,
    required this.fallbackUsername,
    required this.createdAt,
  });
}

class BiteScoreAdminReviewEntry {
  final DishReview review;
  final String dishName;
  final String restaurantName;

  const BiteScoreAdminReviewEntry({
    required this.review,
    required this.dishName,
    required this.restaurantName,
  });
}

class ReviewTrustSummary {
  final int helpfulCount;
  final int notHelpfulCount;
  final String? currentUserVoteType;
  final bool hasPendingUserReport;

  const ReviewTrustSummary({
    this.helpfulCount = 0,
    this.notHelpfulCount = 0,
    this.currentUserVoteType,
    this.hasPendingUserReport = false,
  });

  bool get userMarkedHelpful =>
      currentUserVoteType == ReviewFeedbackVote.voteHelpful;
  bool get userMarkedNotHelpful =>
      currentUserVoteType == ReviewFeedbackVote.voteNotHelpful;
  int get helpfulScore => helpfulCount - notHelpfulCount;
}

class BiteScoreReportedReviewAdminEntry {
  final DishReview review;
  final String dishName;
  final String restaurantName;
  final List<ReviewReport> reports;

  const BiteScoreReportedReviewAdminEntry({
    required this.review,
    required this.dishName,
    required this.restaurantName,
    required this.reports,
  });

  int get reportCount => reports.length;
  String get reportStatus =>
      reports.isEmpty ? ReviewReport.statusPending : reports.first.status;
  List<String> get distinctReasons =>
      reports
          .map((report) => report.reason?.trim() ?? '')
          .where((reason) => reason.isNotEmpty)
          .toSet()
          .toList()
        ..sort();
}

class BiteScoreReportedRestaurantAdminEntry {
  final BitescoreRestaurant restaurant;
  final List<RestaurantReport> reports;

  const BiteScoreReportedRestaurantAdminEntry({
    required this.restaurant,
    required this.reports,
  });

  int get reportCount => reports.length;
  String get reportStatus =>
      reports.isEmpty ? RestaurantReport.statusPending : reports.first.status;
  List<String> get distinctReasons =>
      reports
          .map((report) => report.reason?.trim() ?? '')
          .where((reason) => reason.isNotEmpty)
          .toSet()
          .toList()
        ..sort();
}

class BiteScoreReportedDishAdminEntry {
  final BitescoreDish dish;
  final BitescoreRestaurant? restaurant;
  final List<DishReport> reports;

  const BiteScoreReportedDishAdminEntry({
    required this.dish,
    required this.restaurant,
    required this.reports,
  });

  int get reportCount => reports.length;
  String get reportStatus =>
      reports.isEmpty ? DishReport.statusPending : reports.first.status;
  List<String> get distinctReasons =>
      reports
          .map((report) => report.reason?.trim() ?? '')
          .where((reason) => reason.isNotEmpty)
          .toSet()
          .toList()
        ..sort();
}

class BiteScoreDuplicateRestaurantReportAdminEntry {
  final BitescoreRestaurant restaurant;
  final List<DuplicateRestaurantReport> reports;

  const BiteScoreDuplicateRestaurantReportAdminEntry({
    required this.restaurant,
    required this.reports,
  });

  int get reportCount => reports.length;
  String get reportStatus => reports.isEmpty
      ? DuplicateRestaurantReport.statusPending
      : reports.first.status;
  List<String> get distinctReasons =>
      reports
          .map((report) => report.reason?.trim() ?? '')
          .where((reason) => reason.isNotEmpty)
          .toSet()
          .toList()
        ..sort();
}

class BiteScoreAdminClaimEntry {
  final RestaurantClaimRequest request;
  final BitescoreRestaurant? restaurant;

  const BiteScoreAdminClaimEntry({
    required this.request,
    required this.restaurant,
  });
}

class BiteScoreApprovedOwnershipEntry {
  final BitescoreRestaurant restaurant;
  final RestaurantClaimRequest? approvedClaim;

  const BiteScoreApprovedOwnershipEntry({
    required this.restaurant,
    required this.approvedClaim,
  });
}

class BiteScoreAdminUserEntry {
  final String uid;
  final String? email;
  final String? phoneNumber;
  final String? displayName;
  final Set<String> claimedRestaurantNames;
  final bool hasRestaurantAccount;
  final bool hasBiteScoreOwnership;
  final bool isAdmin;
  final bool isEmailVerified;
  final String restaurantAccountStatus;
  final Set<String> activityTags;

  const BiteScoreAdminUserEntry({
    required this.uid,
    required this.email,
    required this.phoneNumber,
    required this.displayName,
    required this.claimedRestaurantNames,
    required this.hasRestaurantAccount,
    required this.hasBiteScoreOwnership,
    required this.isAdmin,
    required this.isEmailVerified,
    required this.restaurantAccountStatus,
    required this.activityTags,
  });

  String get roleLabel {
    final roles = <String>[];
    if (isAdmin) {
      roles.add('Admin');
    }
    if (hasRestaurantAccount) {
      roles.add('Coupon Owner');
    }
    if (hasBiteScoreOwnership) {
      roles.add('BiteScore Owner');
    }
    if (activityTags.contains('Claims')) {
      roles.add('Claimant');
    }
    if (activityTags.contains('Reviews') || activityTags.contains('Reports')) {
      roles.add('Customer');
    }
    return roles.isEmpty ? 'App User' : roles.toSet().join(', ');
  }
}

class _MutableAdminUserEntry {
  final String uid;
  String? email;
  String? phoneNumber;
  String? displayName;
  final Set<String> claimedRestaurantNames = <String>{};
  bool hasRestaurantAccount = false;
  bool hasBiteScoreOwnership = false;
  bool isAdmin = false;
  bool isEmailVerified = false;
  String restaurantAccountStatus = 'none';
  final Set<String> activityTags = <String>{};

  _MutableAdminUserEntry(this.uid);

  void apply({
    String? email,
    String? phoneNumber,
    String? displayName,
    bool hasRestaurantAccount = false,
    bool hasBiteScoreOwnership = false,
    bool? isEmailVerified,
    String? restaurantAccountStatus,
    String? claimedRestaurantName,
    String? activityTag,
  }) {
    final trimmedEmail = email?.trim();
    if (trimmedEmail != null && trimmedEmail.isNotEmpty) {
      this.email = trimmedEmail;
    }

    final trimmedPhoneNumber = phoneNumber?.trim();
    if (trimmedPhoneNumber != null && trimmedPhoneNumber.isNotEmpty) {
      this.phoneNumber = trimmedPhoneNumber;
    }

    final trimmedDisplayName = displayName?.trim();
    if (trimmedDisplayName != null && trimmedDisplayName.isNotEmpty) {
      this.displayName = trimmedDisplayName;
    }

    this.hasRestaurantAccount |= hasRestaurantAccount;
    this.hasBiteScoreOwnership |= hasBiteScoreOwnership;

    final trimmedClaimedRestaurantName = claimedRestaurantName?.trim();
    if (trimmedClaimedRestaurantName != null &&
        trimmedClaimedRestaurantName.isNotEmpty) {
      claimedRestaurantNames.add(trimmedClaimedRestaurantName);
    }

    if (isEmailVerified == true) {
      this.isEmailVerified = true;
    }

    final trimmedStatus = restaurantAccountStatus?.trim();
    if (trimmedStatus != null && trimmedStatus.isNotEmpty) {
      this.restaurantAccountStatus = trimmedStatus;
    }

    final trimmedTag = activityTag?.trim();
    if (trimmedTag != null && trimmedTag.isNotEmpty) {
      activityTags.add(trimmedTag);
    }
  }
}

class DishEditSuggestionAdminEntry {
  final String groupKey;
  final String type;
  final String restaurantId;
  final BitescoreDish? targetDish;
  final BitescoreDish? mergeTargetDish;
  final List<DishEditProposal> proposals;
  final String? invalidReason;

  const DishEditSuggestionAdminEntry({
    required this.groupKey,
    required this.type,
    required this.restaurantId,
    required this.targetDish,
    required this.mergeTargetDish,
    required this.proposals,
    this.invalidReason,
  });

  bool get isRename => type == DishEditProposal.typeRename;
  bool get isMerge => type == DishEditProposal.typeMerge;
  bool get isInvalid => (invalidReason ?? '').trim().isNotEmpty;
  int get supporterCount =>
      proposals.map((proposal) => proposal.userId).toSet().length;
  DateTime? get oldestCreatedAt {
    DateTime? oldest;
    for (final proposal in proposals) {
      final createdAt = proposal.createdAt;
      if (createdAt == null) {
        continue;
      }
      if (oldest == null || createdAt.isBefore(oldest)) {
        oldest = createdAt;
      }
    }
    return oldest;
  }

  DateTime? get newestUpdatedAt {
    DateTime? newest;
    for (final proposal in proposals) {
      final updatedAt = proposal.updatedAt ?? proposal.createdAt;
      if (updatedAt == null) {
        continue;
      }
      if (newest == null || updatedAt.isAfter(newest)) {
        newest = updatedAt;
      }
    }
    return newest;
  }

  String? get proposedName => proposals.first.proposedName;
  String? get mergeTargetDishId => proposals.first.mergeTargetDishId;
}

class DishCatalogSuggestion {
  final String canonicalName;
  final List<String> aliases;

  const DishCatalogSuggestion({
    required this.canonicalName,
    required this.aliases,
  });
}

class ExistingDishMatchSuggestion {
  final BitescoreDish dish;
  final double score;

  const ExistingDishMatchSuggestion({required this.dish, required this.score});
}

class BiteScoreCreateRequest {
  static const String invalidAddressMessage =
      'Could not verify address. Please enter a valid address.';

  final String restaurantName;
  final String streetAddress;
  final String city;
  final String state;
  final String zipCode;
  final String dishName;
  final String category;
  final String priceLabel;
  final String headline;
  final String notes;
  final double overallImpression;
  final double? tastinessScore;
  final double? qualityScore;
  final double? valueScore;

  const BiteScoreCreateRequest({
    required this.restaurantName,
    required this.streetAddress,
    required this.city,
    required this.state,
    required this.zipCode,
    required this.dishName,
    required this.category,
    required this.priceLabel,
    required this.headline,
    required this.notes,
    required this.overallImpression,
    this.tastinessScore,
    this.qualityScore,
    this.valueScore,
  });

  String get fullAddress =>
      '${streetAddress.trim()}, ${city.trim()}, ${state.trim()} ${zipCode.trim()}';

  String? validate() {
    if (restaurantName.trim().isEmpty) {
      return 'Restaurant name is required.';
    }
    if (streetAddress.trim().isEmpty) {
      return 'Street address is required.';
    }
    if (city.trim().isEmpty) {
      return 'City is required.';
    }
    if (state.trim().isEmpty) {
      return 'State is required.';
    }
    if (zipCode.trim().isEmpty) {
      return 'ZIP code is required.';
    }
    if (dishName.trim().isEmpty) {
      return 'Dish name is required.';
    }
    return BiteScoreService._validateRequiredReviewScores(
      overallImpression: overallImpression,
      tastinessScore: tastinessScore,
      qualityScore: qualityScore,
      valueScore: valueScore,
    );
  }
}

class BiteScoreService {
  static final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  static List<DishCatalogSuggestion>? _dishCatalogCache;
  static Future<List<DishCatalogSuggestion>>? _dishCatalogCacheFuture;

  static const double _overallImpressionWeight = 0.50;
  static const double _tastinessWeight = 0.20;
  static const double _qualityWeight = 0.20;
  static const double _valueWeight = 0.10;
  static const String loginRequiredMessage = 'Please sign in to continue';
  static const String emailVerificationRequiredMessage =
      'Please verify your email first';

  static CollectionReference<Map<String, dynamic>> restaurantsCollection() {
    return _firestore.collection(BitescoreRestaurant.collectionName);
  }

  static CollectionReference<Map<String, dynamic>> dishesCollection() {
    return _firestore.collection(BitescoreDish.collectionName);
  }

  static CollectionReference<Map<String, dynamic>> dishCatalogCollection() {
    return _firestore.collection('dish_catalog');
  }

  static CollectionReference<Map<String, dynamic>>
  ratingAggregatesCollection() {
    return _firestore.collection(DishRatingAggregate.collectionName);
  }

  static CollectionReference<Map<String, dynamic>> reviewsCollection() {
    return _firestore.collection(DishReview.collectionName);
  }

  static CollectionReference<Map<String, dynamic>>
  reviewFeedbackVotesCollection() {
    return _firestore.collection(ReviewFeedbackVote.collectionName);
  }

  static CollectionReference<Map<String, dynamic>> reviewReportsCollection() {
    return _firestore.collection(ReviewReport.collectionName);
  }

  static CollectionReference<Map<String, dynamic>>
  restaurantReportsCollection() {
    return _firestore.collection(RestaurantReport.collectionName);
  }

  static CollectionReference<Map<String, dynamic>> dishReportsCollection() {
    return _firestore.collection(DishReport.collectionName);
  }

  static CollectionReference<Map<String, dynamic>>
  duplicateRestaurantReportsCollection() {
    return _firestore.collection(DuplicateRestaurantReport.collectionName);
  }

  static CollectionReference<Map<String, dynamic>> editProposalsCollection() {
    return _firestore.collection(DishEditProposal.collectionName);
  }

  static CollectionReference<Map<String, dynamic>> claimRequestsCollection() {
    return _firestore.collection(RestaurantClaimRequest.collectionName);
  }

  static CollectionReference<Map<String, dynamic>>
  restaurantAccountsCollection() {
    return _firestore.collection('restaurant_accounts');
  }

  static DocumentReference<Map<String, dynamic>> userProfileDocument(
    String userId,
  ) {
    return _firestore.collection('user_profiles').doc(userId.trim());
  }

  static DocumentReference<Map<String, dynamic>> publicReviewerProfileDocument(
    String userId,
  ) {
    return _firestore.collection('public_reviewer_profiles').doc(userId.trim());
  }

  static CollectionReference<Map<String, dynamic>>
  publicReviewerProfilesCollection() {
    return _firestore.collection('public_reviewer_profiles');
  }

  static CollectionReference<Map<String, dynamic>> publicUsernamesCollection() {
    return _firestore.collection('public_usernames');
  }

  static CollectionReference<Map<String, dynamic>>
  favoriteRestaurantsCollection(String userId) {
    return userProfileDocument(userId).collection('favorite_restaurants');
  }

  static CollectionReference<Map<String, dynamic>> favoriteDishesCollection(
    String userId,
  ) {
    return userProfileDocument(userId).collection('favorite_dishes');
  }

  static CollectionReference<Map<String, dynamic>> favoriteCouponsCollection(
    String userId,
  ) {
    return userProfileDocument(userId).collection('favorite_coupons');
  }

  static double computeOverallBiteScore({
    required double overallImpression,
    double? tastinessScore,
    double? qualityScore,
    double? valueScore,
  }) {
    var weightedSum = overallImpression * _overallImpressionWeight;
    var totalWeight = _overallImpressionWeight;

    if (tastinessScore != null) {
      weightedSum += tastinessScore * _tastinessWeight;
      totalWeight += _tastinessWeight;
    }

    if (qualityScore != null) {
      weightedSum += qualityScore * _qualityWeight;
      totalWeight += _qualityWeight;
    }

    if (valueScore != null) {
      weightedSum += valueScore * _valueWeight;
      totalWeight += _valueWeight;
    }

    final normalizedTenPointScore = weightedSum / totalWeight;
    return (normalizedTenPointScore * 10).clamp(1, 100).toDouble();
  }

  static Future<List<BitescoreRestaurant>> loadRestaurants() async {
    final snapshot = await restaurantsCollection().get();

    return snapshot.docs
        .map(
          (doc) => BitescoreRestaurant.tryFromFirestore(
            doc.data(),
            fallbackId: doc.id,
          ),
        )
        .whereType<BitescoreRestaurant>()
        .where((restaurant) => restaurant.isActive)
        .toList();
  }

  static Future<BitescoreDish?> loadDishById(String dishId) async {
    final snapshot = await dishesCollection().doc(dishId).get();
    return BitescoreDish.tryFromFirestore(
      snapshot.data(),
      fallbackId: snapshot.id,
    );
  }

  static Future<void> evaluatePendingDishEditSuggestionsForDish(
    String dishId,
  ) async {
    await maybeAutoApplyDueDishEditSuggestions(dishId: dishId);
  }

  static Future<List<BitescoreDish>> loadDishesForRestaurant(
    String restaurantId, {
    bool includeInactive = false,
  }) async {
    final snapshot = await dishesCollection()
        .where('restaurantId', isEqualTo: restaurantId)
        .get();

    final dishes =
        snapshot.docs
            .map(
              (doc) => BitescoreDish.tryFromFirestore(
                doc.data(),
                fallbackId: doc.id,
              ),
            )
            .whereType<BitescoreDish>()
            .where(
              (dish) => !dish.isMerged && (includeInactive || dish.isActive),
            )
            .toList()
          ..sort(
            (a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()),
          );

    return dishes;
  }

  static Future<List<BitescoreRestaurant>> loadOwnedRestaurantsForUser(
    String userId,
  ) async {
    final snapshot = await restaurantsCollection()
        .where('ownerUserId', isEqualTo: userId.trim())
        .where('isClaimed', isEqualTo: true)
        .get();

    final restaurants =
        snapshot.docs
            .map(
              (doc) => BitescoreRestaurant.tryFromFirestore(
                doc.data(),
                fallbackId: doc.id,
              ),
            )
            .whereType<BitescoreRestaurant>()
            .toList()
          ..sort(
            (a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()),
          );

    return restaurants;
  }

  static Future<List<BitescoreRestaurant>> loadRestaurantMergeCandidates({
    required BitescoreRestaurant duplicateRestaurant,
  }) async {
    final candidates =
        (await loadRestaurantsForFinder())
            .where(
              (restaurant) =>
                  restaurant.id != duplicateRestaurant.id &&
                  restaurant.isActive,
            )
            .toList()
          ..sort((a, b) {
            final aSameMarket =
                a.city.toLowerCase() ==
                    duplicateRestaurant.city.toLowerCase() &&
                a.state.toUpperCase() ==
                    duplicateRestaurant.state.toUpperCase();
            final bSameMarket =
                b.city.toLowerCase() ==
                    duplicateRestaurant.city.toLowerCase() &&
                b.state.toUpperCase() ==
                    duplicateRestaurant.state.toUpperCase();
            if (aSameMarket != bSameMarket) {
              return bSameMarket ? 1 : -1;
            }

            final aSameName =
                a.normalizedName == duplicateRestaurant.normalizedName;
            final bSameName =
                b.normalizedName == duplicateRestaurant.normalizedName;
            if (aSameName != bSameName) {
              return bSameName ? 1 : -1;
            }

            final byName = a.name.toLowerCase().compareTo(b.name.toLowerCase());
            if (byName != 0) {
              return byName;
            }

            final byCity = a.city.toLowerCase().compareTo(b.city.toLowerCase());
            if (byCity != 0) {
              return byCity;
            }

            return a.state.toLowerCase().compareTo(b.state.toLowerCase());
          });

    return candidates;
  }

  static Stream<List<BitescoreRestaurant>> restaurantsAdminStream() {
    return restaurantsCollection().snapshots().map((snapshot) {
      final restaurants = snapshot.docs
          .map(
            (doc) => BitescoreRestaurant.tryFromFinderFirestore(
              doc.data(),
              fallbackId: doc.id,
            ),
          )
          .whereType<BitescoreRestaurant>()
          .toList();

      restaurants.sort((a, b) {
        final byName = a.name.toLowerCase().compareTo(b.name.toLowerCase());
        if (byName != 0) {
          return byName;
        }
        return a.city.toLowerCase().compareTo(b.city.toLowerCase());
      });
      return restaurants;
    });
  }

  static Stream<List<BitescoreDish>> dishesAdminStream() {
    return dishesCollection().snapshots().map((snapshot) {
      final dishes = snapshot.docs
          .map(
            (doc) =>
                BitescoreDish.tryFromFirestore(doc.data(), fallbackId: doc.id),
          )
          .whereType<BitescoreDish>()
          .toList();

      dishes.sort((a, b) {
        final byRestaurant = a.restaurantName.toLowerCase().compareTo(
          b.restaurantName.toLowerCase(),
        );
        if (byRestaurant != 0) {
          return byRestaurant;
        }
        return a.name.toLowerCase().compareTo(b.name.toLowerCase());
      });
      return dishes;
    });
  }

  static Stream<List<BiteScoreAdminReviewEntry>> reviewsAdminStream() {
    return reviewsCollection()
        .orderBy('createdAt', descending: true)
        .snapshots()
        .asyncMap((snapshot) async {
          final dishesSnapshot = await dishesCollection().get();
          final restaurantsSnapshot = await restaurantsCollection().get();

          final dishesById = <String, BitescoreDish>{};
          for (final doc in dishesSnapshot.docs) {
            final dish = BitescoreDish.tryFromFirestore(
              doc.data(),
              fallbackId: doc.id,
            );
            if (dish != null) {
              dishesById[dish.id] = dish;
            }
          }

          final restaurantsById = <String, BitescoreRestaurant>{};
          for (final doc in restaurantsSnapshot.docs) {
            final restaurant = BitescoreRestaurant.tryFromFirestore(
              doc.data(),
              fallbackId: doc.id,
            );
            if (restaurant != null) {
              restaurantsById[restaurant.id] = restaurant;
            }
          }

          final entries = snapshot.docs
              .map(
                (doc) =>
                    DishReview.tryFromFirestore(doc.data(), fallbackId: doc.id),
              )
              .whereType<DishReview>()
              .map((review) {
                final dish = dishesById[review.dishId];
                final restaurant = restaurantsById[review.restaurantId];
                return BiteScoreAdminReviewEntry(
                  review: review,
                  dishName: dish?.name ?? 'Unknown dish',
                  restaurantName: restaurant?.name ?? 'Unknown restaurant',
                );
              })
              .toList();

          return entries;
        });
  }

  static Stream<List<BiteScoreReportedReviewAdminEntry>>
  reportedReviewsAdminStream() {
    return reviewReportsCollection()
        .where('status', isEqualTo: ReviewReport.statusPending)
        .snapshots()
        .asyncMap((snapshot) async {
          final reviewsSnapshot = await reviewsCollection().get();
          final dishesSnapshot = await dishesCollection().get();
          final restaurantsSnapshot = await restaurantsCollection().get();

          final reviewsById = <String, DishReview>{};
          for (final doc in reviewsSnapshot.docs) {
            final review = DishReview.tryFromFirestore(
              doc.data(),
              fallbackId: doc.id,
            );
            if (review != null) {
              reviewsById[review.id] = review;
            }
          }

          final dishesById = <String, BitescoreDish>{};
          for (final doc in dishesSnapshot.docs) {
            final dish = BitescoreDish.tryFromFirestore(
              doc.data(),
              fallbackId: doc.id,
            );
            if (dish != null) {
              dishesById[dish.id] = dish;
            }
          }

          final restaurantsById = <String, BitescoreRestaurant>{};
          for (final doc in restaurantsSnapshot.docs) {
            final restaurant = BitescoreRestaurant.tryFromFirestore(
              doc.data(),
              fallbackId: doc.id,
            );
            if (restaurant != null) {
              restaurantsById[restaurant.id] = restaurant;
            }
          }

          final reportsByReviewId = <String, List<ReviewReport>>{};
          for (final doc in snapshot.docs) {
            final report = ReviewReport.tryFromFirestore(
              doc.data(),
              fallbackId: doc.id,
            );
            if (report == null) {
              continue;
            }
            reportsByReviewId
                .putIfAbsent(report.reviewId, () => <ReviewReport>[])
                .add(report);
          }

          final entries =
              reportsByReviewId.entries
                  .map((group) {
                    final reports = [...group.value]
                      ..sort((a, b) {
                        final aDate =
                            a.createdAt ??
                            DateTime.fromMillisecondsSinceEpoch(0);
                        final bDate =
                            b.createdAt ??
                            DateTime.fromMillisecondsSinceEpoch(0);
                        return bDate.compareTo(aDate);
                      });
                    final review = reviewsById[group.key];
                    if (review == null) {
                      return null;
                    }

                    return BiteScoreReportedReviewAdminEntry(
                      review: review,
                      dishName:
                          dishesById[review.dishId]?.name ?? 'Unknown dish',
                      restaurantName:
                          restaurantsById[review.restaurantId]?.name ??
                          'Unknown restaurant',
                      reports: reports,
                    );
                  })
                  .whereType<BiteScoreReportedReviewAdminEntry>()
                  .toList()
                ..sort((a, b) {
                  final aDate =
                      a.reports.first.createdAt ??
                      DateTime.fromMillisecondsSinceEpoch(0);
                  final bDate =
                      b.reports.first.createdAt ??
                      DateTime.fromMillisecondsSinceEpoch(0);
                  return bDate.compareTo(aDate);
                });

          return entries;
        });
  }

  static Stream<List<BiteScoreReportedRestaurantAdminEntry>>
  reportedRestaurantsAdminStream() {
    return restaurantReportsCollection()
        .where('status', isEqualTo: RestaurantReport.statusPending)
        .snapshots()
        .asyncMap((snapshot) async {
          final restaurants = await loadRestaurantsForFinder();
          final restaurantsById = <String, BitescoreRestaurant>{
            for (final restaurant in restaurants) restaurant.id: restaurant,
          };

          final reportsByRestaurantId = <String, List<RestaurantReport>>{};
          for (final doc in snapshot.docs) {
            final report = RestaurantReport.tryFromFirestore(
              doc.data(),
              fallbackId: doc.id,
            );
            if (report == null) {
              continue;
            }
            reportsByRestaurantId
                .putIfAbsent(report.restaurantId, () => <RestaurantReport>[])
                .add(report);
          }

          final entries =
              reportsByRestaurantId.entries
                  .map((group) {
                    final restaurant = restaurantsById[group.key];
                    if (restaurant == null) {
                      return null;
                    }

                    final reports = [...group.value]
                      ..sort((a, b) {
                        final aDate =
                            a.createdAt ??
                            DateTime.fromMillisecondsSinceEpoch(0);
                        final bDate =
                            b.createdAt ??
                            DateTime.fromMillisecondsSinceEpoch(0);
                        return bDate.compareTo(aDate);
                      });

                    return BiteScoreReportedRestaurantAdminEntry(
                      restaurant: restaurant,
                      reports: reports,
                    );
                  })
                  .whereType<BiteScoreReportedRestaurantAdminEntry>()
                  .toList()
                ..sort((a, b) {
                  final aDate =
                      a.reports.first.createdAt ??
                      DateTime.fromMillisecondsSinceEpoch(0);
                  final bDate =
                      b.reports.first.createdAt ??
                      DateTime.fromMillisecondsSinceEpoch(0);
                  return bDate.compareTo(aDate);
                });

          return entries;
        });
  }

  static Stream<List<BiteScoreReportedDishAdminEntry>>
  reportedDishesAdminStream() {
    return dishReportsCollection()
        .where('status', isEqualTo: DishReport.statusPending)
        .snapshots()
        .asyncMap((snapshot) async {
          final dishesSnapshot = await dishesCollection().get();
          final restaurants = await loadRestaurantsForFinder();

          final dishesById = <String, BitescoreDish>{};
          for (final doc in dishesSnapshot.docs) {
            final dish = BitescoreDish.tryFromFirestore(
              doc.data(),
              fallbackId: doc.id,
            );
            if (dish != null) {
              dishesById[dish.id] = dish;
            }
          }

          final restaurantsById = <String, BitescoreRestaurant>{
            for (final restaurant in restaurants) restaurant.id: restaurant,
          };

          final reportsByDishId = <String, List<DishReport>>{};
          for (final doc in snapshot.docs) {
            final report = DishReport.tryFromFirestore(
              doc.data(),
              fallbackId: doc.id,
            );
            if (report == null) {
              continue;
            }
            reportsByDishId
                .putIfAbsent(report.dishId, () => <DishReport>[])
                .add(report);
          }

          final entries =
              reportsByDishId.entries
                  .map((group) {
                    final dish = dishesById[group.key];
                    if (dish == null) {
                      return null;
                    }

                    final reports = [...group.value]
                      ..sort((a, b) {
                        final aDate =
                            a.createdAt ??
                            DateTime.fromMillisecondsSinceEpoch(0);
                        final bDate =
                            b.createdAt ??
                            DateTime.fromMillisecondsSinceEpoch(0);
                        return bDate.compareTo(aDate);
                      });

                    return BiteScoreReportedDishAdminEntry(
                      dish: dish,
                      restaurant: restaurantsById[dish.restaurantId],
                      reports: reports,
                    );
                  })
                  .whereType<BiteScoreReportedDishAdminEntry>()
                  .toList()
                ..sort((a, b) {
                  final aDate =
                      a.reports.first.createdAt ??
                      DateTime.fromMillisecondsSinceEpoch(0);
                  final bDate =
                      b.reports.first.createdAt ??
                      DateTime.fromMillisecondsSinceEpoch(0);
                  return bDate.compareTo(aDate);
                });

          return entries;
        });
  }

  static Stream<List<BiteScoreDuplicateRestaurantReportAdminEntry>>
  duplicateRestaurantReportsAdminStream() {
    return duplicateRestaurantReportsCollection()
        .where('status', isEqualTo: DuplicateRestaurantReport.statusPending)
        .snapshots()
        .asyncMap((snapshot) async {
          final restaurants = await loadRestaurantsForFinder();
          final restaurantsById = <String, BitescoreRestaurant>{
            for (final restaurant in restaurants) restaurant.id: restaurant,
          };

          final reportsByRestaurantId =
              <String, List<DuplicateRestaurantReport>>{};
          for (final doc in snapshot.docs) {
            final report = DuplicateRestaurantReport.tryFromFirestore(
              doc.data(),
              fallbackId: doc.id,
            );
            if (report == null) {
              continue;
            }
            reportsByRestaurantId
                .putIfAbsent(
                  report.restaurantId,
                  () => <DuplicateRestaurantReport>[],
                )
                .add(report);
          }

          final entries =
              reportsByRestaurantId.entries
                  .map((group) {
                    final restaurant = restaurantsById[group.key];
                    if (restaurant == null) {
                      return null;
                    }

                    final reports = [...group.value]
                      ..sort((a, b) {
                        final aDate =
                            a.createdAt ??
                            DateTime.fromMillisecondsSinceEpoch(0);
                        final bDate =
                            b.createdAt ??
                            DateTime.fromMillisecondsSinceEpoch(0);
                        return bDate.compareTo(aDate);
                      });

                    return BiteScoreDuplicateRestaurantReportAdminEntry(
                      restaurant: restaurant,
                      reports: reports,
                    );
                  })
                  .whereType<BiteScoreDuplicateRestaurantReportAdminEntry>()
                  .toList()
                ..sort((a, b) {
                  final aDate =
                      a.reports.first.createdAt ??
                      DateTime.fromMillisecondsSinceEpoch(0);
                  final bDate =
                      b.reports.first.createdAt ??
                      DateTime.fromMillisecondsSinceEpoch(0);
                  return bDate.compareTo(aDate);
                });

          return entries;
        });
  }

  static Stream<List<BiteScoreAdminClaimEntry>> claimRequestsAdminStream() {
    return claimRequestsCollection()
        .orderBy('createdAt', descending: true)
        .snapshots()
        .asyncMap((snapshot) async {
          final restaurants = await loadRestaurantsForFinder();
          final restaurantsById = <String, BitescoreRestaurant>{
            for (final restaurant in restaurants) restaurant.id: restaurant,
          };

          final entries = snapshot.docs
              .map(
                (doc) => RestaurantClaimRequest.tryFromFirestore(
                  doc.data(),
                  fallbackId: doc.id,
                ),
              )
              .whereType<RestaurantClaimRequest>()
              .map(
                (request) => BiteScoreAdminClaimEntry(
                  request: request,
                  restaurant: restaurantsById[request.restaurantId],
                ),
              )
              .toList();

          return entries;
        });
  }

  static Stream<List<DishEditSuggestionAdminEntry>>
  dishEditSuggestionsAdminStream() {
    return editProposalsCollection()
        .orderBy('createdAt', descending: true)
        .snapshots()
        .asyncMap((snapshot) async {
          await maybeAutoApplyDueDishEditSuggestions();

          final refreshedSnapshot = await editProposalsCollection()
              .orderBy('createdAt', descending: true)
              .get();
          final dishesSnapshot = await dishesCollection().get();

          final dishesById = <String, BitescoreDish>{};
          for (final doc in dishesSnapshot.docs) {
            final dish = BitescoreDish.tryFromFirestore(
              doc.data(),
              fallbackId: doc.id,
            );
            if (dish != null) {
              dishesById[dish.id] = dish;
            }
          }

          final pendingProposals = refreshedSnapshot.docs
              .map(
                (doc) => DishEditProposal.tryFromFirestore(
                  doc.data(),
                  fallbackId: doc.id,
                ),
              )
              .whereType<DishEditProposal>()
              .where((proposal) => proposal.status == 'pending')
              .toList();

          return _buildDishEditSuggestionAdminEntries(
            proposals: pendingProposals,
            dishesById: dishesById,
          );
        });
  }

  static Stream<List<BiteScoreApprovedOwnershipEntry>>
  approvedOwnershipsAdminStream() {
    return restaurantsCollection().snapshots().asyncMap((snapshot) async {
      final claimsSnapshot = await claimRequestsCollection()
          .where('status', isEqualTo: 'approved')
          .get();

      final approvedClaims = claimsSnapshot.docs
          .map(
            (doc) => RestaurantClaimRequest.tryFromFirestore(
              doc.data(),
              fallbackId: doc.id,
            ),
          )
          .whereType<RestaurantClaimRequest>()
          .toList();

      approvedClaims.sort((a, b) {
        final aDate =
            a.updatedAt ??
            a.createdAt ??
            DateTime.fromMillisecondsSinceEpoch(0);
        final bDate =
            b.updatedAt ??
            b.createdAt ??
            DateTime.fromMillisecondsSinceEpoch(0);
        return bDate.compareTo(aDate);
      });

      final restaurants = snapshot.docs
          .map(
            (doc) => BitescoreRestaurant.tryFromFinderFirestore(
              doc.data(),
              fallbackId: doc.id,
            ),
          )
          .whereType<BitescoreRestaurant>()
          .where(
            (restaurant) =>
                restaurant.isClaimed ||
                (restaurant.ownerUserId?.trim().isNotEmpty ?? false),
          )
          .toList();

      final entries =
          restaurants.map((restaurant) {
            final ownerUserId = restaurant.ownerUserId?.trim();
            RestaurantClaimRequest? approvedClaim;
            for (final claim in approvedClaims) {
              if (claim.restaurantId != restaurant.id) {
                continue;
              }
              if (ownerUserId == null ||
                  ownerUserId.isEmpty ||
                  (claim.requesterUserId?.trim() == ownerUserId)) {
                approvedClaim = claim;
                break;
              }
              approvedClaim ??= claim;
            }

            return BiteScoreApprovedOwnershipEntry(
              restaurant: restaurant,
              approvedClaim: approvedClaim,
            );
          }).toList()..sort((a, b) {
            final byName = a.restaurant.name.toLowerCase().compareTo(
              b.restaurant.name.toLowerCase(),
            );
            if (byName != 0) {
              return byName;
            }
            return a.restaurant.city.toLowerCase().compareTo(
              b.restaurant.city.toLowerCase(),
            );
          });

      return entries;
    });
  }

  static Future<List<BiteScoreAdminUserEntry>> loadUsersForAdmin() async {
    _requireSignedInAdminUser(operation: 'load_users_for_admin');

    final usersById = <String, _MutableAdminUserEntry>{};

    void upsertUser({
      required String? uid,
      String? email,
      String? phoneNumber,
      String? displayName,
      bool hasRestaurantAccount = false,
      bool hasBiteScoreOwnership = false,
      bool? isEmailVerified,
      String? restaurantAccountStatus,
      String? claimedRestaurantName,
      String? activityTag,
    }) {
      final trimmedUid = uid?.trim();
      if (trimmedUid == null || trimmedUid.isEmpty) {
        return;
      }

      final existing = usersById.putIfAbsent(
        trimmedUid,
        () => _MutableAdminUserEntry(trimmedUid),
      );
      existing.apply(
        email: email,
        phoneNumber: phoneNumber,
        displayName: displayName,
        hasRestaurantAccount: hasRestaurantAccount,
        hasBiteScoreOwnership: hasBiteScoreOwnership,
        isEmailVerified: isEmailVerified,
        restaurantAccountStatus: restaurantAccountStatus,
        claimedRestaurantName: claimedRestaurantName,
        activityTag: activityTag,
      );
    }

    final restaurantAccountsSnapshot = await restaurantAccountsCollection()
        .get();
    for (final doc in restaurantAccountsSnapshot.docs) {
      final data = doc.data();
      upsertUser(
        uid: _readAdminString(data[Restaurant.fieldUid]) ?? doc.id,
        email: _readAdminString(data[Restaurant.fieldEmail]),
        phoneNumber: _readAdminString(data['phoneNumber']),
        displayName:
            _readAdminString(data[Restaurant.fieldName]) ??
            _readAdminString(data[Restaurant.legacyFieldName]),
        hasRestaurantAccount: true,
        isEmailVerified: data['emailVerified'] as bool?,
        restaurantAccountStatus: _readAdminString(
          data[Restaurant.fieldApprovalStatus],
        ),
        activityTag: 'Coupon',
      );
    }

    final userProfilesSnapshot = await _firestore
        .collection('user_profiles')
        .get();
    for (final doc in userProfilesSnapshot.docs) {
      final data = doc.data();
      upsertUser(
        uid: _readAdminString(data['userId']) ?? doc.id,
        email: _readAdminString(data[Restaurant.fieldEmail]),
        phoneNumber: _readAdminString(data['phoneNumber']),
        displayName: _readAdminString(data['displayName']),
        activityTag: 'Profile',
      );
    }

    final publicProfilesSnapshot = await publicReviewerProfilesCollection()
        .get();
    for (final doc in publicProfilesSnapshot.docs) {
      final data = doc.data();
      upsertUser(
        uid: _readAdminString(data['userId']) ?? doc.id,
        phoneNumber: _readAdminString(data['phoneNumber']),
        displayName: _readAdminString(data['publicDisplayName']),
        activityTag: 'Profile',
      );
    }

    final restaurantsSnapshot = await restaurantsCollection().get();
    for (final doc in restaurantsSnapshot.docs) {
      final restaurant = _parseRestaurantCompat(doc.data(), fallbackId: doc.id);
      if (restaurant == null) {
        continue;
      }
      upsertUser(
        uid: restaurant.ownerUserId,
        hasBiteScoreOwnership: true,
        claimedRestaurantName: restaurant.name,
        activityTag: 'BiteScore Owner',
      );
    }

    final claimRequestsSnapshot = await claimRequestsCollection().get();
    for (final doc in claimRequestsSnapshot.docs) {
      final request = RestaurantClaimRequest.tryFromFirestore(
        doc.data(),
        fallbackId: doc.id,
      );
      if (request == null) {
        continue;
      }
      upsertUser(
        uid: request.requesterUserId,
        email: request.email,
        phoneNumber: request.phone,
        displayName: request.claimantName,
        activityTag: 'Claims',
      );
    }

    final reviewsSnapshot = await reviewsCollection().get();
    for (final doc in reviewsSnapshot.docs) {
      final review = DishReview.tryFromFirestore(
        doc.data(),
        fallbackId: doc.id,
      );
      upsertUser(uid: review?.userId, activityTag: 'Reviews');
    }

    final reviewReportsSnapshot = await reviewReportsCollection().get();
    for (final doc in reviewReportsSnapshot.docs) {
      final report = ReviewReport.tryFromFirestore(
        doc.data(),
        fallbackId: doc.id,
      );
      upsertUser(uid: report?.reportingUserId, activityTag: 'Reports');
    }

    final restaurantReportsSnapshot = await restaurantReportsCollection().get();
    for (final doc in restaurantReportsSnapshot.docs) {
      final report = RestaurantReport.tryFromFirestore(
        doc.data(),
        fallbackId: doc.id,
      );
      upsertUser(uid: report?.reportingUserId, activityTag: 'Reports');
    }

    final dishReportsSnapshot = await dishReportsCollection().get();
    for (final doc in dishReportsSnapshot.docs) {
      final report = DishReport.tryFromFirestore(
        doc.data(),
        fallbackId: doc.id,
      );
      upsertUser(uid: report?.reportingUserId, activityTag: 'Reports');
    }

    final duplicateReportsSnapshot =
        await duplicateRestaurantReportsCollection().get();
    for (final doc in duplicateReportsSnapshot.docs) {
      final report = DuplicateRestaurantReport.tryFromFirestore(
        doc.data(),
        fallbackId: doc.id,
      );
      upsertUser(uid: report?.reportingUserId, activityTag: 'Reports');
    }

    final editProposalsSnapshot = await editProposalsCollection().get();
    for (final doc in editProposalsSnapshot.docs) {
      final proposal = DishEditProposal.tryFromFirestore(
        doc.data(),
        fallbackId: doc.id,
      );
      upsertUser(uid: proposal?.userId, activityTag: 'Suggestions');
    }

    final reviewVotesSnapshot = await reviewFeedbackVotesCollection().get();
    for (final doc in reviewVotesSnapshot.docs) {
      final vote = ReviewFeedbackVote.tryFromFirestore(
        doc.data(),
        fallbackId: doc.id,
      );
      upsertUser(uid: vote?.userId, activityTag: 'Review Votes');
    }

    for (final adminEmail in AdminAccessService.allowedAdminEmails) {
      final existingEntry = usersById.values
          .where((entry) => entry.email?.toLowerCase().trim() == adminEmail)
          .toList();
      if (existingEntry.isNotEmpty) {
        existingEntry.first.isAdmin = true;
      }
    }

    final entries =
        usersById.values
            .map(
              (entry) => BiteScoreAdminUserEntry(
                uid: entry.uid,
                email: entry.email,
                phoneNumber: entry.phoneNumber,
                displayName: entry.displayName,
                claimedRestaurantNames: Set<String>.unmodifiable(
                  entry.claimedRestaurantNames,
                ),
                hasRestaurantAccount: entry.hasRestaurantAccount,
                hasBiteScoreOwnership: entry.hasBiteScoreOwnership,
                isAdmin:
                    entry.isAdmin ||
                    AdminAccessService.isAdminEmail(entry.email),
                isEmailVerified: entry.isEmailVerified,
                restaurantAccountStatus: entry.restaurantAccountStatus,
                activityTags: Set<String>.unmodifiable(entry.activityTags),
              ),
            )
            .toList()
          ..sort((a, b) {
            final byName = (a.displayName ?? '').toLowerCase().compareTo(
              (b.displayName ?? '').toLowerCase(),
            );
            if (byName != 0) {
              return byName;
            }
            final byEmail = (a.email ?? '').toLowerCase().compareTo(
              (b.email ?? '').toLowerCase(),
            );
            if (byEmail != 0) {
              return byEmail;
            }
            return a.uid.compareTo(b.uid);
          });

    return entries;
  }

  static Future<void> deleteUserAccountRecordsAsAdmin(
    BiteScoreAdminUserEntry user,
  ) async {
    _requireSignedInAdminUser(operation: 'delete_user_account_records');

    if (user.isAdmin) {
      throw ArgumentError('Admin records cannot be deleted here.');
    }

    final uid = user.uid.trim();
    if (uid.isEmpty) {
      throw ArgumentError('User ID is missing.');
    }

    final restaurantsSnapshot = await restaurantsCollection()
        .where('ownerUserId', isEqualTo: uid)
        .get();
    final batch = _firestore.batch();
    for (final doc in restaurantsSnapshot.docs) {
      batch.set(doc.reference, {
        'ownerUserId': null,
        'isClaimed': false,
        'updatedAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
    }

    if (restaurantsSnapshot.docs.isNotEmpty) {
      await batch.commit();
    }

    final accountSnapshot = await restaurantAccountsCollection().doc(uid).get();
    if (accountSnapshot.exists) {
      final couponsSnapshot = await restaurantAccountsCollection()
          .doc(uid)
          .collection('coupons')
          .get();
      if (couponsSnapshot.docs.isNotEmpty) {
        final couponBatch = _firestore.batch();
        for (final couponDoc in couponsSnapshot.docs) {
          couponBatch.delete(couponDoc.reference);
        }
        await couponBatch.commit();
      }
      await restaurantAccountsCollection().doc(uid).delete();
    }
  }

  static Future<List<BitescoreRestaurant>> loadRestaurantsForFinder() async {
    final docs = await _loadAllRestaurantDocuments();
    final importedCount = docs.where(_looksLikeImportedRestaurantDoc).length;

    final parsedRestaurants = docs
        .map(
          (doc) => BitescoreRestaurant.tryFromFinderFirestore(
            doc.data(),
            fallbackId: doc.id,
          ),
        )
        .whereType<BitescoreRestaurant>()
        .toList();
    final normalizedRestaurants = _applyFinderCompatibilityFallbacks(
      parsedRestaurants,
    );

    final dedupedRestaurants = <String, BitescoreRestaurant>{};
    for (final restaurant in normalizedRestaurants) {
      final key = _finderRestaurantKey(restaurant);
      dedupedRestaurants.putIfAbsent(key, () => restaurant);
    }
    final restaurants = dedupedRestaurants.values.toList()
      ..sort((a, b) {
        final byState = a.state.compareTo(b.state);
        if (byState != 0) {
          return byState;
        }
        final byCity = a.city.compareTo(b.city);
        if (byCity != 0) {
          return byCity;
        }
        return a.name.compareTo(b.name);
      });

    return restaurants;
  }

  static Future<List<BitescoreDish>> loadDishes() async {
    final snapshot = await dishesCollection().get();

    return snapshot.docs
        .map(
          (doc) =>
              BitescoreDish.tryFromFirestore(doc.data(), fallbackId: doc.id),
        )
        .whereType<BitescoreDish>()
        .where((dish) => dish.isActive && !dish.isMerged)
        .toList();
  }

  static Future<List<DishCatalogSuggestion>> loadDishCatalogSuggestions(
    String query,
  ) async {
    final normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery.isEmpty) {
      return const <DishCatalogSuggestion>[];
    }

    final catalog = await _loadDishCatalogCache();
    final queryTokens = _catalogTokens(normalizedQuery);
    if (queryTokens.isEmpty) {
      return const <DishCatalogSuggestion>[];
    }

    final scoredMatches = <_CatalogMatch>[];

    for (final suggestion in catalog) {
      final canonicalName = suggestion.canonicalName;
      final aliases = suggestion.aliases;
      final searchWords = _catalogSearchWords(canonicalName, aliases);
      final fullTerms = <String>[canonicalName.toLowerCase(), ...aliases];

      final matchesAllTokens = queryTokens.every(
        (token) => searchWords.any((word) => word.contains(token)),
      );
      if (!matchesAllTokens) {
        continue;
      }

      var score = 0;
      final canonicalLower = canonicalName.toLowerCase();

      if (canonicalLower == normalizedQuery) {
        score += 500;
      }
      if (canonicalLower.startsWith(normalizedQuery)) {
        score += 250;
      }
      if (canonicalLower.contains(normalizedQuery)) {
        score += 120;
      }
      if (fullTerms.any((term) => term.startsWith(normalizedQuery))) {
        score += 80;
      }
      score += queryTokens.length * 10;
      score -= canonicalName.length;

      scoredMatches.add(
        _CatalogMatch(
          suggestion: DishCatalogSuggestion(
            canonicalName: canonicalName,
            aliases: aliases,
          ),
          score: score,
        ),
      );
    }

    scoredMatches.sort((a, b) {
      final byScore = b.score.compareTo(a.score);
      if (byScore != 0) {
        return byScore;
      }
      return a.suggestion.canonicalName.toLowerCase().compareTo(
        b.suggestion.canonicalName.toLowerCase(),
      );
    });

    final deduped = <String, DishCatalogSuggestion>{};
    for (final match in scoredMatches) {
      deduped.putIfAbsent(
        match.suggestion.canonicalName.toLowerCase(),
        () => match.suggestion,
      );
      if (deduped.length >= 8) {
        break;
      }
    }

    return deduped.values.toList();
  }

  static Future<Map<String, DishRatingAggregate>> loadRatingAggregates() async {
    final snapshot = await ratingAggregatesCollection().get();

    final result = <String, DishRatingAggregate>{};
    for (final doc in snapshot.docs) {
      final aggregate = DishRatingAggregate.tryFromFirestore(doc.data());
      if (aggregate != null) {
        result[aggregate.dishId] = aggregate;
      }
    }
    return result;
  }

  static Future<List<BiteScoreHomeEntry>> loadHomeEntries() async {
    final restaurants = (await loadRestaurantsForFinder())
        .where((restaurant) => restaurant.isActive)
        .toList();
    final dishes = await loadDishes();
    final aggregates = await loadRatingAggregates();

    final restaurantsById = <String, BitescoreRestaurant>{
      for (final restaurant in restaurants) restaurant.id: restaurant,
    };

    final entries = <BiteScoreHomeEntry>[];

    for (final dish in dishes) {
      final restaurant = restaurantsById[dish.restaurantId];
      if (restaurant == null) {
        continue;
      }

      final aggregate =
          aggregates[dish.id] ??
          DishRatingAggregate(dishId: dish.id, restaurantId: dish.restaurantId);

      entries.add(
        BiteScoreHomeEntry(
          dish: dish,
          restaurant: restaurant,
          aggregate: aggregate,
        ),
      );
    }

    return entries;
  }

  static Future<List<BiteScoreHomeEntry>> loadEntriesForRestaurant(
    BitescoreRestaurant restaurant, {
    bool includeInactive = false,
  }) async {
    final dishesSnapshot = await dishesCollection()
        .where('restaurantId', isEqualTo: restaurant.id)
        .get();
    final aggregates = await loadRatingAggregates();

    final dishes = dishesSnapshot.docs
        .map(
          (doc) =>
              BitescoreDish.tryFromFirestore(doc.data(), fallbackId: doc.id),
        )
        .whereType<BitescoreDish>()
        .where((dish) => !dish.isMerged && (includeInactive || dish.isActive))
        .toList();

    return dishes
        .map(
          (dish) => BiteScoreHomeEntry(
            dish: dish,
            restaurant: restaurant,
            aggregate:
                aggregates[dish.id] ??
                DishRatingAggregate(
                  dishId: dish.id,
                  restaurantId: dish.restaurantId,
                ),
          ),
        )
        .toList();
  }

  static Future<BitescoreRestaurant?> loadRestaurantById(
    String restaurantId,
  ) async {
    final snapshot = await restaurantsCollection().doc(restaurantId).get();
    return _parseRestaurantCompat(snapshot.data(), fallbackId: snapshot.id);
  }

  static Future<DishRatingAggregate?> loadDishRatingAggregate(
    String dishId,
  ) async {
    final snapshot = await ratingAggregatesCollection().doc(dishId).get();
    return DishRatingAggregate.tryFromFirestore(snapshot.data());
  }

  static Future<List<DishReview>> loadDishReviews(String dishId) async {
    final snapshot = await reviewsCollection()
        .where('dishId', isEqualTo: dishId)
        .limit(100)
        .get();

    final reviews = snapshot.docs
        .map(
          (doc) => DishReview.tryFromFirestore(doc.data(), fallbackId: doc.id),
        )
        .whereType<DishReview>()
        .toList();

    reviews.sort((a, b) {
      final aDate = a.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
      final bDate = b.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
      return bDate.compareTo(aDate);
    });

    return reviews;
  }

  static Future<bool> isRestaurantFavoritedByCurrentUser(
    String restaurantId,
  ) async {
    final trimmedRestaurantId = restaurantId.trim();
    if (trimmedRestaurantId.isEmpty) {
      return false;
    }

    final user = FirebaseAuth.instance.currentUser;
    if (user == null || user.isAnonymous) {
      return false;
    }

    try {
      final snapshot = await favoriteRestaurantsCollection(
        user.uid,
      ).doc(trimmedRestaurantId).get();
      return snapshot.exists;
    } catch (_) {
      return false;
    }
  }

  static Future<bool> isSaverRestaurantFavoritedByCurrentUser(
    Restaurant restaurant,
  ) async {
    return isRestaurantFavoritedByCurrentUser(
      _favoriteSaverRestaurantId(restaurant),
    );
  }

  static Future<bool> isDishFavoritedByCurrentUser(String dishId) async {
    final trimmedDishId = dishId.trim();
    if (trimmedDishId.isEmpty) {
      return false;
    }

    final user = FirebaseAuth.instance.currentUser;
    if (user == null || user.isAnonymous) {
      return false;
    }

    try {
      final snapshot = await favoriteDishesCollection(
        user.uid,
      ).doc(trimmedDishId).get();
      return snapshot.exists;
    } catch (_) {
      return false;
    }
  }

  static Future<bool> isCouponFavoritedByCurrentUser(String couponId) async {
    final trimmedCouponId = couponId.trim();
    if (trimmedCouponId.isEmpty) {
      return false;
    }

    final user = FirebaseAuth.instance.currentUser;
    if (user == null || user.isAnonymous) {
      return false;
    }

    try {
      final snapshot = await favoriteCouponsCollection(
        user.uid,
      ).doc(trimmedCouponId).get();
      return snapshot.exists;
    } catch (_) {
      return false;
    }
  }

  static Future<void> setRestaurantFavorite({
    required BitescoreRestaurant restaurant,
    required bool isFavorite,
  }) async {
    final user = _requireSignedInAppUser();
    final doc = favoriteRestaurantsCollection(user.uid).doc(restaurant.id);

    if (!isFavorite) {
      await doc.delete();
      return;
    }

    await doc.set({
      'restaurantId': restaurant.id,
      'restaurantName': restaurant.name,
      'userId': user.uid,
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  static Future<void> setSaverRestaurantFavorite({
    required Restaurant restaurant,
    required bool isFavorite,
  }) async {
    final user = _requireSignedInAppUser();
    final restaurantId = _favoriteSaverRestaurantId(restaurant);
    final doc = favoriteRestaurantsCollection(user.uid).doc(restaurantId);

    if (!isFavorite) {
      await doc.delete();
      return;
    }

    await doc.set({
      'restaurantId': restaurantId,
      'restaurantName': restaurant.name.trim(),
      'restaurantType': 'bitesaver',
      'city': restaurant.city.trim(),
      'state': '',
      'zipCode': restaurant.zipCode.trim(),
      'streetAddress': restaurant.streetAddress?.trim(),
      'userId': user.uid,
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  static Future<void> setDishFavorite({
    required BitescoreDish dish,
    required BitescoreRestaurant restaurant,
    required bool isFavorite,
  }) async {
    final user = _requireSignedInAppUser();
    final doc = favoriteDishesCollection(user.uid).doc(dish.id);

    if (!isFavorite) {
      await doc.delete();
      return;
    }

    await doc.set({
      'dishId': dish.id,
      'dishName': dish.name,
      'restaurantId': restaurant.id,
      'restaurantName': restaurant.name,
      'userId': user.uid,
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  static Future<void> setCouponFavorite({
    required Coupon coupon,
    required bool isFavorite,
  }) async {
    final user = _requireSignedInAppUser();
    final doc = favoriteCouponsCollection(user.uid).doc(coupon.id.trim());

    if (!isFavorite) {
      await doc.delete();
      return;
    }

    await doc.set({
      'couponId': coupon.id.trim(),
      'couponTitle': coupon.title.trim(),
      'restaurantName': coupon.restaurant.trim(),
      'distance': coupon.distance.trim(),
      'usageRule': coupon.usageRule.trim(),
      'expires': coupon.expires.trim(),
      'userId': user.uid,
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  static Future<BiteScoreUserProfileData> loadCurrentUserProfileData() async {
    final user = _requireSignedInAppUser();
    final publicIdentity = await _ensureCurrentUserPublicReviewerIdentity(user);

    final favoriteRestaurantSnapshot = await favoriteRestaurantsCollection(
      user.uid,
    ).get();
    final favoriteDishSnapshot = await favoriteDishesCollection(user.uid).get();
    final reviewSnapshot = await reviewsCollection()
        .where('userId', isEqualTo: user.uid)
        .get();

    final favoriteRestaurants = <BitescoreRestaurant>[];
    final favoriteSaverRestaurants = <Restaurant>[];
    final saverFavoriteDocs = favoriteRestaurantSnapshot.docs
        .where(
          (doc) => _readString(doc.data()['restaurantType']) == 'bitesaver',
        )
        .toList();
    final approvedSaverRestaurantsById = saverFavoriteDocs.isEmpty
        ? <String, Restaurant>{}
        : {
            for (final restaurant
                in await RestaurantAccountService.loadApprovedRestaurantsWithCoupons())
              _favoriteSaverRestaurantId(restaurant): restaurant,
          };

    for (final doc in favoriteRestaurantSnapshot.docs) {
      final data = doc.data();
      final restaurantType = _readString(data['restaurantType']);
      if (restaurantType == 'bitesaver') {
        final restaurantId = _readString(data['restaurantId']) ?? doc.id;
        final freshRestaurant = approvedSaverRestaurantsById[restaurantId];
        if (freshRestaurant != null) {
          favoriteSaverRestaurants.add(freshRestaurant);
          continue;
        }

        favoriteSaverRestaurants.add(
          Restaurant.fromFirestore({
            Restaurant.fieldName:
                _readString(data['restaurantName']) ?? 'Saved Restaurant',
            Restaurant.fieldCity: _readString(data['city']) ?? '',
            Restaurant.fieldZipCode: _readString(data['zipCode']) ?? '',
            Restaurant.fieldStreetAddress: _readString(data['streetAddress']),
            Restaurant.fieldBusinessHours: data[Restaurant.fieldBusinessHours],
            Restaurant.fieldDistance: Restaurant.defaultDistanceLabel,
          }, coupons: const <Coupon>[]),
        );
        continue;
      }

      final restaurantId = _readString(data['restaurantId']) ?? doc.id;
      final restaurant = await loadRestaurantById(restaurantId);
      if (restaurant != null && restaurant.isActive) {
        favoriteRestaurants.add(restaurant);
      }
    }
    favoriteRestaurants.sort(
      (a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()),
    );
    favoriteSaverRestaurants.sort(
      (a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()),
    );

    final favoriteDishIds = favoriteDishSnapshot.docs
        .map((doc) => _readString(doc.data()['dishId']) ?? doc.id)
        .whereType<String>()
        .toList();
    final favoriteDishEntries = <BiteScoreHomeEntry>[];
    for (final dishId in favoriteDishIds) {
      final entry = await _loadDishHomeEntryById(dishId);
      if (entry != null) {
        favoriteDishEntries.add(entry);
      }
    }
    favoriteDishEntries.sort((a, b) {
      final byScore = b.aggregate.overallBiteScore.compareTo(
        a.aggregate.overallBiteScore,
      );
      if (byScore != 0) {
        return byScore;
      }
      return a.dish.name.toLowerCase().compareTo(b.dish.name.toLowerCase());
    });

    final favoriteCouponSnapshot = await favoriteCouponsCollection(
      user.uid,
    ).get();
    final favoriteCoupons =
        favoriteCouponSnapshot.docs.map((doc) {
          final data = doc.data();
          return Coupon(
            id: _readString(data['couponId']) ?? doc.id,
            restaurant: _readString(data['restaurantName']) ?? '',
            title: _readString(data['couponTitle']) ?? 'Saved Coupon',
            distance:
                _readString(data['distance']) ??
                Restaurant.defaultDistanceLabel,
            expires: _readString(data['expires']) ?? 'Limited time',
            usageRule:
                _readString(data['usageRule']) ?? Coupon.defaultUsageRule,
          );
        }).toList()..sort(
          (a, b) => a.title.toLowerCase().compareTo(b.title.toLowerCase()),
        );

    final reviews =
        reviewSnapshot.docs
            .map(
              (doc) =>
                  DishReview.tryFromFirestore(doc.data(), fallbackId: doc.id),
            )
            .whereType<DishReview>()
            .toList()
          ..sort((a, b) {
            final aDate = a.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
            final bDate = b.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
            final byDate = bDate.compareTo(aDate);
            if (byDate != 0) {
              return byDate;
            }
            return a.id.compareTo(b.id);
          });

    final reviewEntries = <BiteScoreUserReviewEntry>[];
    for (final review in reviews) {
      final dish = await loadDishById(review.dishId);
      final restaurant = await loadRestaurantById(review.restaurantId);
      reviewEntries.add(
        BiteScoreUserReviewEntry(
          review: review,
          dish: dish,
          restaurant: restaurant,
        ),
      );
    }

    final reviewTrustByReviewId = await loadReviewTrustSummaries(
      reviews,
      currentUserId: user.uid,
    );
    final helpfulVotesReceived = reviewTrustByReviewId.values.fold<int>(
      0,
      (total, summary) => total + summary.helpfulCount,
    );
    final accountAgeDays = _accountAgeDaysForUser(user);
    final moderationFlagCount = 0;
    final badgeLabel = _profileBadgeLabelFor(
      reviewCount: reviews.length,
      helpfulVotesReceived: helpfulVotesReceived,
      accountAgeDays: accountAgeDays,
      moderationFlagCount: moderationFlagCount,
    );

    return BiteScoreUserProfileData(
      publicDisplayName: publicIdentity.publicDisplayName,
      chosenUsername: publicIdentity.chosenUsername,
      fallbackUsername: publicIdentity.fallbackUsername,
      favoriteRestaurants: favoriteRestaurants,
      favoriteSaverRestaurants: favoriteSaverRestaurants,
      favoriteDishEntries: favoriteDishEntries,
      favoriteCoupons: favoriteCoupons,
      reviews: reviewEntries,
      badgeLabel: badgeLabel,
      reviewCount: reviews.length,
      helpfulVotesReceived: helpfulVotesReceived,
      accountAgeDays: accountAgeDays,
      moderationFlagCount: moderationFlagCount,
    );
  }

  static Future<BiteScorePublicReviewerProfileData>
  loadPublicReviewerProfileData(String userId) async {
    final trimmedUserId = userId.trim();
    if (trimmedUserId.isEmpty) {
      throw ArgumentError('Could not load that reviewer profile right now.');
    }

    final identity = await _loadPublicReviewerIdentity(trimmedUserId);
    final reviewSnapshot = await reviewsCollection()
        .where('userId', isEqualTo: trimmedUserId)
        .get();
    final reviews =
        reviewSnapshot.docs
            .map(
              (doc) =>
                  DishReview.tryFromFirestore(doc.data(), fallbackId: doc.id),
            )
            .whereType<DishReview>()
            .toList()
          ..sort((a, b) {
            final aDate = a.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
            final bDate = b.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
            final byDate = bDate.compareTo(aDate);
            if (byDate != 0) {
              return byDate;
            }
            return a.id.compareTo(b.id);
          });

    final reviewEntries = <BiteScoreUserReviewEntry>[];
    for (final review in reviews) {
      final dish = await loadDishById(review.dishId);
      final restaurant = await loadRestaurantById(review.restaurantId);
      reviewEntries.add(
        BiteScoreUserReviewEntry(
          review: review,
          dish: dish,
          restaurant: restaurant,
        ),
      );
    }

    final trustByReviewId = await loadReviewTrustSummaries(reviews);
    final helpfulVotesReceived = trustByReviewId.values.fold<int>(
      0,
      (total, summary) => total + summary.helpfulCount,
    );
    final oldestReviewDate = reviews
        .map((review) => review.createdAt)
        .whereType<DateTime>()
        .fold<DateTime?>(identity.createdAt, (oldest, createdAt) {
          if (oldest == null || createdAt.isBefore(oldest)) {
            return createdAt;
          }
          return oldest;
        });
    final accountAgeDays = oldestReviewDate == null
        ? 0
        : max(0, DateTime.now().difference(oldestReviewDate.toLocal()).inDays);
    const moderationFlagCount = 0;
    final badgeLabel = _profileBadgeLabelFor(
      reviewCount: reviews.length,
      helpfulVotesReceived: helpfulVotesReceived,
      accountAgeDays: accountAgeDays,
      moderationFlagCount: moderationFlagCount,
    );

    return BiteScorePublicReviewerProfileData(
      userId: trimmedUserId,
      publicDisplayName: identity.publicDisplayName,
      chosenUsername: identity.chosenUsername,
      fallbackUsername: identity.fallbackUsername,
      reviews: reviewEntries,
      badgeLabel: badgeLabel,
      reviewCount: reviews.length,
      helpfulVotesReceived: helpfulVotesReceived,
      accountAgeDays: accountAgeDays,
      moderationFlagCount: moderationFlagCount,
    );
  }

  static Future<bool> isPublicUsernameAvailable(String username) async {
    final normalizedUsername = _normalizePublicUsername(username);
    final validationError = _validatePublicUsername(normalizedUsername);
    if (validationError != null) {
      throw ArgumentError(validationError);
    }

    final snapshot = await publicUsernamesCollection()
        .doc(normalizedUsername)
        .get();
    if (!snapshot.exists) {
      return true;
    }

    final currentUser = FirebaseAuth.instance.currentUser;
    if (currentUser == null || currentUser.isAnonymous) {
      return false;
    }

    return _readString(snapshot.data()?['userId']) == currentUser.uid;
  }

  static Future<void> saveCurrentUserPublicUsername(String username) async {
    final user = _requireSignedInAppUser();
    final normalizedUsername = _normalizePublicUsername(username);
    final validationError = _validatePublicUsername(normalizedUsername);
    if (validationError != null) {
      throw ArgumentError(validationError);
    }

    await _ensureCurrentUserPublicReviewerIdentity(user);

    await _firestore.runTransaction((transaction) async {
      final profileRef = publicReviewerProfileDocument(user.uid);
      final profileSnapshot = await transaction.get(profileRef);
      final currentIdentity =
          _parsePublicReviewerIdentity(
            profileSnapshot.data(),
            fallbackUserId: profileSnapshot.id,
          ) ??
          _generatedPublicReviewerIdentity(user.uid);

      final currentChosenUsername = _normalizePublicUsername(
        currentIdentity.chosenUsername ?? '',
      );
      if (currentChosenUsername == normalizedUsername) {
        transaction.set(profileRef, {
          'publicDisplayName': username.trim(),
          'chosenUsername': username.trim(),
          'chosenUsernameNormalized': normalizedUsername,
          'fallbackUsername': currentIdentity.fallbackUsername,
          'userId': user.uid,
          'createdAt':
              profileSnapshot.exists && currentIdentity.createdAt != null
              ? Timestamp.fromDate(currentIdentity.createdAt!)
              : FieldValue.serverTimestamp(),
          'updatedAt': FieldValue.serverTimestamp(),
        }, SetOptions(merge: true));
        return;
      }

      final usernameRef = publicUsernamesCollection().doc(normalizedUsername);
      final usernameSnapshot = await transaction.get(usernameRef);
      final reservedByUserId = _readString(usernameSnapshot.data()?['userId']);
      if (usernameSnapshot.exists && reservedByUserId != user.uid) {
        throw ArgumentError(
          'That username is already taken. Please try another one.',
        );
      }

      transaction.set(usernameRef, {
        'username': normalizedUsername,
        'userId': user.uid,
        'reservationType': 'custom',
        'createdAt': FieldValue.serverTimestamp(),
        'updatedAt': FieldValue.serverTimestamp(),
      });

      if (currentChosenUsername.isNotEmpty &&
          currentChosenUsername != currentIdentity.fallbackUsername) {
        transaction.delete(
          publicUsernamesCollection().doc(currentChosenUsername),
        );
      }

      transaction.set(profileRef, {
        'publicDisplayName': username.trim(),
        'chosenUsername': username.trim(),
        'chosenUsernameNormalized': normalizedUsername,
        'fallbackUsername': currentIdentity.fallbackUsername,
        'userId': user.uid,
        'createdAt': profileSnapshot.exists && currentIdentity.createdAt != null
            ? Timestamp.fromDate(currentIdentity.createdAt!)
            : FieldValue.serverTimestamp(),
        'updatedAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
    });
  }

  static Future<BiteScoreHomeEntry?> _loadDishHomeEntryById(
    String dishId,
  ) async {
    final dish = await loadDishById(dishId);
    if (dish == null || dish.isMerged || !dish.isActive) {
      return null;
    }

    final restaurant = await loadRestaurantById(dish.restaurantId);
    if (restaurant == null || !restaurant.isActive) {
      return null;
    }

    final aggregate =
        await loadDishRatingAggregate(dish.id) ??
        DishRatingAggregate(dishId: dish.id, restaurantId: dish.restaurantId);

    return BiteScoreHomeEntry(
      dish: dish,
      restaurant: restaurant,
      aggregate: aggregate,
    );
  }

  static Future<List<DishReview>> _loadAllDishReviewsForDish(
    String dishId,
  ) async {
    final snapshot = await reviewsCollection()
        .where('dishId', isEqualTo: dishId)
        .get();

    return snapshot.docs
        .map(
          (doc) => DishReview.tryFromFirestore(doc.data(), fallbackId: doc.id),
        )
        .whereType<DishReview>()
        .toList();
  }

  static Future<Map<String, ReviewTrustSummary>> loadReviewTrustSummaries(
    List<DishReview> reviews, {
    String? currentUserId,
  }) async {
    if (reviews.isEmpty) {
      return const <String, ReviewTrustSummary>{};
    }

    final summaries = <String, ReviewTrustSummary>{
      for (final review in reviews) review.id: const ReviewTrustSummary(),
    };

    final reviewIds = reviews
        .map((review) => review.id)
        .toList(growable: false);

    for (final chunk in _chunkStrings(reviewIds, size: 10)) {
      final snapshot = await reviewFeedbackVotesCollection()
          .where('reviewId', whereIn: chunk)
          .get();

      for (final doc in snapshot.docs) {
        final vote = ReviewFeedbackVote.tryFromFirestore(
          doc.data(),
          fallbackId: doc.id,
        );
        if (vote == null) {
          continue;
        }

        final existing = summaries[vote.reviewId] ?? const ReviewTrustSummary();
        summaries[vote.reviewId] = ReviewTrustSummary(
          helpfulCount: existing.helpfulCount + (vote.isHelpful ? 1 : 0),
          notHelpfulCount:
              existing.notHelpfulCount + (vote.isNotHelpful ? 1 : 0),
          currentUserVoteType: currentUserId == vote.userId
              ? vote.voteType
              : existing.currentUserVoteType,
          hasPendingUserReport: existing.hasPendingUserReport,
        );
      }
    }

    final trimmedCurrentUserId = currentUserId?.trim();
    if (trimmedCurrentUserId != null && trimmedCurrentUserId.isNotEmpty) {
      final userReportSnapshot = await reviewReportsCollection()
          .where('reportingUserId', isEqualTo: trimmedCurrentUserId)
          .get();

      for (final doc in userReportSnapshot.docs) {
        final report = ReviewReport.tryFromFirestore(
          doc.data(),
          fallbackId: doc.id,
        );
        if (report == null ||
            report.status != ReviewReport.statusPending ||
            !summaries.containsKey(report.reviewId)) {
          continue;
        }

        final existing =
            summaries[report.reviewId] ?? const ReviewTrustSummary();
        summaries[report.reviewId] = ReviewTrustSummary(
          helpfulCount: existing.helpfulCount,
          notHelpfulCount: existing.notHelpfulCount,
          currentUserVoteType: existing.currentUserVoteType,
          hasPendingUserReport: true,
        );
      }
    }

    return summaries;
  }

  static Future<Map<String, String>> loadReviewerBadgeLabels(
    List<DishReview> reviews,
  ) async {
    final reviewerIds = reviews
        .map((review) => review.userId.trim())
        .where((userId) => userId.isNotEmpty)
        .toSet();
    if (reviewerIds.isEmpty) {
      return const <String, String>{};
    }

    final badgeLabelsByUserId = <String, String>{};
    for (final userId in reviewerIds) {
      try {
        badgeLabelsByUserId[userId] = await _loadReviewerBadgeLabel(userId);
      } catch (_) {
        badgeLabelsByUserId[userId] = 'New Reviewer';
      }
    }

    return badgeLabelsByUserId;
  }

  static Future<Map<String, String>> loadReviewerDisplayNames(
    List<DishReview> reviews,
  ) async {
    final reviewerIds = reviews
        .map((review) => review.userId.trim())
        .where((userId) => userId.isNotEmpty)
        .toSet();
    if (reviewerIds.isEmpty) {
      return const <String, String>{};
    }

    final namesByUserId = <String, String>{};
    for (final userId in reviewerIds) {
      try {
        final identity = await _loadPublicReviewerIdentity(userId);
        namesByUserId[userId] = identity.publicDisplayName;
      } catch (_) {
        namesByUserId[userId] = _generatedPublicReviewerIdentity(
          userId,
        ).publicDisplayName;
      }
    }

    return namesByUserId;
  }

  static Future<void> submitRestaurantClaim({
    required String restaurantId,
    required String restaurantName,
    required String claimantName,
    required String email,
    required String phone,
    required String message,
  }) async {
    final user = await _requireFreshSignedInBiteScoreUser();
    if (claimantName.trim().isEmpty) {
      throw ArgumentError('Claimant name is required.');
    }
    if (email.trim().isEmpty) {
      throw ArgumentError('Email is required.');
    }
    if (phone.trim().isEmpty) {
      throw ArgumentError('Phone is required.');
    }

    final duplicateSnapshot = await claimRequestsCollection()
        .where('restaurantId', isEqualTo: restaurantId)
        .where('requesterUserId', isEqualTo: user.uid)
        .where('status', isEqualTo: 'pending')
        .limit(1)
        .get();
    if (duplicateSnapshot.docs.isNotEmpty) {
      throw ArgumentError(
        'You already have a pending claim for this restaurant.',
      );
    }

    await _createPendingRestaurantClaimRequestOnly(
      restaurantId: restaurantId,
      restaurantName: restaurantName,
      requesterUserId: user.uid,
      claimantName: claimantName,
      email: email,
      phone: phone,
      message: message,
    );
  }

  static Future<void> _createPendingRestaurantClaimRequestOnly({
    required String restaurantId,
    required String restaurantName,
    required String requesterUserId,
    required String claimantName,
    required String email,
    required String phone,
    required String message,
  }) async {
    final claimRef = claimRequestsCollection().doc();
    await claimRef.set({
      'id': claimRef.id,
      'restaurantId': restaurantId.trim(),
      'restaurantName': restaurantName.trim(),
      'requesterUserId': requesterUserId.trim(),
      'claimantName': claimantName.trim(),
      'email': email.trim(),
      'phone': phone.trim(),
      'message': message.trim().isEmpty ? null : message.trim(),
      'status': 'pending',
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  static Future<void> approveClaimAsAdmin(
    RestaurantClaimRequest request,
  ) async {
    final requesterUserId = request.requesterUserId?.trim();
    if (requesterUserId == null || requesterUserId.isEmpty) {
      throw ArgumentError('This claim request is missing a requester user ID.');
    }

    final batch = _firestore.batch();
    batch.set(claimRequestsCollection().doc(request.id), {
      'status': 'approved',
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
    batch.set(restaurantsCollection().doc(request.restaurantId), {
      'ownerUserId': requesterUserId,
      'isClaimed': true,
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
    await batch.commit();
  }

  static Future<void> rejectClaimAsAdmin(RestaurantClaimRequest request) async {
    await claimRequestsCollection().doc(request.id).set({
      'status': 'rejected',
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }

  static Future<void> unclaimRestaurantAsAdmin(
    BitescoreRestaurant restaurant,
  ) async {
    await restaurantsCollection().doc(restaurant.id).set({
      'ownerUserId': null,
      'isClaimed': false,
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }

  static Future<void> createAndRate(BiteScoreCreateRequest request) async {
    final validationError = request.validate();
    if (validationError != null) {
      throw ArgumentError(validationError);
    }

    final user = await _requireFreshSignedInBiteScoreUser();

    final restaurant = await _findOrCreateRestaurant(request);
    final dish = await _findOrCreateDish(request, restaurant);
    await _createReviewAndRebuildAggregate(
      userId: user.uid,
      dish: dish,
      restaurant: restaurant,
      overallImpression: request.overallImpression,
      tastinessScore: request.tastinessScore,
      qualityScore: request.qualityScore,
      valueScore: request.valueScore,
      headline: request.headline,
      notes: request.notes,
    );
  }

  static Future<void> addReviewForDish({
    required BitescoreDish dish,
    required BitescoreRestaurant restaurant,
    required double overallImpression,
    required String headline,
    required String notes,
    double? tastinessScore,
    double? qualityScore,
    double? valueScore,
  }) async {
    final validationError = _validateRequiredReviewScores(
      overallImpression: overallImpression,
      tastinessScore: tastinessScore,
      qualityScore: qualityScore,
      valueScore: valueScore,
    );
    if (validationError != null) {
      throw ArgumentError(validationError);
    }

    final user = await _requireFreshSignedInBiteScoreUser();

    await _createReviewAndRebuildAggregate(
      userId: user.uid,
      dish: dish,
      restaurant: restaurant,
      overallImpression: overallImpression,
      tastinessScore: tastinessScore,
      qualityScore: qualityScore,
      valueScore: valueScore,
      headline: headline,
      notes: notes,
    );
  }

  static Future<bool> submitReviewReport({
    required DishReview review,
    String? reason,
  }) async {
    final user = await _requireFreshSignedInBiteScoreUser();
    final pendingSnapshot = await reviewReportsCollection()
        .where('reportingUserId', isEqualTo: user.uid)
        .get();

    final alreadyPending = pendingSnapshot.docs.any((doc) {
      final report = ReviewReport.tryFromFirestore(
        doc.data(),
        fallbackId: doc.id,
      );
      return report != null &&
          report.reviewId == review.id &&
          report.status == ReviewReport.statusPending;
    });

    if (alreadyPending) {
      return false;
    }

    final reportRef = reviewReportsCollection().doc();
    final report = ReviewReport(
      id: reportRef.id,
      reviewId: review.id,
      dishId: review.dishId,
      restaurantId: review.restaurantId,
      reportingUserId: user.uid,
      reason: reason?.trim().isEmpty ?? true ? null : reason!.trim(),
      status: ReviewReport.statusPending,
    );

    await reportRef.set({
      ...report.toFirestoreMap(),
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });

    return true;
  }

  static Future<bool> submitRestaurantReport({
    required BitescoreRestaurant restaurant,
    String? reason,
  }) async {
    final user = await _requireFreshSignedInBiteScoreUser();
    final pendingSnapshot = await restaurantReportsCollection()
        .where('reportingUserId', isEqualTo: user.uid)
        .get();

    final alreadyPending = pendingSnapshot.docs.any((doc) {
      final report = RestaurantReport.tryFromFirestore(
        doc.data(),
        fallbackId: doc.id,
      );
      return report != null &&
          report.restaurantId == restaurant.id &&
          report.status == RestaurantReport.statusPending;
    });

    if (alreadyPending) {
      return false;
    }

    final reportRef = restaurantReportsCollection().doc();
    final report = RestaurantReport(
      id: reportRef.id,
      restaurantId: restaurant.id,
      restaurantName: restaurant.name,
      reportingUserId: user.uid,
      reason: reason?.trim().isEmpty ?? true ? null : reason!.trim(),
      status: RestaurantReport.statusPending,
    );

    await reportRef.set({
      ...report.toFirestoreMap(),
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });

    return true;
  }

  static Future<bool> submitDishReport({
    required BitescoreDish dish,
    String? reason,
  }) async {
    final user = await _requireFreshSignedInBiteScoreUser();
    final pendingSnapshot = await dishReportsCollection()
        .where('reportingUserId', isEqualTo: user.uid)
        .get();

    final alreadyPending = pendingSnapshot.docs.any((doc) {
      final report = DishReport.tryFromFirestore(
        doc.data(),
        fallbackId: doc.id,
      );
      return report != null &&
          report.dishId == dish.id &&
          report.status == DishReport.statusPending;
    });

    if (alreadyPending) {
      return false;
    }

    final reportRef = dishReportsCollection().doc();
    final report = DishReport(
      id: reportRef.id,
      dishId: dish.id,
      dishName: dish.name,
      restaurantId: dish.restaurantId,
      reportingUserId: user.uid,
      reason: reason?.trim().isEmpty ?? true ? null : reason!.trim(),
      status: DishReport.statusPending,
    );

    await reportRef.set({
      ...report.toFirestoreMap(),
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });

    return true;
  }

  static Future<bool> submitDuplicateRestaurantReport({
    required BitescoreRestaurant restaurant,
    String? reason,
  }) async {
    final user = await _requireFreshSignedInBiteScoreUser();
    final pendingSnapshot = await duplicateRestaurantReportsCollection()
        .where('reportingUserId', isEqualTo: user.uid)
        .get();

    final alreadyPending = pendingSnapshot.docs.any((doc) {
      final report = DuplicateRestaurantReport.tryFromFirestore(
        doc.data(),
        fallbackId: doc.id,
      );
      return report != null &&
          report.restaurantId == restaurant.id &&
          report.status == DuplicateRestaurantReport.statusPending;
    });

    if (alreadyPending) {
      return false;
    }

    final reportRef = duplicateRestaurantReportsCollection().doc();
    final report = DuplicateRestaurantReport(
      id: reportRef.id,
      restaurantId: restaurant.id,
      restaurantName: restaurant.name,
      reportingUserId: user.uid,
      reason: reason?.trim().isEmpty ?? true ? null : reason!.trim(),
      status: DuplicateRestaurantReport.statusPending,
    );

    await reportRef.set({
      ...report.toFirestoreMap(),
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });

    return true;
  }

  static Future<void> toggleReviewFeedbackVote({
    required DishReview review,
    required String voteType,
  }) async {
    final user = await _requireFreshSignedInBiteScoreUser();
    if (voteType != ReviewFeedbackVote.voteHelpful &&
        voteType != ReviewFeedbackVote.voteNotHelpful) {
      throw ArgumentError('Unknown review vote type.');
    }

    final voteRef = reviewFeedbackVotesCollection().doc(
      _reviewVoteDocumentId(review.id, user.uid),
    );

    await _firestore.runTransaction((transaction) async {
      final snapshot = await transaction.get(voteRef);
      final existing = ReviewFeedbackVote.tryFromFirestore(
        snapshot.data(),
        fallbackId: voteRef.id,
      );

      if (existing != null && existing.voteType == voteType) {
        transaction.delete(voteRef);
        return;
      }

      final payload = {
        'id': voteRef.id,
        'reviewId': review.id,
        'dishId': review.dishId,
        'restaurantId': review.restaurantId,
        'userId': user.uid,
        'voteType': voteType,
        'updatedAt': FieldValue.serverTimestamp(),
      };

      if (existing == null) {
        transaction.set(voteRef, {
          ...payload,
          'createdAt': FieldValue.serverTimestamp(),
        });
      } else {
        transaction.set(voteRef, payload, SetOptions(merge: true));
      }
    });
  }

  static Future<void> createDishAndRateForRestaurant({
    required BitescoreRestaurant restaurant,
    required String dishName,
    required String category,
    required String priceLabel,
    required String headline,
    required String notes,
    required double overallImpression,
    double? tastinessScore,
    double? qualityScore,
    double? valueScore,
    bool forceCreateNewDish = false,
  }) async {
    if (dishName.trim().isEmpty) {
      throw ArgumentError('Dish name is required.');
    }
    final validationError = _validateRequiredReviewScores(
      overallImpression: overallImpression,
      tastinessScore: tastinessScore,
      qualityScore: qualityScore,
      valueScore: valueScore,
    );
    if (validationError != null) {
      throw ArgumentError(validationError);
    }

    final user = await _requireFreshSignedInBiteScoreUser();

    final request = BiteScoreCreateRequest(
      restaurantName: restaurant.name,
      streetAddress: restaurant.address,
      city: restaurant.city,
      state: restaurant.state,
      zipCode: restaurant.zipCode,
      dishName: dishName,
      category: category,
      priceLabel: priceLabel,
      headline: headline,
      notes: notes,
      overallImpression: overallImpression,
      tastinessScore: tastinessScore,
      qualityScore: qualityScore,
      valueScore: valueScore,
    );

    final dish = await _findOrCreateDish(
      request,
      restaurant,
      allowExistingMatch: !forceCreateNewDish,
    );
    await _createReviewAndRebuildAggregate(
      userId: user.uid,
      dish: dish,
      restaurant: restaurant,
      overallImpression: overallImpression,
      tastinessScore: tastinessScore,
      qualityScore: qualityScore,
      valueScore: valueScore,
      headline: headline,
      notes: notes,
    );
  }

  static Future<List<BitescoreDish>> findSimilarDishesForRestaurant({
    required String restaurantId,
    required String dishName,
    int limit = 8,
  }) async {
    final normalizedQuery = _normalizeDishMatchText(dishName);
    if (restaurantId.trim().isEmpty || normalizedQuery.isEmpty) {
      return const <BitescoreDish>[];
    }

    final queryTokens = _tokenizeDishMatchText(normalizedQuery);
    final dishes = await loadDishesForRestaurant(restaurantId.trim());
    final suggestions = <ExistingDishMatchSuggestion>[];

    for (final dish in dishes) {
      final normalizedDishName = _normalizeDishMatchText(dish.name);
      if (normalizedDishName.isEmpty) {
        continue;
      }

      double score = 0;
      if (normalizedDishName == normalizedQuery) {
        score = 1;
      } else if (normalizedDishName.contains(normalizedQuery) ||
          normalizedQuery.contains(normalizedDishName)) {
        final shorter = normalizedDishName.length < normalizedQuery.length
            ? normalizedDishName.length
            : normalizedQuery.length;
        final longer = normalizedDishName.length > normalizedQuery.length
            ? normalizedDishName.length
            : normalizedQuery.length;
        score = 0.88 + (0.1 * (shorter / longer));
      } else {
        final dishTokens = _tokenizeDishMatchText(normalizedDishName);
        final sharedTokens = queryTokens.intersection(dishTokens).length;
        if (sharedTokens > 0) {
          score = 0.62 + (0.12 * (sharedTokens / queryTokens.length));
        }

        final maxLength = normalizedDishName.length > normalizedQuery.length
            ? normalizedDishName.length
            : normalizedQuery.length;
        if (maxLength > 0) {
          final distance = _levenshteinDistance(
            normalizedDishName,
            normalizedQuery,
          );
          final similarity = 1 - (distance / maxLength);
          if (similarity > score) {
            score = similarity;
          }
        }
      }

      if (score >= 0.60) {
        suggestions.add(ExistingDishMatchSuggestion(dish: dish, score: score));
      }
    }

    suggestions.sort((a, b) {
      final byScore = b.score.compareTo(a.score);
      if (byScore != 0) {
        return byScore;
      }
      return a.dish.name.toLowerCase().compareTo(b.dish.name.toLowerCase());
    });

    return suggestions
        .take(limit)
        .map((suggestion) => suggestion.dish)
        .toList();
  }

  static Future<void> submitEditProposal(DishEditProposal proposal) async {
    await editProposalsCollection().doc(proposal.id).set({
      ...proposal.toFirestoreMap(),
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  static Future<void> submitDishRenameSuggestion({
    required BitescoreDish dish,
    required String proposedName,
  }) async {
    final user = await _requireFreshSignedInSuggestionUser();
    final normalizedName = _normalize(proposedName);
    if (normalizedName.isEmpty) {
      throw ArgumentError('Proposed dish name is required.');
    }
    if (normalizedName == dish.normalizedName) {
      throw ArgumentError('That dish already uses this name.');
    }

    final existing = await editProposalsCollection()
        .where('userId', isEqualTo: user.uid)
        .limit(100)
        .get();

    for (final doc in existing.docs) {
      final proposal = DishEditProposal.tryFromFirestore(
        doc.data(),
        fallbackId: doc.id,
      );
      if (proposal != null &&
          proposal.status == 'pending' &&
          proposal.isRename &&
          proposal.restaurantId == dish.restaurantId &&
          proposal.targetDishId == dish.id &&
          _normalize(proposal.proposedName ?? '') == normalizedName) {
        throw ArgumentError('You already suggested this rename for the dish.');
      }
    }

    final proposalRef = editProposalsCollection().doc();
    await submitEditProposal(
      DishEditProposal(
        id: proposalRef.id,
        type: DishEditProposal.typeRename,
        restaurantId: dish.restaurantId,
        targetDishId: dish.id,
        proposedName: proposedName.trim(),
        userId: user.uid,
      ),
    );
  }

  static Future<void> submitDishMergeSuggestion({
    required BitescoreDish sourceDish,
    required BitescoreDish mergeTargetDish,
  }) async {
    final user = await _requireFreshSignedInSuggestionUser();
    if (!sourceDish.isActive) {
      throw ArgumentError('This source dish is already inactive.');
    }
    if (!mergeTargetDish.isActive) {
      throw ArgumentError('Choose an active dish to merge into.');
    }
    if (sourceDish.restaurantId != mergeTargetDish.restaurantId) {
      throw ArgumentError('Merge suggestions must stay within one restaurant.');
    }
    if (sourceDish.id == mergeTargetDish.id) {
      throw ArgumentError('Choose a different dish to merge into.');
    }

    final existing = await editProposalsCollection()
        .where('userId', isEqualTo: user.uid)
        .limit(100)
        .get();
    for (final doc in existing.docs) {
      final proposal = DishEditProposal.tryFromFirestore(
        doc.data(),
        fallbackId: doc.id,
      );
      if (proposal != null &&
          proposal.status == 'pending' &&
          proposal.isMerge &&
          proposal.restaurantId == sourceDish.restaurantId &&
          proposal.targetDishId == sourceDish.id &&
          proposal.mergeTargetDishId == mergeTargetDish.id) {
        throw ArgumentError('You already suggested this merge.');
      }
    }

    final proposalRef = editProposalsCollection().doc();
    await submitEditProposal(
      DishEditProposal(
        id: proposalRef.id,
        type: DishEditProposal.typeMerge,
        restaurantId: sourceDish.restaurantId,
        targetDishId: sourceDish.id,
        mergeTargetDishId: mergeTargetDish.id,
        userId: user.uid,
      ),
    );
  }

  static Future<void> submitDuplicateDishMergeSuggestion({
    required BitescoreDish sourceDish,
    required BitescoreDish mergeTargetDish,
  }) async {
    final user = await _requireFreshSignedInSuggestionUser();
    if (!sourceDish.isActive) {
      throw ArgumentError('This source dish is already inactive.');
    }
    if (!mergeTargetDish.isActive) {
      throw ArgumentError('Choose an active dish to merge into.');
    }
    if (sourceDish.restaurantId != mergeTargetDish.restaurantId) {
      throw ArgumentError('Merge suggestions must stay within one restaurant.');
    }
    if (sourceDish.id == mergeTargetDish.id) {
      throw ArgumentError('Choose a different dish to merge into.');
    }

    final existing = await editProposalsCollection()
        .where('userId', isEqualTo: user.uid)
        .limit(100)
        .get();
    for (final doc in existing.docs) {
      final proposal = DishEditProposal.tryFromFirestore(
        doc.data(),
        fallbackId: doc.id,
      );
      if (proposal != null &&
          proposal.status == 'pending' &&
          proposal.isMerge &&
          proposal.restaurantId == sourceDish.restaurantId &&
          proposal.targetDishId == sourceDish.id &&
          proposal.mergeTargetDishId == mergeTargetDish.id) {
        throw ArgumentError('You already suggested this merge.');
      }
    }

    final proposalRef = editProposalsCollection().doc();
    await proposalRef.set({
      'id': proposalRef.id,
      'type': DishEditProposal.typeMerge,
      'restaurantId': sourceDish.restaurantId,
      'sourceDishId': sourceDish.id,
      'targetDishId': mergeTargetDish.id,
      'mergeTargetDishId': mergeTargetDish.id,
      'reason': 'duplicate',
      'userId': user.uid,
      'status': 'pending',
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  static Future<void> maybeAutoApplyDueDishEditSuggestions({
    String? dishId,
  }) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null ||
        user.isAnonymous ||
        !AdminAccessService.isAdminEmail(user.email)) {
      return;
    }

    try {
      final snapshot = await editProposalsCollection()
          .where('status', isEqualTo: 'pending')
          .get();
      if (snapshot.docs.isEmpty) {
        return;
      }

      final proposals = snapshot.docs
          .map(
            (doc) => DishEditProposal.tryFromFirestore(
              doc.data(),
              fallbackId: doc.id,
            ),
          )
          .whereType<DishEditProposal>()
          .where(
            (proposal) =>
                dishId == null ||
                proposal.targetDishId == dishId ||
                proposal.mergeTargetDishId == dishId,
          )
          .toList();
      if (proposals.isEmpty) {
        return;
      }

      final dishIds = <String>{
        for (final proposal in proposals) proposal.targetDishId,
        for (final proposal in proposals)
          if ((proposal.mergeTargetDishId ?? '').trim().isNotEmpty)
            proposal.mergeTargetDishId!.trim(),
      };
      final dishes = await Future.wait(dishIds.map(loadDishById));
      final dishesById = <String, BitescoreDish>{
        for (final dish in dishes.whereType<BitescoreDish>()) dish.id: dish,
      };

      final entries = _buildDishEditSuggestionAdminEntries(
        proposals: proposals,
        dishesById: dishesById,
      );
      final now = DateTime.now();
      for (final entry in entries) {
        final oldestCreatedAt = entry.oldestCreatedAt;
        if (oldestCreatedAt == null) {
          continue;
        }
        if (now.difference(oldestCreatedAt) < const Duration(days: 3)) {
          continue;
        }
        if (entry.isMerge && entry.supporterCount < 2) {
          continue;
        }
        try {
          await _applyDishEditSuggestionEntry(
            entry,
            approvedStatus: 'approved',
          );
        } catch (_) {}
      }
    } catch (_) {}
  }

  static Future<void> approveDishEditSuggestionAsAdmin(
    DishEditSuggestionAdminEntry entry,
  ) async {
    await _applyDishEditSuggestionEntry(entry, approvedStatus: 'approved');
  }

  static Future<void> rejectDishEditSuggestionAsAdmin(
    DishEditSuggestionAdminEntry entry,
  ) async {
    await _markDishEditSuggestionEntryStatus(entry, 'rejected');
  }

  static Future<void> deleteDishAsAdmin(String dishId) async {
    final reviewsSnapshot = await reviewsCollection()
        .where('dishId', isEqualTo: dishId)
        .get();

    for (final doc in reviewsSnapshot.docs) {
      await _deleteReviewTrustData(doc.id);
      await doc.reference.delete();
    }

    await _deleteDishReportData(dishId);
    await ratingAggregatesCollection().doc(dishId).delete();
    await dishesCollection().doc(dishId).delete();
  }

  static Future<void> updateRestaurantAsAdmin({
    required BitescoreRestaurant restaurant,
    required String name,
    required String address,
    required String city,
    required String state,
    required String zipCode,
    required String phone,
    required String bio,
    required String cuisineTags,
    List<RestaurantBusinessHours>? businessHours,
    bool? isActive,
  }) async {
    final normalizedName = _normalize(name);
    if (normalizedName.isEmpty) {
      throw ArgumentError('Restaurant name is required.');
    }
    if (address.trim().isEmpty) {
      throw ArgumentError('Street address is required.');
    }
    if (city.trim().isEmpty) {
      throw ArgumentError('City is required.');
    }
    if (state.trim().isEmpty) {
      throw ArgumentError('State is required.');
    }
    if (zipCode.trim().isEmpty) {
      throw ArgumentError('ZIP code is required.');
    }

    final updatedRequest = BiteScoreCreateRequest(
      restaurantName: name,
      streetAddress: address,
      city: city,
      state: state,
      zipCode: zipCode,
      dishName: 'admin-placeholder',
      category: '',
      priceLabel: '',
      headline: '',
      notes: '',
      overallImpression: 8,
    );
    final verifiedLocation = await _verifyRestaurantAddress(updatedRequest);
    final tagList =
        cuisineTags
            .split(',')
            .map((tag) => tag.trim())
            .where((tag) => tag.isNotEmpty)
            .toSet()
            .toList()
          ..sort();

    final updatedRestaurant = restaurant.copyWith(
      name: name.trim(),
      normalizedName: normalizedName,
      address: address.trim(),
      city: city.trim(),
      state: state.trim().toUpperCase(),
      zipCode: zipCode.trim(),
      location: GeoPoint(verifiedLocation.latitude, verifiedLocation.longitude),
      phone: phone.trim().isEmpty ? null : phone.trim(),
      bio: bio.trim().isEmpty ? null : bio.trim(),
      businessHours: businessHours ?? restaurant.businessHours,
      cuisineTags: tagList,
      isActive: isActive ?? restaurant.isActive,
    );

    await restaurantsCollection().doc(restaurant.id).set({
      ...updatedRestaurant.toFirestoreMap(),
      'createdAt': restaurant.createdAt == null
          ? FieldValue.serverTimestamp()
          : Timestamp.fromDate(restaurant.createdAt!),
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));

    if (restaurant.name.trim() == updatedRestaurant.name.trim()) {
      return;
    }

    final dishesSnapshot = await dishesCollection()
        .where('restaurantId', isEqualTo: restaurant.id)
        .get();
    if (dishesSnapshot.docs.isEmpty) {
      return;
    }

    final batch = _firestore.batch();
    for (final dishDoc in dishesSnapshot.docs) {
      batch.set(dishDoc.reference, {
        'restaurantName': updatedRestaurant.name,
        'updatedAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
    }
    await batch.commit();
  }

  static Future<void> updateRestaurantAsOwner({
    required BitescoreRestaurant restaurant,
    required String name,
    required String address,
    required String city,
    required String state,
    required String zipCode,
    required String phone,
    required String bio,
    List<RestaurantBusinessHours>? businessHours,
  }) async {
    await updateRestaurantAsAdmin(
      restaurant: restaurant,
      name: name,
      address: address,
      city: city,
      state: state,
      zipCode: zipCode,
      phone: phone,
      bio: bio,
      cuisineTags: restaurant.cuisineTags.join(', '),
      businessHours: businessHours,
      isActive: restaurant.isActive,
    );
  }

  static Future<void> updateDishAsAdmin({
    required BitescoreDish dish,
    required String name,
    required String category,
    required String priceLabel,
    required bool isActive,
  }) async {
    final normalizedName = _normalize(name);
    if (normalizedName.isEmpty) {
      throw ArgumentError('Dish name is required.');
    }

    final updatedDish = BitescoreDish(
      id: dish.id,
      restaurantId: dish.restaurantId,
      restaurantName: dish.restaurantName,
      name: name.trim(),
      normalizedName: normalizedName,
      category: category.trim().isEmpty ? null : category.trim(),
      priceLabel: priceLabel.trim().isEmpty ? null : priceLabel.trim(),
      isActive: isActive,
      mergedIntoDishId: dish.mergedIntoDishId,
      createdAt: dish.createdAt,
      updatedAt: DateTime.now(),
    );

    await dishesCollection().doc(dish.id).set({
      ...updatedDish.toFirestoreMap(),
      'createdAt': dish.createdAt == null
          ? FieldValue.serverTimestamp()
          : Timestamp.fromDate(dish.createdAt!),
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }

  static Future<void> setDishAvailabilityAsAdmin({
    required BitescoreDish dish,
    required bool isActive,
  }) async {
    await dishesCollection().doc(dish.id).set({
      'isActive': isActive,
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }

  static Future<void> updateDishAsOwner({
    required BitescoreDish dish,
    required String name,
    required String category,
    required String priceLabel,
    required bool isActive,
  }) async {
    await updateDishAsAdmin(
      dish: dish,
      name: name,
      category: category,
      priceLabel: priceLabel,
      isActive: isActive,
    );
  }

  static Future<void> setDishAvailabilityAsOwner({
    required BitescoreDish dish,
    required bool isActive,
  }) async {
    await setDishAvailabilityAsAdmin(dish: dish, isActive: isActive);
  }

  static Future<void> mergeDishesAsOwner({
    required BitescoreDish sourceDish,
    required BitescoreDish mergeTargetDish,
  }) async {
    await _mergeDishIntoTarget(
      sourceDish: sourceDish,
      mergeTargetDish: mergeTargetDish,
    );
  }

  static Future<void> _mergeDishIntoTarget({
    required BitescoreDish sourceDish,
    required BitescoreDish mergeTargetDish,
  }) async {
    final invalidReason = _mergeSuggestionInvalidReason(
      targetDish: sourceDish,
      mergeTargetDish: mergeTargetDish,
    );
    if (invalidReason != null) {
      throw ArgumentError(invalidReason);
    }

    final sourceReviews = await _loadAllDishReviewsForDish(sourceDish.id);

    var batch = _firestore.batch();
    var pendingWrites = 0;

    Future<void> queueMergeWrite(
      DocumentReference<Map<String, dynamic>> reference,
      Map<String, dynamic> data,
    ) async {
      batch.set(reference, data, SetOptions(merge: true));
      pendingWrites += 1;
      if (pendingWrites >= 450) {
        await batch.commit();
        batch = _firestore.batch();
        pendingWrites = 0;
      }
    }

    for (final review in sourceReviews) {
      await queueMergeWrite(reviewsCollection().doc(review.id), {
        'dishId': mergeTargetDish.id,
        'restaurantId': mergeTargetDish.restaurantId,
        'updatedAt': FieldValue.serverTimestamp(),
      });
    }

    await queueMergeWrite(dishesCollection().doc(sourceDish.id), {
      'isActive': false,
      'mergedIntoDishId': mergeTargetDish.id,
      'updatedAt': FieldValue.serverTimestamp(),
    });

    if (pendingWrites > 0) {
      await batch.commit();
    }

    await _rebuildDishAggregate(
      dishId: mergeTargetDish.id,
      restaurantId: mergeTargetDish.restaurantId,
    );
    await _rebuildDishAggregate(
      dishId: sourceDish.id,
      restaurantId: sourceDish.restaurantId,
    );
  }

  static Future<void> dismissReportedReviewAsAdmin(
    BiteScoreReportedReviewAdminEntry entry,
  ) async {
    final batch = _firestore.batch();
    for (final report in entry.reports) {
      batch.set(reviewReportsCollection().doc(report.id), {
        'status': ReviewReport.statusDismissed,
        'updatedAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
    }
    await batch.commit();
  }

  static Future<void> dismissReportedRestaurantAsAdmin(
    BiteScoreReportedRestaurantAdminEntry entry,
  ) async {
    final batch = _firestore.batch();
    for (final report in entry.reports) {
      batch.set(restaurantReportsCollection().doc(report.id), {
        'status': RestaurantReport.statusDismissed,
        'updatedAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
    }
    await batch.commit();
  }

  static Future<void> dismissReportedDishAsAdmin(
    BiteScoreReportedDishAdminEntry entry,
  ) async {
    final batch = _firestore.batch();
    for (final report in entry.reports) {
      batch.set(dishReportsCollection().doc(report.id), {
        'status': DishReport.statusDismissed,
        'updatedAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
    }
    await batch.commit();
  }

  static Future<void> resolveDuplicateRestaurantReportAsAdmin(
    BiteScoreDuplicateRestaurantReportAdminEntry entry,
  ) async {
    final batch = _firestore.batch();
    for (final report in entry.reports) {
      batch.set(
        duplicateRestaurantReportsCollection().doc(report.id),
        {
          'status': DuplicateRestaurantReport.statusResolved,
          'updatedAt': FieldValue.serverTimestamp(),
        },
        SetOptions(merge: true),
      );
    }
    await batch.commit();
  }

  static Future<void> mergeRestaurantsAsAdmin({
    required BitescoreRestaurant duplicateRestaurant,
    required BitescoreRestaurant survivingRestaurant,
  }) async {
    _requireSignedInAdminUser(operation: 'duplicate_restaurant_merge');
    final duplicateId = duplicateRestaurant.id.trim();
    final survivingId = survivingRestaurant.id.trim();
    _logMergeCondition(
      'duplicate_id_present',
      duplicateId.isNotEmpty,
      sourceRestaurantId: duplicateId,
      targetRestaurantId: survivingId,
    );
    _logMergeCondition(
      'surviving_id_present',
      survivingId.isNotEmpty,
      sourceRestaurantId: duplicateId,
      targetRestaurantId: survivingId,
    );

    if (duplicateId.isEmpty || survivingId.isEmpty) {
      throw ArgumentError('Choose both restaurants before merging.');
    }
    _logMergeCondition(
      'different_restaurant_ids',
      duplicateId != survivingId,
      sourceRestaurantId: duplicateId,
      targetRestaurantId: survivingId,
    );
    if (duplicateId == survivingId) {
      throw ArgumentError('A restaurant cannot be merged into itself.');
    }

    final freshDuplicate = await _runMergeStep(
      'load_duplicate_restaurant',
      () => loadRestaurantById(duplicateId),
    );
    final freshSurviving = await _runMergeStep(
      'load_surviving_restaurant',
      () => loadRestaurantById(survivingId),
    );
    _logMergeCondition(
      'restaurants_loaded',
      freshDuplicate != null && freshSurviving != null,
      sourceRestaurantId: duplicateId,
      targetRestaurantId: survivingId,
    );
    if (freshDuplicate == null || freshSurviving == null) {
      throw ArgumentError('Could not load both restaurants for this merge.');
    }
    _logMergeCondition(
      'surviving_restaurant_active',
      freshSurviving.isActive,
      sourceRestaurantId: duplicateId,
      targetRestaurantId: survivingId,
    );
    if (!freshSurviving.isActive) {
      throw ArgumentError('The surviving restaurant must still be active.');
    }

    final duplicateOwner = freshDuplicate.ownerUserId?.trim();
    final survivingOwner = freshSurviving.ownerUserId?.trim();
    final duplicateHasOwner =
        duplicateOwner != null && duplicateOwner.isNotEmpty;
    final survivingHasOwner =
        survivingOwner != null && survivingOwner.isNotEmpty;
    final hasDifferentOwners =
        duplicateHasOwner &&
        survivingHasOwner &&
        duplicateOwner != survivingOwner;
    _logMergeCondition(
      'owner_conflict_detected',
      !hasDifferentOwners,
      sourceRestaurantId: duplicateId,
      targetRestaurantId: survivingId,
      details:
          'duplicateOwner=${duplicateOwner ?? ''} survivingOwner=${survivingOwner ?? ''}',
    );

    final mergedOwnerUserId = survivingHasOwner
        ? survivingOwner
        : (duplicateHasOwner ? duplicateOwner : null);
    final mergedIsClaimed =
        freshSurviving.isClaimed ||
        freshDuplicate.isClaimed ||
        mergedOwnerUserId != null;
    final mergedCuisineTags = <String>{
      ...freshSurviving.cuisineTags.map((tag) => tag.trim()),
      ...freshDuplicate.cuisineTags.map((tag) => tag.trim()),
    }.where((tag) => tag.isNotEmpty).toList()..sort();

    final mergedSurviving = freshSurviving.copyWith(
      phone: (freshSurviving.phone?.trim().isNotEmpty ?? false)
          ? freshSurviving.phone?.trim()
          : freshDuplicate.phone?.trim(),
      bio: (freshSurviving.bio?.trim().isNotEmpty ?? false)
          ? freshSurviving.bio?.trim()
          : freshDuplicate.bio?.trim(),
      cuisineTags: mergedCuisineTags,
      ownerUserId: mergedOwnerUserId,
      isClaimed: mergedIsClaimed,
      isActive: true,
    );

    await _runMergeStep('update_surviving_restaurant', () async {
      await restaurantsCollection().doc(mergedSurviving.id).set({
        ...mergedSurviving.toFirestoreMap(),
        'createdAt': mergedSurviving.createdAt == null
            ? FieldValue.serverTimestamp()
            : Timestamp.fromDate(mergedSurviving.createdAt!),
        'updatedAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
    });

    final dishesSnapshot = await _runMergeStep(
      'load_duplicate_dishes',
      () => dishesCollection()
          .where('restaurantId', isEqualTo: duplicateId)
          .get(),
    );
    final movedDishIds = <String>[];
    for (final doc in dishesSnapshot.docs) {
      final dish = BitescoreDish.tryFromFirestore(
        doc.data(),
        fallbackId: doc.id,
      );
      if (dish == null) {
        continue;
      }
      movedDishIds.add(dish.id);
      final movedDish = BitescoreDish(
        id: dish.id,
        restaurantId: mergedSurviving.id,
        restaurantName: mergedSurviving.name,
        name: dish.name,
        normalizedName: dish.normalizedName,
        category: dish.category,
        priceLabel: dish.priceLabel,
        isActive: dish.isActive,
        createdAt: dish.createdAt,
        updatedAt: DateTime.now(),
      );
      await _runMergeStep('move_dish_${dish.id}', () async {
        await doc.reference.set({
          ...movedDish.toFirestoreMap(),
          'createdAt': dish.createdAt == null
              ? FieldValue.serverTimestamp()
              : Timestamp.fromDate(dish.createdAt!),
          'updatedAt': FieldValue.serverTimestamp(),
        }, SetOptions(merge: true));
      });
    }

    final reviewsSnapshot = await _runMergeStep(
      'load_duplicate_reviews',
      () => reviewsCollection()
          .where('restaurantId', isEqualTo: duplicateId)
          .get(),
    );
    for (final doc in reviewsSnapshot.docs) {
      await _runMergeStep('move_review_${doc.id}', () async {
        await doc.reference.set({
          'restaurantId': mergedSurviving.id,
          'updatedAt': FieldValue.serverTimestamp(),
        }, SetOptions(merge: true));
      });
    }

    for (final dishId in movedDishIds) {
      await _runMergeStep('rebuild_aggregate_$dishId', () async {
        await _rebuildDishAggregate(
          dishId: dishId,
          restaurantId: mergedSurviving.id,
        );
      });
    }

    final claimSnapshot = await _runMergeStep(
      'load_duplicate_claims',
      () => claimRequestsCollection()
          .where('restaurantId', isEqualTo: duplicateId)
          .get(),
    );
    for (final doc in claimSnapshot.docs) {
      await _runMergeStep('move_claim_${doc.id}', () async {
        await doc.reference.set({
          'restaurantId': mergedSurviving.id,
          'restaurantName': mergedSurviving.name,
          'updatedAt': FieldValue.serverTimestamp(),
        }, SetOptions(merge: true));
      });
    }

    final proposalSnapshot = await _runMergeStep(
      'load_duplicate_edit_proposals',
      () => editProposalsCollection()
          .where('restaurantId', isEqualTo: duplicateId)
          .get(),
    );
    for (final doc in proposalSnapshot.docs) {
      await _runMergeStep('move_edit_proposal_${doc.id}', () async {
        await doc.reference.set({
          'restaurantId': mergedSurviving.id,
          'updatedAt': FieldValue.serverTimestamp(),
        }, SetOptions(merge: true));
      });
    }

    final restaurantReportSnapshot = await _runMergeStep(
      'load_duplicate_restaurant_reports',
      () => restaurantReportsCollection()
          .where('restaurantId', isEqualTo: duplicateId)
          .get(),
    );
    for (final doc in restaurantReportSnapshot.docs) {
      await _runMergeStep('move_restaurant_report_${doc.id}', () async {
        await doc.reference.set({
          'restaurantId': mergedSurviving.id,
          'restaurantName': mergedSurviving.name,
          'updatedAt': FieldValue.serverTimestamp(),
        }, SetOptions(merge: true));
      });
    }

    final dishReportSnapshot = await _runMergeStep(
      'load_duplicate_dish_reports',
      () => dishReportsCollection()
          .where('restaurantId', isEqualTo: duplicateId)
          .get(),
    );
    for (final doc in dishReportSnapshot.docs) {
      await _runMergeStep('move_dish_report_${doc.id}', () async {
        await doc.reference.set({
          'restaurantId': mergedSurviving.id,
          'updatedAt': FieldValue.serverTimestamp(),
        }, SetOptions(merge: true));
      });
    }

    final reviewReportSnapshot = await _runMergeStep(
      'load_duplicate_review_reports',
      () => reviewReportsCollection()
          .where('restaurantId', isEqualTo: duplicateId)
          .get(),
    );
    for (final doc in reviewReportSnapshot.docs) {
      await _runMergeStep('move_review_report_${doc.id}', () async {
        await doc.reference.set({
          'restaurantId': mergedSurviving.id,
          'updatedAt': FieldValue.serverTimestamp(),
        }, SetOptions(merge: true));
      });
    }

    final reviewVoteSnapshot = await _runMergeStep(
      'load_duplicate_review_votes',
      () => reviewFeedbackVotesCollection()
          .where('restaurantId', isEqualTo: duplicateId)
          .get(),
    );
    for (final doc in reviewVoteSnapshot.docs) {
      await _runMergeStep('move_review_vote_${doc.id}', () async {
        await doc.reference.set({
          'restaurantId': mergedSurviving.id,
          'updatedAt': FieldValue.serverTimestamp(),
        }, SetOptions(merge: true));
      });
    }

    final duplicateReportSnapshot = await _runMergeStep(
      'load_duplicate_merge_reports',
      () => duplicateRestaurantReportsCollection()
          .where('restaurantId', isEqualTo: duplicateId)
          .get(),
    );
    for (final doc in duplicateReportSnapshot.docs) {
      await _runMergeStep('resolve_duplicate_report_${doc.id}', () async {
        await doc.reference.set({
          'restaurantId': mergedSurviving.id,
          'restaurantName': mergedSurviving.name,
          'status': DuplicateRestaurantReport.statusResolved,
          'updatedAt': FieldValue.serverTimestamp(),
        }, SetOptions(merge: true));
      });
    }

    final retiredDuplicate = freshDuplicate.copyWith(
      ownerUserId: null,
      isClaimed: false,
      isActive: false,
    );
    await _runMergeStep('retire_duplicate_restaurant', () async {
      await restaurantsCollection().doc(retiredDuplicate.id).set({
        ...retiredDuplicate.toFirestoreMap(),
        'createdAt': retiredDuplicate.createdAt == null
            ? FieldValue.serverTimestamp()
            : Timestamp.fromDate(retiredDuplicate.createdAt!),
        'updatedAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
    });
  }

  static Future<void> deleteReviewAsAdmin(DishReview review) async {
    await _deleteReviewTrustData(review.id);
    await reviewsCollection().doc(review.id).delete();
    await _rebuildDishAggregate(
      dishId: review.dishId,
      restaurantId: review.restaurantId,
    );
  }

  static Future<void> deleteRestaurantAsAdmin(String restaurantId) async {
    final dishesSnapshot = await dishesCollection()
        .where('restaurantId', isEqualTo: restaurantId)
        .get();

    for (final dishDoc in dishesSnapshot.docs) {
      await deleteDishAsAdmin(dishDoc.id);
    }

    final orphanReviewSnapshot = await reviewsCollection()
        .where('restaurantId', isEqualTo: restaurantId)
        .get();
    for (final doc in orphanReviewSnapshot.docs) {
      await _deleteReviewTrustData(doc.id);
      await doc.reference.delete();
    }

    await _deleteRestaurantReportData(restaurantId);
    await _deleteDuplicateRestaurantReportData(restaurantId);
    await restaurantsCollection().doc(restaurantId).delete();
  }

  static Future<BitescoreRestaurant> _findOrCreateRestaurant(
    BiteScoreCreateRequest request,
  ) async {
    final normalizedRestaurantName = _normalize(request.restaurantName);
    final zipCode = request.zipCode.trim();

    final snapshot = await restaurantsCollection()
        .where('zipCode', isEqualTo: zipCode)
        .limit(20)
        .get();

    for (final doc in snapshot.docs) {
      final restaurant = BitescoreRestaurant.tryFromFirestore(
        doc.data(),
        fallbackId: doc.id,
      );
      if (restaurant != null &&
          restaurant.normalizedName == normalizedRestaurantName) {
        return restaurant;
      }
    }

    final verifiedLocation = await _verifyRestaurantAddress(request);
    final restaurantRef = restaurantsCollection().doc();
    final restaurant = BitescoreRestaurant(
      id: restaurantRef.id,
      name: request.restaurantName.trim(),
      normalizedName: normalizedRestaurantName,
      address: request.streetAddress.trim(),
      city: request.city.trim(),
      state: request.state.trim(),
      zipCode: request.zipCode.trim(),
      location: GeoPoint(verifiedLocation.latitude, verifiedLocation.longitude),
    );

    await restaurantRef.set({
      ...restaurant.toFirestoreMap(),
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });

    return restaurant;
  }

  static Future<BitescoreDish> _findOrCreateDish(
    BiteScoreCreateRequest request,
    BitescoreRestaurant restaurant, {
    bool allowExistingMatch = true,
  }) async {
    if (restaurant.latitude == null || restaurant.longitude == null) {
      throw ArgumentError(BiteScoreCreateRequest.invalidAddressMessage);
    }

    final normalizedDishName = _normalize(request.dishName);
    final snapshot = await dishesCollection()
        .where('restaurantId', isEqualTo: restaurant.id)
        .where('normalizedName', isEqualTo: normalizedDishName)
        .get();

    if (allowExistingMatch) {
      for (final doc in snapshot.docs) {
        final existingDish = BitescoreDish.tryFromFirestore(
          doc.data(),
          fallbackId: doc.id,
        );
        if (existingDish != null &&
            existingDish.isActive &&
            !existingDish.isMerged) {
          final trimmedCategory = request.category.trim();
          final existingCategory = existingDish.category?.trim() ?? '';
          if (trimmedCategory.isNotEmpty &&
              existingCategory != trimmedCategory) {
            await doc.reference.set({
              'category': trimmedCategory,
              'updatedAt': FieldValue.serverTimestamp(),
            }, SetOptions(merge: true));

            return BitescoreDish(
              id: existingDish.id,
              restaurantId: existingDish.restaurantId,
              restaurantName: existingDish.restaurantName,
              name: existingDish.name,
              normalizedName: existingDish.normalizedName,
              category: trimmedCategory,
              priceLabel: existingDish.priceLabel,
              isActive: existingDish.isActive,
              mergedIntoDishId: existingDish.mergedIntoDishId,
              createdAt: existingDish.createdAt,
              updatedAt: DateTime.now(),
            );
          }

          return existingDish;
        }
      }
    }

    final dishRef = dishesCollection().doc();
    final dish = BitescoreDish(
      id: dishRef.id,
      restaurantId: restaurant.id,
      restaurantName: restaurant.name,
      name: request.dishName.trim(),
      normalizedName: normalizedDishName,
      category: request.category.trim().isEmpty
          ? null
          : request.category.trim(),
      priceLabel: request.priceLabel.trim().isEmpty
          ? null
          : request.priceLabel.trim(),
    );

    await dishRef.set({
      ...dish.toFirestoreMap(),
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });

    return dish;
  }

  static Future<void> _deleteReviewTrustData(String reviewId) async {
    final voteSnapshot = await reviewFeedbackVotesCollection()
        .where('reviewId', isEqualTo: reviewId)
        .get();
    for (final doc in voteSnapshot.docs) {
      await doc.reference.delete();
    }

    final reportSnapshot = await reviewReportsCollection()
        .where('reviewId', isEqualTo: reviewId)
        .get();
    for (final doc in reportSnapshot.docs) {
      await doc.reference.delete();
    }
  }

  static Future<void> _deleteDishReportData(String dishId) async {
    final reportSnapshot = await dishReportsCollection()
        .where('dishId', isEqualTo: dishId)
        .get();
    for (final doc in reportSnapshot.docs) {
      await doc.reference.delete();
    }
  }

  static Future<void> _deleteRestaurantReportData(String restaurantId) async {
    final reportSnapshot = await restaurantReportsCollection()
        .where('restaurantId', isEqualTo: restaurantId)
        .get();
    for (final doc in reportSnapshot.docs) {
      await doc.reference.delete();
    }
  }

  static Future<void> _deleteDuplicateRestaurantReportData(
    String restaurantId,
  ) async {
    final reportSnapshot = await duplicateRestaurantReportsCollection()
        .where('restaurantId', isEqualTo: restaurantId)
        .get();
    for (final doc in reportSnapshot.docs) {
      await doc.reference.delete();
    }
  }

  static String _reviewVoteDocumentId(String reviewId, String userId) {
    return '${reviewId.trim()}_${userId.trim()}';
  }

  static List<List<String>> _chunkStrings(
    List<String> values, {
    required int size,
  }) {
    final chunks = <List<String>>[];
    for (var index = 0; index < values.length; index += size) {
      final end = (index + size) > values.length ? values.length : index + size;
      chunks.add(values.sublist(index, end));
    }
    return chunks;
  }

  static Future<T> _runMergeStep<T>(
    String step,
    Future<T> Function() action,
  ) async {
    assert(step.isNotEmpty);
    try {
      return await action();
    } catch (_) {
      rethrow;
    }
  }

  static void _logMergeCondition(
    String name,
    bool passed, {
    required String sourceRestaurantId,
    required String targetRestaurantId,
    String? details,
  }) {
    assert(name.isNotEmpty);
    assert(
      sourceRestaurantId.isNotEmpty || targetRestaurantId.isNotEmpty || !passed,
    );
    assert(details == null || details.trim().isNotEmpty || passed || !passed);
    return;
  }

  static User _requireSignedInAdminUser({required String operation}) {
    assert(operation.isNotEmpty);
    final user = FirebaseAuth.instance.currentUser;
    final isAdmin = AdminAccessService.isAdminUser(user);

    if (user == null) {
      throw ArgumentError('You do not have permission to do that.');
    }
    if (user.isAnonymous) {
      throw ArgumentError('You do not have permission to do that.');
    }
    if (!isAdmin) {
      throw ArgumentError('You do not have permission to do that.');
    }

    return user;
  }

  static User _requireSignedInSuggestionUser() {
    return _requireSignedInBiteScoreUser();
  }

  static Future<User> _requireFreshSignedInSuggestionUser() async {
    return _requireFreshSignedInBiteScoreUser();
  }

  static User _requireSignedInAppUser() {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null || user.isAnonymous) {
      throw ArgumentError(loginRequiredMessage);
    }

    return user;
  }

  static User _requireSignedInBiteScoreUser() {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null || user.isAnonymous) {
      throw ArgumentError(loginRequiredMessage);
    }

    if (CustomerAuthService.requiresEmailVerification(user)) {
      throw ArgumentError(emailVerificationRequiredMessage);
    }

    return user;
  }

  static Future<User> _requireFreshSignedInBiteScoreUser() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null || user.isAnonymous) {
      throw ArgumentError(loginRequiredMessage);
    }

    try {
      await user.reload();
      final refreshedUser = FirebaseAuth.instance.currentUser;
      await refreshedUser?.getIdToken(true);
    } catch (_) {
      // Fall back to the current user object if Firebase refresh is unavailable.
    }

    return _requireSignedInBiteScoreUser();
  }

  static String? _readString(dynamic value) {
    if (value is String) {
      final trimmed = value.trim();
      return trimmed.isEmpty ? null : trimmed;
    }

    return null;
  }

  static DateTime? _readDateTime(dynamic value) {
    if (value is Timestamp) {
      return value.toDate();
    }
    if (value is DateTime) {
      return value;
    }
    return null;
  }

  static Future<_PublicReviewerIdentity>
  _ensureCurrentUserPublicReviewerIdentity(User user) async {
    final userId = user.uid.trim();
    if (userId.isEmpty || user.isAnonymous) {
      throw ArgumentError(loginRequiredMessage);
    }
    final phoneNumber = user.phoneNumber?.trim();

    return _firestore.runTransaction((transaction) async {
      final profileRef = publicReviewerProfileDocument(userId);
      final profileSnapshot = await transaction.get(profileRef);
      final existingIdentity = _parsePublicReviewerIdentity(
        profileSnapshot.data(),
        fallbackUserId: profileSnapshot.id,
      );
      if (existingIdentity != null) {
        final nextDisplayName =
            (existingIdentity.chosenUsername ?? '').trim().isNotEmpty
            ? existingIdentity.chosenUsername!.trim()
            : existingIdentity.fallbackUsername;

        transaction.set(profileRef, {
          'publicDisplayName': nextDisplayName,
          'chosenUsername': existingIdentity.chosenUsername,
          'chosenUsernameNormalized': _normalizePublicUsername(
            existingIdentity.chosenUsername ?? '',
          ),
          'fallbackUsername': existingIdentity.fallbackUsername,
          'userId': userId,
          if (phoneNumber != null && phoneNumber.isNotEmpty)
            'phoneNumber': phoneNumber,
          'createdAt': existingIdentity.createdAt == null
              ? FieldValue.serverTimestamp()
              : Timestamp.fromDate(existingIdentity.createdAt!),
          'updatedAt': FieldValue.serverTimestamp(),
        }, SetOptions(merge: true));

        return _PublicReviewerIdentity(
          userId: userId,
          publicDisplayName: nextDisplayName,
          chosenUsername: existingIdentity.chosenUsername,
          fallbackUsername: existingIdentity.fallbackUsername,
          createdAt: existingIdentity.createdAt,
        );
      }

      for (var attempt = 0; attempt < 30; attempt += 1) {
        final candidateFallback = _fallbackUsernameForUser(
          userId,
          attempt: attempt,
        );
        final fallbackRef = publicUsernamesCollection().doc(candidateFallback);
        final fallbackSnapshot = await transaction.get(fallbackRef);
        final reservedByUserId = _readString(
          fallbackSnapshot.data()?['userId'],
        );
        if (fallbackSnapshot.exists && reservedByUserId != userId) {
          continue;
        }

        transaction.set(fallbackRef, {
          'username': candidateFallback,
          'userId': userId,
          'reservationType': 'fallback',
          'createdAt': FieldValue.serverTimestamp(),
          'updatedAt': FieldValue.serverTimestamp(),
        });
        transaction.set(profileRef, {
          'publicDisplayName': candidateFallback,
          'chosenUsername': null,
          'chosenUsernameNormalized': null,
          'fallbackUsername': candidateFallback,
          'userId': userId,
          if (phoneNumber != null && phoneNumber.isNotEmpty)
            'phoneNumber': phoneNumber,
          'createdAt': FieldValue.serverTimestamp(),
          'updatedAt': FieldValue.serverTimestamp(),
        }, SetOptions(merge: true));

        return _PublicReviewerIdentity(
          userId: userId,
          publicDisplayName: candidateFallback,
          chosenUsername: null,
          fallbackUsername: candidateFallback,
          createdAt: null,
        );
      }

      throw ArgumentError(
        'Could not assign a public username right now. Please try again.',
      );
    });
  }

  static Future<_PublicReviewerIdentity> _loadPublicReviewerIdentity(
    String userId,
  ) async {
    final trimmedUserId = userId.trim();
    if (trimmedUserId.isEmpty) {
      return _generatedPublicReviewerIdentity(trimmedUserId);
    }

    final currentUser = FirebaseAuth.instance.currentUser;
    if (currentUser != null &&
        !currentUser.isAnonymous &&
        currentUser.uid == trimmedUserId) {
      return _ensureCurrentUserPublicReviewerIdentity(currentUser);
    }

    final snapshot = await publicReviewerProfileDocument(trimmedUserId).get();
    return _parsePublicReviewerIdentity(
          snapshot.data(),
          fallbackUserId: snapshot.id,
        ) ??
        _generatedPublicReviewerIdentity(trimmedUserId);
  }

  static _PublicReviewerIdentity? _parsePublicReviewerIdentity(
    Map<String, dynamic>? data, {
    required String fallbackUserId,
  }) {
    if (data == null) {
      return null;
    }

    final userId = _readString(data['userId']) ?? fallbackUserId.trim();
    if (userId.isEmpty) {
      return null;
    }

    final chosenUsername = _readString(data['chosenUsername']);
    final fallbackUsername =
        _readString(data['fallbackUsername']) ??
        _fallbackUsernameForUser(userId);
    final publicDisplayName =
        chosenUsername ??
        _readString(data['publicDisplayName']) ??
        fallbackUsername;

    return _PublicReviewerIdentity(
      userId: userId,
      publicDisplayName: publicDisplayName,
      chosenUsername: chosenUsername,
      fallbackUsername: fallbackUsername,
      createdAt: _readDateTime(data['createdAt']),
    );
  }

  static _PublicReviewerIdentity _generatedPublicReviewerIdentity(
    String userId,
  ) {
    final trimmedUserId = userId.trim();
    final fallbackUsername = _fallbackUsernameForUser(trimmedUserId);
    return _PublicReviewerIdentity(
      userId: trimmedUserId,
      publicDisplayName: fallbackUsername,
      chosenUsername: null,
      fallbackUsername: fallbackUsername,
      createdAt: null,
    );
  }

  static String _fallbackUsernameForUser(String userId, {int attempt = 0}) {
    final seed = userId.trim().codeUnits.fold<int>(
      0,
      (value, codeUnit) => ((value * 31) + codeUnit) & 0x7fffffff,
    );
    final base = 1 + (seed % 900000);
    final offset = attempt == 0
        ? 0
        : Random(seed + attempt).nextInt(9000) + attempt;
    return 'anon${base + offset}';
  }

  static String _normalizePublicUsername(String value) {
    return value.trim().toLowerCase();
  }

  static String? _validatePublicUsername(String username) {
    final normalizedUsername = username.trim().toLowerCase();
    if (normalizedUsername.isEmpty) {
      return 'Please enter a username first.';
    }
    if (normalizedUsername.length < 3 || normalizedUsername.length > 20) {
      return 'Usernames must be 3 to 20 characters.';
    }
    if (!RegExp(r'^[a-z0-9_]+$').hasMatch(normalizedUsername)) {
      return 'Use only letters, numbers, and underscores.';
    }
    if (normalizedUsername.startsWith('anon')) {
      return 'Please choose a username that does not start with anon.';
    }
    return null;
  }

  static int _accountAgeDaysForUser(User user) {
    final createdAt = user.metadata.creationTime;
    if (createdAt == null) {
      return 0;
    }

    final age = DateTime.now().difference(createdAt.toLocal()).inDays;
    return age < 0 ? 0 : age;
  }

  static String _favoriteSaverRestaurantId(Restaurant restaurant) {
    final keySource = [
      restaurant.name,
      restaurant.city,
      restaurant.zipCode,
      restaurant.streetAddress ?? '',
    ].join('_').toLowerCase();
    final normalizedKey = keySource
        .replaceAll(RegExp(r'[^a-z0-9]+'), '_')
        .replaceAll(RegExp(r'^_+|_+$'), '');
    return normalizedKey.isEmpty
        ? 'bitesaver_restaurant'
        : 'bitesaver_$normalizedKey';
  }

  static String _profileBadgeLabelFor({
    required int reviewCount,
    required int helpfulVotesReceived,
    required int accountAgeDays,
    required int moderationFlagCount,
  }) {
    if (moderationFlagCount >= 3) {
      return 'New Reviewer';
    }

    if (reviewCount >= 50 &&
        helpfulVotesReceived >= 100 &&
        accountAgeDays >= 90 &&
        moderationFlagCount == 0) {
      return 'Top Contributor';
    }

    if (reviewCount >= 15 &&
        helpfulVotesReceived >= 25 &&
        accountAgeDays >= 30 &&
        moderationFlagCount <= 1) {
      return 'Trusted Reviewer';
    }

    if (reviewCount >= 5 || helpfulVotesReceived >= 5) {
      return 'Active Reviewer';
    }

    return 'New Reviewer';
  }

  static Future<String> _loadReviewerBadgeLabel(String userId) async {
    final trimmedUserId = userId.trim();
    if (trimmedUserId.isEmpty) {
      return 'New Reviewer';
    }

    final reviewSnapshot = await reviewsCollection()
        .where('userId', isEqualTo: trimmedUserId)
        .get();
    final reviewerReviews = reviewSnapshot.docs
        .map(
          (doc) => DishReview.tryFromFirestore(doc.data(), fallbackId: doc.id),
        )
        .whereType<DishReview>()
        .toList();
    final trustByReviewId = await loadReviewTrustSummaries(reviewerReviews);
    final helpfulVotesReceived = trustByReviewId.values.fold<int>(
      0,
      (total, summary) => total + summary.helpfulCount,
    );
    final oldestReviewDate = reviewerReviews
        .map((review) => review.createdAt)
        .whereType<DateTime>()
        .fold<DateTime?>(null, (oldest, createdAt) {
          if (oldest == null || createdAt.isBefore(oldest)) {
            return createdAt;
          }
          return oldest;
        });
    final reviewerAgeDays = oldestReviewDate == null
        ? 0
        : DateTime.now().difference(oldestReviewDate.toLocal()).inDays;

    return _profileBadgeLabelFor(
      reviewCount: reviewerReviews.length,
      helpfulVotesReceived: helpfulVotesReceived,
      accountAgeDays: reviewerAgeDays < 0 ? 0 : reviewerAgeDays,
      moderationFlagCount: 0,
    );
  }

  static List<DishEditSuggestionAdminEntry>
  _buildDishEditSuggestionAdminEntries({
    required List<DishEditProposal> proposals,
    required Map<String, BitescoreDish> dishesById,
  }) {
    final proposalsByKey = <String, List<DishEditProposal>>{};
    for (final proposal in proposals) {
      proposalsByKey
          .putIfAbsent(
            _dishEditProposalGroupKey(proposal),
            () => <DishEditProposal>[],
          )
          .add(proposal);
    }

    final entries =
        proposalsByKey.entries.map((group) {
          final sortedProposals = [...group.value]
            ..sort((a, b) {
              final aDate =
                  a.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
              final bDate =
                  b.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
              return aDate.compareTo(bDate);
            });
          final representative = sortedProposals.first;

          return DishEditSuggestionAdminEntry(
            groupKey: group.key,
            type: representative.type,
            restaurantId: representative.restaurantId,
            targetDish: dishesById[representative.targetDishId],
            mergeTargetDish: representative.mergeTargetDishId == null
                ? null
                : dishesById[representative.mergeTargetDishId!],
            proposals: sortedProposals,
            invalidReason: representative.isMerge
                ? _mergeSuggestionInvalidReason(
                    targetDish: dishesById[representative.targetDishId],
                    mergeTargetDish: representative.mergeTargetDishId == null
                        ? null
                        : dishesById[representative.mergeTargetDishId!],
                  )
                : null,
          );
        }).toList()..sort((a, b) {
          final aDate =
              a.oldestCreatedAt ?? DateTime.fromMillisecondsSinceEpoch(0);
          final bDate =
              b.oldestCreatedAt ?? DateTime.fromMillisecondsSinceEpoch(0);
          return bDate.compareTo(aDate);
        });

    return entries;
  }

  static String _dishEditProposalGroupKey(DishEditProposal proposal) {
    if (proposal.isMerge) {
      return [
        proposal.type,
        proposal.restaurantId.trim(),
        proposal.targetDishId.trim(),
        (proposal.mergeTargetDishId ?? '').trim(),
      ].join('|');
    }

    return [
      proposal.type,
      proposal.restaurantId.trim(),
      proposal.targetDishId.trim(),
      _normalize(proposal.proposedName ?? ''),
    ].join('|');
  }

  static String? _mergeSuggestionInvalidReason({
    required BitescoreDish? targetDish,
    required BitescoreDish? mergeTargetDish,
  }) {
    if (targetDish == null) {
      return 'Source dish is missing.';
    }
    if (mergeTargetDish == null) {
      return 'Merge target dish is missing.';
    }
    if (targetDish.restaurantId != mergeTargetDish.restaurantId) {
      return 'Merge dishes must belong to the same restaurant.';
    }
    if (!targetDish.isActive) {
      return 'Source dish is already inactive or previously merged.';
    }
    if (targetDish.isMerged) {
      return 'Source dish was already merged into another dish.';
    }
    if (!mergeTargetDish.isActive) {
      return 'Merge target is already inactive, so this reverse/conflicting merge is invalid.';
    }
    if (mergeTargetDish.isMerged) {
      return 'Merge target was already merged into another dish.';
    }
    if (targetDish.id == mergeTargetDish.id) {
      return 'A dish cannot merge into itself.';
    }
    return null;
  }

  static String? _readAdminString(dynamic value) {
    if (value is String) {
      final trimmed = value.trim();
      return trimmed.isEmpty ? null : trimmed;
    }
    return null;
  }

  static Future<void> _markDishEditSuggestionEntryStatus(
    DishEditSuggestionAdminEntry entry,
    String status,
  ) async {
    final batch = _firestore.batch();
    for (final proposal in entry.proposals) {
      batch.set(editProposalsCollection().doc(proposal.id), {
        'status': status,
        'updatedAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
    }
    await batch.commit();
  }

  static Future<void> _applyDishEditSuggestionEntry(
    DishEditSuggestionAdminEntry entry, {
    required String approvedStatus,
  }) async {
    if (entry.isRename) {
      final targetDish = entry.targetDish;
      final proposedName = entry.proposedName?.trim() ?? '';
      if (targetDish == null || proposedName.isEmpty) {
        throw ArgumentError('Rename suggestion is missing dish data.');
      }

      final normalizedName = _normalize(proposedName);
      if (normalizedName != targetDish.normalizedName) {
        await dishesCollection().doc(targetDish.id).set({
          ...BitescoreDish(
            id: targetDish.id,
            restaurantId: targetDish.restaurantId,
            restaurantName: targetDish.restaurantName,
            name: proposedName,
            normalizedName: normalizedName,
            category: targetDish.category,
            priceLabel: targetDish.priceLabel,
            isActive: targetDish.isActive,
            mergedIntoDishId: targetDish.mergedIntoDishId,
            createdAt: targetDish.createdAt,
            updatedAt: DateTime.now(),
          ).toFirestoreMap(),
          'createdAt': targetDish.createdAt == null
              ? FieldValue.serverTimestamp()
              : Timestamp.fromDate(targetDish.createdAt!),
          'updatedAt': FieldValue.serverTimestamp(),
        }, SetOptions(merge: true));
      }
    } else if (entry.isMerge) {
      final representative = entry.proposals.first;
      final freshTargetDish = await loadDishById(representative.targetDishId);
      final freshMergeTargetDish = representative.mergeTargetDishId == null
          ? null
          : await loadDishById(representative.mergeTargetDishId!);
      final invalidReason = _mergeSuggestionInvalidReason(
        targetDish: freshTargetDish,
        mergeTargetDish: freshMergeTargetDish,
      );
      if (invalidReason != null) {
        await _markDishEditSuggestionEntryStatus(entry, 'rejected');
        throw ArgumentError(invalidReason);
      }

      await _mergeDishIntoTarget(
        sourceDish: freshTargetDish!,
        mergeTargetDish: freshMergeTargetDish!,
      );
    } else {
      throw ArgumentError('Unknown dish edit suggestion type.');
    }

    await _markDishEditSuggestionEntryStatus(entry, approvedStatus);
  }

  static Future<void> _rebuildDishAggregate({
    required String dishId,
    required String restaurantId,
  }) async {
    final reviews = await _loadAllDishReviewsForDish(dishId);

    if (reviews.isEmpty) {
      await ratingAggregatesCollection().doc(dishId).set({
        'dishId': dishId,
        'restaurantId': restaurantId,
        'overallBiteScore': 0,
        'ratingCount': 0,
        'overallImpressionAverage': null,
        'tastinessScoreAverage': null,
        'qualityScoreAverage': null,
        'valueScoreAverage': null,
        'updatedAt': FieldValue.serverTimestamp(),
      });
      return;
    }

    double sumOverall = 0;
    double sumOverallImpression = 0;
    double sumTastiness = 0;
    double sumQuality = 0;
    double sumValue = 0;
    var tastinessCount = 0;
    var qualityCount = 0;
    var valueCount = 0;

    for (final review in reviews) {
      sumOverall += review.overallBiteScore;
      sumOverallImpression += review.overallImpression;

      if (review.tastinessScore != null) {
        sumTastiness += review.tastinessScore!;
        tastinessCount += 1;
      }

      if (review.qualityScore != null) {
        sumQuality += review.qualityScore!;
        qualityCount += 1;
      }

      if (review.valueScore != null) {
        sumValue += review.valueScore!;
        valueCount += 1;
      }
    }

    final ratingCount = reviews.length;
    final aggregate = DishRatingAggregate(
      dishId: dishId,
      restaurantId: restaurantId,
      overallBiteScore: sumOverall / ratingCount,
      ratingCount: ratingCount,
      overallImpressionAverage: sumOverallImpression / ratingCount,
      tastinessScoreAverage: tastinessCount == 0
          ? null
          : sumTastiness / tastinessCount,
      qualityScoreAverage: qualityCount == 0 ? null : sumQuality / qualityCount,
      valueScoreAverage: valueCount == 0 ? null : sumValue / valueCount,
    );

    await ratingAggregatesCollection().doc(dishId).set({
      ...aggregate.toFirestoreMap(),
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  static Future<Location> _verifyRestaurantAddress(
    BiteScoreCreateRequest request,
  ) async {
    try {
      final results = await locationFromAddress(request.fullAddress);
      if (results.isEmpty) {
        throw ArgumentError(BiteScoreCreateRequest.invalidAddressMessage);
      }

      return results.first;
    } catch (_) {
      throw ArgumentError(BiteScoreCreateRequest.invalidAddressMessage);
    }
  }

  static BitescoreRestaurant? _parseRestaurantCompat(
    Map<String, dynamic>? data, {
    required String fallbackId,
  }) {
    return BitescoreRestaurant.tryFromFirestore(data, fallbackId: fallbackId) ??
        BitescoreRestaurant.tryFromFinderFirestore(
          data,
          fallbackId: fallbackId,
        );
  }

  static String _normalize(String input) {
    return input.trim().toLowerCase();
  }

  static String _normalizeDishMatchText(String input) {
    return input
        .trim()
        .toLowerCase()
        .replaceAll(RegExp(r'[^\w\s]+'), ' ')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
  }

  static Set<String> _tokenizeDishMatchText(String normalizedInput) {
    return normalizedInput
        .split(' ')
        .map((token) => token.trim())
        .where((token) => token.isNotEmpty)
        .toSet();
  }

  static int _levenshteinDistance(String left, String right) {
    if (left == right) {
      return 0;
    }
    if (left.isEmpty) {
      return right.length;
    }
    if (right.isEmpty) {
      return left.length;
    }

    var previousRow = List<int>.generate(right.length + 1, (index) => index);
    for (var leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
      final currentRow = List<int>.filled(right.length + 1, 0);
      currentRow[0] = leftIndex + 1;

      for (var rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
        final insertionCost = currentRow[rightIndex] + 1;
        final deletionCost = previousRow[rightIndex + 1] + 1;
        final substitutionCost =
            previousRow[rightIndex] +
            (left[leftIndex] == right[rightIndex] ? 0 : 1);
        var bestCost = insertionCost < deletionCost
            ? insertionCost
            : deletionCost;
        if (substitutionCost < bestCost) {
          bestCost = substitutionCost;
        }
        currentRow[rightIndex + 1] = bestCost;
      }

      previousRow = currentRow;
    }

    return previousRow.last;
  }

  static Future<void> _createReviewAndRebuildAggregate({
    required String userId,
    required BitescoreDish dish,
    required BitescoreRestaurant restaurant,
    required double overallImpression,
    required String headline,
    required String notes,
    double? tastinessScore,
    double? qualityScore,
    double? valueScore,
  }) async {
    final validationError = _validateRequiredReviewScores(
      overallImpression: overallImpression,
      tastinessScore: tastinessScore,
      qualityScore: qualityScore,
      valueScore: valueScore,
    );
    if (validationError != null) {
      throw ArgumentError(validationError);
    }

    final currentUser = FirebaseAuth.instance.currentUser;
    if (currentUser != null &&
        !currentUser.isAnonymous &&
        currentUser.uid == userId.trim()) {
      await _ensureCurrentUserPublicReviewerIdentity(currentUser);
    }

    final overallBiteScore = computeOverallBiteScore(
      overallImpression: overallImpression,
      tastinessScore: tastinessScore,
      qualityScore: qualityScore,
      valueScore: valueScore,
    );

    final reviewRef = reviewsCollection().doc();
    final review = DishReview(
      id: reviewRef.id,
      dishId: dish.id,
      restaurantId: restaurant.id,
      userId: userId,
      headline: headline.trim().isEmpty ? null : headline.trim(),
      notes: notes.trim().isEmpty ? null : notes.trim(),
      overallImpression: overallImpression,
      tastinessScore: tastinessScore,
      qualityScore: qualityScore,
      valueScore: valueScore,
      overallBiteScore: overallBiteScore,
    );

    await reviewRef.set({
      ...review.toFirestoreMap(),
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });

    await _rebuildDishAggregate(dishId: dish.id, restaurantId: restaurant.id);
  }

  static String? _validateRequiredReviewScores({
    required double overallImpression,
    required double? tastinessScore,
    required double? qualityScore,
    required double? valueScore,
  }) {
    if (overallImpression < 1 || overallImpression > 10) {
      return 'Enjoyment must be between 1 and 10.';
    }
    if (tastinessScore == null) {
      return 'Tastiness is required.';
    }
    if (tastinessScore < 1 || tastinessScore > 10) {
      return 'Tastiness must be between 1 and 10.';
    }
    if (qualityScore == null) {
      return 'Quality is required.';
    }
    if (qualityScore < 1 || qualityScore > 10) {
      return 'Quality must be between 1 and 10.';
    }
    if (valueScore == null) {
      return 'Value is required.';
    }
    if (valueScore < 1 || valueScore > 10) {
      return 'Value must be between 1 and 10.';
    }
    return null;
  }

  static Future<List<QueryDocumentSnapshot<Map<String, dynamic>>>>
  _loadAllRestaurantDocuments() async {
    const pageSize = 250;
    final allDocs = <QueryDocumentSnapshot<Map<String, dynamic>>>[];
    DocumentSnapshot<Map<String, dynamic>>? lastDoc;

    while (true) {
      var query = restaurantsCollection()
          .orderBy(FieldPath.documentId)
          .limit(pageSize);

      if (lastDoc != null) {
        query = query.startAfterDocument(lastDoc);
      }

      final snapshot = await query.get();
      if (snapshot.docs.isEmpty) {
        break;
      }

      allDocs.addAll(snapshot.docs);
      if (snapshot.docs.length < pageSize) {
        break;
      }

      lastDoc = snapshot.docs.last;
    }

    return allDocs;
  }

  static Future<List<QueryDocumentSnapshot<Map<String, dynamic>>>>
  _loadAllDishCatalogDocuments() async {
    const pageSize = 250;
    final allDocs = <QueryDocumentSnapshot<Map<String, dynamic>>>[];
    DocumentSnapshot<Map<String, dynamic>>? lastDoc;

    while (true) {
      var query = dishCatalogCollection()
          .orderBy(FieldPath.documentId)
          .limit(pageSize);

      if (lastDoc != null) {
        query = query.startAfterDocument(lastDoc);
      }

      final snapshot = await query.get();
      if (snapshot.docs.isEmpty) {
        break;
      }

      allDocs.addAll(snapshot.docs);
      if (snapshot.docs.length < pageSize) {
        break;
      }

      lastDoc = snapshot.docs.last;
    }

    return allDocs;
  }

  static Future<List<DishCatalogSuggestion>> _loadDishCatalogCache() async {
    if (_dishCatalogCache != null) {
      return _dishCatalogCache!;
    }

    if (_dishCatalogCacheFuture != null) {
      return _dishCatalogCacheFuture!;
    }

    _dishCatalogCacheFuture = _loadDishCatalogCacheInternal();

    try {
      final catalog = await _dishCatalogCacheFuture!;
      _dishCatalogCache = catalog;
      return catalog;
    } finally {
      _dishCatalogCacheFuture = null;
    }
  }

  static Future<List<DishCatalogSuggestion>>
  _loadDishCatalogCacheInternal() async {
    try {
      final docs = await _loadAllDishCatalogDocuments();

      final suggestions = docs
          .map((doc) => _catalogSuggestionFromDoc(doc.data()))
          .whereType<DishCatalogSuggestion>()
          .toList();

      return suggestions;
    } catch (_) {
      rethrow;
    }
  }

  static DishCatalogSuggestion? _catalogSuggestionFromDoc(
    Map<String, dynamic> data,
  ) {
    final canonicalName =
        _readCatalogString(data['canonicalName']) ??
        _readCatalogString(data['name']) ??
        _readCatalogString(data['title']);
    if (canonicalName == null) {
      return null;
    }

    return DishCatalogSuggestion(
      canonicalName: canonicalName,
      aliases: _readCatalogStringList(data['aliases']),
    );
  }

  static String? _readCatalogString(dynamic value) {
    if (value is String) {
      final trimmed = value.trim();
      return trimmed.isEmpty ? null : trimmed;
    }

    return null;
  }

  static List<String> _readCatalogStringList(dynamic value) {
    if (value is Iterable) {
      return value
          .whereType<String>()
          .map((item) => item.trim().toLowerCase())
          .where((item) => item.isNotEmpty)
          .toList();
    }

    return const <String>[];
  }

  static List<String> _catalogTokens(String value) {
    return value
        .toLowerCase()
        .split(RegExp(r'[^a-z0-9]+'))
        .map((token) => token.trim())
        .where((token) => token.isNotEmpty)
        .toList();
  }

  static List<String> _catalogSearchWords(
    String canonicalName,
    List<String> aliases,
  ) {
    final words = <String>{};

    for (final source in <String>[canonicalName.toLowerCase(), ...aliases]) {
      words.add(source);
      words.addAll(_catalogTokens(source));
    }

    return words.toList();
  }

  static bool _looksLikeImportedRestaurantDoc(
    QueryDocumentSnapshot<Map<String, dynamic>> doc,
  ) {
    final data = doc.data();
    return data.containsKey('active') ||
        data.containsKey('formattedAddress') ||
        ((data['address'] is String) &&
            (data['address'] as String).toUpperCase().contains(', USA'));
  }

  static String _finderRestaurantKey(BitescoreRestaurant restaurant) {
    return [
      restaurant.state.trim().toUpperCase(),
      restaurant.city.trim().toUpperCase(),
      restaurant.name.trim().toUpperCase(),
      restaurant.zipCode.trim(),
    ].join('|');
  }

  static List<BitescoreRestaurant> _applyFinderCompatibilityFallbacks(
    List<BitescoreRestaurant> restaurants,
  ) {
    final byZip = <String, String>{};
    final byCity = <String, String>{};
    final knownStates = <String>{};

    for (final restaurant in restaurants) {
      final state = restaurant.state.trim();
      if (state.isEmpty) {
        continue;
      }

      knownStates.add(state);

      final zip = restaurant.zipCode.trim();
      if (zip.isNotEmpty) {
        byZip.putIfAbsent(zip, () => state);
      }

      final cityKey = restaurant.city.trim().toUpperCase();
      if (cityKey.isNotEmpty) {
        byCity.putIfAbsent(cityKey, () => state);
      }
    }

    final dominantState = knownStates.length == 1 ? knownStates.first : null;

    return restaurants.map((restaurant) {
      if (restaurant.state.trim().isNotEmpty) {
        return restaurant;
      }

      final inferredState =
          byZip[restaurant.zipCode.trim()] ??
          byCity[restaurant.city.trim().toUpperCase()] ??
          dominantState ??
          'Unknown';

      return restaurant.copyWith(state: inferredState);
    }).toList();
  }
}

class _CatalogMatch {
  final DishCatalogSuggestion suggestion;
  final int score;

  const _CatalogMatch({required this.suggestion, required this.score});
}
