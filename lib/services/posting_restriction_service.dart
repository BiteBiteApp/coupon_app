import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';

import 'photo_report_service.dart' show PhotoReportService;

class PostingRestrictedException extends ArgumentError {
  PostingRestrictedException(super.message);
}

class PostingRestrictionStatus {
  PostingRestrictionStatus._(
    this.status,
    this.revision,
    this.kind,
    this.endsAt,
    this.targetUserId,
    this.operatorUserId,
  );
  final String status;
  final int revision;
  final String? kind;
  final DateTime? endsAt;
  final String? targetUserId;
  final String? operatorUserId;
  bool get active => status == 'active';
  factory PostingRestrictionStatus.parse(
    Object? value, {
    String? operatorUserId,
  }) {
    if (value is! Map ||
        value['schemaVersion'] != 1 ||
        !['none', 'active', 'expired', 'released'].contains(value['status']) ||
        value['revision'] is! int ||
        (value['revision'] as int) < 0 ||
        ![null, '7d', '14d', 'indefinite'].contains(value['kind']) ||
        (value['endsAtMillis'] != null && value['endsAtMillis'] is! int) ||
        (value['targetUserId'] != null && value['targetUserId'] is! String)) {
      throw const FormatException('Invalid posting status response.');
    }
    final kind = value['kind'] as String?;
    final status = value['status'] as String;
    if ((status == 'none') != (kind == null) ||
        (kind == '7d' || kind == '14d') != (value['endsAtMillis'] != null)) {
      throw const FormatException('Invalid posting restriction period.');
    }
    return PostingRestrictionStatus._(
      status,
      value['revision'] as int,
      kind,
      value['endsAtMillis'] == null
          ? null
          : DateTime.fromMillisecondsSinceEpoch(
              value['endsAtMillis'] as int,
              isUtc: true,
            ),
      value['targetUserId'] as String?,
      operatorUserId,
    );
  }
  String get message => active
      ? postingRestrictionMessage(endsAt?.millisecondsSinceEpoch)
      : switch (status) {
          'expired' => 'Posting restriction expired. Posting is allowed.',
          'released' => 'Posting restriction released. Posting is allowed.',
          _ => 'No posting restriction.',
        };
}

String postingRestrictionMessage(int? endsAtMillis) {
  if (endsAtMillis == null) {
    return 'Your public posting is restricted until an administrator releases it. You can still browse, use eligible coupons, and manage your account.';
  }
  // UTC is explicit: no claim of expiry is calculated using the phone clock.
  final end = DateTime.fromMillisecondsSinceEpoch(endsAtMillis, isUtc: true);
  return 'Your public posting is restricted until ${end.toIso8601String().replaceFirst('T', ' ').replaceFirst('.000Z', ' UTC')}. You can still browse, use eligible coupons, and manage your account.';
}

class PostingRestrictionService {
  PostingRestrictionService({
    Future<Object?> Function(String, Map<String, Object?>)? boundary,
    User? Function()? currentUser,
  }) : _boundary = boundary ?? _call,
       _currentUser = currentUser ?? (() => FirebaseAuth.instance.currentUser);
  final Future<Object?> Function(String, Map<String, Object?>) _boundary;
  final User? Function() _currentUser;
  // Coordinated release prerequisite for client preflight; server/Rules
  // enforcement does not depend on a build flag.
  static const _configured = bool.fromEnvironment(
    'BITESCORE_POSTING_RESTRICTIONS',
    defaultValue: false,
  );
  @visibleForTesting
  static bool? testEnabled;
  static bool get customerEnabled => testEnabled ?? _configured;

  void _check(String uid) {
    final user = _currentUser();
    if (user == null || user.isAnonymous || user.uid != uid) {
      throw ArgumentError('The signed-in account changed. Please try again.');
    }
  }

  Future<PostingRestrictionStatus> _request(
    String name,
    String uid,
    Map<String, Object?> data,
  ) async {
    _check(uid);
    Object? response;
    try {
      response = await _boundary(name, {
        'schemaVersion': 1,
        'expectedUserId': uid,
        ...data,
      });
    } catch (_) {
      _check(uid);
      rethrow;
    }
    _check(uid);
    return PostingRestrictionStatus.parse(response, operatorUserId: uid);
  }

  Future<void> requireAllowed(String expectedUserId) async {
    if (!customerEnabled) return;
    final status = await _request(
      'getCustomerPostingStatus',
      expectedUserId,
      {},
    );
    if (status.active) throw PostingRestrictedException(status.message);
  }

  Future<PostingRestrictionStatus> inspect({
    String? reportId,
    String? targetUserId,
  }) async {
    final uid = _currentUser()?.uid ?? '';
    final result = await _request('getAdminPostingRestriction', uid, {
      'reportId': reportId,
      'targetUserId': targetUserId,
    });
    if (result.targetUserId == null ||
        result.targetUserId!.isEmpty ||
        (targetUserId != null && result.targetUserId != targetUserId)) {
      throw const FormatException('Invalid contributor identity.');
    }
    return result;
  }

  Future<PostingRestrictionStatus> change({
    required PostingRestrictionStatus current,
    required String action,
    String? reportId,
  }) async {
    final uid = current.operatorUserId ?? '';
    final result = await _request('setAdminPostingRestriction', uid, {
      'reportId': reportId,
      'targetUserId': current.targetUserId,
      'expectedRevision': current.revision,
      'action': action,
      'requestId': PhotoReportService.newRequestId(),
    });
    if (result.targetUserId != current.targetUserId) {
      throw const FormatException('Contributor identity changed.');
    }
    return result;
  }

  static Future<Object?> _call(String name, Map<String, Object?> data) async =>
      (await FirebaseFunctions.instance.httpsCallable(name).call<Object?>(data))
          .data;
}
