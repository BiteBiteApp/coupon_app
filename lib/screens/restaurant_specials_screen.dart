import '../models/bitesaver_restaurant_media.dart';
import '../widgets/bitesaver_board_photo.dart';
import '../services/customer_bitesaver_service.dart';
import 'bitesaver_photo_viewer.dart';
import 'package:flutter/material.dart';

import '../models/daily_special.dart';
import '../models/customer_bitesaver_search.dart';
import '../widgets/bitesaver_specials_board.dart';
import '../widgets/bitesaver_profile_deal_card.dart';
import '../models/restaurant.dart';
import '../services/app_mode_state_service.dart';
import '../services/restaurant_account_service.dart';
import '../widgets/bitesaver_colors.dart';
import '../widgets/persistent_bottom_navigation.dart';

typedef CustomerBiteSaverSpecialsContinuation =
    Future<({List<CustomerBiteSaverOffer> offers, bool hasMore})> Function();

typedef PublicRestaurantSpecialsLoader =
    Future<List<DailySpecial>> Function(String accountDocumentId);

class RestaurantSpecialsScreen extends StatefulWidget {
  final BiteSaverRestaurantMedia? media;
  final Restaurant restaurant;
  final PublicRestaurantSpecialsLoader? loadSpecials;
  final List<CustomerBiteSaverOffer>? boundedOffers;
  final bool hasMoreOffers;
  final CustomerBiteSaverSpecialsContinuation? loadMoreOffers;
  final Future<void> Function(BuildContext context, String imageUrl)? openImage;

  const RestaurantSpecialsScreen({
    super.key,
    this.media,
    required this.restaurant,
    @visibleForTesting this.loadSpecials,
  }) : boundedOffers = null,
       hasMoreOffers = false,
       loadMoreOffers = null,
       openImage = null;

  const RestaurantSpecialsScreen.fromCustomerBiteSaver({
    super.key,
    this.media,
    required this.restaurant,
    required List<CustomerBiteSaverOffer> offers,
    required this.openImage,
    this.hasMoreOffers = false,
    this.loadMoreOffers,
  }) : boundedOffers = offers,
       loadSpecials = null;

  @override
  State<RestaurantSpecialsScreen> createState() =>
      _RestaurantSpecialsScreenState();
}

class _RestaurantSpecialsScreenState extends State<RestaurantSpecialsScreen> {
  late BiteSaverRestaurantMedia? _media = widget.media;
  late final Future<List<DailySpecial>> _specialsFuture = _loadSpecials();
  late List<CustomerBiteSaverOffer>? _offers = widget.boundedOffers;
  late bool _hasMoreOffers = widget.hasMoreOffers;
  bool _loadingMore = false;
  Object? _moreError;

  Future<void> _loadMore() async {
    if (_loadingMore || widget.loadMoreOffers == null) return;
    setState(() {
      _loadingMore = true;
      _moreError = null;
    });
    try {
      final result = await widget.loadMoreOffers!();
      if (!mounted) return;
      setState(() {
        _offers = result.offers;
        _hasMoreOffers = result.hasMore;
      });
    } catch (error) {
      if (mounted) setState(() => _moreError = error);
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  String _displayText(String value, String fallback) {
    final trimmed = value.trim();
    return trimmed.isEmpty ? fallback : trimmed;
  }

  Future<List<DailySpecial>> _loadSpecials() async {
    if (widget.boundedOffers != null) return const <DailySpecial>[];
    final accountDocumentId = widget.restaurant.accountDocumentId;
    final List<DailySpecial> specials;
    if (accountDocumentId != null) {
      final loader = widget.loadSpecials;
      if (loader != null) {
        specials = await loader(accountDocumentId);
      } else {
        final projectionData =
            await RestaurantAccountService.loadCustomerRestaurantProjectionById(
              accountDocumentId,
            );
        final mediaId = projectionData?['publicRestaurantId'];
        if (_media == null && mediaId is String) {
          _media = await CustomerBiteSaverService().getRestaurantMedia(mediaId);
        }
        specials =
            RestaurantAccountService.customerRestaurantFromProjectionData(
                  projectionData,
                  expectedRestaurantId: accountDocumentId,
                ) !=
                null
            ? await RestaurantAccountService.loadActiveDailySpecialsForRestaurant(
                accountDocumentId,
              )
            : const <DailySpecial>[];
      }
    } else {
      specials = const <DailySpecial>[];
    }

    final now = DateTime.now();
    return DailySpecial.visibleSpecialsAt(
      specials
          .where((special) => special.id != 'bitesaver_managed_board')
          .toList(),
      now,
    );
  }

  @override
  Widget build(BuildContext context) {
    final restaurantName = _displayText(widget.restaurant.name, 'Restaurant');

    return Scaffold(
      backgroundColor: BiteSaverColors.pageBackground,
      appBar: AppBar(
        title: const Text("Today's Specials"),
        backgroundColor: BiteSaverColors.pageBackground,
        surfaceTintColor: BiteSaverColors.pageBackground,
        elevation: 0,
      ),
      bottomNavigationBar: const PersistentBottomNavigation(
        mode: AppMode.biteSaver,
      ),
      body: FutureBuilder<List<DailySpecial>>(
        future: _specialsFuture,
        builder: (context, snapshot) {
          final specials = snapshot.data ?? const <DailySpecial>[];
          final isLoading =
              snapshot.connectionState == ConnectionState.waiting &&
              !snapshot.hasData;

          return ListView(
            padding: EdgeInsets.fromLTRB(
              16,
              10,
              16,
              18 + MediaQuery.of(context).viewPadding.bottom,
            ),
            children: [
              if (isLoading)
                const Center(
                  child: Padding(
                    padding: EdgeInsets.symmetric(vertical: 36),
                    child: CircularProgressIndicator(),
                  ),
                )
              else if (snapshot.hasError)
                const Text(
                  'Could not load the published Daily Specials. Please reopen this board to retry.',
                )
              else
                BiteSaverSpecialsBoard(
                  restaurantName: restaurantName,
                  emptyMessage: _hasMoreOffers
                      ? 'More offers may include Daily Specials.'
                      : 'No specials posted right now.',
                  entries: _media?.photoBoard == true
                      ? [
                          if (_media!.board?.shouldShowPubliclyAt(
                                    DateTime.now(),
                                  ) ==
                                  true &&
                              _media!.board!.imageUrl != null)
                            BiteSaverBoardPhoto(
                              imageUrl: _media!.board!.imageUrl!,
                              onTap: () => widget.openImage != null
                                  ? widget.openImage!(
                                      context,
                                      _media!.board!.imageUrl!,
                                    )
                                  : Navigator.push(
                                      context,
                                      MaterialPageRoute<void>(
                                        builder: (_) => BiteSaverPhotoViewer(
                                          title:
                                              '$restaurantName Daily Specials',
                                          imageUrl: _media!.board!.imageUrl!,
                                        ),
                                      ),
                                    ),
                            ),
                        ]
                      : _offers != null
                      ? [
                          for (final offer in _offers!)
                            if (offer.offerType ==
                                    CustomerBiteSaverOfferType.dailySpecial &&
                                offer.offerId.value != _media?.boardOfferId)
                              BiteSaverSpecialsEntry.fromOffer(
                                offer: offer,
                                onImageTap: widget.openImage == null
                                    ? null
                                    : () => widget.openImage!(
                                        context,
                                        offer.imageUrl!,
                                      ),
                              ),
                        ]
                      : [
                          for (final special in specials)
                            BiteSaverLegacySpecialsEntry(special: special),
                        ],
                ),
              if (_moreError != null)
                const Text('Could not load more specials. Please try again.'),
              if (_media?.photoBoard != true &&
                  (_hasMoreOffers || _moreError != null))
                TextButton(
                  onPressed: _loadingMore ? null : _loadMore,
                  child: Text(
                    _loadingMore
                        ? 'Loading offers…'
                        : _moreError != null
                        ? 'Retry offers'
                        : 'More offers',
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}
