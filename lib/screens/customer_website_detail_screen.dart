import '../services/app_mode_state_service.dart';
import '../models/customer_bitesaver_search.dart';
import 'package:flutter/material.dart';

import '../services/customer_website_routes.dart';
import '../services/customer_bitesaver_runtime.dart';
import '../services/customer_bitesaver_public_profile.dart';
import '../services/customer_bitescore_reads.dart';
import 'bitescore_dish_detail_screen.dart';
import 'restaurant_menu_screen.dart';

/// Re-resolves public identity after reload. No search lease, auth state or
/// provider credential is encoded in a URL or trusted from history.state.
class CustomerWebsiteDetailScreen extends StatefulWidget {
  const CustomerWebsiteDetailScreen({
    super.key,
    required this.destination,
    this.profileLoader,
    this.biteScoreReads,
    @visibleForTesting this.testOfferBuilder,
  });
  final CustomerWebsiteDetailRoute destination;
  final Future<CustomerBiteSaverPublicProfile> Function(String)? profileLoader;
  final CustomerBiteScoreReads? biteScoreReads;
  final Widget Function(CustomerBiteSaverPublicProfile, CustomerBiteSaverOffer)?
  testOfferBuilder;
  @override
  State<CustomerWebsiteDetailScreen> createState() =>
      _CustomerWebsiteDetailScreenState();
}

class _CustomerWebsiteDetailScreenState
    extends State<CustomerWebsiteDetailScreen> {
  CustomerBiteSaverPublicProfile? _profile;
  late final Future<Widget> _content = _load();
  Future<Widget> _load() async {
    final d = widget.destination;
    if (d.isBiteScore) {
      final reads = widget.biteScoreReads ?? CustomerBiteScoreReads();
      final detail = await reads.detail(
        d.kind == CustomerWebsiteDetailKind.menu ? 'restaurant' : 'dish',
        d.kind == CustomerWebsiteDetailKind.menu ? d.restaurantId : d.detailId!,
      );
      if (detail.restaurant.id != d.restaurantId) {
        throw const FormatException(
          'This dish is not available at this restaurant.',
        );
      }
      if (d.kind == CustomerWebsiteDetailKind.menu) {
        return RestaurantMenuScreen(
          restaurantName: detail.restaurant.name,
          mode: AppMode.biteScore,
          biteScorePageLoader: (cursor) =>
              reads.menu(d.restaurantId, cursor: cursor),
        );
      }
      return BiteScoreDishDetailScreen(
        entry: detail.entry!,
        scrollToReviewSection: d.kind == CustomerWebsiteDetailKind.reviews,
        // Existing injection seam is used only when the fixture supplies reads.
        // ignore: invalid_use_of_visible_for_testing_member
        testCustomerReads: widget.biteScoreReads,
      );
    }
    final profile =
        await (widget.profileLoader ??
            CustomerBiteSaverRuntime.loadPublicProfile)(d.restaurantId);
    if (!mounted) {
      profile.dispose();
      return const SizedBox.shrink();
    }
    _profile = profile;
    if (profile.catalogRestaurantId != d.restaurantId ||
        profile.restaurant == null) {
      throw const FormatException(
        'This restaurant is not currently available.',
      );
    }
    if (d.kind == CustomerWebsiteDetailKind.menu) {
      return RestaurantMenuScreen.fromCustomerBiteSaver(
        restaurantName: profile.restaurant!.displayName,
        pageLoader: profile.menu,
        openImageViewer: (context, builder) => Navigator.of(
          context,
        ).push<void>(MaterialPageRoute(builder: builder)),
      );
    }
    final seenCursors = <String>{};
    while (mounted &&
        !profile.offers.any((o) => o.offerId.value == d.detailId) &&
        profile.cursor != null) {
      if (!seenCursors.add(profile.cursor!)) {
        throw const FormatException('Could not load this coupon.');
      }
      await profile.loadMore();
      if (profile.error != null) throw profile.error!;
    }
    if (!mounted) return const SizedBox.shrink();
    final offers = profile.offers.where((o) => o.offerId.value == d.detailId);
    if (offers.isEmpty) {
      throw const FormatException('This coupon is not currently available.');
    }
    profile.viewOffer(offers.first);
    if (widget.testOfferBuilder != null) {
      return widget.testOfferBuilder!(profile, offers.first);
    }
    return CustomerBiteSaverRuntime.buildPublicOffer(profile, offers.first);
  }

  @override
  void dispose() {
    _profile?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<Widget>(
    future: _content,
    builder: (context, snapshot) => snapshot.hasError
        ? Scaffold(
            appBar: AppBar(title: const Text('BiteStar')),
            body: const Center(
              child: Text(
                'This page is not available right now. Return to the restaurant and try again.',
              ),
            ),
          )
        : snapshot.data ??
              Scaffold(
                appBar: AppBar(title: const Text('BiteStar')),
                body: const Center(child: CircularProgressIndicator()),
              ),
  );
}
