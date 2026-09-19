import 'package:cloud_functions/cloud_functions.dart';

import '../models/bitescore_dish_image.dart';
import '../models/bitescore_restaurant.dart';
import '../models/customer_bitesaver_search.dart';
import '../models/customer_bitescore_search.dart';
import '../models/dish_review.dart';
import '../models/local_expert_badge.dart';
import 'bitescore_service.dart';
import 'customer_bitescore_search_service.dart'
    show customerBiteScoreRequestId, customerBiteScoreActorKey;

typedef CustomerBiteScoreReadBoundary =
    Future<Object?> Function(String name, Map<String, Object?> request);

class CustomerBiteScoreMenuPage {
  final CustomerBiteSaverMenuAvailability availability;
  final CustomerBiteSaverMenuStyle menuStyle;
  final List<CustomerBiteSaverMenuEntry> entries;
  final String? nextCursor;
  const CustomerBiteScoreMenuPage({
    required this.availability,
    required this.menuStyle,
    required this.entries,
    required this.nextCursor,
  });
}

class CustomerBiteScoreReadPage<T> {
  final List<T> items;
  final String? nextCursor;
  const CustomerBiteScoreReadPage(this.items, this.nextCursor);
}

class CustomerBiteScoreDetail {
  final BitescoreRestaurant restaurant;
  final BiteScoreHomeEntry? entry;
  final bool isFavorite;
  final bool canManage;
  final int imageCount;
  const CustomerBiteScoreDetail({
    required this.restaurant,
    this.entry,
    required this.isFavorite,
    required this.canManage,
    this.imageCount = 0,
  });
}

class CustomerBiteScoreReviewItem {
  final DishReview review;
  final ReviewTrustSummary trust;
  final String displayName;
  final int publicReviewCount;
  final List<LocalExpertBadge> badges;
  final BiteScoreDishImage? image;
  const CustomerBiteScoreReviewItem({
    required this.review,
    required this.trust,
    required this.displayName,
    required this.publicReviewCount,
    required this.badges,
    this.image,
  });
}

/// Customer reads never fall back to Firestore or to legacy service loaders.
class CustomerBiteScoreReads {
  CustomerBiteScoreReads({
    CustomerBiteScoreReadBoundary? boundary,
    String Function()? actorKey,
    Future<void> Function(Duration)? delay,
  }) : _boundary = boundary ?? _call,
       _actorKey = actorKey ?? customerBiteScoreActorKey,
       _delay = delay ?? Future<void>.delayed;
  final CustomerBiteScoreReadBoundary _boundary;
  final String _clientInstanceId = customerBiteScoreRequestId();
  final String Function() _actorKey;
  final Future<void> Function(Duration) _delay;
  int _menuGeneration = 0;
  final Map<String, ({String actor, int generation, String requestId})>
  _menuRequests = {};
  final Map<String, ({String sessionId, String fingerprint})> _menuSessions =
      {};

  Future<Object?> _invoke(String name, Map<String, Object?> request) async {
    final actor = _actorKey();
    final result = await _boundary(name, {
      ...request,
      'clientInstanceId': _clientInstanceId,
    });
    if (actor != _actorKey()) throw StateError('BiteScore account changed.');
    return result;
  }

  static Future<Object?> _call(
    String name,
    Map<String, Object?> request,
  ) async => (await FirebaseFunctions.instanceFor(
    region: 'us-central1',
  ).httpsCallable(name).call<Object?>(request)).data;

  Future<CustomerBiteScoreDetail> detail(String kind, String id) async {
    final value = _map(
      await _invoke('getCustomerBiteScoreDetail', {'kind': kind, 'id': id}),
    );
    if (value['kind'] != kind) {
      throw const FormatException('Unexpected detail kind.');
    }
    final restaurantMap = _map(value['restaurant']);
    final restaurant = CustomerBiteScorePublicData.restaurant(restaurantMap);
    final entry = kind == 'dish'
        ? CustomerBiteScorePublicData.entry(
            _map(value['dish']),
            restaurantProjection: restaurantMap,
          )
        : null;
    if ((kind == 'dish' ? entry?.dish.id : restaurant.id) != id ||
        value['isFavorite'] is! bool ||
        value['canManage'] is! bool) {
      throw const FormatException('Unexpected detail identity.');
    }
    return CustomerBiteScoreDetail(
      restaurant: restaurant,
      entry: entry,
      isFavorite: value['isFavorite'] as bool,
      canManage: value['canManage'] as bool,
      imageCount: _count(value['imageCount'] ?? 0),
    );
  }

  Future<CustomerBiteScoreReadPage<CustomerBiteScoreReviewItem>> reviews(
    String dishId, {
    required String sort,
    String? cursor,
    String? targetReviewId,
  }) async {
    final result = _map(
      await _invoke('pageCustomerBiteScoreReviews', {
        'dishId': dishId,
        'sort': sort,
        'targetReviewId': ?targetReviewId,
        'cursor': ?cursor,
      }),
    );
    final items = _items(result)
        .map((raw) {
          final value = _map(raw);
          final review = _map(value['review']);
          if (review['dishId'] != dishId) {
            throw const FormatException('Unexpected review parent.');
          }
          final author = _map(value['reviewer']);
          final userId = _identity(review['userId']);
          if (author['userId'] != userId) {
            throw const FormatException('Unexpected reviewer.');
          }
          return CustomerBiteScoreReviewItem(
            image: value['image'] == null
                ? null
                : _image(value['image'], dishId),
            review: DishReview(
              id: _identity(review['id']),
              dishId: dishId,
              restaurantId: _identity(review['restaurantId']),
              userId: userId,
              headline: review['headline'] as String?,
              notes: review['notes'] as String?,
              overallImpression: _number(review['overallImpression']),
              overallBiteScore: _number(review['overallBiteScore']),
              tastinessScore: _optionalNumber(review['tastinessScore']),
              qualityScore: _optionalNumber(review['qualityScore']),
              valueScore: _optionalNumber(review['valueScore']),
              createdAt: _date(review['createdAtMs']),
              updatedAt: _date(review['updatedAtMs']),
            ),
            trust: ReviewTrustSummary(
              helpfulCount: _count(value['helpfulCount']),
              notHelpfulCount: _count(value['notHelpfulCount']),
              currentUserVoteType: value['currentUserVoteType'] as String?,
              hasPendingUserReport: value['hasPendingUserReport'] == true,
            ),
            displayName: author['displayName'] as String,
            publicReviewCount: _count(author['publicReviewCount']),
            badges: (author['badges'] as List)
                .map((raw) {
                  final badge = _map(raw);
                  return LocalExpertBadge.tryFromMap({
                    ...badge,
                    'earnedAt': _date(badge['earnedAtMs']),
                    'updatedAt': _date(badge['updatedAtMs']),
                  });
                })
                .whereType<LocalExpertBadge>()
                .toList(growable: false),
          );
        })
        .toList(growable: false);
    return CustomerBiteScoreReadPage(items, _cursor(result));
  }

  Future<CustomerBiteScoreReadPage<BiteScoreDishImage>> images(
    String dishId, {
    String? cursor,
  }) async {
    final result = _map(
      await _invoke('pageCustomerBiteScoreImages', {
        'dishId': dishId,
        'cursor': ?cursor,
      }),
    );
    final images = _items(
      result,
    ).map((raw) => _image(raw, dishId)).toList(growable: false);
    return CustomerBiteScoreReadPage(images, _cursor(result));
  }

  static BiteScoreDishImage _image(Object? raw, String dishId) {
    final image = _map(raw);
    if (image['dishId'] != dishId) {
      throw const FormatException('Unexpected image parent.');
    }
    return BiteScoreDishImage(
      id: _identity(image['id']),
      dishId: dishId,
      restaurantId: _identity(image['restaurantId']),
      reviewId: image['reviewId'] as String?,
      uploadedByUserId: '',
      storagePath: '',
      imageUrl: image['imageUrl'] as String,
      sortOrder: image['sortOrder'] as int,
      helpfulCount: _count(image['helpfulCount']),
      notHelpfulCount: _count(image['notHelpfulCount']),
      createdAt: image['createdAtMicros'] is int
          ? DateTime.fromMicrosecondsSinceEpoch(image['createdAtMicros'] as int)
          : _date(image['createdAtMs']),
    );
  }

  Future<CustomerBiteScoreMenuPage> menu(
    String restaurantId, {
    String? cursor,
  }) async {
    if (cursor == null) {
      _menuSessions.remove(restaurantId);
      _menuRequests[restaurantId] = (
        actor: _actorKey(),
        generation: ++_menuGeneration,
        requestId: customerBiteScoreRequestId(),
      );
    }
    final active = _menuRequests[restaurantId];
    if (active == null || active.actor != _actorKey()) {
      throw StateError('Menu request changed.');
    }
    String? sessionId = _menuSessions[restaurantId]?.sessionId;
    String? fingerprint = _menuSessions[restaurantId]?.fingerprint;
    late Map<String, dynamic> result;
    while (true) {
      result = _map(
        await _invoke('pageCustomerBiteScoreMenu', {
          'schemaVersion': 1,
          'restaurantId': restaurantId,
          'clientRequestId': active.requestId,
          'queryGeneration': active.generation,
          'sessionId': ?sessionId,
          'queryFingerprint': ?fingerprint,
          'cursor': ?cursor,
        }),
      );
      if (_menuRequests[restaurantId] != active ||
          active.actor != _actorKey()) {
        throw StateError('Menu request changed.');
      }
      if (result['sessionId'] is String &&
          result['queryFingerprint'] is String) {
        sessionId = result['sessionId'] as String;
        fingerprint = result['queryFingerprint'] as String;
        _menuSessions[restaurantId] = (
          sessionId: sessionId,
          fingerprint: fingerprint,
        );
      }
      if (result['state'] == 'failed') {
        throw FirebaseFunctionsException(
          code: 'failed-precondition',
          message: 'The menu changed. Refresh to continue.',
        );
      }
      if (result['state'] != 'preparing') break;
      if (result['restaurantId'] != restaurantId ||
          result['sessionId'] is! String ||
          result['queryFingerprint'] is! String ||
          result['entries'] is! List ||
          (result['entries'] as List).isNotEmpty) {
        throw const FormatException('Invalid menu preparation.');
      }
      sessionId = result['sessionId'] as String;
      fingerprint = result['queryFingerprint'] as String;
      await _delay(const Duration(milliseconds: 100));
    }
    if (result['restaurantId'] != restaurantId ||
        !['available', 'absent'].contains(result['state']) ||
        !['biteScore', 'biteSaver'].contains(result['menuStyle'])) {
      throw const FormatException('Invalid BiteScore menu binding.');
    }
    final rawEntries = result['entries'];
    if (rawEntries is! List || rawEntries.length > 25) {
      throw const FormatException('Invalid menu page.');
    }
    final entries = rawEntries
        .map((raw) {
          final entry = _map(raw);
          final key = entry['key'];
          final sort = entry['sortOrder'];
          if (key is! String ||
              !RegExp(r'^bscm_[a-f0-9]{64}$').hasMatch(key) ||
              sort is! int) {
            throw const FormatException('Invalid menu entry.');
          }
          return switch (entry['kind']) {
            'image' => CustomerBiteSaverMenuImageEntry(
              key: key,
              sortOrder: sort,
              imageUrl: entry['imageUrl'] as String,
            ),
            'item' => CustomerBiteSaverMenuItemEntry(
              key: key,
              sortOrder: sort,
              name: entry['name'] as String,
              description: entry['description'] as String,
              price: entry['price'] as String,
              category: entry['category'] as String,
            ),
            'section' => CustomerBiteSaverMenuSectionEntry(
              key: key,
              sortOrder: sort,
              title: entry['title'] as String,
              body: entry['body'] as String,
            ),
            _ => throw const FormatException('Unknown menu entry.'),
          };
        })
        .toList(growable: false);
    return CustomerBiteScoreMenuPage(
      availability: result['state'] == 'available'
          ? CustomerBiteSaverMenuAvailability.available
          : CustomerBiteSaverMenuAvailability.absent,
      menuStyle: result['menuStyle'] == 'biteScore'
          ? CustomerBiteSaverMenuStyle.biteScore
          : CustomerBiteSaverMenuStyle.biteSaver,
      entries: entries,
      nextCursor: _cursor(result),
    );
  }

  static Map<String, dynamic> _map(Object? value) {
    if (value is! Map || value.keys.any((key) => key is! String)) {
      throw const FormatException('Invalid BiteScore response.');
    }
    return Map<String, dynamic>.from(value);
  }

  static List<dynamic> _items(Map<String, dynamic> value) {
    final items = value['items'];
    if (items is! List || items.length > 25) {
      throw const FormatException('Invalid BiteScore page.');
    }
    return items;
  }

  static String? _cursor(Map<String, dynamic> value) {
    final cursor = value['nextCursor'];
    if (cursor != null && (cursor is! String || cursor.isEmpty)) {
      throw const FormatException('Invalid cursor.');
    }
    return cursor as String?;
  }

  static String _identity(Object? value) {
    if (value is! String ||
        value.isEmpty ||
        value.trim() != value ||
        value.contains('/')) {
      throw const FormatException('Invalid identity.');
    }
    return value;
  }

  static double _number(Object? value) {
    if (value is! num || !value.isFinite) {
      throw const FormatException('Invalid score.');
    }
    return value.toDouble();
  }

  static double? _optionalNumber(Object? value) =>
      value == null ? null : _number(value);
  static int _count(Object? value) {
    if (value is! int || value < 0) {
      throw const FormatException('Invalid count.');
    }
    return value;
  }

  static DateTime _date(Object? value) {
    if (value is! int) throw const FormatException('Invalid date.');
    return DateTime.fromMillisecondsSinceEpoch(value);
  }
}
