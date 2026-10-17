import 'dart:convert';
import 'dart:math';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'photo_screening_service.dart';
import 'bitescore_terms_service.dart';
import 'admin_access_service.dart';

/// Only private receipt IDs persist. Unpublished bytes never use Storage SDK
/// uploads/download URLs. Reopening an editor checks status without rescanning.
class OwnerPhotoScreeningService {
  OwnerPhotoScreeningService({
    PhotoScreeningService? transport,
    String Function()? currentUserId,
    @visibleForTesting bool? termsActive,
    bool Function()? isAdmin,
  }) : _transport = transport ?? PhotoScreeningService(),
       _termsActive = termsActive ?? BiteScoreTermsService.enabled,
       _isAdmin =
           isAdmin ??
           (() => AdminAccessService.isAdminUser(
             FirebaseAuth.instance.currentUser,
           )),
       _uid = currentUserId ?? currentUid;
  final PhotoScreeningService _transport;
  final String Function() _uid;
  final bool _termsActive;
  final bool Function() _isAdmin;
  static const enabled = bool.fromEnvironment(
    'BITESAVER_PHOTO_SCREENING',
    defaultValue: false,
  );
  @visibleForTesting
  static bool? debugEnabled;
  static bool get isEnabled => debugEnabled ?? enabled;
  static String newTargetId() => List.generate(
    16,
    (_) => Random.secure().nextInt(256).toRadixString(16).padLeft(2, '0'),
  ).join();
  static String? imageId(String? url) {
    if (url == null) return null;
    try {
      return RegExp(
        r'screened_(bso_[a-f0-9]{64})\.jpg(?:\?|$)',
      ).firstMatch(Uri.decodeComponent(url))?.group(1);
    } on FormatException {
      return null;
    }
  }

  static String currentUid() {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null || user.isAnonymous) {
      throw StateError('Please sign in to check a photograph.');
    }
    return user.uid;
  }

  String _key(
    String uid,
    String sourceType,
    String sourceId,
    String family,
    String targetId,
  ) =>
      'owner.photo.check.${jsonEncode([uid, sourceType, sourceId, family, targetId])}';

  Future<Map?> recover({
    required String uid,
    required String sourceType,
    required String sourceId,
    required String family,
    required String targetId,
  }) async {
    final preferences = await SharedPreferences.getInstance();
    final key = _key(uid, sourceType, sourceId, family, targetId);
    final receipt = preferences.getString(key);
    if (receipt == null) return null;
    late Map result;
    try {
      result = await _transport.request('getOwnerScreenedPhoto', uid, {
        'imageId': receipt,
      });
    } on FirebaseFunctionsException catch (error) {
      if (['not-found', 'failed-precondition'].contains(error.code)) {
        await preferences.remove(key);
        throw ArgumentError(
          'The previous photograph is unavailable. Choose a new photo. Your saved content is unchanged.',
        );
      }
      rethrow;
    }
    _requireContext(result, sourceType, sourceId, family, targetId);
    if (['failed', 'upload_failed'].contains(result['state'])) {
      // A retry requires explicit reselection of the original bytes. Status
      // reads never admit a provider call.
      await preferences.remove(key);
      return null;
    }
    return _available(result, uid, key);
  }

  Future<Map> submit({
    required String uid,
    required String sourceType,
    required String sourceId,
    required String family,
    required String targetId,
    required Uint8List bytes,
    required String contentType,
  }) async {
    if (bytes.isEmpty || bytes.length > 5 * 1024 * 1024) {
      throw ArgumentError('Choose a photograph up to 5 MB.');
    }
    if (_termsActive && !_isAdmin()) {
      await BiteScoreTermsService.requireAccepted(
        expectedUserId: uid,
        isCurrent: () => _transport.isCurrent(uid),
        active: true,
        transport: (name, data) => _transport.request(name, uid, data),
      );
    }
    final result = await _transport.request('submitScreenedOwnerPhoto', uid, {
      'sourceType': sourceType,
      'sourceId': sourceId,
      'family': family,
      'targetId': targetId,
      'contentType': contentType,
      'bytesBase64': base64Encode(bytes),
      'retry': true,
    });
    _requireContext(result, sourceType, sourceId, family, targetId);
    final key = _key(uid, sourceType, sourceId, family, targetId);
    if (result['imageId'] is! String ||
        !RegExp(r'^bso_[a-f0-9]{64}$').hasMatch(result['imageId'])) {
      throw const FormatException('Invalid photograph receipt.');
    }
    await (await SharedPreferences.getInstance()).setString(
      key,
      result['imageId'],
    );
    return _available(result, uid, key);
  }

  void _requireContext(
    Map result,
    String sourceType,
    String sourceId,
    String family,
    String targetId,
  ) {
    if (result['sourceType'] != sourceType ||
        result['sourceId'] != sourceId ||
        result['family'] != family ||
        result['targetId'] != targetId) {
      throw const FormatException(
        'The photograph response belongs to a different selection.',
      );
    }
  }

  Future<Map> _available(Map result, String uid, String key) async {
    if (result['state'] != 'available') {
      throw OwnerPhotoCheckOutcome(
        result['state'] as String? ?? 'failed',
        discard: () async {
          await _transport.request('useOwnerScreenedPhoto', uid, {
            'imageId': result['imageId'],
            'action': 'discard',
          });
          await (await SharedPreferences.getInstance()).remove(key);
        },
      );
    }
    if (imageId(result['imageUrl'] as String?) != result['imageId'] ||
        result['storagePath'] is! String) {
      throw const FormatException('Invalid approved photograph.');
    }
    return result;
  }

  Future<String?> preview(String imageId) async {
    final response = await _transport.request('getOwnerScreenedPhoto', _uid(), {
      'imageId': imageId,
      'preview': true,
    });
    return response['bytesBase64'] as String?;
  }

  Future<Map> use(
    String url, {
    bool remove = false,
    String? expectedUid,
  }) async {
    final uid = expectedUid ?? _uid();
    final result = await _transport.request('useOwnerScreenedPhoto', uid, {
      'imageId': imageId(url),
      'action': remove ? 'remove' : 'attach',
    });
    await acknowledge(imageId(url)!, uid);
    return result;
  }

  /// Forget a receipt only after the owner save/registration is acknowledged.
  Future<void> acknowledge(String imageId, String uid) async {
    final preferences = await SharedPreferences.getInstance();
    for (final key in preferences.getKeys().toList()) {
      if (!key.startsWith('owner.photo.check.') ||
          preferences.getString(key) != imageId) {
        continue;
      }
      final context =
          jsonDecode(key.substring('owner.photo.check.'.length)) as List;
      if (context[0] != uid) continue;
      await preferences.remove(key);
      if (context[3] == 'menu') {
        final targetKey =
            'owner.menu.photo.target.$uid.${context[1]}.${context[2]}';
        if (preferences.getString(targetKey) == context[4]) {
          await preferences.remove(targetKey);
        }
      }
    }
  }
}

class OwnerPhotoCheckOutcome extends PhotoScreeningOutcome {
  const OwnerPhotoCheckOutcome(super.state, {required this.discard});
  final Future<void> Function() discard;
  @override
  String get message => switch (state) {
    'needs_review' =>
      'Photograph awaiting Admin review. Your text can still be saved. Use Add or Replace again to check its status.',
    'withdrawn' => 'This photograph was removed and cannot be used again.',
    'failed' =>
      'The photo could not be checked. Choose it again to retry within seven days. Your text and saved photos are unchanged.',
    _ => super.message,
  };
}
