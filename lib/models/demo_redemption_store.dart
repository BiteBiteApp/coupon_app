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

  static FirebaseFirestore get _firestore =>
      _firestoreForTesting ?? FirebaseFirestore.instance;
  static FirebaseFirestore? _firestoreForTesting;
  static Future<void> Function(String key, String value)?
  _guestStateWriterForTesting;
  static Future<void>? _guestWriteTail;
  static bool _legacyWritesEnabled = true;

  static bool get legacyWritesEnabled => _legacyWritesEnabled;

  /// Called by the existing bounded customer composition before it is exposed.
  /// Retirement is one-way for this process, including already scheduled work.
  static void retireLegacyWritersForBoundedCutover() {
    if (!_legacyWritesEnabled) return;
    _legacyWritesEnabled = false;
    _loadGeneration++;
    _clearMemory();
    _initialized = false;
    _initializingFuture = null;
  }

  static const String _guestStorageKeyPrefix = 'guest_coupon_redemptions';
  static const Duration redeemWindow = Duration(minutes: 5);

  static final Map<String, DateTime> _lastRedeemedAtByCoupon = {};
  static final Map<String, DateTime> _timerStartedAtByCoupon = {};
  static final Map<String, Timer> _expiryTimersByCoupon = {};
  static final Map<String, Future<void>> _pendingFinalizationsByCoupon = {};
  static final Map<String, DateTime> _deferredFinalizationsByCoupon = {};

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
    if (!legacyWritesEnabled) return Future<void>.value();
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
    if (!legacyWritesEnabled) return;
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
    if (!_isCurrentLoad(loadGeneration, activeUid, activeIsGuest)) return;
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
    _pendingFinalizationsByCoupon.clear();
    _deferredFinalizationsByCoupon.clear();
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
    if (_guestWriteTail case final pendingWrite?) await pendingWrite;
    final prefs = await SharedPreferences.getInstance();
    return _decodeGuestRedemptions(
      prefs.getString(_guestStorageKeyFor(guestDeviceId)),
    );
  }

  static Map<String, _StoredCouponRedemption> _decodeGuestRedemptions(
    String? rawJson,
  ) {
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

  static Future<_StoredCouponRedemption?> _saveGuestRedemptionToDevice({
    required String guestDeviceId,
    required String couponId,
    required _StoredCouponRedemption state,
    required bool Function() isCurrent,
    DateTime? finalizedTimerStartedAt,
  }) {
    // Serialize read/modify/write of the existing device key. Each operation
    // changes only its captured coupon, never a later account's memory snapshot.
    final write = (_guestWriteTail ?? SynchronousFuture<void>(null))
        .then<_StoredCouponRedemption?>((_) async {
          if (!isCurrent()) return null;
          final prefs = await SharedPreferences.getInstance();
          if (!isCurrent()) return null;
          final key = _guestStorageKeyFor(guestDeviceId);
          final redemptions = _decodeGuestRedemptions(prefs.getString(key));
          final existing = redemptions[couponId];
          final latestLastRedeemedAt = _laterDate(
            existing?.lastRedeemedAt,
            state.lastRedeemedAt,
          );
          final existingTimer = existing?.timerStartedAt;
          redemptions[couponId] = _StoredCouponRedemption(
            lastRedeemedAt: latestLastRedeemedAt,
            timerStartedAt: finalizedTimerStartedAt == null
                ? _laterDate(existingTimer, state.timerStartedAt)
                : existingTimer == finalizedTimerStartedAt
                ? null
                : existingTimer,
          );
          final data = <String, Map<String, String>>{
            for (final entry in redemptions.entries)
              entry.key: <String, String>{
                if (entry.value.lastRedeemedAt != null)
                  'lastRedeemedAt': entry.value.lastRedeemedAt!
                      .toIso8601String(),
                if (entry.value.timerStartedAt != null)
                  'timerStartedAt': entry.value.timerStartedAt!
                      .toIso8601String(),
              },
          };
          final encoded = jsonEncode(data);
          if (_guestStateWriterForTesting case final writer?) {
            await writer(key, encoded);
          } else {
            await prefs.setString(key, encoded);
          }
          return redemptions[couponId];
        });
    // A failed operation must not poison subsequent independent saves.
    late final Future<void> tail;
    void completed() {
      if (identical(_guestWriteTail, tail)) _guestWriteTail = null;
    }

    tail = write.then<void>(
      (_) => completed(),
      onError: (Object _, StackTrace _) => completed(),
    );
    _guestWriteTail = tail;
    return write;
  }

  static DateTime? _laterDate(DateTime? first, DateTime? second) =>
      second != null && (first == null || second.isAfter(first))
      ? second
      : first;

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
    if (!legacyWritesEnabled) {
      throw StateError(
        'Legacy coupon use is retired for the bounded customer path.',
      );
    }
    await ensureInitialized();
    if (!legacyWritesEnabled ||
        !_matchesCurrentAuthUser(_loadedUid, _loadedAsGuest)) {
      throw StateError('The customer session changed. Please try again.');
    }

    if (!supportsRedeemTimer(coupon.usageRule)) {
      return;
    }

    final generation = _loadGeneration;
    final uid = _loadedUid;
    final isGuest = _loadedAsGuest;
    while (true) {
      final hasActiveTimer = hasActiveRedeemTimer(coupon.id);
      if (_pendingFinalizationsByCoupon[coupon.id] case final finalization?) {
        await finalization;
      } else if (_deferredFinalizationsByCoupon[coupon.id]
          case final deferredAnchor?) {
        // A failed completion still owns the durable timer. Retry it before a
        // new use can replace that anchor, including after offline recovery.
        await _persistRedemptionState(
          couponId: coupon.id,
          finalizedTimerStartedAt: deferredAnchor,
        );
        if (_isCurrentLoad(generation, uid, isGuest) &&
            _deferredFinalizationsByCoupon[coupon.id] == deferredAnchor) {
          _deferredFinalizationsByCoupon.remove(coupon.id);
        }
      } else {
        if (hasActiveTimer) return;
        break;
      }
      if (!_isCurrentLoad(generation, uid, isGuest)) {
        throw StateError('The customer session changed. Please try again.');
      }
      // Persistence can discover another expired remote anchor. Settle its
      // finalizer too before deciding whether a new use is available.
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
    DateTime? finalizedTimerStartedAt,
  }) async {
    // Capture the owner and coupon before yielding. Auth refreshes can clear or
    // replace both maps while auth readiness or persistence is pending.
    final uid = _loadedUid;
    final isGuest = _loadedAsGuest;
    final generation = _loadGeneration;
    final guestDeviceId = _loadedGuestDeviceId;
    final state = _StoredCouponRedemption(
      lastRedeemedAt: _lastRedeemedAtByCoupon[couponId],
      timerStartedAt: _timerStartedAtByCoupon[couponId],
    );
    bool isCurrent() => _isCurrentLoad(generation, uid, isGuest);

    await _ensureAuthReady();
    if (!isCurrent()) {
      if (coupon != null) {
        throw StateError('The customer session changed. Please try again.');
      }
      return;
    }
    if (uid == null) {
      throw StateError(
        'Please continue as guest or sign in before redeeming coupons.',
      );
    }

    if (isGuest) {
      if (guestDeviceId == null) {
        throw StateError('The guest customer session is not initialized.');
      }
      final persisted = await _saveGuestRedemptionToDevice(
        guestDeviceId: guestDeviceId,
        couponId: couponId,
        state: state,
        isCurrent: isCurrent,
        finalizedTimerStartedAt: finalizedTimerStartedAt,
      );
      if (isCurrent() && persisted != null) {
        _reconcilePersistedState(couponId, state, persisted);
      }
      if (coupon != null && !isCurrent()) {
        throw StateError('The customer session changed. Please try again.');
      }
      return;
    }

    final reference = _redemptionsCollection(uid).doc(couponId);
    if (finalizedTimerStartedAt != null) {
      final completedAt = finalizedTimerStartedAt.add(redeemWindow);
      final newerState = await _firestore
          .runTransaction<_StoredCouponRedemption?>((transaction) async {
            if (!isCurrent()) return null;
            final snapshot = await transaction.get(reference);
            if (!isCurrent()) return null;
            final existing = snapshot.data();
            final existingTimer = _coerceDateTime(existing?['timerStartedAt']);
            // A newer remote use owns its timer; an older reader cannot clear it.
            if (existingTimer != null &&
                existingTimer != finalizedTimerStartedAt) {
              return _StoredCouponRedemption(
                lastRedeemedAt: _coerceDateTime(existing?['lastRedeemedAt']),
                timerStartedAt: existingTimer,
              );
            }
            final lastRedeemedAt = _coerceDateTime(existing?['lastRedeemedAt']);
            final shouldUpdate =
                lastRedeemedAt == null || completedAt.isAfter(lastRedeemedAt);
            final persistedState = _StoredCouponRedemption(
              lastRedeemedAt: _laterDate(lastRedeemedAt, completedAt),
            );
            if (!shouldUpdate && existingTimer == null) return persistedState;
            transaction.set(reference, <String, dynamic>{
              'couponId': couponId,
              'updatedAt': FieldValue.serverTimestamp(),
              if (existingTimer == finalizedTimerStartedAt)
                'timerStartedAt': FieldValue.delete(),
              if (shouldUpdate) ...<String, dynamic>{
                'lastRedeemedAt': Timestamp.fromDate(completedAt),
                'redeemedCount': FieldValue.increment(1),
              },
            }, SetOptions(merge: true));
            return persistedState;
          });
      if (isCurrent() && newerState != null) {
        _reconcilePersistedState(couponId, state, newerState);
      }
      return;
    }

    await reference.set(<String, dynamic>{
      'couponId': couponId,
      'updatedAt': FieldValue.serverTimestamp(),
      // Starting a timer does not replace previously recorded use history.
      if (state.timerStartedAt != null)
        'timerStartedAt': Timestamp.fromDate(state.timerStartedAt!),
      if (coupon != null) ...<String, dynamic>{
        'couponTitle': coupon.title,
        'restaurant': coupon.restaurant,
        'usageRule': coupon.usageRule,
      },
    }, SetOptions(merge: true));
  }

  static void _reconcilePersistedState(
    String couponId,
    _StoredCouponRedemption expected,
    _StoredCouponRedemption persisted,
  ) {
    // A finalizer may observe a later use while it is pending. Restore that
    // timer for display only if no later local action has replaced our state.
    if (_lastRedeemedAtByCoupon[couponId] != expected.lastRedeemedAt ||
        _timerStartedAtByCoupon[couponId] != expected.timerStartedAt) {
      return;
    }
    final lastRedeemedAt = _laterDate(
      expected.lastRedeemedAt,
      persisted.lastRedeemedAt,
    );
    var changed = lastRedeemedAt != expected.lastRedeemedAt;
    if (lastRedeemedAt != null) {
      _lastRedeemedAtByCoupon[couponId] = lastRedeemedAt;
    }
    if (persisted.timerStartedAt != null &&
        persisted.timerStartedAt != expected.timerStartedAt) {
      _timerStartedAtByCoupon[couponId] = persisted.timerStartedAt!;
      _scheduleExpiryTimer(couponId);
      changed = true;
    }
    if (changed) changes.value++;
  }

  static void _scheduleAllExpiryTimers() {
    for (final couponId in _timerStartedAtByCoupon.keys.toList()) {
      _scheduleExpiryTimer(couponId);
    }
  }

  static void _scheduleExpiryTimer(String couponId) {
    if (!legacyWritesEnabled) return;
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
    if (timerStartedAt == null ||
        DateTime.now().isBefore(timerStartedAt.add(redeemWindow))) {
      return;
    }
    unawaited(_finalizeExpiredTimerIfNeeded(couponId));
  }

  static Future<void> _finalizeExpiredTimersIfNeeded() async {
    final generation = _loadGeneration;
    final uid = _loadedUid;
    final isGuest = _loadedAsGuest;
    for (final couponId in _timerStartedAtByCoupon.keys.toList()) {
      if (!_isCurrentLoad(generation, uid, isGuest)) return;
      await _finalizeExpiredTimerIfNeeded(couponId);
    }
  }

  static Future<void> _finalizeExpiredTimerIfNeeded(String couponId) {
    final pending = _pendingFinalizationsByCoupon[couponId];
    if (pending != null) return pending;
    final finalization = _finalizeExpiredTimer(couponId);
    _pendingFinalizationsByCoupon[couponId] = finalization;
    return finalization.whenComplete(() {
      if (identical(_pendingFinalizationsByCoupon[couponId], finalization)) {
        _pendingFinalizationsByCoupon.remove(couponId);
      }
    });
  }

  static Future<void> _finalizeExpiredTimer(String couponId) async {
    if (!legacyWritesEnabled ||
        !_matchesCurrentAuthUser(_loadedUid, _loadedAsGuest)) {
      return;
    }
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

    // Read-triggered finalization updates memory synchronously, so repeated
    // reads cannot schedule duplicate consumption while persistence is pending.
    final generation = _loadGeneration;
    final uid = _loadedUid;
    final isGuest = _loadedAsGuest;
    changes.value++;
    try {
      await _persistRedemptionState(
        couponId: couponId,
        finalizedTimerStartedAt: timerStartedAt,
      );
    } on FirebaseException catch (error) {
      // Transactions cannot complete offline. Keep the local completion and
      // durable original timer; refresh/load or the next explicit use retries.
      if (_isCurrentLoad(generation, uid, isGuest)) {
        _deferredFinalizationsByCoupon[couponId] = timerStartedAt;
      }
      debugPrint('Legacy coupon finalization deferred: ${error.code}');
    }
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
    bool canImport() =>
        legacyWritesEnabled && _matchesCurrentAuthUser(targetUid, false);
    if (!canImport()) return;
    final guestDeviceId = await _getExistingGuestDeviceId();

    if (guestDeviceId == null || guestDeviceId.trim().isEmpty) {
      return;
    }

    final localGuestRedemptions = await _readGuestRedemptionsFromDevice(
      guestDeviceId,
    );

    if (!canImport() || localGuestRedemptions.isEmpty) {
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

    if (!canImport()) return;
    await batch.commit();
  }

  static Future<void> refreshFromFirestore() async {
    if (!legacyWritesEnabled) return;
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
    return legacyWritesEnabled &&
        generation == _loadGeneration &&
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
    FirebaseFirestore? firestore,
    Future<void> Function(String key, String value)? guestStateWriter,
  }) {
    if (_authSubscription != null || _initializingFuture != null) {
      throw StateError('Reset DemoRedemptionStore before configuring it.');
    }
    _firestoreForTesting = firestore;
    _guestStateWriterForTesting = guestStateWriter;
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
    bool loadedAsGuest = false,
    String? loadedGuestDeviceId,
    Map<String, DateTime> lastRedeemedAtByCoupon = const <String, DateTime>{},
    Map<String, DateTime> timerStartedAtByCoupon = const <String, DateTime>{},
  }) {
    _clearMemory();
    _lastRedeemedAtByCoupon.addAll(lastRedeemedAtByCoupon);
    _timerStartedAtByCoupon.addAll(timerStartedAtByCoupon);
    _loadedUid = loadedUid;
    _loadedAsGuest = loadedAsGuest;
    _loadedGuestDeviceId = loadedGuestDeviceId;
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
    if (_guestWriteTail case final pendingWrite?) await pendingWrite;
    _guestWriteTail = null;
    _legacyWritesEnabled = true;
    _firestoreForTesting = null;
    _guestStateWriterForTesting = null;
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
