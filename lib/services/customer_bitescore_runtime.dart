import 'package:flutter/foundation.dart';

/// Source-only opt-in. The server independently enforces every read/write
/// contract; this selector is never an authorization credential.
abstract final class CustomerBiteScoreRuntime {
  static const bool _configured = bool.fromEnvironment(
    'BITESCORE_BOUNDED_CUSTOMER',
    defaultValue: false,
  );

  @visibleForTesting
  static bool? testEnabled;

  static bool get isEnabled => testEnabled ?? _configured;
}
