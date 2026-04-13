import 'dart:async';
import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/coupon.dart';
import '../services/customer_session_service.dart';

class DemoRedemptionStore {
  static final ValueNotifier<int> changes = ValueNotifier<int>(0);

  static final FirebaseFirestore _firestore = FirebaseFirestore.instance;

  static const String _guestStorageKeyPrefix = 'guest_coupon_redemptions';
  static const Duration redeemWindow = Duration(minutes: 5);

  static final Map<String, DateTime> _lastRedeemedAtByCoupon = {};
  static final Map<String, DateTime> _timerStartedAtByCoupon = {};
  static final Map<String, Timer> _expiryTimersByCoupon = {};

  static bool _initialized = false;
  static Future<void>? _initializingFuture;
  static StreamSubscription<User?>? _authSubscription;
  static String? _loadedUid;
  static bool _loadedAsGuest = false;
  static String? _loadedGuestDeviceId;
  static int _loadGeneration = 0;

  static CollectionReference<Map<String, dynamic>> _redemptionsCollection(
    String uid,
  ) {
    return _firestore
        .collection('customer_redemptions')
        .doc(uid)
        .collection('coupon_redemptions');
  }

  static String _guestStorageKeyFor(String guestDeviceId) {
    return '${_guestStorageKeyPrefix}_$guestDeviceId';
  }

  static Future<void> ensureInitialized() {
    if (_authSubscription == null) {
      _authSubscription = FirebaseAuth.instance.authStateChanges().listen((
        user,
      ) async {
        final nextUid = user?.uid;
        final nextIsGuest = user == null || user.isAnonymous;

        if (_loadedUid != nextUid || _loadedAsGuest != nextIsGuest) {
          _loadGeneration++;
          _loadedUid = nextUid;
          _loadedAsGuest = nextIsGuest;
          _loadedGuestDeviceId = null;
          _clearMemory();
          _initialized = false;
          _initializingFuture = null;
          changes.value++;
          await ensureInitialized();
        }
      });
    }

    if (_initialized) {
      return Future.value();
    }

    if (_initializingFuture != null) {
      return _initializingFuture!;
    }

    _initializingFuture = _loadCurrentUserRedemptions();
    return _initializingFuture!;
  }

  static Future<void> _loadCurrentUserRedemptions() async {
    final user = await CustomerSessionService.ensureCustomerUser();
    final loadGeneration = _loadGeneration;
    final activeUid = user.uid;
    final activeIsGuest = user.isAnonymous;

    if (!_matchesCurrentAuthUser(activeUid, activeIsGuest)) {
      return;
    }

    _loadedUid = activeUid;
    _loadedAsGuest = activeIsGuest;
    _loadedGuestDeviceId = null;
    _clearMemory();

    final guestDeviceId =
        await CustomerSessionService.getOrCreateGuestDeviceId();

    if (!_isCurrentLoad(loadGeneration, activeUid, activeIsGuest)) {
      return;
    }

    _loadedGuestDeviceId = guestDeviceId;

    if (activeIsGuest) {
      await _loadGuestRedemptionsFromDevice(guestDeviceId);
    } else {
      await _loadSignedInRedemptionsFromFirestore(activeUid);

      final guestRedemptions = await _readGuestRedemptionsFromDevice(
        guestDeviceId,
      );
      _mergeIntoMemoryKeepingMostRecent(guestRedemptions);
    }

    if (!_isCurrentLoad(loadGeneration, activeUid, activeIsGuest)) {
      return;
    }

    await _finalizeExpiredTimersIfNeeded();
    _scheduleAllExpiryTimers();

    if (!_isCurrentLoad(loadGeneration, activeUid, activeIsGuest)) {
      return;
    }

    _initialized = true;
    changes.value++;
  }

  static void _clearMemory() {
    _lastRedeemedAtByCoupon.clear();
    _timerStartedAtByCoupon.clear();

    for (final timer in _expiryTimersByCoupon.values) {
      timer.cancel();
    }
    _expiryTimersByCoupon.clear();
  }

  static Future<void> _loadSignedInRedemptionsFromFirestore(String uid) async {
    final snapshot = await _redemptionsCollection(uid).get();

    for (final doc in snapshot.docs) {
      final data = doc.data();
      final lastRedeemedAt = _coerceDateTime(data['lastRedeemedAt']);
      final timerStartedAt = _coerceDateTime(data['timerStartedAt']);

      if (lastRedeemedAt != null) {
        _lastRedeemedAtByCoupon[doc.id] = lastRedeemedAt;
      }

      if (timerStartedAt != null) {
        _timerStartedAtByCoupon[doc.id] = timerStartedAt;
      }
    }
  }

  static Future<Map<String, _StoredCouponRedemption>>
  _readGuestRedemptionsFromDevice(
    String guestDeviceId,
  ) async {
    final prefs = await SharedPreferences.getInstance();
    final rawJson = prefs.getString(_guestStorageKeyFor(guestDeviceId));

    if (rawJson == null || rawJson.trim().isEmpty) {
      return {};
    }

    final decoded = jsonDecode(rawJson);

    if (decoded is! Map<String, dynamic>) {
      return {};
    }

    final result = <String, _StoredCouponRedemption>{};

    for (final entry in decoded.entries) {
      final value = entry.value;

      if (value is String) {
        final parsed = DateTime.tryParse(value)?.toLocal();
        if (parsed != null) {
          result[entry.key] = _StoredCouponRedemption(
            lastRedeemedAt: parsed,
          );
        }
        continue;
      }

      if (value is Map) {
        result[entry.key] = _StoredCouponRedemption(
          lastRedeemedAt: _coerceDateTime(value['lastRedeemedAt']),
          timerStartedAt: _coerceDateTime(value['timerStartedAt']),
        );
      }
    }

    return result;
  }

  static Future<void> _loadGuestRedemptionsFromDevice(
    String guestDeviceId,
  ) async {
    final stored = await _readGuestRedemptionsFromDevice(guestDeviceId);

    _clearMemory();
    _mergeIntoMemoryKeepingMostRecent(stored);
  }

  static void _mergeIntoMemoryKeepingMostRecent(
    Map<String, _StoredCouponRedemption> incoming,
  ) {
    for (final entry in incoming.entries) {
      final existingLastRedeemedAt = _lastRedeemedAtByCoupon[entry.key];
      final existingTimerStartedAt = _timerStartedAtByCoupon[entry.key];
      final incomingLastRedeemedAt = entry.value.lastRedeemedAt;
      final incomingTimerStartedAt = entry.value.timerStartedAt;

      if (incomingLastRedeemedAt != null &&
          (existingLastRedeemedAt == null ||
              incomingLastRedeemedAt.isAfter(existingLastRedeemedAt))) {
        _lastRedeemedAtByCoupon[entry.key] = incomingLastRedeemedAt;
      }

      if (incomingTimerStartedAt != null &&
          (existingTimerStartedAt == null ||
              incomingTimerStartedAt.isAfter(existingTimerStartedAt))) {
        _timerStartedAtByCoupon[entry.key] = incomingTimerStartedAt;
      }
    }
  }

  static Future<void> _saveGuestRedemptionsToDevice() async {
    final guestDeviceId =
        _loadedGuestDeviceId ??
        await CustomerSessionService.getOrCreateGuestDeviceId();

    final prefs = await SharedPreferences.getInstance();

    final data = <String, Map<String, String>>{};
    final couponIds = <String>{
      ..._lastRedeemedAtByCoupon.keys,
      ..._timerStartedAtByCoupon.keys,
    };

    for (final couponId in couponIds) {
      final redemptionData = <String, String>{};
      final lastRedeemedAt = _lastRedeemedAtByCoupon[couponId];
      final timerStartedAt = _timerStartedAtByCoupon[couponId];

      if (lastRedeemedAt != null) {
        redemptionData['lastRedeemedAt'] = lastRedeemedAt.toIso8601String();
      }

      if (timerStartedAt != null) {
        redemptionData['timerStartedAt'] = timerStartedAt.toIso8601String();
      }

      if (redemptionData.isNotEmpty) {
        data[couponId] = redemptionData;
      }
    }

    await prefs.setString(
      _guestStorageKeyFor(guestDeviceId),
      jsonEncode(data),
    );
  }

  static bool supportsRedeemTimer(String usageRule) {
    return usageRule.trim().toLowerCase() != 'unlimited';
  }

  static bool hasActiveRedeemTimer(String couponId) {
    _refreshExpiredTimerIfNeeded(couponId);

    final timerStartedAt = _timerStartedAtByCoupon[couponId];
    if (timerStartedAt == null) {
      return false;
    }

    return DateTime.now().isBefore(timerStartedAt.add(redeemWindow));
  }

  static Duration? activeTimerRemaining(String couponId) {
    _refreshExpiredTimerIfNeeded(couponId);

    final timerStartedAt = _timerStartedAtByCoupon[couponId];
    if (timerStartedAt == null) {
      return null;
    }

    final remaining = timerStartedAt.add(redeemWindow).difference(DateTime.now());
    if (remaining <= Duration.zero) {
      return null;
    }

    return remaining;
  }

  static bool isAvailable(String couponId, String usageRule) {
    final normalizedRule = usageRule.trim().toLowerCase();

    if (normalizedRule == 'unlimited') {
      return true;
    }

    _refreshExpiredTimerIfNeeded(couponId);

    final lastRedeemedAt = _lastRedeemedAtByCoupon[couponId];

    if (lastRedeemedAt == null) {
      return true;
    }

    if (normalizedRule == 'once per customer') {
      return false;
    }

    if (normalizedRule == 'once per day') {
      return !DateTime.now().isBefore(_nextDailyAvailability(lastRedeemedAt));
    }

    return true;
  }

  static Future<void> startRedeemTimer(Coupon coupon) async {
    await ensureInitialized();

    if (!supportsRedeemTimer(coupon.usageRule)) {
      return;
    }

    if (hasActiveRedeemTimer(coupon.id)) {
      return;
    }

    if (!isAvailable(coupon.id, coupon.usageRule)) {
      throw Exception('This coupon is not currently redeemable.');
    }

    final now = DateTime.now();
    _timerStartedAtByCoupon[coupon.id] = now;
    _scheduleExpiryTimer(coupon.id);

    await _persistRedemptionState(
      couponId: coupon.id,
      coupon: coupon,
    );

    changes.value++;
  }

  static Future<void> redeemCoupon(Coupon coupon) async {
    await startRedeemTimer(coupon);
  }

  static Future<void> _persistRedemptionState({
    required String couponId,
    Coupon? coupon,
    bool incrementRedeemedCount = false,
  }) async {
    final user = await CustomerSessionService.ensureCustomerUser();

    if (user.isAnonymous) {
      await _saveGuestRedemptionsToDevice();
      return;
    }

    final data = <String, dynamic>{
      'couponId': couponId,
      'updatedAt': FieldValue.serverTimestamp(),
      'lastRedeemedAt': _lastRedeemedAtByCoupon[couponId] == null
          ? FieldValue.delete()
          : Timestamp.fromDate(_lastRedeemedAtByCoupon[couponId]!),
      'timerStartedAt': _timerStartedAtByCoupon[couponId] == null
          ? FieldValue.delete()
          : Timestamp.fromDate(_timerStartedAtByCoupon[couponId]!),
    };

    if (coupon != null) {
      data['couponTitle'] = coupon.title;
      data['restaurant'] = coupon.restaurant;
      data['usageRule'] = coupon.usageRule;
    }

    if (incrementRedeemedCount) {
      data['redeemedCount'] = FieldValue.increment(1);
    }

    await _redemptionsCollection(user.uid).doc(couponId).set(
      data,
      SetOptions(merge: true),
    );
  }

  static void _scheduleAllExpiryTimers() {
    for (final couponId in _timerStartedAtByCoupon.keys.toList()) {
      _scheduleExpiryTimer(couponId);
    }
  }

  static void _scheduleExpiryTimer(String couponId) {
    _expiryTimersByCoupon.remove(couponId)?.cancel();

    final timerStartedAt = _timerStartedAtByCoupon[couponId];
    if (timerStartedAt == null) {
      return;
    }

    final remaining = timerStartedAt.add(redeemWindow).difference(DateTime.now());
    if (remaining <= Duration.zero) {
      unawaited(_finalizeExpiredTimerIfNeeded(couponId));
      return;
    }

    _expiryTimersByCoupon[couponId] = Timer(remaining, () {
      unawaited(_finalizeExpiredTimerIfNeeded(couponId));
    });
  }

  static void _refreshExpiredTimerIfNeeded(String couponId) {
    final timerStartedAt = _timerStartedAtByCoupon[couponId];
    if (timerStartedAt == null) {
      return;
    }

    final completedAt = timerStartedAt.add(redeemWindow);
    if (DateTime.now().isBefore(completedAt)) {
      return;
    }

    final existingLastRedeemedAt = _lastRedeemedAtByCoupon[couponId];
    final shouldUpdate = existingLastRedeemedAt == null ||
        completedAt.isAfter(existingLastRedeemedAt);

    _timerStartedAtByCoupon.remove(couponId);
    _expiryTimersByCoupon.remove(couponId)?.cancel();

    if (shouldUpdate) {
      _lastRedeemedAtByCoupon[couponId] = completedAt;
    }

    changes.value++;
    unawaited(
      _persistRedemptionState(
        couponId: couponId,
        incrementRedeemedCount: shouldUpdate,
      ),
    );
  }

  static Future<void> _finalizeExpiredTimersIfNeeded() async {
    for (final couponId in _timerStartedAtByCoupon.keys.toList()) {
      await _finalizeExpiredTimerIfNeeded(couponId);
    }
  }

  static Future<void> _finalizeExpiredTimerIfNeeded(String couponId) async {
    final timerStartedAt = _timerStartedAtByCoupon[couponId];
    if (timerStartedAt == null) {
      return;
    }

    final completedAt = timerStartedAt.add(redeemWindow);
    if (DateTime.now().isBefore(completedAt)) {
      _scheduleExpiryTimer(couponId);
      return;
    }

    final existingLastRedeemedAt = _lastRedeemedAtByCoupon[couponId];
    final shouldUpdate = existingLastRedeemedAt == null ||
        completedAt.isAfter(existingLastRedeemedAt);

    _timerStartedAtByCoupon.remove(couponId);
    _expiryTimersByCoupon.remove(couponId)?.cancel();

    if (shouldUpdate) {
      _lastRedeemedAtByCoupon[couponId] = completedAt;
    }

    await _persistRedemptionState(
      couponId: couponId,
      incrementRedeemedCount: shouldUpdate,
    );

    changes.value++;
  }

  static DateTime _nextDailyAvailability(DateTime redeemedAt) {
    return DateTime(
      redeemedAt.year,
      redeemedAt.month,
      redeemedAt.day + 1,
      0,
      1,
    );
  }

  static Future<void> syncGuestDeviceRedemptionsToSignedInUser(
    String targetUid,
  ) async {
    final guestDeviceId = await CustomerSessionService.getExistingGuestDeviceId();

    if (guestDeviceId == null || guestDeviceId.trim().isEmpty) {
      return;
    }

    final localGuestRedemptions = await _readGuestRedemptionsFromDevice(
      guestDeviceId,
    );

    if (localGuestRedemptions.isEmpty) {
      return;
    }

    final batch = _firestore.batch();
    final targetCollection = _redemptionsCollection(targetUid);

    for (final entry in localGuestRedemptions.entries) {
      final data = <String, dynamic>{
        'couponId': entry.key,
        'updatedAt': FieldValue.serverTimestamp(),
      };

      if (entry.value.lastRedeemedAt != null) {
        data['lastRedeemedAt'] = Timestamp.fromDate(entry.value.lastRedeemedAt!);
        data['redeemedCount'] = 1;
      }

      if (entry.value.timerStartedAt != null) {
        data['timerStartedAt'] = Timestamp.fromDate(entry.value.timerStartedAt!);
      }

      batch.set(targetCollection.doc(entry.key), data, SetOptions(merge: true));
    }

    await batch.commit();
  }

  static Future<void> refreshFromFirestore() async {
    _loadGeneration++;
    _initialized = false;
    _initializingFuture = null;
    await ensureInitialized();
  }

  static bool _matchesCurrentAuthUser(String uid, bool isGuest) {
    final currentUser = FirebaseAuth.instance.currentUser;
    return currentUser != null &&
        currentUser.uid == uid &&
        currentUser.isAnonymous == isGuest;
  }

  static bool _isCurrentLoad(int generation, String uid, bool isGuest) {
    return generation == _loadGeneration && _matchesCurrentAuthUser(uid, isGuest);
  }

  static DateTime? _coerceDateTime(dynamic value) {
    if (value is Timestamp) {
      return value.toDate().toLocal();
    }

    if (value is String) {
      return DateTime.tryParse(value)?.toLocal();
    }

    if (value is DateTime) {
      return value.toLocal();
    }

    return null;
  }
}

class _StoredCouponRedemption {
  final DateTime? lastRedeemedAt;
  final DateTime? timerStartedAt;

  const _StoredCouponRedemption({
    this.lastRedeemedAt,
    this.timerStartedAt,
  });
}
