import 'package:cloud_firestore/cloud_firestore.dart';

class AppErrorText {
  static String friendly(
    Object error, {
    required String fallback,
  }) {
    if (error is ArgumentError) {
      final message = error.message;
      if (message is String && message.trim().isNotEmpty) {
        return message.trim();
      }
      return fallback;
    }

    if (error is FirebaseException) {
      switch (error.code) {
        case 'permission-denied':
          return 'You do not have permission to do that.';
        case 'unavailable':
          return 'This service is temporarily unavailable. Please try again.';
        case 'network-request-failed':
          return 'Please check your connection and try again.';
      }

      final message = _stripPrefix(error.message);
      if (message != null && !_looksTechnical(message)) {
        return message;
      }
      return fallback;
    }

    final message = _stripPrefix(error.toString());
    if (message != null && !_looksTechnical(message)) {
      return message;
    }

    return fallback;
  }

  static String load(String subject) {
    return 'Could not load $subject right now.';
  }

  static String? _stripPrefix(String? value) {
    final trimmed = value?.trim();
    if (trimmed == null || trimmed.isEmpty) {
      return null;
    }
    if (trimmed.startsWith('Exception:')) {
      final stripped = trimmed.substring('Exception:'.length).trim();
      return stripped.isEmpty ? null : stripped;
    }
    return trimmed;
  }

  static bool _looksTechnical(String message) {
    final lower = message.toLowerCase();
    return lower.contains('firebaseexception') ||
        lower.contains('cloud_firestore') ||
        lower.contains('stack trace') ||
        message.contains('package:') ||
        message.contains('dart:') ||
        (message.contains('[') && message.contains(']'));
  }
}
