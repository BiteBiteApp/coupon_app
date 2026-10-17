import 'package:flutter/foundation.dart';

/// Source-only transport selection; server authority remains mandatory.
abstract final class CustomerSearchCandidateRuntime {
  static const bool _configured = bool.fromEnvironment(
    'BITESTAR_POSTGIS_SEARCH',
    defaultValue: false,
  );

  @visibleForTesting
  static bool? testEnabled;

  static bool get isEnabled => testEnabled ?? _configured;

  static const _searchEndpoints = <String>{
    'startCustomerBiteSaverSearch',
    'getCustomerBiteSaverSearchStatus',
    'getCustomerBiteSaverSearchPage',
    'getCustomerBiteSaverOfferPage',
    'continueCustomerBiteSaverGuestOfferCheck',
    'startCustomerBiteScoreSearch',
    'advanceCustomerBiteScoreSearch',
    'getCustomerBiteScoreSearchPage',
  };

  static String endpoint(
    String existing,
    Map<String, Object?> request, {
    required bool enabled,
  }) {
    // BiteSaver multiplexes public profiles and media on its search endpoint.
    if (!enabled ||
        request['kind'] != null ||
        !_searchEndpoints.contains(existing)) {
      return existing;
    }
    return '${existing}V2';
  }
}
