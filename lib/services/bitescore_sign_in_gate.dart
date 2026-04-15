import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../screens/customer_account_screen.dart';
import 'customer_auth_service.dart';

class BiteScoreSignInGate {
  static const String loginRequiredMessage = 'Please sign in to continue';
  static const String emailVerificationRequiredMessage =
      'Please verify your email first';

  static bool get canCurrentUserWrite {
    final user = FirebaseAuth.instance.currentUser;
    return _canUserWrite(user);
  }

  static bool get canCurrentUserSaveFavorites {
    final user = FirebaseAuth.instance.currentUser;
    return _canUserSaveFavorites(user);
  }

  static Future<bool> ensureSignedInForWrite(
    BuildContext context, {
    String message = loginRequiredMessage,
  }) async {
    try {
      await FirebaseAuth.instance.currentUser?.reload();
      await FirebaseAuth.instance.currentUser?.getIdToken(true);
    } catch (_) {}

    if (!context.mounted) {
      return false;
    }

    final user = FirebaseAuth.instance.currentUser;
    if (_canUserWrite(user)) {
      return true;
    }

    if (user != null && !user.isAnonymous && _requiresEmailVerification(user)) {
      _showAuthSnackBar(
        context,
        title: 'Email verification required',
        message: 'Please verify your email to rate, review, or add dishes.',
        isWarning: true,
      );

      return false;
    }

    _showAuthSnackBar(context, message: message);

    await Navigator.of(
      context,
    ).push(MaterialPageRoute(builder: (_) => const CustomerAccountScreen()));

    return canCurrentUserWrite;
  }

  static Future<bool> ensureSignedInForFavorites(
    BuildContext context, {
    String message = 'Please sign in to save favorites.',
  }) async {
    final user = FirebaseAuth.instance.currentUser;
    if (_canUserSaveFavorites(user)) {
      return true;
    }

    _showAuthSnackBar(context, message: message);

    await Navigator.of(
      context,
    ).push(MaterialPageRoute(builder: (_) => const CustomerAccountScreen()));

    return canCurrentUserSaveFavorites;
  }

  static void _showAuthSnackBar(
    BuildContext context, {
    required String message,
    String? title,
    bool isWarning = false,
  }) {
    final messenger = ScaffoldMessenger.of(context);
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          duration: const Duration(seconds: 3),
          behavior: SnackBarBehavior.floating,
          backgroundColor: isWarning ? const Color(0xFFFFF3E0) : null,
          content: title == null
              ? Text(
                  message,
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                    color: isWarning ? const Color(0xFF5D4037) : null,
                  ),
                )
              : RichText(
                  text: TextSpan(
                    style: const TextStyle(
                      fontSize: 15,
                      height: 1.35,
                      color: Color(0xFF5D4037),
                    ),
                    children: [
                      TextSpan(
                        text: '$title. ',
                        style: const TextStyle(fontWeight: FontWeight.w800),
                      ),
                      TextSpan(
                        text: message,
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                    ],
                  ),
                ),
        ),
      );
  }

  static bool _canUserWrite(User? user) {
    if (user == null || user.isAnonymous) {
      return false;
    }

    return !_requiresEmailVerification(user);
  }

  static bool _requiresEmailVerification(User user) {
    return CustomerAuthService.requiresEmailVerification(user);
  }

  static bool _canUserSaveFavorites(User? user) {
    return user != null && !user.isAnonymous;
  }
}
