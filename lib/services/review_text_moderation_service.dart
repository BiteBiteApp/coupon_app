import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'customer_bitescore_runtime.dart';

class ReviewTextModerationService {
  ReviewTextModerationService({
    Future<Object?> Function(String, Map<String, Object?>)? transport,
    String? Function()? currentUserId,
  }) : _transport = transport ?? _call,
       _currentUserId =
           currentUserId ?? (() => FirebaseAuth.instance.currentUser?.uid);
  static const enabled = bool.fromEnvironment(
    'BITESCORE_REVIEW_TEXT_MODERATION',
    defaultValue: false,
  );
  @visibleForTesting
  static bool? debugEnabled;
  static bool get isEnabled =>
      (debugEnabled ?? enabled) && CustomerBiteScoreRuntime.isEnabled;
  final Future<Object?> Function(String, Map<String, Object?>) _transport;
  final String? Function() _currentUserId;
  static Future<Object?> _call(String name, Map<String, Object?> data) async =>
      (await FirebaseFunctions.instance.httpsCallable(name).call<Object?>(data))
          .data;
  bool isCurrent(String uid) => _currentUserId() == uid;
  Future<Map> request(
    String name,
    String uid,
    Map<String, Object?> data,
  ) async {
    if (!isCurrent(uid)) throw StateError('The signed-in account changed.');
    final response = await _transport(name, {
      ...data,
      'schemaVersion': 1,
      'expectedUserId': uid,
    });
    if (!isCurrent(uid)) throw StateError('The signed-in account changed.');
    if (response is! Map || response['schemaVersion'] != 1) {
      throw const FormatException('Invalid review text response.');
    }
    return response;
  }
}
