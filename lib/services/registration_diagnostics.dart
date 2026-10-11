import 'package:flutter/foundation.dart';

// Debug-only, fixed labels. Never accept credentials, identifiers, URLs,
// exception objects or request/response payloads as diagnostic arguments.
enum RegistrationStage {
  nativeGoogle,
  googleToken,
  existingGoogle,
  beforeLinkLookup,
  passwordLink,
  afterLinkLookup,
  emailContinuation,
}

enum RegistrationCheck {
  started,
  responseReceived,
  accepted,
  cancelled,
  nativeFailure,
  malformedToken,
  missingToken,
  missingUid,
  newUser,
  emailMismatch,
  emailUnverified,
  lookupShape,
  uidMismatch,
  googleMissing,
  passwordAlreadyAttached,
  passwordMissing,
  firebaseUserDisabled,
  firebaseRateLimited,
  firebaseCredentialInUse,
  firebaseExpiredToken,
  firebaseUserNotFound,
  firebaseInvalidIdpResponse,
  firebaseInvalidCredential,
  firebaseOperationNotAllowed,
  firebaseOtherRejection,
  networkFailure,
  malformedResponse,
  failed,
}

void registrationDiagnostic(
  RegistrationStage stage,
  RegistrationCheck check, {
  int? httpStatus,
}) {
  if (kDebugMode) {
    // Diagnostic output must never affect the authentication outcome.
    try {
      debugPrint(
        'BS_AUTH_DIAG stage=${stage.name} check=${check.name}'
        '${httpStatus == null ? '' : ' http=$httpStatus'}',
      );
    } catch (_) {
      // Preserve the original authentication result even if logging fails.
    }
  }
}
