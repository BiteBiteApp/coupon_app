import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

import 'registration_diagnostics.dart';

/// Confirms an existing Google identity without Firebase's signup-capable
/// Google sign-in. Tokens and the submitted password remain on this call stack.
class ExistingGooglePasswordLink {
  ExistingGooglePasswordLink({
    required this.apiKey,
    this.tenantId,
    http.Client? client,
  }) : _client = client;

  final String apiKey;
  final String? tenantId;
  final http.Client? _client;

  Future<String> link({
    required String googleIdToken,
    required String email,
    required String password,
    required bool Function() isCurrent,
  }) async {
    var stage = RegistrationStage.googleToken;
    Never reject(RegistrationCheck reason, String code) {
      registrationDiagnostic(stage, reason);
      throw FirebaseAuthException(code: code);
    }

    void check() {
      if (!isCurrent()) {
        reject(RegistrationCheck.cancelled, 'flow-cancelled');
      }
    }

    // Rejection only, never proof of ownership. Firebase verifies the token
    // below. Reject mismatches before even an existing-account IDP sign-in.
    try {
      final payload =
          jsonDecode(
                utf8.decode(
                  base64Url.decode(
                    base64Url.normalize(googleIdToken.split('.')[1]),
                  ),
                ),
              )
              as Map<String, dynamic>;
      if (!_sameEmail(payload['email'], email)) {
        reject(RegistrationCheck.emailMismatch, 'email-mismatch');
      }
    } on FirebaseAuthException {
      rethrow;
    } catch (_) {
      reject(RegistrationCheck.malformedToken, 'invalid-credential');
    }
    if (password.length < 6) throw FirebaseAuthException(code: 'weak-password');
    final client = _client ?? http.Client();
    try {
      stage = RegistrationStage.existingGoogle;
      check();
      final identity = await _post(
        client,
        'signInWithIdp',
        {
          'requestUri': 'http://localhost',
          'postBody': Uri(
            queryParameters: {
              'providerId': 'google.com',
              'id_token': googleIdToken,
            },
          ).query,
          // Also used by the Firebase SDK's reauthentication implementation.
          'autoCreate': false,
          'returnSecureToken': true,
        },
        'localId,email,emailVerified,idToken,isNewUser',
        stage,
      );
      check();
      final uid = identity['localId'];
      final token = identity['idToken'];
      if (uid is! String || uid.isEmpty) {
        reject(RegistrationCheck.missingUid, 'invalid-credential');
      }
      if (token is! String || token.isEmpty) {
        reject(RegistrationCheck.missingToken, 'invalid-credential');
      }
      if (identity['isNewUser'] == true) {
        reject(RegistrationCheck.newUser, 'invalid-credential');
      }
      if (!_sameEmail(identity['email'], email)) {
        reject(RegistrationCheck.emailMismatch, 'invalid-credential');
      }
      // Firebase has authenticated the existing Google account. Its email
      // verification status controls access after sign-in, not ownership of
      // this authenticated UID. Keep that status for the normal verification UI.
      Future<Map<String, dynamic>> lookup(String idToken) async {
        final response = await _post(
          client,
          'lookup',
          {'idToken': idToken},
          'users(localId,email,emailVerified,providerUserInfo(providerId))',
          stage,
        );
        check();
        final users = response['users'];
        if (users is! List || users.length != 1 || users.single is! Map) {
          reject(RegistrationCheck.lookupShape, 'invalid-credential');
        }
        final user = Map<String, dynamic>.from(users.single as Map);
        if (user['localId'] != uid) {
          reject(RegistrationCheck.uidMismatch, 'user-mismatch');
        }
        if (!_sameEmail(user['email'], email)) {
          reject(RegistrationCheck.emailMismatch, 'user-mismatch');
        }
        if (!_hasProvider(user, 'google.com')) {
          reject(RegistrationCheck.googleMissing, 'user-mismatch');
        }
        return user;
      }

      stage = RegistrationStage.beforeLinkLookup;
      final existing = await lookup(token);
      if (_hasProvider(existing, 'password')) {
        reject(
          RegistrationCheck.passwordAlreadyAttached,
          'provider-already-linked',
        );
      }
      stage = RegistrationStage.passwordLink;
      check();
      // Firebase's documented email-link endpoint, also used by current SDKs.
      // idToken is mandatory here: this must never become a new-user signup.
      // No updatePassword, reset-password or accounts:update fallback.
      final linked = await _post(
        client,
        'signUp',
        {
          'idToken': token,
          'email': email,
          'password': password,
          'returnSecureToken': true,
        },
        'localId,idToken',
        stage,
      );
      check();
      if (linked['localId'] != uid) {
        reject(RegistrationCheck.uidMismatch, 'user-mismatch');
      }
      final linkedToken = linked['idToken'];
      // Password linking can leave email verification pending. Ownership was
      // verified before this mutation; still require the same UID/email and
      // both providers afterward. The normal signed-in verification flow must
      // handle Firebase's current status instead of stranding a completed link.
      if (linkedToken is! String || linkedToken.isEmpty) {
        reject(RegistrationCheck.missingToken, 'association-not-confirmed');
      }
      stage = RegistrationStage.afterLinkLookup;
      if (!_hasProvider(await lookup(linkedToken), 'password')) {
        reject(RegistrationCheck.passwordMissing, 'association-not-confirmed');
      }
      return uid;
    } finally {
      if (_client == null) client.close();
    }
  }

  static bool _sameEmail(Object? left, String right) =>
      left is String && left.toLowerCase() == right.toLowerCase();

  static bool _hasProvider(Map<String, dynamic> user, String provider) =>
      (user['providerUserInfo'] as List? ?? const []).any(
        (entry) => entry is Map && entry['providerId'] == provider,
      );

  Future<Map<String, dynamic>> _post(
    http.Client client,
    String method,
    Map<String, dynamic> body,
    String fields,
    RegistrationStage stage,
  ) async {
    try {
      registrationDiagnostic(stage, RegistrationCheck.started);
      final response = await client.post(
        Uri.https('identitytoolkit.googleapis.com', '/v1/accounts:$method', {
          'key': apiKey,
          'fields': fields,
        }),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({...body, if (tenantId != null) 'tenantId': tenantId}),
      );
      registrationDiagnostic(
        stage,
        RegistrationCheck.responseReceived,
        httpStatus: response.statusCode,
      );
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      if (response.statusCode != 200) {
        // Never surface raw responses, tokens or request URLs in error text.
        final code = (data['error'] as Map?)?['message'];
        registrationDiagnostic(stage, switch (code) {
          'USER_DISABLED' => RegistrationCheck.firebaseUserDisabled,
          'TOO_MANY_ATTEMPTS_TRY_LATER' =>
            RegistrationCheck.firebaseRateLimited,
          'EMAIL_EXISTS' || 'CREDENTIAL_ALREADY_IN_USE' =>
            RegistrationCheck.firebaseCredentialInUse,
          'TOKEN_EXPIRED' ||
          'INVALID_ID_TOKEN' => RegistrationCheck.firebaseExpiredToken,
          'USER_NOT_FOUND' => RegistrationCheck.firebaseUserNotFound,
          'INVALID_IDP_RESPONSE' =>
            RegistrationCheck.firebaseInvalidIdpResponse,
          'INVALID_LOGIN_CREDENTIALS' ||
          'INVALID_PASSWORD' => RegistrationCheck.firebaseInvalidCredential,
          'OPERATION_NOT_ALLOWED' =>
            RegistrationCheck.firebaseOperationNotAllowed,
          _ => RegistrationCheck.firebaseOtherRejection,
        }, httpStatus: response.statusCode);
        throw FirebaseAuthException(
          code: switch (code) {
            'USER_DISABLED' => 'user-disabled',
            'TOO_MANY_ATTEMPTS_TRY_LATER' => 'too-many-requests',
            'EMAIL_EXISTS' ||
            'CREDENTIAL_ALREADY_IN_USE' => 'credential-already-in-use',
            'TOKEN_EXPIRED' || 'INVALID_ID_TOKEN' => 'requires-recent-login',
            _ => 'invalid-credential',
          },
        );
      }
      registrationDiagnostic(
        stage,
        RegistrationCheck.accepted,
        httpStatus: response.statusCode,
      );
      return data;
    } on FirebaseAuthException {
      rethrow;
    } on http.ClientException {
      registrationDiagnostic(stage, RegistrationCheck.networkFailure);
      throw FirebaseAuthException(code: 'network-request-failed');
    } catch (_) {
      registrationDiagnostic(stage, RegistrationCheck.malformedResponse);
      throw FirebaseAuthException(code: 'invalid-credential');
    }
  }
}
