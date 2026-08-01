import 'package:cloud_functions/cloud_functions.dart';
import 'package:url_launcher/url_launcher.dart';

import 'subscription_return_context_store.dart';

enum PreparedSubscriptionFamily { checkout, customerPortal }

enum SubscriptionExternalLaunchResult {
  launched,
  launchedStale,
  notCurrent,
  failed,
  failedStale,
}

const int subscriptionExternalStripeUrlMaxLength = 4096;

class PreparedSubscriptionSession {
  final Uri externalUrl;
  final String returnToken;
  final PreparedSubscriptionFamily family;
  final int returnProtocolVersion;

  const PreparedSubscriptionSession({
    required this.externalUrl,
    required this.returnToken,
    required this.family,
    required this.returnProtocolVersion,
  });
}

typedef SubscriptionCallableInvoker =
    Future<Map<String, Object?>> Function(
      String callableName,
      Map<String, Object?> payload,
    );

typedef SubscriptionExternalUrlLauncher = Future<bool> Function(Uri url);

class SubscriptionCheckoutService {
  final SubscriptionCallableInvoker _invokeCallable;
  final SubscriptionExternalUrlLauncher _launchExternalUrl;

  const SubscriptionCheckoutService({
    required SubscriptionCallableInvoker invokeCallable,
    required SubscriptionExternalUrlLauncher launchExternalUrl,
  }) : _invokeCallable = invokeCallable,
       _launchExternalUrl = launchExternalUrl;

  factory SubscriptionCheckoutService.production() {
    return SubscriptionCheckoutService(
      invokeCallable: (callableName, payload) async {
        final functions = FirebaseFunctions.instanceFor(region: 'us-central1');
        final callable = functions.httpsCallable(callableName);
        final response = await callable.call<Object?>(payload);
        final rawData = response.data;
        if (rawData is! Map) {
          throw StateError('Invalid subscription session response.');
        }
        final data = <String, Object?>{};
        for (final entry in rawData.entries) {
          final key = entry.key;
          if (key is! String) {
            throw StateError('Invalid subscription session response.');
          }
          data[key] = entry.value;
        }
        return data;
      },
      launchExternalUrl: (url) =>
          launchUrl(url, mode: LaunchMode.externalApplication),
    );
  }

  Future<PreparedSubscriptionSession> prepareSubscriptionCheckout({
    required String restaurantAccountDocumentId,
  }) {
    return _prepare(
      callableName: 'createCheckoutSession',
      family: PreparedSubscriptionFamily.checkout,
      restaurantAccountDocumentId: restaurantAccountDocumentId,
    );
  }

  Future<PreparedSubscriptionSession> prepareCustomerPortal({
    required String restaurantAccountDocumentId,
  }) {
    return _prepare(
      callableName: 'createCustomerPortalSession',
      family: PreparedSubscriptionFamily.customerPortal,
      restaurantAccountDocumentId: restaurantAccountDocumentId,
    );
  }

  Future<PreparedSubscriptionSession> _prepare({
    required String callableName,
    required PreparedSubscriptionFamily family,
    required String restaurantAccountDocumentId,
  }) async {
    if (!isValidSubscriptionReturnAccountDocumentId(
      restaurantAccountDocumentId,
    )) {
      throw StateError('Invalid subscription session request.');
    }
    final data = await _invokeCallable(callableName, <String, Object?>{
      'returnProtocolVersion': subscriptionReturnProtocolVersion,
      'restaurantAccountDocumentId': restaurantAccountDocumentId,
    });
    const allowedKeys = <String>{'url', 'returnToken', 'returnProtocolVersion'};
    if (data.length != allowedKeys.length ||
        !data.keys.every(allowedKeys.contains)) {
      throw StateError('Invalid subscription session response.');
    }

    final rawUrl = data['url'];
    final returnToken = data['returnToken'];
    final version = data['returnProtocolVersion'];
    if (rawUrl is! String ||
        returnToken is! String ||
        version is! int ||
        version != subscriptionReturnProtocolVersion ||
        !isValidSubscriptionReturnToken(returnToken)) {
      throw StateError('Invalid subscription session response.');
    }

    final externalUrl = _requireExternalStripeUrl(rawUrl, family: family);
    return PreparedSubscriptionSession(
      externalUrl: externalUrl,
      returnToken: returnToken,
      family: family,
      returnProtocolVersion: version,
    );
  }

  Future<SubscriptionExternalLaunchResult> launchPreparedSubscriptionUrl(
    PreparedSubscriptionSession prepared, {
    required bool Function() isCurrent,
  }) async {
    if (!_isCurrentSafely(isCurrent)) {
      return SubscriptionExternalLaunchResult.notCurrent;
    }

    try {
      if (prepared.returnProtocolVersion != subscriptionReturnProtocolVersion ||
          !isValidSubscriptionReturnToken(prepared.returnToken)) {
        return SubscriptionExternalLaunchResult.failed;
      }
      final validatedUrl = _requireExternalStripeUrl(
        prepared.externalUrl.toString(),
        family: prepared.family,
      );
      if (validatedUrl != prepared.externalUrl) {
        return SubscriptionExternalLaunchResult.failed;
      }
    } catch (_) {
      return SubscriptionExternalLaunchResult.failed;
    }

    if (!_isCurrentSafely(isCurrent)) {
      return SubscriptionExternalLaunchResult.notCurrent;
    }

    bool launched;
    try {
      launched = await _launchExternalUrl(prepared.externalUrl);
    } catch (_) {
      return _isCurrentSafely(isCurrent)
          ? SubscriptionExternalLaunchResult.failed
          : SubscriptionExternalLaunchResult.failedStale;
    }
    final remainsCurrent = _isCurrentSafely(isCurrent);
    if (launched) {
      return remainsCurrent
          ? SubscriptionExternalLaunchResult.launched
          : SubscriptionExternalLaunchResult.launchedStale;
    }
    return remainsCurrent
        ? SubscriptionExternalLaunchResult.failed
        : SubscriptionExternalLaunchResult.failedStale;
  }
}

bool _isCurrentSafely(bool Function() isCurrent) {
  try {
    return isCurrent();
  } catch (_) {
    return false;
  }
}

Uri _requireExternalStripeUrl(
  String rawUrl, {
  required PreparedSubscriptionFamily family,
}) {
  if (rawUrl.isEmpty ||
      rawUrl.length > subscriptionExternalStripeUrlMaxLength ||
      rawUrl != rawUrl.trim() ||
      rawUrl.codeUnits.any((unit) => unit < 0x20 || unit == 0x7f) ||
      RegExp(r'%(?![0-9A-Fa-f]{2})').hasMatch(rawUrl)) {
    throw StateError('Invalid external URL.');
  }
  final uri = Uri.tryParse(rawUrl);
  final expectedHost = switch (family) {
    PreparedSubscriptionFamily.checkout => 'checkout.stripe.com',
    PreparedSubscriptionFamily.customerPortal => 'billing.stripe.com',
  };
  if (uri == null ||
      uri.scheme != 'https' ||
      uri.host != expectedHost ||
      uri.path.isEmpty ||
      uri.path == '/' ||
      uri.userInfo.isNotEmpty ||
      uri.hasPort ||
      uri.hasFragment ||
      uri.toString() != rawUrl) {
    throw StateError('Invalid external URL.');
  }
  return uri;
}
