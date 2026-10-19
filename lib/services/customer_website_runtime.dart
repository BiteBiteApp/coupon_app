import 'package:flutter/foundation.dart';

/// Local/source opt-in only. This is presentation selection, never authority.
abstract final class CustomerWebsiteRuntime {
  static const enabled =
      kIsWeb &&
      bool.fromEnvironment('BITESTAR_CUSTOMER_WEBSITE', defaultValue: false);

  static String homeRoute(bool biteScore) =>
      biteScore ? '/browse/bitescore' : '/browse/coupons';
}
