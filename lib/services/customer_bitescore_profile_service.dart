import '../models/bitescore_restaurant.dart';
import '../models/customer_bitescore_search.dart';
import '../models/dish_review.dart';
import '../models/local_expert.dart';
import '../models/local_expert_badge.dart';
import 'bitescore_service.dart';
import 'customer_bitescore_search_service.dart';
import 'local_expert_review_service.dart';

/// Profile headers and independently paged lists share the customer boundary.
/// No failure here is repaired by downloading raw review/favorite collections.
class CustomerBiteScoreProfileService {
  CustomerBiteScoreProfileService({
    CustomerBiteScoreSearchApi? api,
    String Function()? actorKey,
  }) : _api = api ?? CustomerBiteScoreSearchService(),
       _actorKey = actorKey;
  final CustomerBiteScoreSearchApi _api;
  final String Function()? _actorKey;
  final String _clientInstanceId = customerBiteScoreRequestId();

  Future<BiteScorePublicReviewerProfileData> summary(String userId) async {
    final value = await _api.invoke('getCustomerBiteScoreProfileSummary', {
      'schemaVersion': 1,
      'clientInstanceId': _clientInstanceId,
      'userId': userId,
    });
    if (value['schemaVersion'] != 1 || value['userId'] != userId) {
      throw const FormatException('Unexpected profile identity.');
    }
    int count(String field) {
      final result = value[field];
      if (result is! int || result < 0) {
        throw FormatException('Invalid $field.');
      }
      return result;
    }

    String text(String field) {
      final result = value[field];
      if (result is! String || result.isEmpty) {
        throw FormatException('Invalid $field.');
      }
      return result;
    }

    final chosen = value['chosenUsername'];
    if (chosen != null && chosen is! String) {
      throw const FormatException('Invalid username.');
    }
    return BiteScorePublicReviewerProfileData(
      userId: userId,
      publicDisplayName: text('publicDisplayName'),
      chosenUsername: chosen as String?,
      fallbackUsername: text('fallbackUsername'),
      reviews: const [],
      badgeLabel: text('badgeLabel'),
      reviewCount: count('reviewCount'),
      helpfulVotesReceived: count('helpfulVotesReceived'),
      accountAgeDays: count('accountAgeDays'),
      moderationFlagCount: count('moderationFlagCount'),
      contributionPoints: count('contributionPoints'),
    );
  }

  Future<List<LocalExpertBadge>> badges(String userId) async {
    final data = await _api.invoke('getCustomerBiteScoreProfileSummary', {
      'schemaVersion': 1,
      'clientInstanceId': _clientInstanceId,
      'userId': userId,
    });
    final raw = data['badges'];
    if (data['schemaVersion'] != 1 ||
        data['userId'] != userId ||
        raw is! List ||
        raw.length > 21) {
      throw const FormatException('Invalid reviewer badges.');
    }
    return LocalExpertBadge.sortBadges(
      raw
          .map((value) {
            final badge = _map(value);
            for (final field in ['earnedAt', 'updatedAt']) {
              final milliseconds = badge['${field}Ms'];
              badge[field] = milliseconds is int
                  ? DateTime.fromMillisecondsSinceEpoch(
                      milliseconds,
                      isUtc: true,
                    )
                  : null;
            }
            return LocalExpertBadge.tryFromMap(badge);
          })
          .whereType<LocalExpertBadge>()
          .where((badge) => LocalExperts.byId(badge.expertTypeId) != null),
    );
  }

  CustomerBiteScoreSearchController list({
    required String kind,
    required String userId,
    String sort = 'mostRecent',
    String? expertTypeId,
    double? latitude,
    double? longitude,
  }) {
    if (!const {
      'savedRestaurants',
      'savedDishes',
      'reviews',
      'localExpert',
    }.contains(kind)) {
      throw ArgumentError.value(kind, 'kind');
    }
    return CustomerBiteScoreSearchController(
      api: _api,
      actorKey: _actorKey,
      criteria: {
        'kind': kind,
        'userId': userId,
        'sort': sort,
        'expertTypeId': ?expertTypeId,
        if (latitude != null && longitude != null)
          'location': {'latitude': latitude, 'longitude': longitude},
      },
      startEndpoint: 'startCustomerBiteScoreProfileList',
      advanceEndpoint: 'advanceCustomerBiteScoreProfileList',
      pageEndpoint: 'getCustomerBiteScoreProfileListPage',
      validateItem: (item) {
        if (kind == 'savedRestaurants') {
          restaurant(item);
        } else if (kind == 'savedDishes') {
          dish(item);
        } else {
          final entry = review(item);
          if (entry.review.userId != userId) {
            throw const FormatException('Unexpected reviewer.');
          }
        }
      },
      resultIdentity: (item) => kind == 'savedRestaurants'
          ? restaurant(item).id
          : kind == 'savedDishes'
          ? dish(item).dish.id
          : review(item).review.id,
    );
  }

  static Map<String, dynamic> _map(Object? value) {
    if (value is! Map) throw const FormatException('Invalid profile item.');
    return Map<String, dynamic>.from(value);
  }

  static BitescoreRestaurant restaurant(Map<String, dynamic> item) =>
      CustomerBiteScorePublicData.restaurant(_map(item['restaurant']));
  static BiteScoreHomeEntry dish(Map<String, dynamic> item) =>
      CustomerBiteScorePublicData.entry(
        _map(item['dish']),
        restaurantProjection: _map(item['restaurant']),
      );
  static BiteScoreUserReviewEntry review(Map<String, dynamic> item) {
    final entry = dish(item);
    final data = _map(item['review']);
    final id = data['id'];
    final userId = data['userId'];
    if (id is! String ||
        id.isEmpty ||
        userId is! String ||
        userId.isEmpty ||
        data['dishId'] != entry.dish.id ||
        data['restaurantId'] != entry.restaurant.id) {
      throw const FormatException('Invalid review identity.');
    }
    double score(String field, {bool nullable = false}) {
      final value = data[field];
      if (nullable && value == null) return 0;
      if (value is! num || !value.isFinite) {
        throw FormatException('Invalid $field.');
      }
      return value.toDouble();
    }

    DateTime? date(String field) {
      final value = data[field];
      if (value == null) return null;
      if (value is! int || value < 0) throw FormatException('Invalid $field.');
      return DateTime.fromMillisecondsSinceEpoch(value, isUtc: true);
    }

    String? optionalText(String field) {
      final value = data[field];
      if (value != null && value is! String) {
        throw FormatException('Invalid $field.');
      }
      return value as String?;
    }

    return BiteScoreUserReviewEntry(
      dish: entry.dish,
      restaurant: entry.restaurant,
      review: DishReview(
        id: id,
        userId: userId,
        dishId: entry.dish.id,
        restaurantId: entry.restaurant.id,
        headline: optionalText('headline'),
        notes: optionalText('notes'),
        overallImpression: score('overallImpression'),
        overallBiteScore: score('overallBiteScore'),
        tastinessScore: data['tastinessScore'] == null
            ? null
            : score('tastinessScore'),
        qualityScore: data['qualityScore'] == null
            ? null
            : score('qualityScore'),
        valueScore: data['valueScore'] == null ? null : score('valueScore'),
        createdAt: date('createdAtMs'),
        updatedAt: date('updatedAtMs'),
      ),
    );
  }

  static LocalExpertReviewEntry expertReview(Map<String, dynamic> item) {
    final entry = review(item);
    return LocalExpertReviewEntry(
      review: entry.review,
      dish: entry.dish!,
      restaurant: entry.restaurant!,
    );
  }

  static BiteScoreUserProfileData ownProfile(
    BiteScorePublicReviewerProfileData summary, {
    BiteScoreUserProfileData? biteSaver,
    List<BitescoreRestaurant> restaurants = const [],
    List<BiteScoreHomeEntry> dishes = const [],
    List<BiteScoreUserReviewEntry> reviews = const [],
  }) => BiteScoreUserProfileData(
    publicDisplayName: summary.publicDisplayName,
    chosenUsername: summary.chosenUsername,
    fallbackUsername: summary.fallbackUsername,
    favoriteRestaurants: restaurants,
    favoriteDishEntries: dishes,
    favoriteSaverRestaurants: biteSaver?.favoriteSaverRestaurants ?? const [],
    favoriteCoupons: biteSaver?.favoriteCoupons ?? const [],
    reviews: reviews,
    badgeLabel: summary.badgeLabel,
    reviewCount: summary.reviewCount,
    helpfulVotesReceived: summary.helpfulVotesReceived,
    accountAgeDays: summary.accountAgeDays,
    moderationFlagCount: summary.moderationFlagCount,
    contributionPoints: summary.contributionPoints,
  );
}
