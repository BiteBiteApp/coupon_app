import 'package:flutter/material.dart';

import '../services/restaurant_invite_service.dart';

class RestaurantInvitePreviewScreen extends StatefulWidget {
  final String side;
  final String token;

  const RestaurantInvitePreviewScreen({
    super.key,
    required this.side,
    required this.token,
  });

  @override
  State<RestaurantInvitePreviewScreen> createState() =>
      _RestaurantInvitePreviewScreenState();
}

class _RestaurantInvitePreviewScreenState
    extends State<RestaurantInvitePreviewScreen> {
  late Future<RestaurantInvitePreview> _previewFuture;

  @override
  void initState() {
    super.initState();
    _previewFuture = RestaurantInviteService.previewInvite(
      token: widget.token,
      side: widget.side,
    );
  }

  String get _title {
    return widget.side == 'bitescore'
        ? 'BiteScore Claim Invite'
        : 'Coupon Invite';
  }

  String get _disabledActionLabel {
    return widget.side == 'bitescore'
        ? 'Claim setup coming next'
        : 'Account signup coming next';
  }

  Widget _buildInvalidInvite() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: const [
            Icon(Icons.link_off_outlined, size: 56),
            SizedBox(height: 16),
            Text(
              'This invite link is no longer valid.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
            ),
            SizedBox(height: 10),
            Text(
              'Please request a new invite.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.black54),
            ),
          ],
        ),
      ),
    );
  }

  Widget _detailLine(String label, String value) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) {
      return const SizedBox.shrink();
    }

    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 84,
            child: Text(
              label,
              style: const TextStyle(
                color: Colors.black54,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          Expanded(child: Text(trimmed)),
        ],
      ),
    );
  }

  Widget _buildCouponDetails(RestaurantInvitePreview preview) {
    final prefill = preview.couponPrefill;
    final location = [
      prefill?.city ?? '',
      prefill?.state ?? '',
      prefill?.zipCode ?? '',
    ].where((part) => part.trim().isNotEmpty).join(', ');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _detailLine('Address', prefill?.streetAddress ?? ''),
        _detailLine('Location', location),
        _detailLine('Phone', prefill?.phone ?? ''),
        _detailLine('Website', prefill?.website ?? ''),
      ],
    );
  }

  Widget _buildBiteScoreDetails(RestaurantInvitePreview preview) {
    return _detailLine('Address', preview.restaurantAddressSummary);
  }

  Widget _buildPreview(RestaurantInvitePreview preview) {
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'This invite is for:',
                  style: TextStyle(fontSize: 15, color: Colors.black54),
                ),
                const SizedBox(height: 8),
                Text(
                  preview.restaurantName.isEmpty
                      ? 'Restaurant'
                      : preview.restaurantName,
                  style: const TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 10),
                if (preview.isCoupon)
                  _buildCouponDetails(preview)
                else
                  _buildBiteScoreDetails(preview),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        FilledButton(onPressed: null, child: Text(_disabledActionLabel)),
        const SizedBox(height: 10),
        const Text(
          'Full invite redemption will be available in the next stage.',
          textAlign: TextAlign.center,
          style: TextStyle(color: Colors.black54),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_title)),
      body: FutureBuilder<RestaurantInvitePreview>(
        future: _previewFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }

          if (snapshot.hasError || snapshot.data == null) {
            return _buildInvalidInvite();
          }

          return _buildPreview(snapshot.data!);
        },
      ),
    );
  }
}
