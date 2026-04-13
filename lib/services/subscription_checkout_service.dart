import 'package:cloud_functions/cloud_functions.dart';
import 'package:url_launcher/url_launcher.dart';

class SubscriptionCheckoutService {
  static final FirebaseFunctions _functions = FirebaseFunctions.instanceFor(
    region: 'us-central1',
  );

  static Future<void> startCheckout() async {
    final callable = _functions.httpsCallable('createCheckoutSession');
    final response =
        await callable.call<Map<String, dynamic>>(<String, dynamic>{});
    final data = response.data;
    final checkoutUrl = (data['url'] as String?)?.trim();

    if (checkoutUrl == null || checkoutUrl.isEmpty) {
      throw StateError('Missing checkout URL.');
    }

    await _launchExternalUrl(checkoutUrl);
  }

  static Future<void> openCustomerPortal() async {
    final callable = _functions.httpsCallable('createCustomerPortalSession');
    final response =
        await callable.call<Map<String, dynamic>>(<String, dynamic>{});
    final data = response.data;
    final portalUrl = (data['url'] as String?)?.trim();

    if (portalUrl == null || portalUrl.isEmpty) {
      throw StateError('Missing customer portal URL.');
    }

    await _launchExternalUrl(portalUrl);
  }

  static Future<void> _launchExternalUrl(String rawUrl) async {
    final uri = Uri.tryParse(rawUrl);
    if (uri == null) {
      throw StateError('Invalid external URL.');
    }

    final launched = await launchUrl(
      uri,
      mode: LaunchMode.externalApplication,
    );
    if (!launched) {
      throw StateError('Could not open external URL.');
    }
  }
}
