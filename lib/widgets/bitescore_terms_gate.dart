import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../services/bitescore_terms_service.dart';
import '../services/admin_access_service.dart';

/// Shared posting preflight. Private account fields and defensive actions do not
/// call this gate. The server independently authorizes each contribution.
class BiteScoreTermsGate {
  static Future<bool> ensureOwnerAuthor(BuildContext context) async {
    if (!BiteScoreTermsService.enabled) return true;
    final user = FirebaseAuth.instance.currentUser;
    if (AdminAccessService.isAdminUser(user)) return true;
    final uid = user?.uid ?? '';
    return ensureAccepted(
      context,
      expectedUserId: uid,
      isCurrent: () =>
          context.mounted && FirebaseAuth.instance.currentUser?.uid == uid,
    );
  }

  static Future<bool> ensureAccepted(
    BuildContext context, {
    required String expectedUserId,
    required bool Function() isCurrent,
    bool active = BiteScoreTermsService.enabled,
    Future<Object?> Function(String, Map<String, Object?>)? transport,
    Stream<String?>? identityChanges,
  }) async {
    if (!active) return true;
    var changed = false;
    final subscription =
        (identityChanges ??
                FirebaseAuth.instance.authStateChanges().map((u) => u?.uid))
            .listen((uid) {
              if (uid != expectedUserId) changed = true;
            });
    bool current() => context.mounted && !changed && isCurrent();
    var accepted = false;
    try {
      accepted = await BiteScoreTermsService.ensureAccepted(
        expectedUserId: expectedUserId,
        isCurrent: current,
        active: active,
        transport: transport,
        confirm: (version, text) async {
          if (!current()) return false;
          return await showDialog<bool>(
                context: context,
                builder: (dialogContext) => AlertDialog(
                  title: const Text('Terms of Service'),
                  content: SizedBox(
                    width: 560,
                    child: SingleChildScrollView(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text('Version: $version'),
                          const SizedBox(height: 12),
                          SelectableText(text),
                          const SizedBox(height: 16),
                          const Text(
                            'Accept these Terms to contribute public content. You can cancel and continue browsing.',
                          ),
                        ],
                      ),
                    ),
                  ),
                  actions: [
                    TextButton(
                      onPressed: () => Navigator.pop(dialogContext, false),
                      child: const Text('Cancel'),
                    ),
                    FilledButton(
                      onPressed: () => Navigator.pop(dialogContext, true),
                      child: const Text('Accept Terms'),
                    ),
                  ],
                ),
              ) ==
              true;
        },
      );
    } finally {
      unawaited(subscription.cancel());
    }
    return accepted && current();
  }
}
