import 'dart:async';
import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/coupon.dart';
import '../services/customer_session_service.dart';

typedef DemoRedemptionAuthSnapshot = ({String uid, bool isAnonymous});
typedef DemoRedemptionSignedStateLoader =
    Future<Map<String, DemoRedemptionStoredState>> Function(String uid);

@immutable
final class DemoRedemptionStoredState {
  final DateTime? lastRedeemedAt;
  final DateTime? timerStartedAt;

  const DemoRedemptionStoredState({this.lastRedeemedAt, this.timerStartedAt});
}

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
  static StreamSubscription<DemoRedemptionAuthSnapshot?>? _authSubscription;
  static String? _loadedUid;
  static bool _loadedAsGuest = false;
  static String? _loadedGuestDeviceId;
  static int _loadGeneration = 0;

  static Future<void> Function()? _ensureAuthReadyForTesting;
  static DemoRedemptionAuthSnapshot? Function()? _currentAuthSnapshotForTesting;
  static Stream<DemoRedemptionAuthSnapshot?>? _authChangesForTesting;
  static Future<String?> Function()? _existingGuestDeviceIdForTesting;
  static Future<String> Function()? _guestDeviceIdForTesting;
  static DemoRedemptionSignedStateLoader? _signedStateLoaderForTesting;

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
    _authSubscription ??= _authChanges().listen((snapshot) async {
      final nextUid = snapshot?.uid;
      final nextIsGuest = snapshot?.isAnonymous ?? false;

      if (_loadedUid != nextUid || _loadedAsGuest != nextIsGuest) {
        _loadGeneration++;
        _clearMemory();
        _loadedUid = nextUid;
        _loadedAsGuest = nextIsGuest;
        _loadedGuestDeviceId = null;
        _initialized = false;
        _initializingFuture = null;
        await ensureInitialized();
      }
    });

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
    await _ensureAuthReady();
    final authSnapshot = _currentAuthSnapshot();
    final loadGeneration = _loadGeneration;
    final activeUid = authSnapshot?.uid;
    final activeIsGuest = authSnapshot?.isAnonymous ?? false;

    if (!_matchesCurrentAuthUser(activeUid, activeIsGuest)) {
      return;
    }

    _loadedUid = activeUid;
    _loadedAsGuest = activeIsGuest;
    _loadedGuestDeviceId = null;
    _clearMemory();
    final existingGuestDeviceId = await _getExistingGuestDeviceId();

    if (authSnapshot == null) {
      if (!_isCurrentLoad(loadGeneration, activeUid, activeIsGuest)) {
        return;
      }

      _loadedGuestDeviceId = existingGuestDeviceId;
      _initialized = true;
      changes.value++;
      return;
    }

    final guestDeviceId = await _getOrCreateGuestDeviceId();

    if (!_isCurrentLoad(loadGeneration, activeUid, activeIsGuest)) {
      return;
    }

    late final Map<String, _StoredCouponRedemption> loadedRedemptions;
    if (activeIsGuest) {
      loadedRedemptions = await _readGuestRedemptionsFromDevice(guestDeviceId);
    } else {
      final signedRedemptions = await _readSignedInRedemptionsFromFirestore(
        activeUid!,
      );
      if (!_isCurrentLoad(loadGeneration, activeUid, activeIsGuest)) {
        return;
      }
      final guestRedemptions = await _readGuestRedemptionsFromDevice(
        guestDeviceId,
      );
      loadedRedemptions = _mergeRedemptionsKeepingMostRecent(
        signedRedemptions,
        guestRedemptions,
      );
    }

    if (!_isCurrentLoad(loadGeneration, activeUid, activeIsGuest)) {
      return;
    }

    _loadedGuestDeviceId = guestDeviceId;
    _replaceMemory(loadedRedemptions);
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

  static Future<Map<String, _StoredCouponRedemption>>
  _readSignedInRedemptionsFromFirestore(String uid) async {
    final testingLoader = _signedStateLoaderForTesting;
    if (testingLoader != null) {
      final loaded = await testingLoader(uid);
      return loaded.map(
        (couponId, state) => MapEntry(
          couponId,
          _StoredCouponRedemption(
            lastRedeemedAt: state.lastRedeemedAt,
            timerStartedAt: state.timerStartedAt,
          ),
        ),
      );
    }
    final snapshot = await _redemptionsCollection(uid).get();
    final result = <String, _StoredCouponRedemption>{};

    for (final doc in snapshot.docs) {
      final data = doc.data();
      final lastRedeemedAt = _coerceDateTime(data['lastRedeemedAt']);
      final timerStartedAt = _coerceDateTime(data['timerStartedAt']);
      if (lastRedeemedAt != null || timerStartedAt != null) {
        result[doc.id] = _StoredCouponRedemption(
          lastRedeemedAt: lastRedeemedAt,
          timerStartedAt: timerStartedAt,
        );
      }
    }
    return result;
  }

  static Future<Map<String, _StoredCouponRedemption>>
  _readGuestRedemptionsFromDevice(String guestDeviceId) async {
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
          result[entry.key] = _StoredCouponRedemption(lastRedeemedAt: parsed);
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

  static Map<String, _StoredCouponRedemption>
  _mergeRedemptionsKeepingMostRecent(
    Map<String, _StoredCouponRedemption> first,
    Map<String, _StoredCouponRedemption> second,
  ) {
    final result = <String, _StoredCouponRedemption>{};
    _mergeRedemptionsInto(result, first);
    _mergeRedemptionsInto(result, second);
    return result;
  }

  static void _mergeRedemptionsInto(
    Map<String, _StoredCouponRedemption> target,
    Map<String, _StoredCouponRedemption> incoming,
  ) {
    for (final entry in incoming.entries) {
      final existing = target[entry.key];
      final existingLastRedeemedAt = existing?.lastRedeemedAt;
      final existingTimerStartedAt = existing?.timerStartedAt;
      final incomingLastRedeemedAt = entry.value.lastRedeemedAt;
      final incomingTimerStartedAt = entry.value.timerStartedAt;
      target[entry.key] = _StoredCouponRedemption(
        lastRedeemedAt:
            incomingLastRedeemedAt != null &&
                (existingLastRedeemedAt == null ||
                    incomingLastRedeemedAt.isAfter(existingLastRedeemedAt))
            ? incomingLastRedeemedAt
            : existingLastRedeemedAt,
        timerStartedAt:
            incomingTimerStartedAt != null &&
                (existingTimerStartedAt == null ||
                    incomingTimerStartedAt.isAfter(existingTimerStartedAt))
            ? incomingTimerStartedAt
            : existingTimerStartedAt,
      );
    }
  }

  static void _replaceMemory(Map<String, _StoredCouponRedemption> redemptions) {
    _clearMemory();
    for (final entry in redemptions.entries) {
      final lastRedeemedAt = entry.value.lastRedeemedAt;
      final timerStartedAt = entry.value.timerStartedAt;
      if (lastRedeemedAt != null) {
        _lastRedeemedAtByCoupon[entry.key] = lastRedeemedAt;
      }
      if (timerStartedAt != null) {
        _timerStartedAtByCoupon[entry.key] = timerStartedAt;
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

    await prefs.setString(_guestStorageKeyFor(guestDeviceId), jsonEncode(data));
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

    final remaining = timerStartedAt
        .add(redeemWindow)
        .difference(DateTime.now());
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

    await _persistRedemptionState(couponId: coupon.id, coupon: coupon);

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
    await _ensureAuthReady();
    final user = _currentAuthSnapshot();

    if (user == null) {
      throw StateError(
        'Please continue as guest or sign in before redeeming coupons.',
      );
    }

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

    await _redemptionsCollection(
      user.uid,
    ).doc(couponId).set(data, SetOptions(merge: true));
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

    final remaining = timerStartedAt
        .add(redeemWindow)
        .difference(DateTime.now());
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
    final shouldUpdate =
        existingLastRedeemedAt == null ||
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
    final shouldUpdate =
        existingLastRedeemedAt == null ||
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
    final guestDeviceId =
        await CustomerSessionService.getExistingGuestDeviceId();

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
        data['lastRedeemedAt'] = Timestamp.fromDate(
          entry.value.lastRedeemedAt!,
        );
        data['redeemedCount'] = 1;
      }

      if (entry.value.timerStartedAt != null) {
        data['timerStartedAt'] = Timestamp.fromDate(
          entry.value.timerStartedAt!,
        );
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

  static Future<void> _ensureAuthReady() async {
    final testingLoader = _ensureAuthReadyForTesting;
    if (testingLoader != null) {
      await testingLoader();
      return;
    }
    await CustomerSessionService.ensureAuthReady();
  }

  static DemoRedemptionAuthSnapshot? _currentAuthSnapshot() {
    final testingLoader = _currentAuthSnapshotForTesting;
    if (testingLoader != null) {
      return testingLoader();
    }
    final user = FirebaseAuth.instance.currentUser;
    return user == null ? null : (uid: user.uid, isAnonymous: user.isAnonymous);
  }

  static Stream<DemoRedemptionAuthSnapshot?> _authChanges() {
    final testingStream = _authChangesForTesting;
    if (testingStream != null) {
      return testingStream;
    }
    return FirebaseAuth.instance.authStateChanges().map(
      (user) =>
          user == null ? null : (uid: user.uid, isAnonymous: user.isAnonymous),
    );
  }

  static Future<String?> _getExistingGuestDeviceId() {
    return _existingGuestDeviceIdForTesting?.call() ??
        CustomerSessionService.getExistingGuestDeviceId();
  }

  static Future<String> _getOrCreateGuestDeviceId() {
    return _guestDeviceIdForTesting?.call() ??
        CustomerSessionService.getOrCreateGuestDeviceId();
  }

  static bool _matchesCurrentAuthUser(String? uid, bool isGuest) {
    final currentUser = _currentAuthSnapshot();
    if (currentUser == null) {
      return uid == null && !isGuest;
    }

    return currentUser.uid == uid && currentUser.isAnonymous == isGuest;
  }

  static bool _isCurrentLoad(int generation, String? uid, bool isGuest) {
    return generation == _loadGeneration &&
        _matchesCurrentAuthUser(uid, isGuest);
  }

  @visibleForTesting
  static void configureForTesting({
    required DemoRedemptionAuthSnapshot? Function() currentAuthSnapshot,
    Future<void> Function()? ensureAuthReady,
    Stream<DemoRedemptionAuthSnapshot?>? authChanges,
    Future<String?> Function()? existingGuestDeviceId,
    Future<String> Function()? guestDeviceId,
    DemoRedemptionSignedStateLoader? signedStateLoader,
  }) {
    if (_authSubscription != null || _initializingFuture != null) {
      throw StateError('Reset DemoRedemptionStore before configuring it.');
    }
    _currentAuthSnapshotForTesting = currentAuthSnapshot;
    _ensureAuthReadyForTesting = ensureAuthReady ?? () async {};
    _authChangesForTesting =
        authChanges ?? const Stream<DemoRedemptionAuthSnapshot?>.empty();
    _existingGuestDeviceIdForTesting =
        existingGuestDeviceId ?? () async => null;
    _guestDeviceIdForTesting = guestDeviceId ?? () async => 'guest-test-device';
    _signedStateLoaderForTesting =
        signedStateLoader ??
        (_) async => const <String, DemoRedemptionStoredState>{};
  }

  @visibleForTesting
  static void seedMemoryForTesting({
    required String loadedUid,
    Map<String, DateTime> lastRedeemedAtByCoupon = const <String, DateTime>{},
    Map<String, DateTime> timerStartedAtByCoupon = const <String, DateTime>{},
  }) {
    _clearMemory();
    _lastRedeemedAtByCoupon.addAll(lastRedeemedAtByCoupon);
    _timerStartedAtByCoupon.addAll(timerStartedAtByCoupon);
    _loadedUid = loadedUid;
    _loadedAsGuest = false;
    _initialized = true;
  }

  @visibleForTesting
  static DemoRedemptionStoredState? memoryStateForTesting(String couponId) {
    final lastRedeemedAt = _lastRedeemedAtByCoupon[couponId];
    final timerStartedAt = _timerStartedAtByCoupon[couponId];
    if (lastRedeemedAt == null && timerStartedAt == null) {
      return null;
    }
    return DemoRedemptionStoredState(
      lastRedeemedAt: lastRedeemedAt,
      timerStartedAt: timerStartedAt,
    );
  }

  @visibleForTesting
  static Future<void> resetForTesting() async {
    _loadGeneration++;
    final subscription = _authSubscription;
    _authSubscription = null;
    if (subscription != null) {
      await subscription.cancel();
    }
    _clearMemory();
    _initialized = false;
    _initializingFuture = null;
    _loadedUid = null;
    _loadedAsGuest = false;
    _loadedGuestDeviceId = null;
    _ensureAuthReadyForTesting = null;
    _currentAuthSnapshotForTesting = null;
    _authChangesForTesting = null;
    _existingGuestDeviceIdForTesting = null;
    _guestDeviceIdForTesting = null;
    _signedStateLoaderForTesting = null;
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

  const _StoredCouponRedemption({this.lastRedeemedAt, this.timerStartedAt});
}
