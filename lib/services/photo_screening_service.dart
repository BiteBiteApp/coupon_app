import 'dart:convert';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import '../models/bitescore_dish_image.dart';
import 'bitescore_image_upload_service.dart';
import 'customer_bitescore_runtime.dart';

typedef ScreeningTransport =
    Future<Object?> Function(String, Map<String, Object?>);

class PhotoScreeningOutcome implements Exception {
  const PhotoScreeningOutcome(this.state);
  final String state;
  String get message => switch (state) {
    'needs_review' => 'Photograph awaiting Admin review.',
    'scanning' =>
      'Photograph is still being checked. Please try again shortly.',
    'rejected' => 'Photograph was not accepted.',
    'removed' => 'This photograph is no longer available.',
    _ => 'Photograph could not be checked right now. Please try again later.',
  };
  @override
  String toString() => message;
}

class PhotoScreeningService {
  PhotoScreeningService({
    ScreeningTransport? transport,
    String? Function()? currentUserId,
  }) : _transport = transport ?? _call,
       _currentUserId =
           currentUserId ?? (() => FirebaseAuth.instance.currentUser?.uid);
  static const enabled = bool.fromEnvironment(
    'BITESCORE_PHOTO_SCREENING',
    defaultValue: false,
  );
  @visibleForTesting
  static bool? debugEnabled;
  static bool get isEnabled =>
      (debugEnabled ?? enabled) && CustomerBiteScoreRuntime.isEnabled;
  final ScreeningTransport _transport;
  final String? Function() _currentUserId;
  static Future<Object?> _call(String name, Map<String, Object?> data) async =>
      (await FirebaseFunctions.instanceFor(region: 'us-central1')
              .httpsCallable(
                name,
                options: HttpsCallableOptions(
                  timeout: const Duration(seconds: 70),
                ),
              )
              .call<Object?>(data))
          .data;
  bool isCurrent(String uid) => _currentUserId() == uid;

  void _requireActor(String uid) {
    if (_currentUserId() != uid) {
      throw StateError('The signed-in account changed.');
    }
  }

  Future<Map> request(
    String name,
    String uid,
    Map<String, Object?> data,
  ) async {
    _requireActor(uid);
    final result = await _transport(name, {
      'schemaVersion': 1,
      'expectedUserId': uid,
      ...data,
    });
    _requireActor(uid);
    if (result is! Map || result['schemaVersion'] != 1) {
      throw const FormatException('Invalid screening response.');
    }
    return result;
  }

  Future<BiteScoreDishImage> submit({
    required String expectedUid,
    required String dishId,
    required String restaurantId,
    required String mode,
    String? reviewId,
    required BiteScorePickedDishImage pickedImage,
    bool retry = true,
  }) async {
    if (pickedImage.bytes.isEmpty ||
        pickedImage.bytes.length > 5 * 1024 * 1024) {
      throw ArgumentError('Choose a photograph up to 5 MB.');
    }
    final name = pickedImage.fileName.toLowerCase();
    final result = await request('submitScreenedBiteScorePhoto', expectedUid, {
      'dishId': dishId,
      'restaurantId': restaurantId,
      'reviewId': reviewId,
      'mode': mode,
      'contentType': name.endsWith('.png')
          ? 'image/png'
          : name.endsWith('.webp')
          ? 'image/webp'
          : 'image/jpeg',
      'bytesBase64': base64Encode(pickedImage.bytes),
      'retry': retry,
    });
    final state = result['state'];
    if (!const [
          'approved',
          'needs_review',
          'scanning',
          'failed',
          'rejected',
          'removed',
        ].contains(state) ||
        result['imageId'] is! String) {
      throw const FormatException('Invalid screening status.');
    }
    if (state != 'approved') {
      throw PhotoScreeningOutcome(state as String);
    }
    final image = result['image'];
    if (image is! Map ||
        image['id'] != result['imageId'] ||
        image['dishId'] != dishId ||
        image['restaurantId'] != restaurantId ||
        image['reviewId'] != reviewId ||
        image['imageUrl'] is! String ||
        !(image['imageUrl'] as String).startsWith('https://') ||
        image['reportTargetVersion'] is! String ||
        image['helpfulCount'] is! int ||
        image['notHelpfulCount'] is! int) {
      throw const FormatException('Invalid screened photo identity.');
    }
    return BiteScoreDishImage(
      id: image['id'] as String,
      dishId: dishId,
      restaurantId: restaurantId,
      reviewId: reviewId,
      uploadedByUserId: expectedUid,
      storagePath: '',
      imageUrl: image['imageUrl'] as String,
      reportTargetVersion: image['reportTargetVersion'] as String,
      helpfulCount: image['helpfulCount'] as int,
      notHelpfulCount: image['notHelpfulCount'] as int,
    );
  }
}
