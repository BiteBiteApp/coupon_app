import 'dart:async';
import 'dart:math';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:shared_preferences/shared_preferences.dart';

class CustomerSessionService {
  static final FirebaseAuth _auth = FirebaseAuth.instance;

  static const String _guestDeviceIdKey = 'guest_device_id';

  static bool _hasBootstrappedAuth = false;
  static Future<User>? _bootstrapFuture;
  static Future<String>? _guestDeviceIdFuture;

  /// Ensures Firebase Auth has had a chance to restore any existing user
  /// before deciding to create a new anonymous customer session.
  static Future<User> ensureCustomerUser() {
    if (_hasBootstrappedAuth && _auth.currentUser != null) {
      return Future.value(_auth.currentUser!);
    }

    if (_bootstrapFuture != null) {
      return _bootstrapFuture!;
    }

    _bootstrapFuture = _ensureCustomerUserInternal();
    return _bootstrapFuture!;
  }

  static Future<User> _ensureCustomerUserInternal() async {
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

  /// Signs out the current user and immediately restores guest browsing mode.
  static Future<User> restoreGuestSession() async {
    resetBootstrapState();
    await _auth.signOut();
    return ensureCustomerUser();
  }
}