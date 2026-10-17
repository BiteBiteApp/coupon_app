import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';

/// Local self-report only, not verified age or a server authorization boundary.
/// Enable only with an owner-authorized, qualified client release.
class RegistrationAgePolicy {
  static const bool enabled = false;

  @visibleForTesting
  static bool? enabledForTesting;

  static bool get isEnabled => enabledForTesting ?? enabled;

  /// For direct creation entry points outside AccountProviderService. Bind only
  /// the preflight to the original session; do not modify or replace accounts.
  static Future<void> requireEligibleForAuth({
    required FirebaseAuth auth,
    required bool Function() isActive,
    required Future<bool> Function() requestAge,
  }) async {
    if (!isEnabled) return;
    final initial = auth.currentUser;
    final uid = initial?.uid;
    final anonymous = initial?.isAnonymous;
    var changed = false;
    final subscription = auth.authStateChanges().listen((user) {
      if (user?.uid != uid || user?.isAnonymous != anonymous) changed = true;
    });
    bool isCurrent() =>
        !changed &&
        isActive() &&
        auth.currentUser?.uid == uid &&
        auth.currentUser?.isAnonymous == anonymous;
    try {
      await requireEligible(
        user: initial,
        isCurrent: isCurrent,
        requestAge: requestAge,
      );
      if (!isCurrent()) throw FirebaseAuthException(code: 'flow-cancelled');
    } finally {
      await subscription.cancel();
    }
    if (!isCurrent()) throw FirebaseAuthException(code: 'flow-cancelled');
  }

  /// A missing UI callback fails closed in enabled builds. No age, DOB or
  /// eligibility receipt is stored; existing registered sessions are exempt.
  static Future<void> requireEligible({
    required User? user,
    required bool Function() isCurrent,
    Future<bool> Function()? requestAge,
  }) async {
    if (!isEnabled || (user != null && !user.isAnonymous)) return;
    if (!isCurrent()) throw FirebaseAuthException(code: 'flow-cancelled');
    final eligible = await requestAge?.call() ?? false;
    if (!eligible || !isCurrent()) {
      throw FirebaseAuthException(code: 'flow-cancelled');
    }
  }
}
