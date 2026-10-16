import 'package:flutter/material.dart';
import '../services/owner_photo_screening_service.dart';

/// Keep the existing draft/editor open and give a held selection a clear exit.
bool showOwnerPhotoCheckFeedback(BuildContext context, Object error) {
  if (error is! OwnerPhotoCheckOutcome) return false;
  final messenger = ScaffoldMessenger.of(context);
  messenger.showSnackBar(
    SnackBar(
      content: Text(error.message),
      showCloseIcon: true,
      duration: const Duration(seconds: 10),
      action: SnackBarAction(
        label: 'Choose another',
        onPressed: () async {
          try {
            await error.discard();
            if (!messenger.mounted) return;
            messenger.showSnackBar(
              const SnackBar(
                content: Text(
                  'The pending photo was cancelled. Use Add or Replace to choose another.',
                ),
              ),
            );
          } catch (_) {
            if (!messenger.mounted) return;
            messenger.showSnackBar(
              const SnackBar(
                content: Text(
                  'Could not cancel the pending photo. Please try again.',
                ),
              ),
            );
          }
        },
      ),
    ),
  );
  return true;
}
