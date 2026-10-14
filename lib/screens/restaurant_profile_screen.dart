import '../models/bitesaver_restaurant_media.dart';
import '../services/customer_bitesaver_service.dart';
import '../widgets/bitesaver_board_photo.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/demo_redemption_store.dart';
import '../models/coupon.dart';
import '../models/customer_bitesaver_search.dart';
import '../models/daily_special.dart';
import '../models/restaurant.dart';
import '../services/app_error_text.dart';
import '../services/app_mode_state_service.dart';
import '../services/bitesaver_report_service.dart';
import '../services/bitescore_sign_in_gate.dart';
import '../services/bitescore_service.dart';
import '../services/customer_bitesaver_search_coordinator.dart';
import '../services/customer_load_more_controller.dart';
import '../services/customer_bitesaver_public_profile.dart';
import '../services/customer_bitesaver_saved_coordinator.dart';
import '../services/customer_bitescore_reads.dart';
import '../services/customer_bitescore_runtime.dart';
import '../services/restaurant_account_service.dart';
import '../services/restaurant_menu_service.dart';
import '../widgets/bitesaver_colors.dart';
import '../widgets/bitesaver_report_dialog.dart';
import '../widgets/bitesaver_restaurant_images.dart';
import '../widgets/bitesaver_specials_board.dart';
import '../widgets/bitesaver_profile_deal_card.dart';
import 'bitesaver_photo_viewer.dart';
import 'main_navigation_screen.dart';
import '../widgets/clickable_phone_text.dart';
import '../widgets/persistent_bottom_navigation.dart';
import 'coupon_detail_screen.dart';
import 'restaurant_menu_screen.dart';
import 'restaurant_specials_screen.dart';

typedef PublicRestaurantFavoriteLoader =
    Future<bool> Function(Restaurant restaurant);
typedef PublicRestaurantDetailsRefresher =
    Future<Restaurant?> Function(Restaurant restaurant);
typedef PublicRestaurantProjectionLoader =
    Future<Map<String, dynamic>?> Function(String accountDocumentId);
typedef PublicRestaurantMenuResolver =
    Future<RestaurantMenuSource?> Function(String accountDocumentId);
typedef CustomerBiteSaverProfileOfferOpener =
    Future<void> Function(BuildContext context, CustomerBiteSaverOffer offer);
typedef CustomerBiteSaverProfileMenuOpener =
    Future<void> Function(BuildContext context);
typedef CustomerBiteSaverProfileViewOpener =
    Future<void> Function(BuildContext context, WidgetBuilder builder);
typedef PublicRestaurantReportPrompt =
    Future<BiteSaverReportResult?> Function(BuildContext context);
typedef PublicRestaurantReportSubmitter = BiteSaverReportSubmitter;

class RestaurantProfileScreen extends StatefulWidget {
  final Future<BiteSaverRestaurantMedia> Function(String)? loadMedia;
  final Restaurant restaurant;
  final CustomerBiteSaverPublicProfile? publicProfile;
  final PublicRestaurantFavoriteLoader? loadFavorite;
  final PublicRestaurantDetailsRefresher? refreshRestaurant;
  final PublicRestaurantProjectionLoader? loadProjectionData;
  final PublicRestaurantMenuResolver? resolvePublicMenu;
  final CustomerBiteScoreReads? testBiteScoreReads;
  final PublicRestaurantReportPrompt? promptForReport;
  final PublicRestaurantReportSubmitter? submitReport;
  final CustomerBiteSaverRestaurant? boundedRestaurant;
  final CustomerBiteSaverSearchCoordinator? boundedSession;
  final CustomerBiteSaverSavedCoordinator? boundedSavedCoordinator;
  final CustomerBiteSaverBrowseAccess? boundedAccess;
  final CustomerBiteSaverProfileOfferOpener? openBoundedOffer;
  final CustomerBiteSaverProfileMenuOpener? openBoundedMenu;
  final CustomerBiteSaverProfileViewOpener? openBoundedView;

  const RestaurantProfileScreen({
    super.key,
    this.loadMedia,
    required this.restaurant,
    @visibleForTesting this.loadFavorite,
    @visibleForTesting this.refreshRestaurant,
    @visibleForTesting this.loadProjectionData,
    @visibleForTesting this.resolvePublicMenu,
    @visibleForTesting this.testBiteScoreReads,
    @visibleForTesting this.promptForReport,
    @visibleForTesting this.submitReport,
  }) : publicProfile = null,
       boundedRestaurant = null,
       boundedSession = null,
       boundedSavedCoordinator = null,
       boundedAccess = null,
       openBoundedView = null,
       openBoundedOffer = null,
       openBoundedMenu = null;

  RestaurantProfileScreen.fromCustomerBiteSaver({
    super.key,
    this.loadMedia,
    required CustomerBiteSaverRestaurant restaurant,
    required CustomerBiteSaverSearchCoordinator session,
    required CustomerBiteSaverBrowseAccess access,
    required this.openBoundedOffer,
    required this.openBoundedMenu,
    required this.openBoundedView,
    @visibleForTesting this.promptForReport,
    @visibleForTesting this.submitReport,
  }) : publicProfile = null,
       restaurant = _customerBiteSaverRestaurantView(restaurant),
       boundedRestaurant = restaurant,
       boundedSession = session,
       boundedSavedCoordinator = null,
       boundedAccess = access,
       loadFavorite = null,
       refreshRestaurant = null,
       loadProjectionData = null,
       testBiteScoreReads = null,
       resolvePublicMenu = null {
    final current = session.currentAcceptedRestaurantForAccess(
      access,
      restaurant.restaurantId,
    );
    if (!identical(current, restaurant)) {
      throw const CustomerBiteSaverFreshSearchRequiredException();
    }
  }

  RestaurantProfileScreen.fromCustomerBiteSaverSaved({
    super.key,
    this.loadMedia,
    required CustomerBiteSaverRestaurant restaurant,
    required CustomerBiteSaverSavedCoordinator savedCoordinator,
    required this.openBoundedMenu,
    this.openBoundedOffer,
    @visibleForTesting this.promptForReport,
    @visibleForTesting this.submitReport,
  }) : publicProfile = null,
       restaurant = _customerBiteSaverRestaurantView(restaurant),
       boundedRestaurant = restaurant,
       boundedSession = null,
       boundedSavedCoordinator = savedCoordinator,
       boundedAccess = null,
       openBoundedView = null,
       loadFavorite = null,
       refreshRestaurant = null,
       loadProjectionData = null,
       testBiteScoreReads = null,
       resolvePublicMenu = null;

  RestaurantProfileScreen.fromPublicProfile({
    super.key,
    this.loadMedia,
    required CustomerBiteSaverPublicProfile profile,
    required this.openBoundedOffer,
    required this.openBoundedMenu,
    this.boundedSavedCoordinator,
  }) : publicProfile = profile,
       restaurant = _customerBiteSaverRestaurantView(
         profile.restaurant!,
         hideDistance: true,
       ),
       boundedRestaurant = profile.restaurant,
       boundedSession = null,
       boundedAccess = null,
       openBoundedView = null,
       loadFavorite = null,
       refreshRestaurant = null,
       loadProjectionData = null,
       resolvePublicMenu = null,
       testBiteScoreReads = null,
       promptForReport = null,
       submitReport = null;

  @override
  State<RestaurantProfileScreen> createState() =>
      _RestaurantProfileScreenState();
}

class _RestaurantProfileScreenState extends State<RestaurantProfileScreen> {
  BiteSaverRestaurantMedia? _media;
  String? _mediaRestaurantId;
  bool _mediaFailed = false;
  bool _mediaLoading = false;
  bool _isFavoriteRestaurant = false;
  bool _isSavingFavoriteRestaurant = false;
  bool _showRestaurantInfo = false;
  bool _showMoreCoupons = false;
  bool _hasExpandedCoupons = false;
  bool _isSubmittingReport = false;
  bool _isOpeningBoundedMenu = false;
  bool _isCustomerRestaurantAvailabilityResolved = false;
  bool _isCustomerRestaurantAvailable = true;
  double _modeDragProgress = 0;
  AppMode? _pressedMode;
  late Restaurant _restaurant;

  CustomerLoadMoreController<CustomerBiteSaverOffer>? _offerPager;
  bool _loadingOffers = false;
  Object? _offerError;

  CustomerBiteSaverRestaurant? get _currentBrowseRestaurant {
    final session = widget.boundedSession;
    final access = widget.boundedAccess;
    if (session == null ||
        access == null ||
        !session.isBrowseAccessCurrent(access)) {
      return null;
    }
    return session.currentAcceptedRestaurantFor(
      widget.boundedRestaurant!.restaurantId,
    );
  }

  Restaurant get restaurant {
    final publicProfile = widget.publicProfile;
    if (publicProfile != null) {
      return _customerBiteSaverRestaurantView(
        publicProfile.restaurant!,
        offers: publicProfile.offers,
        hideDistance: true,
      );
    }
    final current = _currentBrowseRestaurant;
    return current == null
        ? _restaurant
        : _customerBiteSaverRestaurantView(current, offers: _boundedOffers);
  }

  List<CustomerBiteSaverOffer>? get _boundedOffers {
    final current = _currentBrowseRestaurant;
    if (current == null) {
      return widget.publicProfile?.offers ?? widget.boundedRestaurant?.offers;
    }
    // Keep server order and replace repeated IDs in place, as Home does.
    final offers = <String, CustomerBiteSaverOffer>{
      for (final offer in current.offers) offer.offerId.value: offer,
      for (final offer
          in _offerPager?.items ?? const <CustomerBiteSaverOffer>[])
        offer.offerId.value: offer,
    };
    return offers.values.toList(growable: false);
  }

  void _bindOfferPager() {
    final current = _currentBrowseRestaurant;
    final pager = current == null
        ? null
        : widget.boundedSession!.offerPagerFor(current.restaurantId);
    if (identical(pager, _offerPager)) return;
    _offerPager?.removeListener(_offersChanged);
    _offerPager = pager;
    pager?.addListener(_offersChanged);
  }

  void _browseChanged() {
    _bindOfferPager();
    _offersChanged();
  }

  void _offersChanged() {
    if (mounted) setState(() {});
  }

  Future<void> _loadMoreOffers() async {
    final current = _currentBrowseRestaurant;
    if (current == null || _loadingOffers || _offerPager?.isLoading == true) {
      return;
    }
    final session = widget.boundedSession!;
    setState(() {
      _loadingOffers = true;
      _offerError = null;
    });
    try {
      final pager = session.offerPagerFor(current.restaurantId);
      if (pager == null ||
          session.offerPageRequiresRestart(current.restaurantId)) {
        await session.loadOffers(current.restaurantId);
      } else if (pager.hasRetry) {
        await pager.retry();
      } else if (pager.pageEnvelope == null) {
        await pager.loadInitial();
      } else {
        await pager.loadMore();
      }
    } catch (error) {
      if (mounted) _offerError = error;
    } finally {
      if (mounted) {
        _bindOfferPager();
        setState(() => _loadingOffers = false);
      }
    }
  }

  Widget _buildBrowseOfferContinuation() {
    final current = _currentBrowseRestaurant;
    if (current == null) return const SizedBox.shrink();
    final pager = _offerPager;
    final loading = _loadingOffers || pager?.isLoading == true;
    final error = _offerError ?? pager?.error;
    final restart = widget.boundedSession!.offerPageRequiresRestart(
      current.restaurantId,
    );
    final hasMore =
        restart ||
        (pager?.pageEnvelope == null ? current.hasMoreOffers : pager!.hasNext);
    return Column(
      children: <Widget>[
        if (error != null)
          const Text('Could not load more offers. Please try again.'),
        if (loading || error != null || hasMore)
          TextButton(
            onPressed: loading ? null : _loadMoreOffers,
            child: Text(
              loading
                  ? 'Loading offers…'
                  : error != null
                  ? 'Retry offers'
                  : 'More offers',
            ),
          ),
      ],
    );
  }

  @override
  void dispose() {
    widget.boundedSession?.removeListener(_browseChanged);
    _offerPager?.removeListener(_offersChanged);
    // The search coordinator owns the shared pager and its accepted results.
    super.dispose();
  }

  String _displayText(String value, String fallback) {
    final trimmed = value.trim();
    return trimmed.isEmpty ? fallback : trimmed;
  }

  @override
  void initState() {
    super.initState();
    _restaurant = widget.restaurant;
    final mediaId = widget.boundedRestaurant?.restaurantId.value;
    if (mediaId != null) _loadMedia(mediaId);
    widget.boundedSession?.addListener(_browseChanged);
    _bindOfferPager();
    final boundedRestaurant = widget.boundedRestaurant;
    if (boundedRestaurant != null) {
      _isCustomerRestaurantAvailabilityResolved = true;
      _isCustomerRestaurantAvailable = true;
      _isFavoriteRestaurant =
          _boundedFavoriteState == CustomerBiteSaverFavoriteState.favorite;
      return;
    }
    final hasCanonicalRestaurantId =
        widget.restaurant.accountDocumentId != null;
    _isCustomerRestaurantAvailabilityResolved =
        widget.refreshRestaurant != null || !hasCanonicalRestaurantId;
    _isCustomerRestaurantAvailable =
        widget.refreshRestaurant != null || hasCanonicalRestaurantId;
    _loadFavoriteState();
    _refreshRestaurantDetails();
  }

  CustomerBiteSaverFavoriteState get _boundedFavoriteState {
    final boundedRestaurant = widget.boundedRestaurant;
    if (boundedRestaurant == null) {
      return _isFavoriteRestaurant
          ? CustomerBiteSaverFavoriteState.favorite
          : CustomerBiteSaverFavoriteState.notFavorite;
    }
    return widget.boundedSession?.restaurantFavoriteState(
          boundedRestaurant.restaurantId,
        ) ??
        widget.boundedSavedCoordinator?.restaurantFavoriteState(
          boundedRestaurant.restaurantId,
        ) ??
        CustomerBiteSaverFavoriteState.unknown;
  }

  Future<void> _loadFavoriteState() async {
    final loader = widget.loadFavorite;
    final isFavorite = loader == null
        ? await BiteScoreService.isSaverRestaurantFavoritedByCurrentUser(
            restaurant,
          )
        : await loader(restaurant);
    if (!mounted) {
      return;
    }

    setState(() {
      _isFavoriteRestaurant = isFavorite;
    });
  }

  bool get hasPhone =>
      restaurant.phone != null && restaurant.phone!.trim().isNotEmpty;

  bool get hasWebsite =>
      restaurant.website != null && restaurant.website!.trim().isNotEmpty;

  bool get hasStreetAddress =>
      restaurant.streetAddress != null &&
      restaurant.streetAddress!.trim().isNotEmpty;

  bool get hasBio =>
      restaurant.bio != null && restaurant.bio!.trim().isNotEmpty;

  List<RestaurantBusinessHours> get weeklyHours =>
      restaurant.businessHours.isEmpty
      ? const []
      : RestaurantBusinessHours.normalizedWeek(restaurant.businessHours);

  List<_GroupedRestaurantHours> get groupedWeeklyHours {
    if (weeklyHours.isEmpty) {
      return const [];
    }

    final hoursByDay = {for (final entry in weeklyHours) entry.day: entry};
    final orderedDays = const [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ];
    final orderedHours = [
      for (final day in orderedDays)
        if (hoursByDay[day] != null) hoursByDay[day]!,
    ];

    final groups = <_GroupedRestaurantHours>[];
    for (final entry in orderedHours) {
      if (groups.isNotEmpty && groups.last.matches(entry)) {
        groups.last = groups.last.copyWith(endDay: entry.day);
      } else {
        groups.add(
          _GroupedRestaurantHours(
            startDay: entry.day,
            endDay: entry.day,
            summaryLabel: entry.summaryLabel,
            closed: entry.closed,
          ),
        );
      }
    }

    return groups;
  }

  bool _isFallbackDistanceLabel(String value) {
    return value.trim().isEmpty ||
        value.trim() == Restaurant.defaultDistanceLabel;
  }

  String _distanceLocationLine(Restaurant restaurant) {
    final parts = <String>[
      if (!_isFallbackDistanceLabel(restaurant.distance))
        restaurant.distance.trim(),
      if (restaurant.city.trim().isNotEmpty) restaurant.city.trim(),
    ];
    if (parts.isEmpty) {
      return _displayText(restaurant.zipCode, 'Location unavailable');
    }
    return parts.join(' - ');
  }

  Restaurant _withSafeDistanceLabel(Restaurant freshRestaurant) {
    if (!_isFallbackDistanceLabel(freshRestaurant.distance) ||
        _isFallbackDistanceLabel(restaurant.distance)) {
      return freshRestaurant;
    }

    return Restaurant(
      documentId: freshRestaurant.documentId,
      uid: freshRestaurant.uid,
      name: freshRestaurant.name,
      distance: restaurant.distance,
      city: freshRestaurant.city,
      state: freshRestaurant.state,
      zipCode: freshRestaurant.zipCode,
      coupons: freshRestaurant.coupons,
      dailySpecials: freshRestaurant.dailySpecials,
      phone: freshRestaurant.phone,
      streetAddress: freshRestaurant.streetAddress,
      website: freshRestaurant.website,
      bio: freshRestaurant.bio,
      mainImageUrl: freshRestaurant.mainImageUrl,
      businessHours: freshRestaurant.businessHours,
      latitude: freshRestaurant.latitude,
      longitude: freshRestaurant.longitude,
      profileVersion: freshRestaurant.profileVersion,
      locationVersion: freshRestaurant.locationVersion,
      formattedAddress: freshRestaurant.formattedAddress,
      addressFingerprint: freshRestaurant.addressFingerprint,
      locationValidatedAt: freshRestaurant.locationValidatedAt,
      locationSource: freshRestaurant.locationSource,
    );
  }

  Restaurant _withoutCustomerOffers(Restaurant source) {
    return Restaurant(
      documentId: source.documentId,
      uid: source.uid,
      name: source.name,
      distance: source.distance,
      city: source.city,
      state: source.state,
      zipCode: source.zipCode,
      coupons: const <Coupon>[],
      dailySpecials: const <DailySpecial>[],
      phone: source.phone,
      streetAddress: source.streetAddress,
      website: source.website,
      bio: source.bio,
      mainImageUrl: source.mainImageUrl,
      businessHours: source.businessHours,
      latitude: source.latitude,
      longitude: source.longitude,
      profileVersion: source.profileVersion,
      locationVersion: source.locationVersion,
      formattedAddress: source.formattedAddress,
      addressFingerprint: source.addressFingerprint,
      locationValidatedAt: source.locationValidatedAt,
      locationSource: source.locationSource,
    );
  }

  Future<void> _refreshRestaurantDetails() async {
    if (widget.boundedRestaurant != null) return;
    try {
      Restaurant? freshRestaurant;

      final refresher = widget.refreshRestaurant;
      if (refresher != null) {
        freshRestaurant = await refresher(restaurant);
      } else {
        final accountDocumentId = restaurant.accountDocumentId;
        if (accountDocumentId != null) {
          final projectionData =
              await (widget.loadProjectionData?.call(accountDocumentId) ??
                  RestaurantAccountService.loadCustomerRestaurantProjectionById(
                    accountDocumentId,
                  ));
          if (projectionData != null) {
            final mediaId = projectionData['publicRestaurantId'];
            if (mediaId is String) _loadMedia(mediaId);
            final publicRestaurant =
                RestaurantAccountService.customerRestaurantFromProjectionData(
                  projectionData,
                  expectedRestaurantId: accountDocumentId,
                );
            if (publicRestaurant != null) {
              final dailySpecials =
                  await RestaurantAccountService.loadDailySpecialsForRestaurant(
                    accountDocumentId,
                  );
              freshRestaurant =
                  RestaurantAccountService.customerRestaurantFromProjectionData(
                    projectionData,
                    expectedRestaurantId: accountDocumentId,
                    coupons: restaurant.coupons,
                    dailySpecials: dailySpecials,
                  );
            }
          }
        }
      }

      if (!mounted) {
        return;
      }
      if (freshRestaurant == null) {
        if (!_isCustomerRestaurantAvailabilityResolved) {
          _markCustomerRestaurantUnavailable();
        }
        return;
      }

      setState(() {
        _isCustomerRestaurantAvailabilityResolved = true;
        _isCustomerRestaurantAvailable = true;
        _restaurant = _withSafeDistanceLabel(freshRestaurant!);
      });
    } on FirebaseException catch (error) {
      if (error.code == 'permission-denied') {
        _markCustomerRestaurantUnavailable();
        return;
      }
      _retainRestaurantWithoutOffers();
    } catch (_) {
      _retainRestaurantWithoutOffers();
    }
  }

  void _markCustomerRestaurantUnavailable() {
    if (!mounted) return;
    setState(() {
      _isCustomerRestaurantAvailabilityResolved = true;
      _isCustomerRestaurantAvailable = false;
      _restaurant = _withoutCustomerOffers(restaurant);
    });
  }

  void _retainRestaurantWithoutOffers() {
    if (!mounted) return;
    setState(() {
      _isCustomerRestaurantAvailabilityResolved = true;
      _restaurant = _withoutCustomerOffers(restaurant);
    });
  }

  String _placeholderImageForRestaurant(Restaurant restaurant) {
    final stableKey = restaurant.accountDocumentId?.trim().isNotEmpty == true
        ? restaurant.accountDocumentId!.trim()
        : '${restaurant.name}|${restaurant.city}|${restaurant.zipCode}';
    final hash = stableKey.codeUnits.fold<int>(
      0,
      (value, unit) => (value * 31 + unit) & 0x7fffffff,
    );
    return BiteSaverRestaurantPlaceholderImages.assetForPlaceholderOnlyIndex(
      hash,
    );
  }

  Future<void> _showLaunchError(BuildContext context, String message) async {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(content: Text(message), duration: const Duration(seconds: 3)),
      );
  }

  Future<void> _callRestaurant(BuildContext context) async {
    if (!hasPhone) {
      await _showLaunchError(context, 'No phone number available.');
      return;
    }

    final cleanedPhone = restaurant.phone!.replaceAll(RegExp(r'[^0-9+]'), '');
    final uri = Uri(scheme: 'tel', path: cleanedPhone);

    final launched = await launchUrl(uri);
    if (!launched && context.mounted) {
      await _showLaunchError(context, 'Could not open the phone dialer.');
    }
  }

  Future<void> _openWebsite(BuildContext context) async {
    if (!hasWebsite) {
      await _showLaunchError(context, 'No website available.');
      return;
    }

    final rawWebsite = restaurant.website!.trim();
    final normalizedWebsite =
        rawWebsite.startsWith('http://') || rawWebsite.startsWith('https://')
        ? rawWebsite
        : 'https://$rawWebsite';

    final uri = Uri.parse(normalizedWebsite);

    final launched = await launchUrl(uri, mode: LaunchMode.externalApplication);

    if (!launched && context.mounted) {
      await _showLaunchError(context, 'Could not open the website.');
    }
  }

  Future<void> _openMenu(BuildContext context) async {
    if (widget.boundedRestaurant != null) {
      if (_isOpeningBoundedMenu) return;
      final opener = widget.openBoundedMenu;
      if (opener == null) {
        await _showLaunchError(
          context,
          'Menu is not available from this search yet.',
        );
        return;
      }
      setState(() => _isOpeningBoundedMenu = true);
      try {
        await opener(context);
      } finally {
        if (mounted) setState(() => _isOpeningBoundedMenu = false);
      }
      return;
    }
    final accountDocumentId = restaurant.accountDocumentId;
    RestaurantMenuSource? source;
    String? linkedBiteScoreRestaurantId;
    if (accountDocumentId != null) {
      if (CustomerBiteScoreRuntime.isEnabled) {
        final route =
            await RestaurantMenuService.resolveBiteSaverPublicMenuRoute(
              uid: accountDocumentId,
              projectionLoader: widget.loadProjectionData,
            );
        source = route?.source;
        linkedBiteScoreRestaurantId = route?.biteScoreRestaurantId;
      } else {
        final resolver = widget.resolvePublicMenu;
        source = resolver == null
            ? await RestaurantMenuService.resolveBiteSaverPublicMenuSource(
                uid: accountDocumentId,
              )
            : await resolver(accountDocumentId);
      }
    }

    if (!context.mounted) {
      return;
    }

    if (source == null && linkedBiteScoreRestaurantId == null) {
      await _showLaunchError(context, 'Menu is not available right now.');
      return;
    }

    final linkedId = linkedBiteScoreRestaurantId;
    final biteScoreReads = linkedId == null
        ? null
        : widget.testBiteScoreReads ?? CustomerBiteScoreReads();
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => RestaurantMenuScreen(
          restaurantUid: accountDocumentId,
          restaurantName: _displayText(restaurant.name, 'Restaurant'),
          source: source,
          biteScorePageLoader: linkedId == null
              ? null
              : (cursor) => biteScoreReads!.menu(linkedId, cursor: cursor),
        ),
      ),
    );
  }

  Future<void> _openProfileView(
    BuildContext context,
    WidgetBuilder builder,
  ) async {
    final opener = widget.openBoundedView;
    if (widget.boundedSession != null) {
      if (opener == null || _currentBrowseRestaurant == null) return;
      await opener(context, builder);
      return;
    }
    await pushMainNavigationPrivateRoute<void>(
      context,
      parentBinding: MainNavigationAuthBoundOverlayScope.maybeOf(context),
      builder: builder,
    );
  }

  Future<void> _loadMedia(String id) async {
    _mediaRestaurantId = id;
    _mediaLoading = true;
    try {
      final media =
          await (widget.loadMedia ??
              CustomerBiteSaverService().getRestaurantMedia)(id);
      if (!mounted || _mediaRestaurantId != id) return;
      if (media.restaurantId != id) {
        throw const FormatException('Restaurant photo identity changed.');
      }
      setState(() {
        _media = media;
        _mediaFailed = false;
      });
    } catch (_) {
      if (mounted && _mediaRestaurantId == id) {
        setState(() => _mediaFailed = true);
      }
    } finally {
      if (mounted && _mediaRestaurantId == id) {
        setState(() => _mediaLoading = false);
      }
    }
  }

  Future<void> _openRestaurantPhotos(BuildContext context, String imageUrl) =>
      _openProfileView(
        context,
        (_) => BiteSaverPhotoViewer(
          title: restaurant.name,
          imageUrl: imageUrl,
          additionalImageUrls: _media?.gallery ?? const [],
        ),
      );

  Future<void> _openPhoto(
    BuildContext context,
    String imageUrl,
    String title,
  ) => _openProfileView(
    context,
    (_) => BiteSaverPhotoViewer(title: title, imageUrl: imageUrl),
  );

  bool get _hasMoreProfileOffers {
    final current = _currentBrowseRestaurant;
    if (current != null) {
      return widget.boundedSession!.offerPageRequiresRestart(
            current.restaurantId,
          ) ||
          (_offerPager?.pageEnvelope == null
              ? current.hasMoreOffers
              : _offerPager!.hasNext);
    }
    return widget.publicProfile?.cursor != null;
  }

  Future<({List<CustomerBiteSaverOffer> offers, bool hasMore})>
  _loadBoardOffers() async {
    if (widget.boundedSession != null) {
      if (_currentBrowseRestaurant == null) {
        throw const CustomerBiteSaverFreshSearchRequiredException();
      }
      await _loadMoreOffers();
      if (_currentBrowseRestaurant == null) {
        throw const CustomerBiteSaverFreshSearchRequiredException();
      }
      final error = _offerError ?? _offerPager?.error;
      if (error != null) throw error;
    } else {
      await widget.publicProfile!.loadMore();
      if (widget.publicProfile!.error != null) {
        throw widget.publicProfile!.error!;
      }
    }
    return (
      offers: _boundedOffers ?? const <CustomerBiteSaverOffer>[],
      hasMore: _hasMoreProfileOffers,
    );
  }

  Future<void> _openSpecials(BuildContext context) async {
    final offers = _boundedOffers;
    if (offers == null && _mediaRestaurantId != null && _media == null) {
      await _loadMedia(_mediaRestaurantId!);
      if (!context.mounted || _media == null) return;
    }
    await _openProfileView(
      context,
      (_) => offers == null
          ? RestaurantSpecialsScreen(restaurant: restaurant, media: _media)
          : RestaurantSpecialsScreen.fromCustomerBiteSaver(
              restaurant: restaurant,
              media: _media,
              offers: offers,
              hasMoreOffers: _hasMoreProfileOffers,
              loadMoreOffers:
                  widget.boundedSession != null || widget.publicProfile != null
                  ? _loadBoardOffers
                  : null,
              openImage: (imageContext, url) =>
                  _openPhoto(imageContext, url, '${restaurant.name} special'),
            ),
    );
  }

  Future<void> _getDirections(BuildContext context) async {
    final fullAddress = hasStreetAddress
        ? '${restaurant.streetAddress}, ${restaurant.city}, ${restaurant.zipCode}'
        : '${restaurant.city}, ${restaurant.zipCode}';

    final uri = Uri.parse(
      'https://www.google.com/maps/search/?api=1&query=${Uri.encodeComponent(fullAddress)}',
    );

    final launched = await launchUrl(uri, mode: LaunchMode.externalApplication);

    if (!launched && context.mounted) {
      await _showLaunchError(context, 'Could not open directions.');
    }
  }

  Future<void> _toggleRestaurantFavorite() async {
    final boundedRestaurant = widget.boundedRestaurant;
    if (boundedRestaurant != null) {
      if (_isSavingFavoriteRestaurant ||
          _boundedFavoriteState == CustomerBiteSaverFavoriteState.unknown) {
        return;
      }
      final nextIsFavorite =
          _boundedFavoriteState != CustomerBiteSaverFavoriteState.favorite;
      setState(() => _isSavingFavoriteRestaurant = true);
      try {
        final session = widget.boundedSession;
        if (session != null) {
          await session.setRestaurantFavorite(
            boundedRestaurant.restaurantId,
            nextIsFavorite,
          );
        } else {
          await widget.boundedSavedCoordinator!.setRestaurantFavorite(
            boundedRestaurant,
            nextIsFavorite,
          );
        }
        if (!mounted) return;
        await _showLaunchError(
          context,
          nextIsFavorite
              ? 'Saved restaurant to your profile.'
              : 'Removed restaurant from your saved list.',
        );
      } catch (error) {
        if (!mounted) return;
        await _showLaunchError(
          context,
          AppErrorText.friendly(
            error,
            fallback: 'Could not update this saved restaurant right now.',
          ),
        );
      } finally {
        if (mounted) setState(() => _isSavingFavoriteRestaurant = false);
      }
      return;
    }
    final canSave = await BiteScoreSignInGate.ensureSignedInForFavorites(
      context,
      returnToOriginAfterSignIn: true,
    );
    if (!canSave || !mounted || _isSavingFavoriteRestaurant) {
      return;
    }

    final nextIsFavorite = !_isFavoriteRestaurant;

    setState(() {
      _isSavingFavoriteRestaurant = true;
      _isFavoriteRestaurant = nextIsFavorite;
    });

    try {
      await BiteScoreService.setSaverRestaurantFavorite(
        restaurant: restaurant,
        isFavorite: nextIsFavorite,
      );
      if (!mounted) {
        return;
      }
      await _showLaunchError(
        context,
        nextIsFavorite
            ? 'Saved restaurant to your profile.'
            : 'Removed restaurant from your saved list.',
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _isFavoriteRestaurant = !nextIsFavorite;
      });
      await _showLaunchError(
        context,
        AppErrorText.friendly(
          error,
          fallback: 'Could not update this saved restaurant right now.',
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isSavingFavoriteRestaurant = false;
        });
      }
    }
  }

  Future<void> _reportRestaurant() async {
    if (_isSubmittingReport) {
      return;
    }

    final promptForReport = widget.promptForReport;
    final report = promptForReport == null
        ? await showDialog<BiteSaverReportResult>(
            context: context,
            builder: (context) => const BiteSaverReportDialog(),
          )
        : await promptForReport(context);

    if (report == null || !mounted) {
      return;
    }

    setState(() {
      _isSubmittingReport = true;
    });

    try {
      final submitReport =
          widget.submitReport ?? BiteSaverReportService.submitReport;
      await submitReport(
        reportType: 'restaurant',
        restaurantId:
            widget.boundedRestaurant?.restaurantId.value ??
            restaurant.accountDocumentId,
        restaurantName: restaurant.name,
        reason: report.reason,
        note: report.note,
      );
      if (!mounted) {
        return;
      }
      await _showLaunchError(context, 'Thanks — we’ll review this.');
    } catch (error) {
      if (!mounted) {
        return;
      }
      await _showLaunchError(
        context,
        AppErrorText.friendly(
          error,
          fallback: 'Could not submit this report right now.',
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isSubmittingReport = false;
        });
      }
    }
  }

  List<BoxShadow> _biteSaverTileShadows({double strength = 0.9}) {
    return [
      BoxShadow(
        color: BiteSaverColors.coolShadow.withValues(alpha: 0.10 * strength),
        blurRadius: 14,
        offset: const Offset(0, 8),
      ),
      BoxShadow(
        color: BiteSaverColors.coolShadow.withValues(alpha: 0.05 * strength),
        blurRadius: 3,
        offset: const Offset(0, 2),
      ),
      BoxShadow(
        color: Color.fromRGBO(255, 255, 255, 0.35 * strength),
        blurRadius: 1.5,
        offset: const Offset(0, -0.5),
      ),
    ];
  }

  Widget _biteSaverRaisedSurface({
    required Widget child,
    BorderRadius? borderRadius,
    EdgeInsetsGeometry innerMargin = const EdgeInsets.all(1.8),
    double shadowStrength = 0.9,
  }) {
    final shellRadius = borderRadius ?? BorderRadius.circular(16);

    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: shellRadius,
        gradient: const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            BiteSaverColors.surface,
            BiteSaverColors.secondaryBackground,
            BiteSaverColors.subtleSurface,
            BiteSaverColors.border,
          ],
          stops: [0.0, 0.34, 0.72, 1.0],
        ),
        border: Border.all(color: BiteSaverColors.border, width: 1),
        boxShadow: [
          const BoxShadow(
            color: Color.fromRGBO(15, 23, 42, 0.10),
            offset: Offset(0, 2),
            blurRadius: 0,
          ),
          ..._biteSaverTileShadows(strength: shadowStrength),
        ],
      ),
      child: Padding(
        padding: innerMargin,
        child: DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: shellRadius,
            gradient: const LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [
                BiteSaverColors.surface,
                BiteSaverColors.secondaryBackground,
                BiteSaverColors.subtleSurface,
              ],
            ),
            border: Border.all(color: const Color(0xF7FFFFFF), width: 0.7),
          ),
          child: child,
        ),
      ),
    );
  }

  Widget _buildCompactActionButton({
    required IconData icon,
    required String label,
    required bool enabled,
    required VoidCallback onPressed,
  }) {
    return SizedBox(
      width: double.infinity,
      child: _biteSaverRaisedSurface(
        borderRadius: BorderRadius.circular(999),
        innerMargin: const EdgeInsets.all(1.2),
        shadowStrength: enabled ? 0.56 : 0.2,
        child: ElevatedButton.icon(
          onPressed: enabled ? onPressed : null,
          icon: Icon(icon, size: 16),
          label: Text(label, overflow: TextOverflow.ellipsis),
          style: ElevatedButton.styleFrom(
            backgroundColor: Colors.transparent,
            foregroundColor: BiteSaverColors.orangeDark,
            disabledBackgroundColor: Colors.transparent,
            disabledForegroundColor: BiteSaverColors.mutedInk,
            elevation: 0,
            shadowColor: Colors.transparent,
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
            minimumSize: const Size(0, 40),
            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            textStyle: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w700,
            ),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(999),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildRestaurantProfileImage() {
    final imageUrl = _media == null
        ? restaurant.mainImageUrl
        : _media!.gallery.firstOrNull;
    final fallbackAsset = _placeholderImageForRestaurant(restaurant);
    Widget buildFallback(BuildContext context) =>
        Image.asset(fallbackAsset, fit: BoxFit.cover);

    return _biteSaverRaisedSurface(
      borderRadius: BorderRadius.circular(18),
      innerMargin: const EdgeInsets.all(1.3),
      shadowStrength: 0.52,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(18),
        child: AspectRatio(
          aspectRatio: 1.08,
          child: Semantics(
            button: BiteSaverRestaurantPlaceholderImages.hasRealImage(imageUrl),
            label: BiteSaverRestaurantPlaceholderImages.hasRealImage(imageUrl)
                ? 'Enlarge ${restaurant.name} photograph'
                : 'No restaurant photograph yet',
            child: InkWell(
              key: const ValueKey('profile-main-photo'),
              onTap: BiteSaverRestaurantPlaceholderImages.hasRealImage(imageUrl)
                  ? () => _openRestaurantPhotos(context, imageUrl!)
                  : null,
              child: BiteSaverRestaurantImage(
                imageUrl: imageUrl,
                fit: BoxFit.cover,
                semanticLabel: '${restaurant.name} restaurant image',
                loadingBuilder: (context) =>
                    const ColoredBox(color: BiteSaverColors.imageFallback),
                emptyBuilder: buildFallback,
                errorBuilder: buildFallback,
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildCompactProfileActions() {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (_mediaFailed && _mediaRestaurantId != null)
          TextButton(
            onPressed: _mediaLoading
                ? null
                : () => _loadMedia(_mediaRestaurantId!),
            child: const Text('Retry photos and board'),
          ),
        _buildCompactActionButton(
          icon: Icons.call,
          label: 'Call',
          enabled: hasPhone,
          onPressed: () {
            _callRestaurant(context);
          },
        ),
        const SizedBox(height: 7),
        _buildCompactActionButton(
          icon: Icons.directions,
          label: 'Directions',
          enabled: true,
          onPressed: () {
            _getDirections(context);
          },
        ),
        const SizedBox(height: 7),
        _buildRestaurantInformationTile(compact: true),
      ],
    );
  }

  Widget _buildSpecialsBoard() {
    final offers = _boundedOffers;
    final specials = DailySpecial.visibleSpecialsAt(
      restaurant.dailySpecials
          .where((special) => special.id != 'bitesaver_managed_board')
          .toList(),
      DateTime.now(),
    );
    return Semantics(
      button: true,
      label: "View ${restaurant.name} Daily Specials board",
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          key: const ValueKey('profile-specials-board'),
          onTap: () => _openSpecials(context),
          borderRadius: BorderRadius.circular(22),
          child: BiteSaverSpecialsBoard(
            restaurantName: restaurant.name,
            emptyMessage: _hasMoreProfileOffers
                ? 'View More for additional offers and specials.'
                : 'No specials posted right now.',
            entries:
                offers == null && _mediaRestaurantId != null && _media == null
                ? const []
                : _media?.photoBoard == true
                ? [
                    if (_media!.board?.shouldShowPubliclyAt(DateTime.now()) ==
                            true &&
                        _media!.board!.imageUrl != null)
                      BiteSaverBoardPhoto(
                        imageUrl: _media!.board!.imageUrl!,
                        onTap: () => _openPhoto(
                          context,
                          _media!.board!.imageUrl!,
                          '${restaurant.name} Daily Specials',
                        ),
                      ),
                  ]
                : offers == null
                ? [
                    for (final special in specials)
                      BiteSaverLegacySpecialsEntry(special: special),
                  ]
                : [
                    for (final offer in offers)
                      if (offer.offerType ==
                              CustomerBiteSaverOfferType.dailySpecial &&
                          offer.offerId.value != _media?.boardOfferId)
                        BiteSaverSpecialsEntry.fromOffer(
                          offer: offer,
                          onTap: widget.openBoundedOffer == null
                              ? null
                              : () => widget.openBoundedOffer!(context, offer),
                          onImageTap: () => _openPhoto(
                            context,
                            offer.imageUrl!,
                            '${restaurant.name} special',
                          ),
                        ),
                  ],
          ),
        ),
      ),
    );
  }

  Future<void> _openProfileCoupon(Coupon coupon) async {
    if (widget.boundedRestaurant != null) {
      final offer = _boundedOffers
          ?.where((offer) => offer.offerId.value == coupon.id)
          .firstOrNull;
      if (offer != null && widget.openBoundedOffer != null) {
        await widget.openBoundedOffer!(context, offer);
      }
      return;
    }
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) =>
            CouponDetailScreen(coupon: coupon, restaurant: restaurant),
      ),
    );
  }

  Future<void> _expandCoupons() async {
    if (_showMoreCoupons) {
      setState(() => _showMoreCoupons = false);
      return;
    }
    final firstExpansion = !_hasExpandedCoupons;
    _hasExpandedCoupons = true;
    setState(() => _showMoreCoupons = true);
    if (_currentBrowseRestaurant?.hasMoreOffers == true &&
        _offerPager == null) {
      await _loadMoreOffers();
    } else if (widget.publicProfile?.cursor != null &&
        firstExpansion &&
        !widget.publicProfile!.loading) {
      await widget.publicProfile!.loadMore();
    }
  }

  Widget _buildExpandableInfoTile({
    required String title,
    required bool isExpanded,
    required ValueChanged<bool> onExpansionChanged,
    required Widget child,
    bool compact = false,
    bool inlineContent = true,
  }) {
    return _biteSaverRaisedSurface(
      borderRadius: BorderRadius.circular(18),
      innerMargin: const EdgeInsets.all(1.4),
      shadowStrength: 0.64,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(18),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            InkWell(
              onTap: () => onExpansionChanged(!isExpanded),
              child: ConstrainedBox(
                constraints: BoxConstraints(minHeight: compact ? 40 : 56),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 10,
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          title,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: BiteSaverColors.orangeDark,
                            fontSize: compact ? 13 : 14,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      AnimatedRotation(
                        turns: isExpanded ? 0.5 : 0,
                        duration: const Duration(milliseconds: 200),
                        child: const Icon(
                          Icons.expand_more,
                          size: 20,
                          color: BiteSaverColors.orangeDark,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            if (inlineContent)
              AnimatedCrossFade(
                firstChild: const SizedBox(width: double.infinity),
                secondChild: Padding(
                  padding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
                  child: Align(alignment: Alignment.centerLeft, child: child),
                ),
                crossFadeState: isExpanded
                    ? CrossFadeState.showSecond
                    : CrossFadeState.showFirst,
                duration: const Duration(milliseconds: 200),
                sizeCurve: Curves.easeOut,
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildRestaurantInformationTile({bool compact = false}) {
    return _buildExpandableInfoTile(
      title: 'Restaurant Information',
      isExpanded: _showRestaurantInfo,
      onExpansionChanged: (expanded) =>
          setState(() => _showRestaurantInfo = expanded),
      compact: compact,
      inlineContent: !compact,
      child: compact
          ? const SizedBox.shrink()
          : _buildRestaurantInformationContent(),
    );
  }

  Widget _buildRestaurantInformationContent() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      if (hasBio) ...[
        const Text(
          'About',
          style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 6),
        Text(restaurant.bio!, style: const TextStyle(fontSize: 14)),
        const SizedBox(height: 14),
      ],
      const Text(
        'Hours',
        style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
      ),
      const SizedBox(height: 6),
      if (weeklyHours.isEmpty)
        const Text('Hours not set')
      else
        for (final dayHours in groupedWeeklyHours)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  width: 78,
                  child: Text(
                    '${dayHours.dayRangeLabel}:',
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                ),
                Expanded(child: Text(dayHours.summaryLabel)),
              ],
            ),
          ),
      const SizedBox(height: 14),
      const Text(
        'Details',
        style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
      ),
      const SizedBox(height: 6),
      if (hasStreetAddress) ...[
        InkWell(
          onTap: () {
            _getDirections(context);
          },
          borderRadius: BorderRadius.circular(8),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 2),
            child: Text(
              'Address: ${restaurant.streetAddress!}',
              style: TextStyle(
                color: ClickablePhoneText.linkColor,
                decoration: TextDecoration.underline,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ),
        const SizedBox(height: 6),
      ],
      Text('City: ${restaurant.city}'),
      const SizedBox(height: 6),
      Text('ZIP: ${restaurant.zipCode}'),
      TextButton(
        key: const ValueKey('profile-menu-information'),
        onPressed: () => _openMenu(context),
        child: const Text(
          'Menu',
          style: TextStyle(
            color: Color(0xFF2563EB),
            decoration: TextDecoration.underline,
            fontWeight: FontWeight.w800,
          ),
        ),
      ),
      if (hasPhone) ...[
        const SizedBox(height: 6),
        ClickablePhoneText(phone: restaurant.phone, prefix: 'Phone: '),
      ],
      if (hasWebsite) ...[
        const SizedBox(height: 6),
        InkWell(
          onTap: () {
            _openWebsite(context);
          },
          borderRadius: BorderRadius.circular(8),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 2),
            child: Text(
              'Website: ${restaurant.website!}',
              style: const TextStyle(
                color: Color(0xFF2563EB),
                decoration: TextDecoration.underline,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ),
      ],
    ],
  );

  Color _modeAccentColor(AppMode selectedMode) {
    return selectedMode == AppMode.biteScore
        ? const Color(0xFF3D67BE)
        : const Color(0xFFD06C3B);
  }

  double _selectedModePosition(AppMode selectedMode) {
    return selectedMode == AppMode.biteSaver ? 0 : 1;
  }

  void _handleModeDragUpdate(
    DragUpdateDetails details,
    BoxConstraints constraints,
  ) {
    final width = constraints.maxWidth;
    if (width <= 0) return;

    setState(() {
      _modeDragProgress = (_modeDragProgress + (details.delta.dx / width))
          .clamp(-1, 1);
    });
  }

  void _setPressedMode(AppMode? mode) {
    if (_pressedMode == mode) return;
    setState(() {
      _pressedMode = mode;
    });
  }

  void _selectMode(AppMode mode, AppMode selectedMode) {
    if (mode == selectedMode) {
      return;
    }
    Navigator.of(context).popUntil((route) => route.isFirst);
    AppModeStateService.setMode(mode);
  }

  Widget _buildWarmModeSwitcher() {
    return ValueListenableBuilder<AppMode>(
      valueListenable: AppModeStateService.selectedMode,
      builder: (context, selectedMode, _) {
        final colorScheme = Theme.of(context).colorScheme;
        final accent = _modeAccentColor(selectedMode);
        final selectedPosition = _selectedModePosition(selectedMode);

        return Container(
          width: double.infinity,
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          color: BiteSaverColors.secondaryBackground,
          child: LayoutBuilder(
            builder: (context, constraints) {
              final width = constraints.maxWidth;
              final thumbWidth = (width - 4) / 2;
              final visualPosition = (selectedPosition + _modeDragProgress)
                  .clamp(0, 1)
                  .toDouble();
              final left = 2 + (visualPosition * thumbWidth);

              void handleDragEnd() {
                final targetPosition =
                    (selectedPosition + _modeDragProgress) >= 0.5 ? 1 : 0;
                setState(() {
                  _modeDragProgress = 0;
                  _pressedMode = null;
                });
                _selectMode(
                  targetPosition == 0 ? AppMode.biteSaver : AppMode.biteScore,
                  selectedMode,
                );
              }

              return GestureDetector(
                onHorizontalDragUpdate: (details) {
                  _handleModeDragUpdate(details, constraints);
                },
                onHorizontalDragEnd: (_) {
                  handleDragEnd();
                },
                child: Container(
                  width: double.infinity,
                  height: 51,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      begin: Alignment.centerLeft,
                      end: Alignment.centerRight,
                      colors: [
                        Color(0xFFD68A52),
                        Color(0xFFC66E59),
                        Color(0xFFB56678),
                        Color(0xFF7A689E),
                        Color(0xFF3364BB),
                      ],
                      stops: [0.0, 0.24, 0.50, 0.74, 1.0],
                    ),
                    borderRadius: BorderRadius.circular(26),
                    border: Border.all(
                      color: BiteSaverColors.border.withValues(alpha: 0.70),
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: accent.withValues(alpha: 0.10),
                        blurRadius: 8,
                        offset: const Offset(0, 2),
                      ),
                    ],
                  ),
                  child: Stack(
                    children: [
                      AnimatedPositioned(
                        duration: const Duration(milliseconds: 300),
                        curve: Curves.easeOutCubic,
                        left: left,
                        top: 1,
                        bottom: 1,
                        width: thumbWidth,
                        child: AnimatedScale(
                          scale: _pressedMode == selectedMode ? 0.978 : 1.0,
                          duration: const Duration(milliseconds: 100),
                          curve: Curves.easeOut,
                          child: AnimatedOpacity(
                            opacity: _pressedMode == selectedMode ? 0.98 : 1.0,
                            duration: const Duration(milliseconds: 100),
                            curve: Curves.easeOut,
                            child: ClipRRect(
                              clipBehavior: Clip.antiAlias,
                              borderRadius: const BorderRadius.all(
                                Radius.elliptical(20.5, 17.5),
                              ),
                              child: DecoratedBox(
                                decoration: BoxDecoration(
                                  gradient: selectedMode == AppMode.biteSaver
                                      ? const LinearGradient(
                                          begin: Alignment.topLeft,
                                          end: Alignment.bottomRight,
                                          colors: [
                                            Color(0xFFEDA364),
                                            Color(0xFFD36F3A),
                                            Color(0xFFB54D24),
                                          ],
                                        )
                                      : const LinearGradient(
                                          begin: Alignment.topLeft,
                                          end: Alignment.bottomRight,
                                          colors: [
                                            Color(0xFF936AB3),
                                            Color(0xFF5668BE),
                                            Color(0xFF285CC3),
                                          ],
                                        ),
                                  borderRadius: const BorderRadius.all(
                                    Radius.elliptical(20.5, 17.5),
                                  ),
                                  border: Border.all(
                                    color: const Color(
                                      0xFFFFFFFF,
                                    ).withValues(alpha: 0.62),
                                    width: 0.8,
                                  ),
                                ),
                                child: Center(
                                  child: Text(
                                    selectedMode == AppMode.biteSaver
                                        ? 'BiteSaver'
                                        : 'BiteScore',
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontWeight: FontWeight.w800,
                                      fontSize: 14,
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                      Row(
                        children: [
                          Expanded(
                            child: InkWell(
                              borderRadius: BorderRadius.circular(24),
                              onHighlightChanged: (pressed) {
                                _setPressedMode(
                                  pressed ? AppMode.biteSaver : null,
                                );
                              },
                              onTap: () {
                                _selectMode(AppMode.biteSaver, selectedMode);
                              },
                              child: AnimatedScale(
                                scale: _pressedMode == AppMode.biteSaver
                                    ? 0.985
                                    : 1.0,
                                duration: const Duration(milliseconds: 100),
                                curve: Curves.easeOut,
                                child: AnimatedOpacity(
                                  opacity: _pressedMode == AppMode.biteSaver
                                      ? 0.98
                                      : 1.0,
                                  duration: const Duration(milliseconds: 100),
                                  curve: Curves.easeOut,
                                  child: Padding(
                                    padding: const EdgeInsets.symmetric(
                                      vertical: 12,
                                    ),
                                    child: Center(
                                      child: Text(
                                        'BiteSaver',
                                        style: TextStyle(
                                          color:
                                              selectedMode == AppMode.biteSaver
                                              ? Colors.transparent
                                              : colorScheme.onSurfaceVariant
                                                    .withValues(alpha: 0.9),
                                          fontWeight: FontWeight.w700,
                                          fontSize: 14,
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                          Expanded(
                            child: InkWell(
                              borderRadius: BorderRadius.circular(24),
                              onHighlightChanged: (pressed) {
                                _setPressedMode(
                                  pressed ? AppMode.biteScore : null,
                                );
                              },
                              onTap: () {
                                _selectMode(AppMode.biteScore, selectedMode);
                              },
                              child: AnimatedScale(
                                scale: _pressedMode == AppMode.biteScore
                                    ? 0.985
                                    : 1.0,
                                duration: const Duration(milliseconds: 100),
                                curve: Curves.easeOut,
                                child: AnimatedOpacity(
                                  opacity: _pressedMode == AppMode.biteScore
                                      ? 0.98
                                      : 1.0,
                                  duration: const Duration(milliseconds: 100),
                                  curve: Curves.easeOut,
                                  child: Padding(
                                    padding: const EdgeInsets.symmetric(
                                      vertical: 12,
                                    ),
                                    child: Center(
                                      child: Text(
                                        'BiteScore',
                                        style: TextStyle(
                                          color:
                                              selectedMode == AppMode.biteScore
                                              ? Colors.transparent
                                              : colorScheme.onSurfaceVariant
                                                    .withValues(alpha: 0.9),
                                          fontWeight: FontWeight.w700,
                                          fontSize: 14,
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    if (!_isCustomerRestaurantAvailabilityResolved) {
      return Scaffold(
        backgroundColor: BiteSaverColors.pageBackground,
        appBar: AppBar(
          leading: IconButton(
            tooltip: MaterialLocalizations.of(context).backButtonTooltip,
            onPressed: () => Navigator.of(context).maybePop(),
            icon: const BackButtonIcon(),
          ),
          backgroundColor: BiteSaverColors.pageBackground,
          surfaceTintColor: BiteSaverColors.pageBackground,
          elevation: 0,
        ),
        body: const Center(child: CircularProgressIndicator()),
      );
    }
    if (!_isCustomerRestaurantAvailable) {
      return Scaffold(
        backgroundColor: BiteSaverColors.pageBackground,
        appBar: AppBar(
          leading: IconButton(
            tooltip: MaterialLocalizations.of(context).backButtonTooltip,
            onPressed: () => Navigator.of(context).maybePop(),
            icon: const BackButtonIcon(),
          ),
          backgroundColor: BiteSaverColors.pageBackground,
          surfaceTintColor: BiteSaverColors.pageBackground,
          elevation: 0,
        ),
        bottomNavigationBar: const PersistentBottomNavigation(
          mode: AppMode.biteSaver,
        ),
        body: const Center(
          child: Padding(
            padding: EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Icon(Icons.storefront_outlined, size: 56),
                SizedBox(height: 16),
                Text(
                  'This restaurant is not currently available in BiteSaver.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                ),
              ],
            ),
          ),
        ),
      );
    }
    return ListenableBuilder(
      listenable: widget.publicProfile != null
          ? Listenable.merge([
              widget.publicProfile,
              widget.boundedSavedCoordinator,
            ])
          : widget.boundedSession ??
                widget.boundedSavedCoordinator ??
                DemoRedemptionStore.changes,
      builder: (context, child) {
        final now = DateTime.now();
        final activeCoupons = widget.boundedRestaurant != null
            ? restaurant.coupons
            : restaurant.coupons
                  .where(
                    (coupon) =>
                        coupon.isActiveAt(now) &&
                        (!DemoRedemptionStore.legacyWritesEnabled ||
                            DemoRedemptionStore.isAvailable(
                              coupon.id,
                              coupon.usageRule,
                            )),
                  )
                  .toList();

        final couponOffers = _boundedOffers
            ?.where(
              (offer) => offer.offerType == CustomerBiteSaverOfferType.coupon,
            )
            .map((offer) => offer.offerId.value)
            .toSet();
        final coupons = couponOffers == null
            ? activeCoupons
            : activeCoupons
                  .where((coupon) => couponOffers.contains(coupon.id))
                  .toList(growable: false);
        final visibleCoupons = _showMoreCoupons ? coupons : coupons.take(1);
        final canExpand = coupons.length > 1 || _hasMoreProfileOffers;

        return Scaffold(
          backgroundColor: BiteSaverColors.pageBackground,
          appBar: AppBar(
            leadingWidth: 64,
            leading: IconButton(
              tooltip: MaterialLocalizations.of(context).backButtonTooltip,
              onPressed: () => Navigator.of(context).maybePop(),
              padding: const EdgeInsets.all(16),
              constraints: const BoxConstraints(minWidth: 56, minHeight: 56),
              icon: const BackButtonIcon(),
            ),
            backgroundColor: BiteSaverColors.pageBackground,
            surfaceTintColor: BiteSaverColors.pageBackground,
            elevation: 0,
          ),
          bottomNavigationBar: const PersistentBottomNavigation(
            mode: AppMode.biteSaver,
          ),
          body: Column(
            children: [
              _buildWarmModeSwitcher(),
              Expanded(
                child: ScrollConfiguration(
                  behavior: ScrollConfiguration.of(
                    context,
                  ).copyWith(overscroll: false),
                  child: SingleChildScrollView(
                    physics: const ClampingScrollPhysics(),
                    padding: EdgeInsets.fromLTRB(
                      16,
                      8,
                      16,
                      16 + MediaQuery.of(context).viewPadding.bottom,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.center,
                                children: [
                                  Text(
                                    _displayText(restaurant.name, 'Restaurant'),
                                    textAlign: TextAlign.center,
                                    style: const TextStyle(
                                      color: BiteSaverColors.ink,
                                      fontSize: 24,
                                      fontWeight: FontWeight.w800,
                                      height: 1.05,
                                    ),
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    _distanceLocationLine(restaurant),
                                    textAlign: TextAlign.center,
                                    style: const TextStyle(
                                      fontSize: 14,
                                      color: BiteSaverColors.secondaryText,
                                      fontWeight: FontWeight.w500,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(width: 8),
                            Builder(
                              builder: (context) {
                                final state = _boundedFavoriteState;
                                final favorite =
                                    state ==
                                    CustomerBiteSaverFavoriteState.favorite;
                                final known =
                                    state !=
                                    CustomerBiteSaverFavoriteState.unknown;
                                return IconButton(
                                  tooltip: known
                                      ? favorite
                                            ? 'Unsave restaurant'
                                            : 'Save restaurant'
                                      : 'Saved status unavailable',
                                  onPressed:
                                      _isSavingFavoriteRestaurant || !known
                                      ? null
                                      : _toggleRestaurantFavorite,
                                  icon: Icon(
                                    known
                                        ? favorite
                                              ? Icons.favorite
                                              : Icons.favorite_border
                                        : Icons.help_outline,
                                    color: favorite
                                        ? Colors.red.shade400
                                        : BiteSaverColors.orangeDark,
                                  ),
                                );
                              },
                            ),
                          ],
                        ),
                        const SizedBox(height: 14),
                        IntrinsicHeight(
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Expanded(
                                flex: 44,
                                child: _buildRestaurantProfileImage(),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                flex: 56,
                                child: _buildCompactProfileActions(),
                              ),
                            ],
                          ),
                        ),
                        IntrinsicHeight(
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Flexible(
                                child: TextButton(
                                  key: const ValueKey('profile-menu-main'),
                                  onPressed: () => _openMenu(context),
                                  style: TextButton.styleFrom(
                                    minimumSize: const Size(48, 48),
                                    padding: const EdgeInsets.symmetric(
                                      vertical: 8,
                                    ),
                                    alignment: Alignment.centerLeft,
                                  ),
                                  child: const Text(
                                    'Menu',
                                    style: TextStyle(
                                      color: Color(0xFF2563EB),
                                      decoration: TextDecoration.underline,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                ),
                              ),
                              Flexible(
                                child: TextButton.icon(
                                  onPressed: _isSubmittingReport
                                      ? null
                                      : _reportRestaurant,
                                  style: TextButton.styleFrom(
                                    foregroundColor: BiteSaverColors.mutedInk,
                                    minimumSize: const Size(48, 48),
                                    padding: const EdgeInsets.symmetric(
                                      vertical: 8,
                                    ),
                                    alignment: Alignment.centerRight,
                                  ),
                                  icon: const Icon(
                                    Icons.flag_outlined,
                                    size: 16,
                                  ),
                                  label: const Text('Report'),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 20),
                        if (_showRestaurantInfo) ...[
                          _biteSaverRaisedSurface(
                            child: Padding(
                              padding: const EdgeInsets.all(14),
                              child: _buildRestaurantInformationContent(),
                            ),
                          ),
                          const SizedBox(height: 18),
                        ],
                        const Text(
                          'Available Coupons',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                            color: BiteSaverColors.ink,
                          ),
                        ),
                        const SizedBox(height: 12),
                        if (coupons.isEmpty)
                          Text(
                            _hasMoreProfileOffers
                                ? 'View More for additional offers.'
                                : 'No available coupons right now.',
                          )
                        else
                          for (final coupon in visibleCoupons)
                            Padding(
                              padding: const EdgeInsets.only(bottom: 10),
                              child: BiteSaverProfileDealCard(
                                key: ValueKey('profile-coupon-${coupon.id}'),
                                title: _displayText(
                                  coupon.title,
                                  'Untitled coupon',
                                ),
                                imageUrl: coupon.imageUrl,
                                onTap: () => _openProfileCoupon(coupon),
                              ),
                            ),
                        if (canExpand)
                          MergeSemantics(
                            key: const ValueKey(
                              'profile-coupon-expansion-semantics',
                            ),
                            child: Semantics(
                              expanded: _showMoreCoupons,
                              child: TextButton.icon(
                                key: const ValueKey('profile-coupon-expansion'),
                                onPressed: _expandCoupons,
                                icon: Icon(
                                  _showMoreCoupons
                                      ? Icons.expand_less
                                      : Icons.expand_more,
                                ),
                                label: Text(
                                  _showMoreCoupons
                                      ? 'Show Fewer Coupons'
                                      : 'View More Coupons',
                                ),
                              ),
                            ),
                          ),
                        if (_showMoreCoupons && widget.boundedSession != null)
                          _buildBrowseOfferContinuation(),
                        if (_showMoreCoupons &&
                            widget.publicProfile?.cursor != null)
                          TextButton(
                            onPressed: widget.publicProfile!.loading
                                ? null
                                : widget.publicProfile!.loadMore,
                            child: Text(
                              widget.publicProfile!.loading
                                  ? 'Loading offers…'
                                  : 'More offers',
                            ),
                          ),
                        if (widget.publicProfile?.error != null)
                          const Text(
                            'Could not load more offers. Please try again.',
                          ),
                        const SizedBox(height: 18),
                        _buildSpecialsBoard(),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

Restaurant _customerBiteSaverRestaurantView(
  CustomerBiteSaverRestaurant restaurant, {
  List<CustomerBiteSaverOffer>? offers,
  bool hideDistance = false,
}) {
  final distance =
      restaurant.distanceMiles == restaurant.distanceMiles.roundToDouble()
      ? restaurant.distanceMiles.toStringAsFixed(0)
      : restaurant.distanceMiles.toStringAsFixed(1);
  return Restaurant(
    name: restaurant.displayName,
    distance: hideDistance ? '' : '$distance miles',
    city: restaurant.city,
    state: restaurant.state,
    zipCode: restaurant.zipCode,
    coupons: (offers ?? restaurant.offers)
        .map((offer) => _customerBiteSaverCouponView(restaurant, offer))
        .toList(growable: false),
    phone: restaurant.phone,
    streetAddress: restaurant.streetAddress,
    website: restaurant.website,
    bio: restaurant.bio,
    mainImageUrl: restaurant.imageUrl,
    businessHours: restaurant.businessHours
        .map(
          (hours) => RestaurantBusinessHours(
            day: hours.day,
            opensAt: hours.opensAt,
            closesAt: hours.closesAt,
            closed: hours.closed,
          ),
        )
        .toList(growable: false),
    formattedAddress: restaurant.formattedAddress,
  );
}

Coupon _customerBiteSaverCouponView(
  CustomerBiteSaverRestaurant restaurant,
  CustomerBiteSaverOffer offer,
) => Coupon(
  id: offer.offerId.value,
  restaurant: restaurant.displayName,
  title: offer.title,
  distance: '${restaurant.distanceMiles} miles',
  expires: offer.expiresText,
  usageRule: offer.redemptionPolicyLabel ?? offer.usageRule ?? '',
  couponCode: offer.couponCode,
  couponNumber: offer.couponNumber,
  isProximityOnly: offer.isProximityOnly,
  proximityRadiusMiles: offer.proximityRadiusMiles,
  details: offer.details,
  imageUrl: offer.imageUrl,
);

class _GroupedRestaurantHours {
  final String startDay;
  final String endDay;
  final String summaryLabel;
  final bool closed;

  const _GroupedRestaurantHours({
    required this.startDay,
    required this.endDay,
    required this.summaryLabel,
    required this.closed,
  });

  String get dayRangeLabel {
    final start = _shortDayName(startDay);
    final end = _shortDayName(endDay);
    if (start == end) {
      return start;
    }
    return '$start–$end';
  }

  bool matches(RestaurantBusinessHours entry) {
    return closed == entry.closed && summaryLabel == entry.summaryLabel;
  }

  _GroupedRestaurantHours copyWith({required String endDay}) {
    return _GroupedRestaurantHours(
      startDay: startDay,
      endDay: endDay,
      summaryLabel: summaryLabel,
      closed: closed,
    );
  }

  static String _shortDayName(String day) {
    return switch (day) {
      'Monday' => 'Mon',
      'Tuesday' => 'Tue',
      'Wednesday' => 'Wed',
      'Thursday' => 'Thu',
      'Friday' => 'Fri',
      'Saturday' => 'Sat',
      'Sunday' => 'Sun',
      _ => day,
    };
  }
}
