import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';

import 'customer_bitescore_runtime.dart';

/// Separate coordinated rollout gate. Bounded reads alone never activate safety
/// mutations, and legacy reads cannot safely host these customer controls.
abstract final class ReviewerSafetyCustomerUi {
  static const bool _configured = bool.fromEnvironment(
    'REVIEWER_SAFETY_CUSTOMER_UI',
    defaultValue: false,
  );
  @visibleForTesting
  static bool? testEnabled;
  static bool get isEnabled =>
      (testEnabled ?? _configured) && CustomerBiteScoreRuntime.isEnabled;
}

/// A local cache invalidation, never an authorization or stored preference.
class ReviewerSafetyChange {
  const ReviewerSafetyChange(this.viewerUserId, this.targetUserId);
  final String viewerUserId;
  final String targetUserId;
}

class ReviewerSafetyStatus {
  final String targetUserId;
  final bool blocked;
  final int revision;
  const ReviewerSafetyStatus(this.targetUserId, this.blocked, this.revision);
}

class BlockedReviewer {
  final String targetUserId;
  const BlockedReviewer(this.targetUserId);
}

class BlockedReviewerPage {
  final List<BlockedReviewer> items;
  final String? nextCursor;
  const BlockedReviewerPage(this.items, this.nextCursor);
}

typedef ReviewerSafetyBoundary =
    Future<Object?> Function(String name, Map<String, Object?> request);
typedef ReviewerSafetyPageReader =
    Future<BlockedReviewerPage> Function(String userId, String? afterUserId);

/// Private operations pin the account and the caller's existing navigation lease
/// on both sides of every asynchronous boundary. No automatic mutation retries.
class ReviewerSafetyService {
  ReviewerSafetyService({
    ReviewerSafetyBoundary? boundary,
    ReviewerSafetyPageReader? pageReader,
    FirebaseFirestore? firestore,
    User? Function()? currentUser,
  }) : _boundary = boundary ?? _call,
       _pageReader =
           pageReader ??
           ((uid, after) =>
               _readPage(firestore ?? FirebaseFirestore.instance, uid, after)),
       _currentUser = currentUser ?? (() => FirebaseAuth.instance.currentUser);

  static final _changes = ValueNotifier<ReviewerSafetyChange?>(null);
  static ValueListenable<ReviewerSafetyChange?> get changes => _changes;

  void notifyPreferencesChanged({
    required String expectedUserId,
    required String targetUserId,
    required bool Function() leaseIsCurrent,
  }) {
    _check(expectedUserId, leaseIsCurrent);
    _changes.value = ReviewerSafetyChange(expectedUserId, targetUserId);
  }

  static const pageSize = 25;
  final ReviewerSafetyBoundary _boundary;
  final ReviewerSafetyPageReader _pageReader;
  final User? Function() _currentUser;

  void _check(String expectedUserId, bool Function() leaseIsCurrent) {
    if (!ReviewerSafetyCustomerUi.isEnabled || !leaseIsCurrent()) {
      throw StateError('Reviewer safety session changed.');
    }
    final user = _currentUser();
    if (user == null || user.isAnonymous || user.uid != expectedUserId) {
      throw StateError('Reviewer safety session changed.');
    }
  }

  Future<ReviewerSafetyStatus> _invoke(
    String name, {
    required String expectedUserId,
    required String targetUserId,
    required bool Function() leaseIsCurrent,
    int? expectedRevision,
    String? supportingReviewId,
  }) async {
    _check(expectedUserId, leaseIsCurrent);
    if (targetUserId.isEmpty || targetUserId == expectedUserId) {
      throw ArgumentError('Invalid reviewer.');
    }
    final Object? result;
    try {
      result = await _boundary(name, {
        'schemaVersion': 1,
        'expectedUserId': expectedUserId,
        'targetUserId': targetUserId,
        'expectedRevision': ?expectedRevision,
        if (name == 'blockReviewer') 'supportingReviewId': supportingReviewId,
      });
    } catch (_) {
      _check(expectedUserId, leaseIsCurrent);
      rethrow;
    }
    _check(expectedUserId, leaseIsCurrent);
    if (result is! Map ||
        result['schemaVersion'] != 1 ||
        result['targetUserId'] != targetUserId ||
        result['blocked'] is! bool ||
        result['revision'] is! int ||
        (result['revision'] as int) < 0) {
      throw const FormatException('Invalid reviewer safety response.');
    }
    if (name == 'blockReviewer' || name == 'unblockReviewer') {
      notifyPreferencesChanged(
        expectedUserId: expectedUserId,
        targetUserId: targetUserId,
        leaseIsCurrent: leaseIsCurrent,
      );
    }
    return ReviewerSafetyStatus(
      targetUserId,
      result['blocked'] as bool,
      result['revision'] as int,
    );
  }

  Future<ReviewerSafetyStatus> status({
    required String expectedUserId,
    required String targetUserId,
    required bool Function() leaseIsCurrent,
  }) => _invoke(
    'getReviewerSafetyStatus',
    expectedUserId: expectedUserId,
    targetUserId: targetUserId,
    leaseIsCurrent: leaseIsCurrent,
  );

  Future<ReviewerSafetyStatus> block({
    required String expectedUserId,
    required String targetUserId,
    required int expectedRevision,
    required String supportingReviewId,
    required bool Function() leaseIsCurrent,
  }) => _invoke(
    'blockReviewer',
    expectedUserId: expectedUserId,
    targetUserId: targetUserId,
    expectedRevision: expectedRevision,
    supportingReviewId: supportingReviewId,
    leaseIsCurrent: leaseIsCurrent,
  );

  Future<ReviewerSafetyStatus> unblock({
    required String expectedUserId,
    required String targetUserId,
    required int expectedRevision,
    required bool Function() leaseIsCurrent,
  }) => _invoke(
    'unblockReviewer',
    expectedUserId: expectedUserId,
    targetUserId: targetUserId,
    expectedRevision: expectedRevision,
    leaseIsCurrent: leaseIsCurrent,
  );

  Future<BlockedReviewerPage> blockedReviewers({
    required String expectedUserId,
    required bool Function() leaseIsCurrent,
    String? afterUserId,
  }) async {
    _check(expectedUserId, leaseIsCurrent);
    final BlockedReviewerPage page;
    try {
      page = await _pageReader(expectedUserId, afterUserId);
    } catch (_) {
      _check(expectedUserId, leaseIsCurrent);
      rethrow;
    }
    _check(expectedUserId, leaseIsCurrent);
    if (page.items.length > pageSize) {
      throw const FormatException('Invalid blocked reviewer page.');
    }
    return page;
  }

  static Future<Object?> _call(
    String name,
    Map<String, Object?> request,
  ) async => (await FirebaseFunctions.instanceFor(
    region: 'us-central1',
  ).httpsCallable(name).call<Object?>(request)).data;

  static Future<BlockedReviewerPage> _readPage(
    FirebaseFirestore firestore,
    String userId,
    String? afterUserId,
  ) async {
    Query<Map<String, dynamic>> query = firestore
        .collection('user_profiles')
        .doc(userId)
        .collection('blocked_reviewers')
        .orderBy(FieldPath.documentId)
        .limit(pageSize + 1);
    if (afterUserId != null) query = query.startAfter([afterUserId]);
    final snapshot = await query.get();
    final selected = snapshot.docs.take(pageSize).toList();
    final items = selected
        .map((document) {
          final value = document.data();
          if (value['schemaVersion'] != 1 ||
              value['targetUserId'] != document.id ||
              value['createdAt'] is! Timestamp) {
            throw const FormatException('Invalid blocked reviewer record.');
          }
          return BlockedReviewer(document.id);
        })
        .toList(growable: false);
    return BlockedReviewerPage(
      items,
      snapshot.docs.length > pageSize ? selected.last.id : null,
    );
  }

  static String errorMessage(Object error) =>
      error is FirebaseFunctionsException && error.code == 'failed-precondition'
      ? 'Reviewer preferences changed. Refresh and try again.'
      : 'Could not update reviewer preferences. Please try again.';
}
