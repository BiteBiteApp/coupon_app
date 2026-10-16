import 'dart:math';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';

import '../models/bitescore_dish_image.dart';
import 'customer_bitescore_runtime.dart';

/// Requires the coordinated photo-report backend/Rules release, independently
/// of personal reviewer blocking. Normal customer builds remain unchanged.
abstract final class PhotoReportingUi {
  static const _configured = bool.fromEnvironment(
    'BITESCORE_PHOTO_REPORTING',
    defaultValue: false,
  );
  @visibleForTesting
  static bool? testEnabled;
  static bool get isEnabled =>
      (testEnabled ?? _configured) && CustomerBiteScoreRuntime.isEnabled;
}

typedef PhotoReportBoundary =
    Future<Object?> Function(String name, Map<String, Object?> request);

class PhotoReportService {
  PhotoReportService({
    PhotoReportBoundary? boundary,
    User? Function()? currentUser,
  }) : _boundary = boundary ?? _call,
       _currentUser = currentUser ?? (() => FirebaseAuth.instance.currentUser);

  final PhotoReportBoundary _boundary;
  final User? Function() _currentUser;
  static String newRequestId() {
    final random = Random.secure();
    return List.generate(
      24,
      (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'),
    ).join();
  }

  void _check(String uid, bool Function() current) {
    final user = _currentUser();
    if (!current() || user == null || user.isAnonymous || user.uid != uid) {
      throw StateError('The signed-in account changed. Please try again.');
    }
  }

  Future<bool> submit({
    required BiteScoreDishImage image,
    required String reason,
    required String requestId,
    required String expectedUserId,
    required bool Function() leaseIsCurrent,
  }) async {
    if (!PhotoReportingUi.isEnabled) {
      throw StateError('Photo reporting is not available yet.');
    }
    if (image.reportTargetVersion == null ||
        !RegExp(r'^[a-f0-9]{64}$').hasMatch(image.reportTargetVersion!)) {
      throw StateError('Please refresh the photos before reporting.');
    }
    _check(expectedUserId, leaseIsCurrent);
    final result = await _boundary('submitPhotoReport', {
      'schemaVersion': 1,
      'expectedUserId': expectedUserId,
      'imageId': image.id,
      'reportTargetVersion': image.reportTargetVersion,
      'dishId': image.dishId,
      'restaurantId': image.restaurantId,
      'reason': reason,
      'requestId': requestId,
    });
    _check(expectedUserId, leaseIsCurrent);
    if (result is! Map ||
        result['schemaVersion'] != 1 ||
        result['imageId'] != image.id ||
        result['reportId'] is! String ||
        (result['reportId'] as String).isEmpty ||
        result['submitted'] is! bool) {
      throw const FormatException('Invalid photo report response.');
    }
    return result['submitted'] as bool;
  }

  Future<void> moderate({
    required String reportId,
    required String imageId,
    required String action,
  }) async {
    final uid = _currentUser()?.uid ?? '';
    _check(uid, () => true);
    final result = await _boundary('moderatePhotoReport', {
      'schemaVersion': 1,
      'expectedUserId': uid,
      'reportId': reportId,
      'imageId': imageId,
      'action': action,
    });
    _check(uid, () => true);
    if (result is! Map ||
        result['schemaVersion'] != 1 ||
        result['reportId'] != reportId ||
        result['imageId'] != imageId ||
        result['status'] != (action == 'dismiss' ? 'dismissed' : 'resolved')) {
      throw const FormatException('Invalid photo moderation response.');
    }
  }

  static Future<Object?> _call(String name, Map<String, Object?> data) async =>
      (await FirebaseFunctions.instance.httpsCallable(name).call<Object?>(data))
          .data;
}
