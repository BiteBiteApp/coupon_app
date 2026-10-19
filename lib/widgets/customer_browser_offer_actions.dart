import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/customer_bitesaver_search.dart';

/// Shared by every coupon-detail constructor. Null/unknown policy fails closed;
/// display labels never grant browser coupon use.
class CustomerBrowserOfferActions extends StatelessWidget {
  const CustomerBrowserOfferActions({
    super.key,
    required this.policy,
    required this.onEnlarge,
    this.appLink,
  });
  final CustomerBiteSaverUsagePolicy? policy;
  final VoidCallback onEnlarge;
  final Uri? appLink;

  @override
  Widget build(BuildContext context) {
    if (policy == CustomerBiteSaverUsagePolicy.unlimited) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          FilledButton.icon(
            onPressed: onEnlarge,
            icon: const Icon(Icons.fullscreen),
            label: const Text('Show coupon full screen'),
          ),
          const Text(
            'Show this coupon to the restaurant. Viewing it does not use a coupon.',
          ),
        ],
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        FilledButton(
          onPressed: () => showDialog<void>(
            context: context,
            builder: (dialogContext) => AlertDialog(
              title: const Text('Use in BiteStar App'),
              content: const Text(
                'This coupon has a usage limit and can only be redeemed in the BiteStar app.\n\nApp Store and Google Play download links are not available yet.',
              ),
              actions: [
                if (appLink != null)
                  TextButton(
                    onPressed: () async {
                      final opened = await launchUrl(
                        appLink!,
                        mode: LaunchMode.externalApplication,
                      );
                      if (!opened && dialogContext.mounted) {
                        ScaffoldMessenger.of(dialogContext).showSnackBar(
                          const SnackBar(
                            content: Text(
                              'Could not open BiteStar. Please open the installed app.',
                            ),
                          ),
                        );
                      }
                    },
                    child: const Text('Open BiteStar'),
                  ),
                TextButton(
                  onPressed: () => Navigator.pop(dialogContext),
                  child: const Text('Close'),
                ),
              ],
            ),
          ),
          child: const Text('Use in BiteStar App'),
        ),
        const Text(
          'This coupon has a usage limit and can only be redeemed in the BiteStar app.',
        ),
      ],
    );
  }
}
