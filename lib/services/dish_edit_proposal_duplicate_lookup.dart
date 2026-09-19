import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/dish_edit_proposal.dart';

/// Complete existence predicates for modern proposal writers. These checks are
/// preflights; they do not provide uniqueness between concurrent submissions.
abstract final class DishEditProposalDuplicateLookup {
  static Query<Map<String, dynamic>> _renameScope(
    Query<Map<String, dynamic>> proposals, {
    required String userId,
    required String restaurantId,
    required String sourceDishId,
  }) => proposals
      .where('userId', isEqualTo: userId)
      .where('status', isEqualTo: 'pending')
      .where('type', isEqualTo: DishEditProposal.typeRename)
      .where('restaurantId', isEqualTo: restaurantId)
      .where('canonicalSourceDishId', isEqualTo: sourceDishId);

  static Future<bool> renameExists(
    Query<Map<String, dynamic>> proposals, {
    required String userId,
    required String restaurantId,
    required String sourceDishId,
    required String proposedName,
  }) async {
    final normalizedName = proposedName.trim().toLowerCase();
    if (utf8.encode(normalizedName).length < 1500) {
      final result = await rename(
        proposals,
        userId: userId,
        restaurantId: restaurantId,
        sourceDishId: sourceDishId,
        proposedName: proposedName,
      ).get();
      return result.docs.isNotEmpty;
    }

    // Firestore truncates indexed strings after 1500 bytes; even an exact
    // 1500-byte name can collide with a longer indexed prefix. Existing rename
    // input has no length cap, so compare the complete stored name while
    // advancing through bounded pages of the exact remaining predicate.
    final scoped = _renameScope(
      proposals,
      userId: userId,
      restaurantId: restaurantId,
      sourceDishId: sourceDishId,
    ).orderBy(FieldPath.documentId).limit(25);
    QueryDocumentSnapshot<Map<String, dynamic>>? after;
    while (true) {
      final page =
          await (after == null ? scoped : scoped.startAfterDocument(after))
              .get();
      if (page.docs.any(
        (doc) => doc.data()['normalizedProposedName'] == normalizedName,
      )) {
        return true;
      }
      if (page.docs.length < 25) return false;
      after = page.docs.last;
    }
  }

  static Query<Map<String, dynamic>> rename(
    Query<Map<String, dynamic>> proposals, {
    required String userId,
    required String restaurantId,
    required String sourceDishId,
    required String proposedName,
  }) {
    return _renameScope(
          proposals,
          userId: userId,
          restaurantId: restaurantId,
          sourceDishId: sourceDishId,
        )
        .where(
          'normalizedProposedName',
          isEqualTo: proposedName.trim().toLowerCase(),
        )
        .limit(1);
  }

  static Query<Map<String, dynamic>> merge(
    Query<Map<String, dynamic>> proposals, {
    required String userId,
    required String restaurantId,
    required String sourceDishId,
    required String mergeTargetDishId,
  }) {
    return proposals
        .where('userId', isEqualTo: userId)
        .where('status', isEqualTo: 'pending')
        .where('type', isEqualTo: DishEditProposal.typeMerge)
        .where('restaurantId', isEqualTo: restaurantId)
        .where('canonicalSourceDishId', isEqualTo: sourceDishId)
        .where('mergeTargetDishId', isEqualTo: mergeTargetDishId)
        .limit(1);
  }
}
