import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:coupon_app/services/customer_bitescore_runtime.dart';
import 'package:coupon_app/services/reviewer_safety_service.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_test/flutter_test.dart';

class SafetyUser extends Fake implements User {
  @override
  final String uid;
  @override
  final bool isAnonymous;
  @override
  final bool emailVerified;
  @override
  String? get email => '$uid@example.test';
  @override
  String? get displayName => uid;
  SafetyUser(this.uid, {this.isAnonymous = false, this.emailVerified = false});
}

void main() {
  setUp(() {
    CustomerBiteScoreRuntime.testEnabled = true;
    ReviewerSafetyCustomerUi.testEnabled = true;
  });
  tearDown(() {
    CustomerBiteScoreRuntime.testEnabled = null;
    ReviewerSafetyCustomerUi.testEnabled = null;
  });
  test(
    'separate default gate denies every operation; bounded mode alone never activates calls',
    () async {
      ReviewerSafetyCustomerUi.testEnabled = null;
      var calls = 0;
      final service = ReviewerSafetyService(
        currentUser: () => SafetyUser('A'),
        boundary: (_, _) async {
          calls++;
          return null;
        },
        pageReader: (_, _) async {
          calls++;
          return const BlockedReviewerPage([], null);
        },
      );
      for (final bounded in [false, true]) {
        CustomerBiteScoreRuntime.testEnabled = bounded;
        expect(ReviewerSafetyCustomerUi.isEnabled, false);
        await expectLater(
          service.status(
            expectedUserId: 'A',
            targetUserId: 'B',
            leaseIsCurrent: () => true,
          ),
          throwsStateError,
        );
        await expectLater(
          service.block(
            expectedUserId: 'A',
            targetUserId: 'B',
            expectedRevision: 0,
            supportingReviewId: 'r',
            leaseIsCurrent: () => true,
          ),
          throwsStateError,
        );
        await expectLater(
          service.unblock(
            expectedUserId: 'A',
            targetUserId: 'B',
            expectedRevision: 0,
            leaseIsCurrent: () => true,
          ),
          throwsStateError,
        );
        await expectLater(
          service.blockedReviewers(
            expectedUserId: 'A',
            leaseIsCurrent: () => true,
          ),
          throwsStateError,
        );
      }
      ReviewerSafetyCustomerUi.testEnabled = true;
      CustomerBiteScoreRuntime.testEnabled = false;
      expect(ReviewerSafetyCustomerUi.isEnabled, false);
      expect(calls, 0);
    },
  );
  test(
    'exact status/block/unblock envelopes accept real unverified accounts, never report or delete',
    () async {
      final calls = <String, Map<String, Object?>>{};
      final service = ReviewerSafetyService(
        currentUser: () => SafetyUser('A'),
        boundary: (name, request) async {
          calls[name] = request;
          return {
            'schemaVersion': 1,
            'targetUserId': 'B',
            'blocked': name == 'blockReviewer',
            'revision': 7,
          };
        },
      );
      await service.status(
        expectedUserId: 'A',
        targetUserId: 'B',
        leaseIsCurrent: () => true,
      );
      await service.block(
        expectedUserId: 'A',
        targetUserId: 'B',
        expectedRevision: 6,
        supportingReviewId: 'real-review',
        leaseIsCurrent: () => true,
      );
      await service.unblock(
        expectedUserId: 'A',
        targetUserId: 'B',
        expectedRevision: 7,
        leaseIsCurrent: () => true,
      );
      const identity = {
        'schemaVersion': 1,
        'expectedUserId': 'A',
        'targetUserId': 'B',
      };
      expect(calls, {
        'getReviewerSafetyStatus': identity,
        'blockReviewer': {
          ...identity,
          'expectedRevision': 6,
          'supportingReviewId': 'real-review',
        },
        'unblockReviewer': {...identity, 'expectedRevision': 7},
      });
    },
  );
  test(
    'cache notifications require a validated response and current account lease',
    () async {
      User? user = SafetyUser('A');
      var lease = true;
      var pending = Completer<Object?>();
      final changes = <ReviewerSafetyChange>[];
      void listener() => changes.add(ReviewerSafetyService.changes.value!);
      ReviewerSafetyService.changes.addListener(listener);
      addTearDown(() => ReviewerSafetyService.changes.removeListener(listener));
      final service = ReviewerSafetyService(
        currentUser: () => user,
        boundary: (_, _) => pending.future,
      );
      Future<ReviewerSafetyStatus> unblock() => service.unblock(
        expectedUserId: 'A',
        targetUserId: 'B',
        expectedRevision: 1,
        leaseIsCurrent: () => lease,
      );
      const result = {
        'schemaVersion': 1,
        'targetUserId': 'B',
        'blocked': false,
        'revision': 2,
      };
      var operation = unblock();
      user = SafetyUser('C');
      pending.complete(result);
      await expectLater(operation, throwsStateError);
      expect(changes, isEmpty);
      user = SafetyUser('A');
      pending = Completer<Object?>();
      operation = unblock();
      lease = false;
      pending.complete(result);
      await expectLater(operation, throwsStateError);
      expect(changes, isEmpty);
      lease = true;
      pending = Completer<Object?>();
      operation = unblock();
      pending.complete({...result, 'targetUserId': 'forged'});
      await expectLater(operation, throwsFormatException);
      expect(changes, isEmpty);
      pending = Completer<Object?>();
      operation = unblock();
      pending.complete(result);
      await operation;
      expect(changes.single.viewerUserId, 'A');
      expect(changes.single.targetUserId, 'B');
    },
  );

  test(
    'self, guest, wrong account and expired lease dispatch no requests',
    () async {
      User? user = SafetyUser('A');
      var lease = true;
      var calls = 0;
      final service = ReviewerSafetyService(
        currentUser: () => user,
        boundary: (_, _) async {
          calls++;
          return null;
        },
      );
      await expectLater(
        service.status(
          expectedUserId: 'A',
          targetUserId: 'A',
          leaseIsCurrent: () => lease,
        ),
        throwsArgumentError,
      );
      for (final next in [
        null,
        SafetyUser('anonymous', isAnonymous: true),
        SafetyUser('B'),
      ]) {
        user = next;
        await expectLater(
          service.status(
            expectedUserId: 'A',
            targetUserId: 'B',
            leaseIsCurrent: () => lease,
          ),
          throwsStateError,
        );
      }
      user = SafetyUser('A');
      lease = false;
      await expectLater(
        service.status(
          expectedUserId: 'A',
          targetUserId: 'B',
          leaseIsCurrent: () => lease,
        ),
        throwsStateError,
      );
      expect(calls, 0);
    },
  );
  for (final switchAccount in [true, false]) {
    test(
      'late response is discarded after ${switchAccount ? 'account switch' : 'same-UID lease retirement'}',
      () async {
        User? user = SafetyUser('A');
        var lease = true;
        final pending = Completer<Object?>();
        final service = ReviewerSafetyService(
          currentUser: () => user,
          boundary: (_, _) => pending.future,
        );
        final operation = service.status(
          expectedUserId: 'A',
          targetUserId: 'B',
          leaseIsCurrent: () => lease,
        );
        final rejected = expectLater(operation, throwsStateError);
        if (switchAccount) {
          user = SafetyUser('C');
        } else {
          lease = false;
        }
        pending.complete({
          'schemaVersion': 1,
          'targetUserId': 'B',
          'blocked': false,
          'revision': 0,
        });
        await rejected;
      },
    );
  }
  test(
    'revision conflict is exposed once without an automatic overwrite/retry',
    () async {
      var calls = 0;
      final service = ReviewerSafetyService(
        currentUser: () => SafetyUser('A'),
        boundary: (_, _) async {
          calls++;
          throw FirebaseFunctionsException(
            code: 'failed-precondition',
            message: 'Changed',
          );
        },
      );
      await expectLater(
        service.block(
          expectedUserId: 'A',
          targetUserId: 'B',
          expectedRevision: 1,
          supportingReviewId: 'r',
          leaseIsCurrent: () => true,
        ),
        throwsA(isA<FirebaseFunctionsException>()),
      );
      expect(calls, 1);
      expect(
        ReviewerSafetyService.errorMessage(
          FirebaseFunctionsException(
            code: 'failed-precondition',
            message: 'Changed',
          ),
        ),
        contains('Refresh'),
      );
    },
  );
  test('malformed target and revision responses fail closed', () async {
    for (final response in [
      null,
      {
        'schemaVersion': 1,
        'targetUserId': 'wrong',
        'blocked': true,
        'revision': 1,
      },
      {
        'schemaVersion': 1,
        'targetUserId': 'B',
        'blocked': true,
        'revision': -1,
      },
    ]) {
      final service = ReviewerSafetyService(
        currentUser: () => SafetyUser('A'),
        boundary: (_, _) async => response,
      );
      await expectLater(
        service.status(
          expectedUserId: 'A',
          targetUserId: 'B',
          leaseIsCurrent: () => true,
        ),
        throwsFormatException,
      );
    }
  });
  test(
    'private Firestore list uses owner path, stable UID ordering, 26 lookahead and last selected cursor',
    () async {
      final db = SafetyFirestore();
      final service = ReviewerSafetyService(
        currentUser: () => SafetyUser('A'),
        firestore: db,
      );
      final first = await service.blockedReviewers(
        expectedUserId: 'A',
        leaseIsCurrent: () => true,
      );
      expect(first.items.length, 25);
      expect(first.nextCursor, 'reviewer-24');
      await service.blockedReviewers(
        expectedUserId: 'A',
        afterUserId: first.nextCursor,
        leaseIsCurrent: () => true,
      );
      expect(db.log, [
        'collection:user_profiles',
        'doc:A',
        'collection:blocked_reviewers',
        'orderBy:documentId',
        'limit:26',
        'get',
        'collection:user_profiles',
        'doc:A',
        'collection:blocked_reviewers',
        'orderBy:documentId',
        'limit:26',
        'after:[reviewer-24]',
        'get',
      ]);
    },
  );
  test('private page result cannot outlive its account', () async {
    User? user = SafetyUser('A');
    final pending = Completer<BlockedReviewerPage>();
    final service = ReviewerSafetyService(
      currentUser: () => user,
      pageReader: (uid, cursor) {
        expect(uid, 'A');
        return pending.future;
      },
    );
    final rejected = expectLater(
      service.blockedReviewers(expectedUserId: 'A', leaseIsCurrent: () => true),
      throwsStateError,
    );
    user = SafetyUser('B');
    pending.complete(
      const BlockedReviewerPage([BlockedReviewer('private')], null),
    );
    await rejected;
  });
}

class SafetyFirestore extends Fake implements FirebaseFirestore {
  final log = <String>[];
  @override
  CollectionReference<Map<String, dynamic>> collection(String path) {
    log.add('collection:$path');
    return _Collection(log);
  }
}

// Test-only SDK double; no network or emulator is used.
// ignore: subtype_of_sealed_class
class _Collection extends Fake
    implements CollectionReference<Map<String, dynamic>> {
  final List<String> log;
  _Collection(this.log);
  @override
  DocumentReference<Map<String, dynamic>> doc([String? path]) {
    log.add('doc:$path');
    return _Document(log);
  }

  @override
  Query<Map<String, dynamic>> orderBy(Object field, {bool descending = false}) {
    expect(field, FieldPath.documentId);
    expect(descending, false);
    log.add('orderBy:documentId');
    return _Query(log);
  }
}

// Test-only SDK double; no network or emulator is used.
// ignore: subtype_of_sealed_class
class _Document extends Fake
    implements DocumentReference<Map<String, dynamic>> {
  final List<String> log;
  _Document(this.log);
  @override
  CollectionReference<Map<String, dynamic>> collection(String path) {
    log.add('collection:$path');
    return _Collection(log);
  }
}

// Test-only SDK double; no network or emulator is used.
// ignore: subtype_of_sealed_class
class _Query extends Fake implements Query<Map<String, dynamic>> {
  final List<String> log;
  _Query(this.log);
  @override
  Query<Map<String, dynamic>> limit(int limit) {
    log.add('limit:$limit');
    return this;
  }

  @override
  Query<Map<String, dynamic>> startAfter(Iterable<Object?> values) {
    log.add('after:$values');
    return this;
  }

  @override
  Future<QuerySnapshot<Map<String, dynamic>>> get([GetOptions? options]) async {
    log.add('get');
    return _Snapshot();
  }
}

class _Snapshot extends Fake implements QuerySnapshot<Map<String, dynamic>> {
  @override
  List<QueryDocumentSnapshot<Map<String, dynamic>>> get docs =>
      List.generate(26, (i) => _Row(i));
}

// Test-only SDK double; no network or emulator is used.
// ignore: subtype_of_sealed_class
class _Row extends Fake implements QueryDocumentSnapshot<Map<String, dynamic>> {
  final int index;
  _Row(this.index);
  @override
  String get id => 'reviewer-${index.toString().padLeft(2, '0')}';
  @override
  Map<String, dynamic> data() => {
    'schemaVersion': 1,
    'targetUserId': id,
    'createdAt': Timestamp.fromMillisecondsSinceEpoch(1),
  };
}
