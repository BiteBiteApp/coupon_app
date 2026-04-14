import 'dart:async';
import 'dart:math';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:shared_preferences/shared_preferences.dart';

class CustomerSessionService {
  static final FirebaseAuth _auth = FirebaseAuth.instance;

  static const String _guestDeviceIdKey = 'guest_device_id';

  static bool _hasBootstrappedAuth = false;
  static Future<User?>? _bootstrapFuture;
  static Future<String>? _guestDeviceIdFuture;

  /// Ensures Firebase Auth has had a chance to restore any existing user
  /// without automatically creating a new anonymous session.
  static Future<User?> ensureAuthReady() {
    if (_hasBootstrappedAuth) {
      return Future.value(_auth.currentUser);
    }

    if (_bootstrapFuture != null) {
      return _bootstrapFuture!;
    }

    _bootstrapFuture = _ensureAuthReadyInternal();
    return _bootstrapFuture!;
  }

  static Future<User?> _ensureAuthReadyInternal() async {
    User? currentUser = _auth.currentUser;

    if (currentUser != null) {
      _hasBootstrappedAuth = true;
      return currentUser;
    }

    try {
      currentUser = await _auth
          .authStateChanges()
          .first
          .timeout(const Duration(seconds: 3));
    } on TimeoutException {
      currentUser = _auth.currentUser;
    }

    if (currentUser != null) {
      _hasBootstrappedAuth = true;
      return currentUser;
    }

    _hasBootstrappedAuth = true;
    return null;
  }

  static Future<User> signInAsGuest() async {
    final existingUser = await ensureAuthReady();
    if (existingUser != null) {
      return existingUser;
    }

    final credential = await _auth.signInAnonymously();
    final user = credential.user;

    if (user == null) {
      _bootstrapFuture = null;
      throw Exception('Could not create customer session.');
    }

    _hasBootstrappedAuth = true;
    return user;
  }

  /// Returns a stable device-level guest ID that survives app restarts.
  static Future<String> getOrCreateGuestDeviceId() {
    if (_guestDeviceIdFuture != null) {
      return _guestDeviceIdFuture!;
    }

    _guestDeviceIdFuture = _getOrCreateGuestDeviceIdInternal();
    return _guestDeviceIdFuture!;
  }

  static Future<String> _getOrCreateGuestDeviceIdInternal() async {
    final prefs = await SharedPreferences.getInstance();
    final existing = prefs.getString(_guestDeviceIdKey);

    if (existing != null && existing.trim().isNotEmpty) {
      return existing;
    }

    final random = Random();
    final generated =
        'guest_${DateTime.now().microsecondsSinceEpoch}_${random.nextInt(1 << 32)}';

    await prefs.setString(_guestDeviceIdKey, generated);
    return generated;
  }

  static Future<String?> getExistingGuestDeviceId() async {
    final prefs = await SharedPreferences.getInstance();
    final existing = prefs.getString(_guestDeviceIdKey);

    if (existing == null || existing.trim().isEmpty) {
      return null;
    }

    return existing;
  }

  /// Resets local bootstrap tracking after a sign-out or auth reset.
  static void resetBootstrapState() {
    _hasBootstrappedAuth = false;
    _bootstrapFuture = null;
  }

  static Future<void> signOutToSignedOut() async {
    resetBootstrapState();
    await _auth.signOut();
  }

  /// Signs out the current user and restores guest browsing mode only when
  /// guest mode is explicitly requested.
  static Future<User> restoreGuestSession() async {
    await signOutToSignedOut();
    return signInAsGuest();
  }
}
