import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/local_expert_badge.dart';
import '../models/local_expert_badge_calculator.dart';
import '../models/local_expert.dart';

class LocalExpertBadgeService {
  static final FirebaseFirestore _firestore = FirebaseFirestore.instance;

  static CollectionReference<Map<String, dynamic>> _badgesCollection(
    String userId,
  ) {
    return _firestore
        .collection(LocalExpertBadgePaths.userProfilesCollection)
        .doc(userId.trim())
        .collection(LocalExpertBadgePaths.badgeSubcollection);
  }

  static Future<List<LocalExpertBadge>> loadBadgesForUser(
    String? userId,
  ) async {
    final trimmedUserId = userId?.trim();
    if (trimmedUserId == null || trimmedUserId.isEmpty) {
      return const <LocalExpertBadge>[];
    }

    final snapshot = await _badgesCollection(trimmedUserId).get();
    final badges = snapshot.docs
        .map(
          (doc) => LocalExpertBadge.tryFromMap(
            doc.data(),
            fallbackExpertTypeId: doc.id,
          ),
        )
        .whereType<LocalExpertBadge>();
    return LocalExpertBadge.sortBadges(
      badges.where((badge) => LocalExperts.byId(badge.expertTypeId) != null),
    );
  }

  static Future<Map<String, List<LocalExpertBadge>>> loadBadgesForUsers(
    Iterable<String> userIds,
  ) async {
    final trimmedUserIds = userIds
        .map((userId) => userId.trim())
        .where((userId) => userId.isNotEmpty)
        .toSet();
    if (trimmedUserIds.isEmpty) {
      return const <String, List<LocalExpertBadge>>{};
    }

    final badgesByUserId = <String, List<LocalExpertBadge>>{};
    for (final userId in trimmedUserIds) {
      try {
        badgesByUserId[userId] = await loadBadgesForUser(userId);
      } catch (_) {
        badgesByUserId[userId] = const <LocalExpertBadge>[];
      }
    }

    return badgesByUserId;
  }
}
