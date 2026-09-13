import 'dart:async';
import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/customer_bitesaver_favorite.dart';
import '../models/customer_bitesaver_search.dart';

const Duration customerBiteSaverGuestRedemptionTimerDuration = Duration(
  minutes: 5,
);
const int customerBiteSaverGuestCheckMaximumCandidates = 75;

/// The deliberately small key-value surface used by the guest usage store.
///
/// There is no key-enumeration operation: guest checks must point-read only the
/// bounded offer IDs supplied by the server.
abstract interface class CustomerBiteSaverGuestUsagePreferences {
  Future<String?> getString(String key);

  Future<void> setString(String key, String value);

  Future<void> remove(String key);
}

final class SharedPreferencesAsyncCustomerBiteSaverGuestUsagePreferences
    implements CustomerBiteSaverGuestUsagePreferences {
  final SharedPreferencesAsync _preferences;

  SharedPreferencesAsyncCustomerBiteSaverGuestUsagePreferences({
    SharedPreferencesAsync? preferences,
  }) : _preferences = preferences ?? SharedPreferencesAsync();

  @override
  Future<String?> getString(String key) => _preferences.getString(key);

  @override
  Future<void> setString(String key, String value) =>
      _preferences.setString(key, value);

  @override
  Future<void> remove(String key) => _preferences.remove(key);
}

enum CustomerBiteSaverGuestUsageFailure {
  invalidArgument,
  readFailed,
  writeFailed,
  corruptData,
  revisionChanged,
  evaluationExpired,
  validationExpired,
  unavailable,
}

final class CustomerBiteSaverLocalUsageCandidate {
  const CustomerBiteSaverLocalUsageCandidate({
    required this.offerId,
    required this.usagePolicy,
  });

  final CustomerBiteSaverOfferId offerId;
  final CustomerBiteSaverUsagePolicy usagePolicy;
}

final class CustomerBiteSaverGuestUsageException implements Exception {
  final CustomerBiteSaverGuestUsageFailure failure;

  const CustomerBiteSaverGuestUsageException(this.failure);

  @override
  String toString() => 'CustomerBiteSaverGuestUsageException($failure)';
}

final class CustomerBiteSaverGuestCandidateEvaluation {
  final int guestStateRevision;
  final bool allEvaluated;
  final List<CustomerBiteSaverOfferId> unavailableOfferIds;
  final Map<CustomerBiteSaverOfferId, int> activeTimerExpiresAtMillisByOfferId;

  CustomerBiteSaverGuestCandidateEvaluation({
    required this.guestStateRevision,
    required this.allEvaluated,
    required List<CustomerBiteSaverOfferId> unavailableOfferIds,
    Map<CustomerBiteSaverOfferId, int> activeTimerExpiresAtMillisByOfferId =
        const <CustomerBiteSaverOfferId, int>{},
  }) : unavailableOfferIds = List<CustomerBiteSaverOfferId>.unmodifiable(
         unavailableOfferIds,
       ),
       activeTimerExpiresAtMillisByOfferId =
           Map<CustomerBiteSaverOfferId, int>.unmodifiable(
             activeTimerExpiresAtMillisByOfferId,
           );
}

enum CustomerBiteSaverGuestRedemptionStartStatus { started, replayed, active }

final class CustomerBiteSaverGuestRedemptionStart {
  final CustomerBiteSaverRestaurantId restaurantId;
  final CustomerBiteSaverOfferId offerId;
  final String redemptionRequestId;
  final CustomerBiteSaverGuestRedemptionStartStatus status;
  final int timerStartedAtMillis;
  final int timerExpiresAtMillis;
  final int guestStateRevision;

  const CustomerBiteSaverGuestRedemptionStart({
    required this.restaurantId,
    required this.offerId,
    required this.redemptionRequestId,
    required this.status,
    required this.timerStartedAtMillis,
    required this.timerExpiresAtMillis,
    required this.guestStateRevision,
  });

  bool get didMutate =>
      status == CustomerBiteSaverGuestRedemptionStartStatus.started;
}

/// Device-local guest usage history for the fresh BiteSaver v1 namespace.
///
/// The backend remains authoritative for discovery and offer eligibility. This
/// store answers only the server's bounded local-history challenges and makes
/// an explicitly validated guest redemption start durable.
final class CustomerBiteSaverGuestUsageStore {
  static const int schemaVersion = 1;
  static const String namespace = 'bitesaver_guest_usage_v1';

  static final RegExp _guestDeviceIdPattern = RegExp(r'^[A-Za-z0-9_-]{1,256}$');
  static final RegExp _redemptionRequestIdPattern = RegExp(
    r'^[A-Za-z0-9_-]{16,128}$',
  );

  static const int _maximumSafeInteger = 9007199254740991;
  static const int _maximumDateTimeMillis = 8640000000000000;
  static final Map<String, _GuestUsageOperationQueue> _operationQueues =
      <String, _GuestUsageOperationQueue>{};

  final String guestDeviceId;
  final CustomerBiteSaverGuestUsagePreferences _preferences;
  final DateTime Function() _clock;

  CustomerBiteSaverGuestUsageStore({
    required this.guestDeviceId,
    CustomerBiteSaverGuestUsagePreferences? preferences,
    DateTime Function()? clock,
  }) : _preferences =
           preferences ??
           SharedPreferencesAsyncCustomerBiteSaverGuestUsagePreferences(),
       _clock = clock ?? _utcNow {
    if (!_guestDeviceIdPattern.hasMatch(guestDeviceId)) {
      throw const CustomerBiteSaverGuestUsageException(
        CustomerBiteSaverGuestUsageFailure.invalidArgument,
      );
    }
  }

  String get metaKey => '$namespace:$guestDeviceId:meta';

  String get journalKey => '$namespace:$guestDeviceId:journal';

  String offerKey(CustomerBiteSaverOfferId offerId) =>
      '$namespace:$guestDeviceId:offer:${offerId.value}';

  Future<int> readRevision() {
    return _serialized(() async {
      await _recoverJournal();
      return (await _readMeta() ?? _GuestUsageMeta.empty()).revision;
    });
  }

  Future<CustomerBiteSaverGuestCandidateEvaluation> evaluateCandidates(
    List<CustomerBiteSaverGuestCheckCandidate> candidates,
    CustomerBiteSaverEvaluationContext evaluationContext,
  ) => _evaluateCandidates(
    candidates
        .map(
          (candidate) => CustomerBiteSaverLocalUsageCandidate(
            offerId: candidate.offerId,
            usagePolicy: switch (candidate.usagePolicy) {
              CustomerBiteSaverGuestUsagePolicy.oncePerCustomer =>
                CustomerBiteSaverUsagePolicy.oncePerCustomer,
              CustomerBiteSaverGuestUsagePolicy.oncePerDay =>
                CustomerBiteSaverUsagePolicy.oncePerDay,
            },
          ),
        )
        .toList(growable: false),
    evaluationContext,
  );

  Future<CustomerBiteSaverGuestCandidateEvaluation> evaluateLocalCandidates(
    List<CustomerBiteSaverLocalUsageCandidate> candidates,
    CustomerBiteSaverEvaluationContext evaluationContext,
  ) => _evaluateCandidates(candidates, evaluationContext);

  Future<CustomerBiteSaverGuestCandidateEvaluation> _evaluateCandidates(
    List<CustomerBiteSaverLocalUsageCandidate> candidates,
    CustomerBiteSaverEvaluationContext evaluationContext,
  ) {
    return _serialized(() async {
      _validateEvaluationContext(evaluationContext);
      _requireLiveEvaluationContext(evaluationContext);
      if (candidates.isEmpty ||
          candidates.length > customerBiteSaverGuestCheckMaximumCandidates) {
        throw const CustomerBiteSaverGuestUsageException(
          CustomerBiteSaverGuestUsageFailure.invalidArgument,
        );
      }
      final candidateIds = <String>{};
      for (final candidate in candidates) {
        if (!candidateIds.add(candidate.offerId.value)) {
          throw const CustomerBiteSaverGuestUsageException(
            CustomerBiteSaverGuestUsageFailure.invalidArgument,
          );
        }
      }

      await _recoverJournal();
      final initialPersistedMeta = await _readMeta();
      final initialMeta = initialPersistedMeta ?? _GuestUsageMeta.empty();
      final unavailable = <CustomerBiteSaverOfferId>[];
      final activeTimers = <CustomerBiteSaverOfferId, int>{};

      for (final candidate in candidates) {
        final record = await _readOffer(candidate.offerId);
        final indexedAsActive = initialMeta.activeOfferIds.contains(
          candidate.offerId.value,
        );
        if (record == null) {
          if (indexedAsActive) {
            throw const CustomerBiteSaverGuestUsageException(
              CustomerBiteSaverGuestUsageFailure.corruptData,
            );
          }
          continue;
        }
        if (initialPersistedMeta == null ||
            record.offerId != candidate.offerId.value ||
            record.committedRevision > initialMeta.revision) {
          throw const CustomerBiteSaverGuestUsageException(
            CustomerBiteSaverGuestUsageFailure.corruptData,
          );
        }
        final isActive =
            record.timerExpiresAtMillis > evaluationContext.evaluationAtMillis;
        if (isActive && !indexedAsActive) {
          throw const CustomerBiteSaverGuestUsageException(
            CustomerBiteSaverGuestUsageFailure.corruptData,
          );
        }
        if (isActive &&
            candidate.usagePolicy != CustomerBiteSaverUsagePolicy.unlimited) {
          activeTimers[candidate.offerId] = record.timerExpiresAtMillis;
        }
        if (_isUnavailable(record, candidate.usagePolicy, evaluationContext)) {
          unavailable.add(candidate.offerId);
        }
      }

      final finalPersistedMeta = await _readMeta();
      if (!_sameNullableMeta(initialPersistedMeta, finalPersistedMeta)) {
        throw const CustomerBiteSaverGuestUsageException(
          CustomerBiteSaverGuestUsageFailure.revisionChanged,
        );
      }
      _requireLiveEvaluationContext(evaluationContext);

      return CustomerBiteSaverGuestCandidateEvaluation(
        guestStateRevision: initialMeta.revision,
        allEvaluated: true,
        unavailableOfferIds: unavailable,
        activeTimerExpiresAtMillisByOfferId: activeTimers,
      );
    });
  }

  Future<CustomerBiteSaverGuestRedemptionStart> startRedemption({
    required String redemptionRequestId,
    required CustomerBiteSaverRestaurantId restaurantId,
    required CustomerBiteSaverOfferId offerId,
    required CustomerBiteSaverGuestUsagePolicy usagePolicy,
    required CustomerBiteSaverEvaluationContext evaluationContext,
    required int validationExpiresAtMillis,
    required int expectedGuestStateRevision,
    bool reusableAfterTimer = false,
  }) {
    return _serialized(() async {
      _validateStartInput(
        redemptionRequestId: redemptionRequestId,
        evaluationContext: evaluationContext,
        validationExpiresAtMillis: validationExpiresAtMillis,
        expectedGuestStateRevision: expectedGuestStateRevision,
      );
      final validationIsLive = _validationIsLive(validationExpiresAtMillis);
      final evaluationIsLive = _evaluationContextIsLive(evaluationContext);
      final authorizationIsLive = validationIsLive && evaluationIsLive;
      final recoveredCommittedExactReplay = authorizationIsLive
          ? false
          : await _recoverCommittedExactReplay(
              redemptionRequestId: redemptionRequestId,
              restaurantId: restaurantId,
              offerId: offerId,
              usagePolicy: usagePolicy,
              reusableAfterTimer: reusableAfterTimer,
              evaluationContext: evaluationContext,
              validationExpiresAtMillis: validationExpiresAtMillis,
              expectedGuestStateRevision: expectedGuestStateRevision,
            );
      if (!authorizationIsLive && !recoveredCommittedExactReplay) {
        throw CustomerBiteSaverGuestUsageException(
          validationIsLive
              ? CustomerBiteSaverGuestUsageFailure.evaluationExpired
              : CustomerBiteSaverGuestUsageFailure.validationExpired,
        );
      }
      if (authorizationIsLive) {
        await _recoverJournal();
      }

      final persistedMeta = await _readMeta();
      final meta = persistedMeta ?? _GuestUsageMeta.empty();
      final existing = await _readOffer(offerId);
      if (existing != null &&
          (persistedMeta == null ||
              existing.offerId != offerId.value ||
              existing.restaurantId != restaurantId.value ||
              existing.committedRevision > meta.revision)) {
        throw const CustomerBiteSaverGuestUsageException(
          CustomerBiteSaverGuestUsageFailure.corruptData,
        );
      }
      final existingIsActive =
          existing != null &&
          existing.timerExpiresAtMillis > evaluationContext.evaluationAtMillis;
      final indexedAsActive = meta.activeOfferIds.contains(offerId.value);

      final recheckedMeta = await _readMeta();
      final recheckedExisting = await _readOffer(offerId);
      if (!_sameNullableMeta(persistedMeta, recheckedMeta) ||
          !_sameNullableOffer(existing, recheckedExisting)) {
        throw const CustomerBiteSaverGuestUsageException(
          CustomerBiteSaverGuestUsageFailure.revisionChanged,
        );
      }
      final hasSameRedemptionRequestId =
          existing?.redemptionRequestId == redemptionRequestId;
      final matchesExactReplayPayload =
          hasSameRedemptionRequestId &&
          _matchesExactReplayPayload(
            existing!,
            redemptionRequestId: redemptionRequestId,
            restaurantId: restaurantId,
            offerId: offerId,
            usagePolicy: usagePolicy,
            reusableAfterTimer: reusableAfterTimer,
            evaluationContext: evaluationContext,
            validationExpiresAtMillis: validationExpiresAtMillis,
            expectedGuestStateRevision: expectedGuestStateRevision,
          );
      if (matchesExactReplayPayload) {
        final replayOffer = existing;
        if (meta.revision < replayOffer.committedRevision) {
          throw const CustomerBiteSaverGuestUsageException(
            CustomerBiteSaverGuestUsageFailure.corruptData,
          );
        }
        if (existingIsActive &&
            !indexedAsActive &&
            meta.revision == replayOffer.committedRevision) {
          throw const CustomerBiteSaverGuestUsageException(
            CustomerBiteSaverGuestUsageFailure.corruptData,
          );
        }
        return _startResult(
          replayOffer,
          CustomerBiteSaverGuestRedemptionStartStatus.replayed,
          meta.revision,
        );
      }
      if ((existingIsActive && !indexedAsActive) ||
          (existing == null && indexedAsActive)) {
        throw const CustomerBiteSaverGuestUsageException(
          CustomerBiteSaverGuestUsageFailure.corruptData,
        );
      }
      if (hasSameRedemptionRequestId) {
        throw const CustomerBiteSaverGuestUsageException(
          CustomerBiteSaverGuestUsageFailure.invalidArgument,
        );
      }

      _requireLiveAuthorization(evaluationContext, validationExpiresAtMillis);

      if (meta.revision != expectedGuestStateRevision) {
        throw const CustomerBiteSaverGuestUsageException(
          CustomerBiteSaverGuestUsageFailure.revisionChanged,
        );
      }
      if (existingIsActive) {
        return _startResult(
          existing,
          CustomerBiteSaverGuestRedemptionStartStatus.active,
          meta.revision,
        );
      }
      if (existing != null &&
          !reusableAfterTimer &&
          _isUnavailable(
            existing,
            _localUsagePolicy(usagePolicy),
            evaluationContext,
          )) {
        throw const CustomerBiteSaverGuestUsageException(
          CustomerBiteSaverGuestUsageFailure.unavailable,
        );
      }
      if (meta.revision >= _maximumSafeInteger) {
        throw const CustomerBiteSaverGuestUsageException(
          CustomerBiteSaverGuestUsageFailure.corruptData,
        );
      }

      final activeOfferIds = await _stillActiveOfferIds(
        meta,
        evaluationContext.evaluationAtMillis,
        alreadyReadOffer: existing,
      );
      activeOfferIds.add(offerId.value);
      final sortedActiveOfferIds = activeOfferIds.toList()..sort();
      final nextMeta = _GuestUsageMeta(
        revision: meta.revision + 1,
        activeOfferIds: sortedActiveOfferIds,
      );
      final timerStartedAtMillis = evaluationContext.evaluationAtMillis;
      final nextOffer = _GuestUsageOffer(
        restaurantId: restaurantId.value,
        offerId: offerId.value,
        redemptionRequestId: redemptionRequestId,
        usagePolicy: usagePolicy,
        reusableAfterTimer: reusableAfterTimer,
        committedRevision: nextMeta.revision,
        evaluationContext: evaluationContext,
        validationExpiresAtMillis: validationExpiresAtMillis,
        timerStartedAtMillis: timerStartedAtMillis,
        timerExpiresAtMillis:
            timerStartedAtMillis +
            customerBiteSaverGuestRedemptionTimerDuration.inMilliseconds,
      );

      final finalPersistedMeta = await _readMeta();
      final finalExisting = await _readOffer(offerId);
      if (!_sameNullableMeta(persistedMeta, finalPersistedMeta) ||
          !_sameNullableOffer(existing, finalExisting)) {
        throw const CustomerBiteSaverGuestUsageException(
          CustomerBiteSaverGuestUsageFailure.revisionChanged,
        );
      }
      _requireLiveAuthorization(evaluationContext, validationExpiresAtMillis);

      final journal = _GuestUsageJournal(
        previousMeta: persistedMeta,
        nextMeta: nextMeta,
        previousOffer: existing,
        nextOffer: nextOffer,
      );
      await _write(journalKey, jsonEncode(journal.toJson()));
      await _write(offerKey(offerId), jsonEncode(nextOffer.toJson()));
      await _write(metaKey, jsonEncode(nextMeta.toJson()));
      await _remove(journalKey);

      return _startResult(
        nextOffer,
        CustomerBiteSaverGuestRedemptionStartStatus.started,
        nextMeta.revision,
      );
    });
  }

  Future<Set<String>> _stillActiveOfferIds(
    _GuestUsageMeta meta,
    int evaluationAtMillis, {
    required _GuestUsageOffer? alreadyReadOffer,
  }) async {
    final active = <String>{};
    for (final offerIdValue in meta.activeOfferIds) {
      _GuestUsageOffer? record;
      if (alreadyReadOffer?.offerId == offerIdValue) {
        record = alreadyReadOffer;
      } else {
        record = await _readOffer(CustomerBiteSaverOfferId(offerIdValue));
      }
      if (record == null ||
          record.offerId != offerIdValue ||
          record.committedRevision > meta.revision) {
        throw const CustomerBiteSaverGuestUsageException(
          CustomerBiteSaverGuestUsageFailure.corruptData,
        );
      }
      if (record.timerExpiresAtMillis > evaluationAtMillis) {
        active.add(offerIdValue);
      }
    }
    return active;
  }

  bool _isUnavailable(
    _GuestUsageOffer record,
    CustomerBiteSaverUsagePolicy usagePolicy,
    CustomerBiteSaverEvaluationContext context,
  ) {
    if (record.timerExpiresAtMillis > context.evaluationAtMillis) {
      return false;
    }
    switch (usagePolicy) {
      case CustomerBiteSaverUsagePolicy.oncePerCustomer:
        return true;
      case CustomerBiteSaverUsagePolicy.oncePerDay:
        return context.oncePerDayUnavailableAt(record.timerExpiresAtMillis);
      case CustomerBiteSaverUsagePolicy.unlimited:
      case CustomerBiteSaverUsagePolicy.reusableAfterTimer:
        return false;
    }
  }

  CustomerBiteSaverGuestRedemptionStart _startResult(
    _GuestUsageOffer offer,
    CustomerBiteSaverGuestRedemptionStartStatus status,
    int revision,
  ) {
    try {
      return CustomerBiteSaverGuestRedemptionStart(
        restaurantId: CustomerBiteSaverRestaurantId(offer.restaurantId),
        offerId: CustomerBiteSaverOfferId(offer.offerId),
        redemptionRequestId: offer.redemptionRequestId,
        status: status,
        timerStartedAtMillis: offer.timerStartedAtMillis,
        timerExpiresAtMillis: offer.timerExpiresAtMillis,
        guestStateRevision: revision,
      );
    } on FormatException {
      throw const CustomerBiteSaverGuestUsageException(
        CustomerBiteSaverGuestUsageFailure.corruptData,
      );
    }
  }

  void _validateStartInput({
    required String redemptionRequestId,
    required CustomerBiteSaverEvaluationContext evaluationContext,
    required int validationExpiresAtMillis,
    required int expectedGuestStateRevision,
  }) {
    _validateEvaluationContext(evaluationContext);
    final timerMillis =
        customerBiteSaverGuestRedemptionTimerDuration.inMilliseconds;
    if (!_redemptionRequestIdPattern.hasMatch(redemptionRequestId) ||
        !_isSafeNonNegativeInteger(expectedGuestStateRevision) ||
        !_isTimestamp(validationExpiresAtMillis) ||
        validationExpiresAtMillis <= evaluationContext.evaluationAtMillis ||
        validationExpiresAtMillis >
            evaluationContext.evaluationAtMillis +
                Duration.millisecondsPerMinute ||
        evaluationContext.evaluationAtMillis >
            _maximumDateTimeMillis - timerMillis) {
      throw const CustomerBiteSaverGuestUsageException(
        CustomerBiteSaverGuestUsageFailure.invalidArgument,
      );
    }
  }

  void _validateEvaluationContext(CustomerBiteSaverEvaluationContext context) {
    if (!_isTimestamp(context.evaluationAtMillis) ||
        !_isTimestamp(context.validUntilExclusiveMillis) ||
        context.timeZone.isEmpty ||
        context.timeZone.length > 128 ||
        context.timeZone.trim() != context.timeZone ||
        context.utcOffsetMinutes < -840 ||
        context.utcOffsetMinutes > 840 ||
        context.availabilityGeneration.isEmpty ||
        context.availabilityGeneration.length > 32768) {
      throw const CustomerBiteSaverGuestUsageException(
        CustomerBiteSaverGuestUsageFailure.invalidArgument,
      );
    }
  }

  void _requireLiveEvaluationContext(
    CustomerBiteSaverEvaluationContext context,
  ) {
    if (!_evaluationContextIsLive(context)) {
      throw const CustomerBiteSaverGuestUsageException(
        CustomerBiteSaverGuestUsageFailure.evaluationExpired,
      );
    }
  }

  void _requireLiveAuthorization(
    CustomerBiteSaverEvaluationContext context,
    int validationExpiresAtMillis,
  ) {
    _requireLiveEvaluationContext(context);
    _requireLiveValidation(validationExpiresAtMillis);
  }

  bool _evaluationContextIsLive(CustomerBiteSaverEvaluationContext context) =>
      _nowMillis() < context.validUntilExclusiveMillis;

  void _requireLiveValidation(int validationExpiresAtMillis) {
    if (!_validationIsLive(validationExpiresAtMillis)) {
      throw const CustomerBiteSaverGuestUsageException(
        CustomerBiteSaverGuestUsageFailure.validationExpired,
      );
    }
  }

  bool _validationIsLive(int validationExpiresAtMillis) {
    return _nowMillis() < validationExpiresAtMillis;
  }

  int _nowMillis() {
    late final int nowMillis;
    try {
      nowMillis = _clock().toUtc().millisecondsSinceEpoch;
    } catch (_) {
      throw const CustomerBiteSaverGuestUsageException(
        CustomerBiteSaverGuestUsageFailure.invalidArgument,
      );
    }
    return nowMillis;
  }

  Future<bool> _recoverCommittedExactReplay({
    required String redemptionRequestId,
    required CustomerBiteSaverRestaurantId restaurantId,
    required CustomerBiteSaverOfferId offerId,
    required CustomerBiteSaverGuestUsagePolicy usagePolicy,
    required bool reusableAfterTimer,
    required CustomerBiteSaverEvaluationContext evaluationContext,
    required int validationExpiresAtMillis,
    required int expectedGuestStateRevision,
  }) async {
    final raw = await _read(journalKey);
    if (raw == null) {
      final currentMeta = await _readMeta();
      final currentOffer = await _readOffer(offerId);
      return _isExactReplayState(
        meta: currentMeta,
        offer: currentOffer,
        redemptionRequestId: redemptionRequestId,
        restaurantId: restaurantId,
        offerId: offerId,
        usagePolicy: usagePolicy,
        reusableAfterTimer: reusableAfterTimer,
        evaluationContext: evaluationContext,
        validationExpiresAtMillis: validationExpiresAtMillis,
        expectedGuestStateRevision: expectedGuestStateRevision,
      );
    }
    final journal = _GuestUsageJournal.parse(raw);
    final previousRevision = journal.previousMeta?.revision ?? 0;
    if (!_matchesExactReplayPayload(
          journal.nextOffer,
          redemptionRequestId: redemptionRequestId,
          restaurantId: restaurantId,
          offerId: offerId,
          usagePolicy: usagePolicy,
          reusableAfterTimer: reusableAfterTimer,
          evaluationContext: evaluationContext,
          validationExpiresAtMillis: validationExpiresAtMillis,
          expectedGuestStateRevision: expectedGuestStateRevision,
        ) ||
        previousRevision != expectedGuestStateRevision) {
      return false;
    }

    await _recoverJournal();
    return true;
  }

  bool _isExactReplayState({
    required _GuestUsageMeta? meta,
    required _GuestUsageOffer? offer,
    required String redemptionRequestId,
    required CustomerBiteSaverRestaurantId restaurantId,
    required CustomerBiteSaverOfferId offerId,
    required CustomerBiteSaverGuestUsagePolicy usagePolicy,
    required bool reusableAfterTimer,
    required CustomerBiteSaverEvaluationContext evaluationContext,
    required int validationExpiresAtMillis,
    required int expectedGuestStateRevision,
  }) {
    if (meta == null ||
        offer == null ||
        !_matchesExactReplayPayload(
          offer,
          redemptionRequestId: redemptionRequestId,
          restaurantId: restaurantId,
          offerId: offerId,
          usagePolicy: usagePolicy,
          reusableAfterTimer: reusableAfterTimer,
          evaluationContext: evaluationContext,
          validationExpiresAtMillis: validationExpiresAtMillis,
          expectedGuestStateRevision: expectedGuestStateRevision,
        )) {
      return false;
    }
    return meta.revision >= offer.committedRevision;
  }

  bool _matchesExactReplayPayload(
    _GuestUsageOffer offer, {
    required String redemptionRequestId,
    required CustomerBiteSaverRestaurantId restaurantId,
    required CustomerBiteSaverOfferId offerId,
    required CustomerBiteSaverGuestUsagePolicy usagePolicy,
    required bool reusableAfterTimer,
    required CustomerBiteSaverEvaluationContext evaluationContext,
    required int validationExpiresAtMillis,
    required int expectedGuestStateRevision,
  }) =>
      expectedGuestStateRevision < _maximumSafeInteger &&
      offer.redemptionRequestId == redemptionRequestId &&
      offer.restaurantId == restaurantId.value &&
      offer.offerId == offerId.value &&
      offer.usagePolicy == usagePolicy &&
      offer.reusableAfterTimer == reusableAfterTimer &&
      offer.committedRevision == expectedGuestStateRevision + 1 &&
      offer.timerStartedAtMillis == evaluationContext.evaluationAtMillis &&
      _sameEvaluationContext(offer.evaluationContext, evaluationContext) &&
      offer.validationExpiresAtMillis == validationExpiresAtMillis;

  Future<void> _recoverJournal() async {
    final raw = await _read(journalKey);
    if (raw == null) {
      return;
    }
    final journal = _GuestUsageJournal.parse(raw);
    final currentMeta = await _readMeta();
    final offerId = CustomerBiteSaverOfferId(journal.nextOffer.offerId);
    final currentOffer = await _readOffer(offerId);

    if (_sameNullableMeta(currentMeta, journal.nextMeta) &&
        _sameNullableOffer(currentOffer, journal.nextOffer)) {
      await _remove(journalKey);
      return;
    }
    if (!_sameNullableMeta(currentMeta, journal.previousMeta) ||
        (!_sameNullableOffer(currentOffer, journal.previousOffer) &&
            !_sameNullableOffer(currentOffer, journal.nextOffer))) {
      throw const CustomerBiteSaverGuestUsageException(
        CustomerBiteSaverGuestUsageFailure.corruptData,
      );
    }

    if (!_sameNullableOffer(currentOffer, journal.nextOffer)) {
      await _write(offerKey(offerId), jsonEncode(journal.nextOffer.toJson()));
    }
    await _write(metaKey, jsonEncode(journal.nextMeta.toJson()));
    await _remove(journalKey);
  }

  Future<_GuestUsageMeta?> _readMeta() async {
    final raw = await _read(metaKey);
    return raw == null ? null : _GuestUsageMeta.parse(raw);
  }

  Future<_GuestUsageOffer?> _readOffer(CustomerBiteSaverOfferId offerId) async {
    final raw = await _read(offerKey(offerId));
    return raw == null ? null : _GuestUsageOffer.parse(raw);
  }

  Future<String?> _read(String key) async {
    try {
      return await _preferences.getString(key);
    } catch (_) {
      throw const CustomerBiteSaverGuestUsageException(
        CustomerBiteSaverGuestUsageFailure.readFailed,
      );
    }
  }

  Future<void> _write(String key, String value) async {
    try {
      await _preferences.setString(key, value);
    } catch (_) {
      throw const CustomerBiteSaverGuestUsageException(
        CustomerBiteSaverGuestUsageFailure.writeFailed,
      );
    }
  }

  Future<void> _remove(String key) async {
    try {
      await _preferences.remove(key);
    } catch (_) {
      throw const CustomerBiteSaverGuestUsageException(
        CustomerBiteSaverGuestUsageFailure.writeFailed,
      );
    }
  }

  Future<T> _serialized<T>(Future<T> Function() operation) {
    final operationKey = '$namespace:$guestDeviceId';
    final queue = _operationQueues.putIfAbsent(
      operationKey,
      _GuestUsageOperationQueue.new,
    );
    queue.pendingOperations += 1;
    final completer = Completer<T>();
    queue.tail = queue.tail.then((_) async {
      try {
        completer.complete(await operation());
      } catch (error, stackTrace) {
        completer.completeError(error, stackTrace);
      } finally {
        queue.pendingOperations -= 1;
        if (queue.pendingOperations == 0 &&
            identical(_operationQueues[operationKey], queue)) {
          _operationQueues.remove(operationKey);
        }
      }
    });
    return completer.future;
  }

  static bool _isSafeNonNegativeInteger(Object? value) =>
      value is int && value >= 0 && value <= _maximumSafeInteger;

  static bool _isTimestamp(Object? value) =>
      value is int &&
      _isSafeNonNegativeInteger(value) &&
      value <= _maximumDateTimeMillis;
}

final class _GuestUsageOperationQueue {
  Future<void> tail = Future<void>.value();
  int pendingOperations = 0;
}

final class _GuestUsageMeta {
  static const Set<String> _fields = <String>{
    'schemaVersion',
    'guestStateRevision',
    'activeOfferIds',
  };

  final int revision;
  final List<String> activeOfferIds;

  _GuestUsageMeta({
    required this.revision,
    required List<String> activeOfferIds,
  }) : activeOfferIds = List<String>.unmodifiable(activeOfferIds);

  factory _GuestUsageMeta.empty() =>
      _GuestUsageMeta(revision: 0, activeOfferIds: const <String>[]);

  factory _GuestUsageMeta.parse(String raw) {
    final data = _decodeObject(raw);
    if (!_hasExactFields(data, _fields) ||
        data['schemaVersion'] !=
            CustomerBiteSaverGuestUsageStore.schemaVersion ||
        !CustomerBiteSaverGuestUsageStore._isSafeNonNegativeInteger(
          data['guestStateRevision'],
        ) ||
        data['activeOfferIds'] is! List<dynamic>) {
      throw const CustomerBiteSaverGuestUsageException(
        CustomerBiteSaverGuestUsageFailure.corruptData,
      );
    }
    final ids = <String>[];
    try {
      for (final value in data['activeOfferIds'] as List<dynamic>) {
        if (value is! String) {
          throw const FormatException();
        }
        ids.add(CustomerBiteSaverOfferId(value).value);
      }
    } on FormatException {
      throw const CustomerBiteSaverGuestUsageException(
        CustomerBiteSaverGuestUsageFailure.corruptData,
      );
    }
    if (ids.toSet().length != ids.length) {
      throw const CustomerBiteSaverGuestUsageException(
        CustomerBiteSaverGuestUsageFailure.corruptData,
      );
    }
    return _GuestUsageMeta(
      revision: data['guestStateRevision'] as int,
      activeOfferIds: ids,
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
    'schemaVersion': CustomerBiteSaverGuestUsageStore.schemaVersion,
    'guestStateRevision': revision,
    'activeOfferIds': activeOfferIds,
  };
}

final class _GuestUsageOffer {
  static const Set<String> _fields = <String>{
    'schemaVersion',
    'restaurantId',
    'offerId',
    'redemptionRequestId',
    'usagePolicy',
    'reusableAfterTimer',
    'committedRevision',
    'evaluationContext',
    'validationExpiresAtMillis',
    'timerStartedAtMillis',
    'timerExpiresAtMillis',
  };

  final String restaurantId;
  final String offerId;
  final String redemptionRequestId;
  final CustomerBiteSaverGuestUsagePolicy usagePolicy;
  final bool reusableAfterTimer;
  final int committedRevision;
  final CustomerBiteSaverEvaluationContext evaluationContext;
  final int validationExpiresAtMillis;
  final int timerStartedAtMillis;
  final int timerExpiresAtMillis;

  const _GuestUsageOffer({
    required this.restaurantId,
    required this.offerId,
    required this.redemptionRequestId,
    required this.usagePolicy,
    required this.reusableAfterTimer,
    required this.committedRevision,
    required this.evaluationContext,
    required this.validationExpiresAtMillis,
    required this.timerStartedAtMillis,
    required this.timerExpiresAtMillis,
  });

  factory _GuestUsageOffer.parse(String raw) {
    final data = _decodeObject(raw);
    if (!_hasExactFields(data, _fields) ||
        data['schemaVersion'] !=
            CustomerBiteSaverGuestUsageStore.schemaVersion ||
        data['restaurantId'] is! String ||
        data['offerId'] is! String ||
        data['redemptionRequestId'] is! String ||
        data['usagePolicy'] is! String ||
        data['reusableAfterTimer'] is! bool ||
        !CustomerBiteSaverGuestUsageStore._isSafeNonNegativeInteger(
          data['committedRevision'],
        ) ||
        data['committedRevision'] == 0 ||
        data['evaluationContext'] is! Map<String, dynamic> ||
        !CustomerBiteSaverGuestUsageStore._redemptionRequestIdPattern.hasMatch(
          data['redemptionRequestId'] as String,
        ) ||
        !CustomerBiteSaverGuestUsageStore._isTimestamp(
          data['validationExpiresAtMillis'],
        ) ||
        !CustomerBiteSaverGuestUsageStore._isTimestamp(
          data['timerStartedAtMillis'],
        ) ||
        !CustomerBiteSaverGuestUsageStore._isTimestamp(
          data['timerExpiresAtMillis'],
        ) ||
        data['timerExpiresAtMillis'] !=
            (data['timerStartedAtMillis'] as int) +
                customerBiteSaverGuestRedemptionTimerDuration.inMilliseconds ||
        (data['validationExpiresAtMillis'] as int) <=
            (data['timerStartedAtMillis'] as int) ||
        (data['validationExpiresAtMillis'] as int) >
            (data['timerStartedAtMillis'] as int) +
                Duration.millisecondsPerMinute) {
      throw const CustomerBiteSaverGuestUsageException(
        CustomerBiteSaverGuestUsageFailure.corruptData,
      );
    }
    final usagePolicy = switch (data['usagePolicy']) {
      'oncePerCustomer' => CustomerBiteSaverGuestUsagePolicy.oncePerCustomer,
      'oncePerDay' => CustomerBiteSaverGuestUsagePolicy.oncePerDay,
      _ => throw const CustomerBiteSaverGuestUsageException(
        CustomerBiteSaverGuestUsageFailure.corruptData,
      ),
    };
    late final CustomerBiteSaverEvaluationContext evaluationContext;
    try {
      CustomerBiteSaverRestaurantId(data['restaurantId'] as String);
      CustomerBiteSaverOfferId(data['offerId'] as String);
      evaluationContext = CustomerBiteSaverEvaluationContext.fromJson(
        data['evaluationContext'],
      );
    } on FormatException {
      throw const CustomerBiteSaverGuestUsageException(
        CustomerBiteSaverGuestUsageFailure.corruptData,
      );
    }
    if (evaluationContext.evaluationAtMillis != data['timerStartedAtMillis']) {
      throw const CustomerBiteSaverGuestUsageException(
        CustomerBiteSaverGuestUsageFailure.corruptData,
      );
    }
    return _GuestUsageOffer(
      restaurantId: data['restaurantId'] as String,
      offerId: data['offerId'] as String,
      redemptionRequestId: data['redemptionRequestId'] as String,
      usagePolicy: usagePolicy,
      reusableAfterTimer: data['reusableAfterTimer'] as bool,
      committedRevision: data['committedRevision'] as int,
      evaluationContext: evaluationContext,
      validationExpiresAtMillis: data['validationExpiresAtMillis'] as int,
      timerStartedAtMillis: data['timerStartedAtMillis'] as int,
      timerExpiresAtMillis: data['timerExpiresAtMillis'] as int,
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
    'schemaVersion': CustomerBiteSaverGuestUsageStore.schemaVersion,
    'restaurantId': restaurantId,
    'offerId': offerId,
    'redemptionRequestId': redemptionRequestId,
    'usagePolicy': usagePolicy.name,
    'reusableAfterTimer': reusableAfterTimer,
    'committedRevision': committedRevision,
    'evaluationContext': evaluationContext.toJson(),
    'validationExpiresAtMillis': validationExpiresAtMillis,
    'timerStartedAtMillis': timerStartedAtMillis,
    'timerExpiresAtMillis': timerExpiresAtMillis,
  };
}

final class _GuestUsageJournal {
  static const String _mutationKind = 'startRedemption';
  static const Set<String> _fields = <String>{
    'schemaVersion',
    'mutationKind',
    'previousMeta',
    'nextMeta',
    'previousOffer',
    'nextOffer',
  };

  final _GuestUsageMeta? previousMeta;
  final _GuestUsageMeta nextMeta;
  final _GuestUsageOffer? previousOffer;
  final _GuestUsageOffer nextOffer;

  const _GuestUsageJournal({
    required this.previousMeta,
    required this.nextMeta,
    required this.previousOffer,
    required this.nextOffer,
  });

  factory _GuestUsageJournal.parse(String raw) {
    final data = _decodeObject(raw);
    if (!_hasExactFields(data, _fields) ||
        data['schemaVersion'] !=
            CustomerBiteSaverGuestUsageStore.schemaVersion ||
        data['mutationKind'] != _mutationKind ||
        data['nextMeta'] is! Map<String, dynamic> ||
        data['nextOffer'] is! Map<String, dynamic> ||
        (data['previousMeta'] != null &&
            data['previousMeta'] is! Map<String, dynamic>) ||
        (data['previousOffer'] != null &&
            data['previousOffer'] is! Map<String, dynamic>)) {
      throw const CustomerBiteSaverGuestUsageException(
        CustomerBiteSaverGuestUsageFailure.corruptData,
      );
    }
    final previousMeta = data['previousMeta'] == null
        ? null
        : _GuestUsageMeta.parse(jsonEncode(data['previousMeta']));
    final nextMeta = _GuestUsageMeta.parse(jsonEncode(data['nextMeta']));
    final previousOffer = data['previousOffer'] == null
        ? null
        : _GuestUsageOffer.parse(jsonEncode(data['previousOffer']));
    final nextOffer = _GuestUsageOffer.parse(jsonEncode(data['nextOffer']));
    if (nextMeta.revision == 0 ||
        nextMeta.revision != (previousMeta?.revision ?? 0) + 1 ||
        nextOffer.committedRevision != nextMeta.revision ||
        !nextMeta.activeOfferIds.contains(nextOffer.offerId) ||
        (previousMeta == null && previousOffer != null) ||
        (previousMeta?.activeOfferIds.contains(nextOffer.offerId) == true &&
            previousOffer == null) ||
        (previousOffer != null &&
            (previousOffer.committedRevision > previousMeta!.revision ||
                previousOffer.offerId != nextOffer.offerId ||
                previousOffer.restaurantId != nextOffer.restaurantId))) {
      throw const CustomerBiteSaverGuestUsageException(
        CustomerBiteSaverGuestUsageFailure.corruptData,
      );
    }
    return _GuestUsageJournal(
      previousMeta: previousMeta,
      nextMeta: nextMeta,
      previousOffer: previousOffer,
      nextOffer: nextOffer,
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
    'schemaVersion': CustomerBiteSaverGuestUsageStore.schemaVersion,
    'mutationKind': _mutationKind,
    'previousMeta': previousMeta?.toJson(),
    'nextMeta': nextMeta.toJson(),
    'previousOffer': previousOffer?.toJson(),
    'nextOffer': nextOffer.toJson(),
  };
}

Map<String, dynamic> _decodeObject(String raw) {
  try {
    final decoded = jsonDecode(raw);
    if (decoded is Map<String, dynamic>) {
      return decoded;
    }
  } catch (_) {
    // Converted to the store's typed corruption failure below.
  }
  throw const CustomerBiteSaverGuestUsageException(
    CustomerBiteSaverGuestUsageFailure.corruptData,
  );
}

bool _hasExactFields(Map<String, dynamic> data, Set<String> fields) =>
    data.length == fields.length && data.keys.every(fields.contains);

bool _sameStrings(List<String> left, List<String> right) {
  if (left.length != right.length) {
    return false;
  }
  for (var index = 0; index < left.length; index += 1) {
    if (left[index] != right[index]) {
      return false;
    }
  }
  return true;
}

bool _sameNullableMeta(_GuestUsageMeta? left, _GuestUsageMeta? right) {
  if (identical(left, right)) {
    return true;
  }
  return left != null &&
      right != null &&
      left.revision == right.revision &&
      _sameStrings(left.activeOfferIds, right.activeOfferIds);
}

CustomerBiteSaverUsagePolicy _localUsagePolicy(
  CustomerBiteSaverGuestUsagePolicy policy,
) => switch (policy) {
  CustomerBiteSaverGuestUsagePolicy.oncePerCustomer =>
    CustomerBiteSaverUsagePolicy.oncePerCustomer,
  CustomerBiteSaverGuestUsagePolicy.oncePerDay =>
    CustomerBiteSaverUsagePolicy.oncePerDay,
};

bool _sameEvaluationContext(
  CustomerBiteSaverEvaluationContext left,
  CustomerBiteSaverEvaluationContext right,
) {
  if (left.sessionId != right.sessionId ||
      left.attemptGeneration != right.attemptGeneration ||
      left.queryFingerprint != right.queryFingerprint ||
      left.evaluationAtMillis != right.evaluationAtMillis ||
      left.timeZone != right.timeZone ||
      left.utcOffsetMinutes != right.utcOffsetMinutes ||
      left.availabilityGeneration != right.availabilityGeneration ||
      left.validUntilExclusiveMillis != right.validUntilExclusiveMillis ||
      left.oncePerDayUnavailableWindows.length !=
          right.oncePerDayUnavailableWindows.length) {
    return false;
  }
  for (
    var index = 0;
    index < left.oncePerDayUnavailableWindows.length;
    index += 1
  ) {
    final leftWindow = left.oncePerDayUnavailableWindows[index];
    final rightWindow = right.oncePerDayUnavailableWindows[index];
    if (leftWindow.startAtMillisInclusive !=
            rightWindow.startAtMillisInclusive ||
        leftWindow.endAtMillisExclusive != rightWindow.endAtMillisExclusive) {
      return false;
    }
  }
  return true;
}

bool _sameNullableOffer(_GuestUsageOffer? left, _GuestUsageOffer? right) {
  if (identical(left, right)) {
    return true;
  }
  return left != null &&
      right != null &&
      left.restaurantId == right.restaurantId &&
      left.offerId == right.offerId &&
      left.redemptionRequestId == right.redemptionRequestId &&
      left.usagePolicy == right.usagePolicy &&
      left.reusableAfterTimer == right.reusableAfterTimer &&
      left.committedRevision == right.committedRevision &&
      _sameEvaluationContext(left.evaluationContext, right.evaluationContext) &&
      left.validationExpiresAtMillis == right.validationExpiresAtMillis &&
      left.timerStartedAtMillis == right.timerStartedAtMillis &&
      left.timerExpiresAtMillis == right.timerExpiresAtMillis;
}

DateTime _utcNow() => DateTime.now().toUtc();
