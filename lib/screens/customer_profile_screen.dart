import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../models/bitescore_restaurant.dart';
import '../models/coupon.dart';
import '../models/customer_bitesaver_saved.dart';
import '../models/dish_rating_aggregate.dart';
import '../models/local_expert_badge.dart';
import '../models/restaurant.dart';
import '../services/app_error_text.dart';
import '../services/bitescore_service.dart';
import '../services/customer_bitescore_profile_service.dart';
import '../services/customer_bitescore_reads.dart';
import '../services/customer_bitescore_runtime.dart';
import '../services/customer_bitescore_search_service.dart';
import '../widgets/customer_bitescore_page_status.dart';
import '../services/customer_bitesaver_saved_coordinator.dart';
import '../services/local_expert_badge_recalculation_service.dart';
import '../services/local_expert_badge_service.dart';
import '../widgets/contribution_points_card.dart';
import '../widgets/local_expert_badge_widget.dart';
import '../widgets/reviewer_activity_pill.dart';
import 'bitescore_dish_detail_screen.dart';
import 'bitescore_restaurant_dishes_screen.dart';
import 'coupon_detail_screen.dart';
import 'customer_bitesaver_saved_destinations.dart';
import 'main_navigation_screen.dart';
import 'restaurant_profile_screen.dart';

enum _SavedSection { restaurants, dishes, coupons }

typedef CustomerProfileDataLoader =
    Future<BiteScoreUserProfileData> Function(User user);
typedef CustomerProfileBadgeLoader =
    Future<List<LocalExpertBadge>> Function(String userId);
typedef CustomerProfileUsernameSaver = Future<void> Function(String username);

class CustomerProfileScreen extends StatefulWidget {
  final User currentUser;
  final User? Function()? testCurrentUserProvider;
  final CustomerProfileDataLoader? testProfileLoader;
  final CustomerProfileBadgeLoader? testLocalExpertBadgesLoader;
  final CustomerProfileUsernameSaver? testUsernameSaver;
  final CustomerBiteSaverSavedCoordinator? boundedSavedCoordinator;
  final CustomerBiteScoreProfileService? boundedProfileService;
  final Future<void> Function()? testPrepareProfileIdentity;
  final Future<BiteScoreUserProfileData> Function()? testLegacyBiteSaverLoader;

  const CustomerProfileScreen({
    super.key,
    required this.currentUser,
    @visibleForTesting this.testCurrentUserProvider,
    @visibleForTesting this.testProfileLoader,
    @visibleForTesting this.testLocalExpertBadgesLoader,
    @visibleForTesting this.testUsernameSaver,
    this.boundedProfileService,
    @visibleForTesting this.testPrepareProfileIdentity,
    @visibleForTesting this.testLegacyBiteSaverLoader,
  }) : boundedSavedCoordinator = null;

  const CustomerProfileScreen.fromCustomerBiteSaver({
    super.key,
    required this.currentUser,
    required CustomerBiteSaverSavedCoordinator savedCoordinator,
    @visibleForTesting this.testCurrentUserProvider,
    @visibleForTesting this.testProfileLoader,
    @visibleForTesting this.testLocalExpertBadgesLoader,
    @visibleForTesting this.testUsernameSaver,
    this.boundedProfileService,
    @visibleForTesting this.testPrepareProfileIdentity,
    @visibleForTesting this.testLegacyBiteSaverLoader,
  }) : boundedSavedCoordinator = savedCoordinator;

  @override
  State<CustomerProfileScreen> createState() => _CustomerProfileScreenState();
}

class _CustomerProfileScreenState extends State<CustomerProfileScreen> {
  late Future<BiteScoreUserProfileData> _profileFuture;
  late final CustomerBiteScoreProfileService _boundedProfiles =
      widget.boundedProfileService ?? CustomerBiteScoreProfileService();
  CustomerBiteScoreSearchController? _savedRestaurants;
  CustomerBiteScoreSearchController? _savedDishes;
  CustomerBiteScoreSearchController? _reviews;
  bool get _bounded =>
      CustomerBiteScoreRuntime.isEnabled && widget.testProfileLoader == null;

  void _refreshBoundedLists() {
    _savedRestaurants?.dispose();
    _savedDishes?.dispose();
    _reviews?.dispose();
    _savedRestaurants = _boundedProfiles.list(
      kind: 'savedRestaurants',
      userId: widget.currentUser.uid,
    )..addListener(_handleSavedChanged);
    _savedDishes = _boundedProfiles.list(
      kind: 'savedDishes',
      userId: widget.currentUser.uid,
    )..addListener(_handleSavedChanged);
    _reviews = _boundedProfiles.list(
      kind: 'reviews',
      userId: widget.currentUser.uid,
    )..addListener(_handleSavedChanged);
    unawaited(_savedRestaurants!.loadInitial());
    unawaited(_reviews!.loadInitial());
    if (_savedSection == _SavedSection.dishes) {
      unawaited(_savedDishes!.loadInitial());
    }
  }

  Future<BiteScoreUserProfileData> _loadBoundedProfile() async {
    await (widget.testPrepareProfileIdentity?.call() ??
        BiteScoreService.prepareCurrentUserPublicProfileIdentity());
    final summary = await _boundedProfiles.summary(widget.currentUser.uid);
    final saver = widget.boundedSavedCoordinator == null
        ? await (widget.testLegacyBiteSaverLoader?.call() ??
              BiteScoreService.loadLegacyBiteSaverProfileData())
        : null;
    return CustomerBiteScoreProfileService.ownProfile(
      summary,
      biteSaver: saver,
    );
  }

  late Future<List<LocalExpertBadge>> _localExpertBadgesFuture;
  final LocalExpertBadgeProfileRefreshBridge _localExpertBadgeRefreshBridge =
      LocalExpertBadgeProfileRefreshBridge();
  final TextEditingController _usernameController = TextEditingController();
  bool _hasSeededUsernameField = false;
  bool _isCheckingUsername = false;
  bool _isSavingUsername = false;
  bool _isEditingUsername = false;
  String? _usernameStatusMessage;
  bool? _isUsernameAvailable;
  _SavedSection _savedSection = _SavedSection.restaurants;
  MainNavigationAuthRouteBinding? _authBoundRouteBinding;
  NavigatorState? _authBoundNavigator;
  ModalRoute<dynamic>? _authBoundRoute;
  BuildContext? _privateOverlayContext;

  @override
  void initState() {
    super.initState();
    widget.boundedSavedCoordinator?.addListener(_handleSavedChanged);
    _refresh();
  }

  void _handleSavedChanged() {
    if (mounted) setState(() {});
  }

  void _refresh() {
    if (_bounded) _refreshBoundedLists();
    _profileFuture = _bounded
        ? _loadBoundedProfile()
        : widget.testProfileLoader?.call(widget.currentUser) ??
              BiteScoreService.loadCurrentUserProfileData(
                includeLegacyBiteSaverSaved:
                    widget.boundedSavedCoordinator == null,
              );
    final savedCoordinator = widget.boundedSavedCoordinator;
    if (savedCoordinator != null) {
      unawaited(savedCoordinator.refreshAll().catchError((_) {}));
    }
    final testBadgeLoader = widget.testLocalExpertBadgesLoader;
    _localExpertBadgesFuture = testBadgeLoader != null
        ? testBadgeLoader(widget.currentUser.uid)
        : _localExpertBadgeRefreshBridge.loadBadgesAfterSessionRecalculation(
            userId: widget.currentUser.uid,
            recalculate: LocalExpertBadgeRecalculationService
                .recalculateMyLocalExpertBadges,
            loadBadges: _bounded
                ? (userId) => userId == null
                      ? Future.value(<LocalExpertBadge>[])
                      : _boundedProfiles.badges(userId)
                : LocalExpertBadgeService.loadBadgesForUser,
            onRecalculationError: (error, stackTrace) {
              debugPrint('Local Expert badge recalculation failed: $error');
            },
          );
  }

  User? get _currentUser {
    final testProvider = widget.testCurrentUserProvider;
    if (testProvider != null) {
      return testProvider();
    }
    try {
      return FirebaseAuth.instance.currentUser;
    } catch (_) {
      return null;
    }
  }

  bool _isOpeningUserCurrent([MainNavigationAuthLease? lease]) {
    final currentUser = _currentUser;
    return (lease == null || lease.isCurrent) &&
        currentUser != null &&
        !currentUser.isAnonymous &&
        currentUser.uid == widget.currentUser.uid;
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final navigator = Navigator.maybeOf(context, rootNavigator: true);
    final route = ModalRoute.of(context);
    if (navigator == null || route == null) {
      return;
    }
    if (identical(navigator, _authBoundNavigator) &&
        identical(route, _authBoundRoute)) {
      return;
    }
    _unbindAuthBoundRoute();
    _authBoundNavigator = navigator;
    _authBoundRoute = route;
    _authBoundRouteBinding = mainNavigationController.bindAuthBoundRoute(
      navigator: navigator,
      route: route,
      originatingAuthRealm: mainNavigationAuthRealmForUser(widget.currentUser),
    );
  }

  String _displayText(String value, String fallback) {
    final trimmed = value.trim();
    return trimmed.isEmpty ? fallback : trimmed;
  }

  String _locationLabel(String city, String zipCode) {
    final parts = <String>[
      if (city.trim().isNotEmpty) city.trim(),
      if (zipCode.trim().isNotEmpty) zipCode.trim(),
    ];
    return parts.isEmpty ? 'Location unavailable' : parts.join(', ');
  }

  @override
  void dispose() {
    _unbindAuthBoundRoute();
    widget.boundedSavedCoordinator?.removeListener(_handleSavedChanged);
    _savedRestaurants?.dispose();
    _savedDishes?.dispose();
    _reviews?.dispose();
    _usernameController.dispose();
    super.dispose();
  }

  void _unbindAuthBoundRoute() {
    final binding = _authBoundRouteBinding;
    if (binding != null) {
      mainNavigationController.unbindAuthBoundRoute(binding);
    }
    _authBoundRouteBinding = null;
    _authBoundNavigator = null;
    _authBoundRoute = null;
    _privateOverlayContext = null;
  }

  void _showSnackBar(String message) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(content: Text(message), duration: const Duration(seconds: 3)),
      );
  }

  Future<void> _checkUsernameAvailability() async {
    if (_isCheckingUsername || _isSavingUsername) {
      return;
    }

    setState(() {
      _isCheckingUsername = true;
      _usernameStatusMessage = null;
      _isUsernameAvailable = null;
    });

    try {
      final available = await BiteScoreService.isPublicUsernameAvailable(
        _usernameController.text,
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _isUsernameAvailable = available;
        _usernameStatusMessage = available
            ? 'That username is available.'
            : 'That username is already taken.';
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _isUsernameAvailable = false;
        _usernameStatusMessage = AppErrorText.friendly(
          error,
          fallback: 'Could not check that username right now.',
        );
      });
    } finally {
      if (mounted) {
        setState(() {
          _isCheckingUsername = false;
        });
      }
    }
  }

  Future<void> _saveUsername() async {
    if (_isCheckingUsername || _isSavingUsername) {
      return;
    }

    final authLease = _authBoundRouteBinding?.captureLease();
    if (!_isOpeningUserCurrent(authLease)) {
      return;
    }

    setState(() {
      _isSavingUsername = true;
      _usernameStatusMessage = null;
      _isUsernameAvailable = null;
    });

    try {
      final username = _usernameController.text;
      final testSaver = widget.testUsernameSaver;
      if (testSaver != null) {
        await testSaver(username);
      } else {
        await BiteScoreService.saveCurrentUserPublicUsername(username);
      }
      if (!mounted || !_isOpeningUserCurrent(authLease)) {
        return;
      }
      _showSnackBar('Your username was updated.');
      setState(() {
        _hasSeededUsernameField = false;
        _isEditingUsername = false;
        _usernameStatusMessage = 'Saved successfully.';
        _isUsernameAvailable = true;
        _refresh();
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _isUsernameAvailable = false;
        _usernameStatusMessage = AppErrorText.friendly(
          error,
          fallback: 'Could not save that username right now.',
        );
      });
    } finally {
      if (mounted) {
        setState(() {
          _isSavingUsername = false;
        });
      }
    }
  }

  Future<void> _openRestaurant(BitescoreRestaurant restaurant) async {
    try {
      final entries = _bounded
          ? <BiteScoreHomeEntry>[]
          : await BiteScoreService.loadEntriesForRestaurant(restaurant);
      if (!mounted) {
        return;
      }

      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => BiteScoreRestaurantDishesScreen(
            restaurant: restaurant,
            entries: entries,
          ),
        ),
      );

      if (mounted) {
        setState(_refresh);
      }
    } catch (error) {
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not open that restaurant right now.',
        ),
      );
    }
  }

  Future<void> _openDish(BiteScoreHomeEntry entry) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => BiteScoreDishDetailScreen(entry: entry),
      ),
    );

    if (mounted) {
      setState(_refresh);
    }
  }

  bool _canEditReview(BiteScoreUserReviewEntry entry) {
    final user = _currentUser;
    return user != null &&
        !user.isAnonymous &&
        entry.review.userId.trim() == user.uid;
  }

  Future<void> _openDishReview(
    BiteScoreUserReviewEntry entry, {
    bool editReview = false,
  }) async {
    final dish = entry.dish;
    final restaurant = entry.restaurant;
    if (dish == null || restaurant == null) {
      _showSnackBar('This dish is no longer available.');
      return;
    }

    try {
      final aggregate =
          (_bounded
              ? (await CustomerBiteScoreReads().detail(
                  'dish',
                  dish.id,
                )).entry?.aggregate
              : await BiteScoreService.loadDishRatingAggregate(dish.id)) ??
          DishRatingAggregate(dishId: dish.id, restaurantId: restaurant.id);
      if (!mounted) {
        return;
      }

      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => BiteScoreDishDetailScreen(
            entry: BiteScoreHomeEntry(
              dish: dish,
              restaurant: restaurant,
              aggregate: aggregate,
            ),
            targetReviewId: editReview ? null : entry.review.id,
            scrollToReviewSection: editReview,
            editReviewId: editReview ? entry.review.id : null,
          ),
        ),
      );

      if (mounted) {
        setState(_refresh);
      }
    } catch (error) {
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not open that dish right now.',
        ),
      );
    }
  }

  Future<void> _openSaverRestaurant(Restaurant restaurant) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => RestaurantProfileScreen(restaurant: restaurant),
      ),
    );

    if (mounted) {
      setState(_refresh);
    }
  }

  Future<void> _openSavedBiteSaverEntry(
    CustomerBiteSaverSavedEntry entry,
  ) async {
    final coordinator = widget.boundedSavedCoordinator;
    if (coordinator == null || !entry.isAvailable) {
      _showSnackBar('This saved item is no longer available.');
      return;
    }
    try {
      await const CustomerBiteSaverSavedDestinationHandler().call(
        context,
        coordinator: coordinator,
        entry: entry,
      );
    } catch (error) {
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not open that saved item right now.',
        ),
      );
    }
  }

  Future<void> _openCoupon(Coupon coupon) async {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => CouponDetailScreen(coupon: coupon)),
    );

    if (mounted) {
      setState(_refresh);
    }
  }

  Future<void> _removeSavedRestaurant(BitescoreRestaurant restaurant) async {
    try {
      await BiteScoreService.setRestaurantFavorite(
        restaurant: restaurant,
        isFavorite: false,
      );
      if (!mounted) {
        return;
      }
      _showSnackBar('Removed restaurant from Saved.');
      setState(_refresh);
    } catch (error) {
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not update your saved restaurants right now.',
        ),
      );
    }
  }

  Future<void> _removeSavedSaverRestaurant(
    SavedBiteSaverRestaurantEntry entry,
  ) async {
    try {
      await BiteScoreService.setSaverRestaurantFavorite(
        restaurant: entry.restaurant,
        isFavorite: false,
        favoriteDocumentIds: entry.favoriteDocumentIds,
      );
      if (!mounted) {
        return;
      }
      _showSnackBar('Removed restaurant from Saved.');
      setState(_refresh);
    } catch (error) {
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not update your saved restaurants right now.',
        ),
      );
    }
  }

  Future<void> _removeSavedBiteSaverEntry(
    CustomerBiteSaverSavedEntry entry,
  ) async {
    final coordinator = widget.boundedSavedCoordinator;
    if (coordinator == null) return;
    try {
      switch (entry.favoriteKind) {
        case 'bitesaverRestaurant':
          await coordinator.removeRestaurantFavorite(entry.restaurantId!);
        case 'bitesaverCoupon':
          await coordinator.removeCouponFavorite(entry.offerId!);
        default:
          throw StateError('Unknown BiteSaver favorite kind.');
      }
      if (!mounted) return;
      _showSnackBar(
        entry.offerId == null
            ? 'Removed restaurant from Saved.'
            : 'Removed coupon from Saved.',
      );
    } catch (error) {
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not update Saved right now.',
        ),
      );
    }
  }

  Future<void> _removeSavedDish(BiteScoreHomeEntry entry) async {
    try {
      await BiteScoreService.setDishFavorite(
        dish: entry.dish,
        restaurant: entry.restaurant,
        isFavorite: false,
      );
      if (!mounted) {
        return;
      }
      _showSnackBar('Removed dish from Saved.');
      setState(_refresh);
    } catch (error) {
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not update your saved dishes right now.',
        ),
      );
    }
  }

  Future<void> _removeSavedCoupon(Coupon coupon) async {
    try {
      await BiteScoreService.setCouponFavorite(
        coupon: coupon,
        isFavorite: false,
      );
      if (!mounted) {
        return;
      }
      _showSnackBar('Removed coupon from Saved.');
      setState(_refresh);
    } catch (error) {
      _showSnackBar(
        AppErrorText.friendly(
          error,
          fallback: 'Could not update your saved coupons right now.',
        ),
      );
    }
  }

  String _scoreLabel(double value) {
    if (value <= 0) {
      return '--';
    }
    return value.toStringAsFixed(0);
  }

  String _dateLabel(DateTime? value) {
    if (value == null) {
      return 'Recent';
    }

    final local = value.toLocal();
    final months = <String>[
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return '${months[local.month - 1]} ${local.day}, ${local.year}';
  }

  Widget _buildSectionHeader(String title, IconData icon) {
    return Row(
      children: [
        Icon(icon, size: 20, color: Theme.of(context).colorScheme.primary),
        const SizedBox(width: 8),
        Text(
          title,
          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
        ),
      ],
    );
  }

  Widget _buildEmptyCard(String message) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Text(message, style: const TextStyle(color: Colors.black54)),
      ),
    );
  }

  Widget _buildSavedSectionTabs() {
    return SegmentedButton<_SavedSection>(
      segments: const [
        ButtonSegment<_SavedSection>(
          value: _SavedSection.restaurants,
          label: Text('Restaurants'),
          icon: Icon(Icons.storefront_outlined),
        ),
        ButtonSegment<_SavedSection>(
          value: _SavedSection.dishes,
          label: Text('Dishes'),
          icon: Icon(Icons.restaurant_menu_outlined),
        ),
        ButtonSegment<_SavedSection>(
          value: _SavedSection.coupons,
          label: Text('Coupons'),
          icon: Icon(Icons.local_offer_outlined),
        ),
      ],
      selected: <_SavedSection>{_savedSection},
      showSelectedIcon: false,
      style: SegmentedButton.styleFrom(
        visualDensity: VisualDensity.compact,
        textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
      ),
      onSelectionChanged: (selection) {
        setState(() {
          _savedSection = selection.first;
          if (_bounded &&
              _savedSection == _SavedSection.dishes &&
              _savedDishes!.items.isEmpty &&
              !_savedDishes!.isLoading) {
            unawaited(_savedDishes!.loadInitial());
          }
        });
      },
    );
  }

  Widget _buildSavedRestaurantCard(BitescoreRestaurant restaurant) {
    return Card(
      margin: const EdgeInsets.only(top: 12),
      child: ListTile(
        dense: true,
        contentPadding: const EdgeInsets.fromLTRB(14, 6, 6, 6),
        leading: Icon(Icons.favorite, color: Colors.red.shade400, size: 22),
        title: Text(
          _displayText(restaurant.name, 'Restaurant'),
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        subtitle: Text(
          '${restaurant.city}, ${restaurant.state} ${restaurant.zipCode}'
              .trim(),
        ),
        trailing: Wrap(
          children: [
            IconButton(
              tooltip: 'Remove from Saved',
              onPressed: () => _removeSavedRestaurant(restaurant),
              icon: Icon(Icons.favorite, color: Colors.red.shade400, size: 20),
            ),
            const Icon(Icons.chevron_right),
          ],
        ),
        onTap: () => _openRestaurant(restaurant),
      ),
    );
  }

  Widget _buildSavedSaverRestaurantCard(SavedBiteSaverRestaurantEntry entry) {
    final restaurant = entry.restaurant;
    return Card(
      margin: const EdgeInsets.only(top: 12),
      child: ListTile(
        dense: true,
        contentPadding: const EdgeInsets.fromLTRB(14, 6, 6, 6),
        leading: Icon(Icons.favorite, color: Colors.red.shade400, size: 22),
        title: Text(
          _displayText(restaurant.name, 'Restaurant'),
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        subtitle: Text(_locationLabel(restaurant.city, restaurant.zipCode)),
        trailing: Wrap(
          children: [
            IconButton(
              tooltip: 'Remove from Saved',
              onPressed: () => _removeSavedSaverRestaurant(entry),
              icon: Icon(Icons.favorite, color: Colors.red.shade400, size: 20),
            ),
            const Icon(Icons.chevron_right),
          ],
        ),
        onTap: () => _openSaverRestaurant(restaurant),
      ),
    );
  }

  Widget _buildSavedBiteSaverCard(CustomerBiteSaverSavedEntry entry) {
    final restaurant = entry.restaurant;
    final offer = entry.offer;
    final unavailable = !entry.isAvailable;
    final activeUse =
        offer != null &&
        (widget.boundedSavedCoordinator?.hasDisplayableRedemptionPresentation(
              offer.offerId,
            ) ??
            false);
    final title =
        offer?.title ??
        restaurant?.displayName ??
        (entry.offerId == null
            ? 'Saved restaurant unavailable'
            : 'Saved coupon unavailable');
    final subtitle = unavailable
        ? 'This item is no longer publicly available. You can remove it.'
        : activeUse
        ? '${restaurant!.displayName} · Coupon timer active'
        : offer == null
        ? _locationLabel(restaurant!.city, restaurant.zipCode)
        : '${restaurant!.displayName} · Saved coupon';
    final pending =
        widget.boundedSavedCoordinator?.isPending(entry.favoriteId) ?? false;
    return Card(
      margin: const EdgeInsets.only(top: 12),
      child: ListTile(
        dense: true,
        contentPadding: const EdgeInsets.fromLTRB(14, 6, 6, 6),
        leading: Icon(
          unavailable ? Icons.bookmark_outline : Icons.favorite,
          color: unavailable ? Colors.black45 : Colors.red.shade400,
          size: 22,
        ),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
        subtitle: Text(subtitle),
        trailing: Wrap(
          children: [
            IconButton(
              tooltip: 'Remove from Saved',
              onPressed: pending
                  ? null
                  : () => _removeSavedBiteSaverEntry(entry),
              icon: pending
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Icon(Icons.favorite, color: Colors.red.shade400, size: 20),
            ),
            if (!unavailable) const Icon(Icons.chevron_right),
          ],
        ),
        onTap: unavailable ? null : () => _openSavedBiteSaverEntry(entry),
      ),
    );
  }

  List<Widget> _boundedSavedStatusCards(CustomerBiteSaverSavedSection section) {
    final coordinator = widget.boundedSavedCoordinator;
    if (coordinator == null) return const <Widget>[];
    final widgets = <Widget>[];
    final error = coordinator.errorFor(section);
    if (error != null) {
      widgets.add(
        Card(
          margin: const EdgeInsets.only(top: 12),
          child: ListTile(
            title: const Text('Could not refresh these Saved items.'),
            subtitle: const Text('Your existing items were kept. Try again.'),
            trailing: TextButton(
              onPressed: coordinator.isLoading(section)
                  ? null
                  : () => coordinator.refresh(section).catchError((_) {}),
              child: const Text('Try Again'),
            ),
          ),
        ),
      );
    }
    if (coordinator.isLoading(section) && !coordinator.isLoaded(section)) {
      widgets.add(
        const Padding(
          padding: EdgeInsets.only(top: 16),
          child: Center(child: CircularProgressIndicator()),
        ),
      );
    } else if (coordinator.hasMore(section)) {
      widgets.add(
        Padding(
          padding: const EdgeInsets.only(top: 12),
          child: Center(
            child: OutlinedButton(
              onPressed: coordinator.isLoading(section)
                  ? null
                  : () => coordinator.loadMore(section).catchError((_) {}),
              child: coordinator.isLoading(section)
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Load more'),
            ),
          ),
        ),
      );
    }
    return widgets;
  }

  Widget _buildSavedDishCard(BiteScoreHomeEntry entry) {
    final ratingCount = entry.aggregate.ratingCount;
    final scoreLabel = _scoreLabel(entry.aggregate.overallBiteScore);

    return Card(
      margin: const EdgeInsets.only(top: 12),
      child: ListTile(
        dense: true,
        contentPadding: const EdgeInsets.fromLTRB(14, 8, 6, 8),
        leading: Icon(Icons.favorite, color: Colors.red.shade400, size: 22),
        title: Text(
          _displayText(entry.dish.name, 'Unnamed dish'),
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        subtitle: Text(_displayText(entry.restaurant.name, 'Restaurant')),
        trailing: Wrap(
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Padding(
              padding: const EdgeInsets.only(right: 4),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    scoreLabel,
                    style: TextStyle(
                      color: Colors.red.shade700,
                      fontSize: 18,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  Text(
                    '$ratingCount ratings',
                    style: const TextStyle(fontSize: 11, color: Colors.black54),
                  ),
                ],
              ),
            ),
            IconButton(
              tooltip: 'Remove from Saved',
              onPressed: () => _removeSavedDish(entry),
              icon: Icon(Icons.favorite, color: Colors.red.shade400, size: 20),
            ),
            const Icon(Icons.chevron_right),
          ],
        ),
        onTap: () => _openDish(entry),
      ),
    );
  }

  Widget _buildSavedCouponTile(Coupon coupon) {
    return Card(
      margin: const EdgeInsets.only(top: 12),
      child: ListTile(
        dense: true,
        contentPadding: const EdgeInsets.fromLTRB(14, 6, 6, 6),
        leading: Icon(Icons.favorite, color: Colors.red.shade400, size: 22),
        title: Text(
          _displayText(coupon.title, 'Untitled coupon'),
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        subtitle: Text(
          "${_displayText(coupon.restaurant, 'Restaurant')} - ${coupon.expires}",
        ),
        trailing: Wrap(
          children: [
            IconButton(
              tooltip: 'Remove from Saved',
              onPressed: () => _removeSavedCoupon(coupon),
              icon: Icon(Icons.favorite, color: Colors.red.shade400, size: 20),
            ),
            const Icon(Icons.chevron_right),
          ],
        ),
        onTap: () => _openCoupon(coupon),
      ),
    );
  }

  List<Widget> _buildSavedSectionCards(BiteScoreUserProfileData profileData) {
    final boundedSaved = widget.boundedSavedCoordinator;
    switch (_savedSection) {
      case _SavedSection.restaurants:
        final boundedEntries =
            boundedSaved?.entries(CustomerBiteSaverSavedSection.restaurants) ??
            const <CustomerBiteSaverSavedEntry>[];
        if (profileData.favoriteRestaurants.isEmpty &&
            profileData.favoriteSaverRestaurants.isEmpty &&
            boundedEntries.isEmpty &&
            (boundedSaved == null ||
                (boundedSaved.isLoaded(
                      CustomerBiteSaverSavedSection.restaurants,
                    ) &&
                    boundedSaved.errorFor(
                          CustomerBiteSaverSavedSection.restaurants,
                        ) ==
                        null))) {
          return <Widget>[
            _buildEmptyCard(
              'No saved restaurants yet. Tap a heart on a restaurant page to save one.',
            ),
            ..._boundedSavedStatusCards(
              CustomerBiteSaverSavedSection.restaurants,
            ),
          ];
        }
        return <Widget>[
          ...boundedEntries.map(_buildSavedBiteSaverCard),
          if (boundedSaved == null)
            ...profileData.favoriteSaverRestaurants.map(
              _buildSavedSaverRestaurantCard,
            ),
          ...profileData.favoriteRestaurants.map(_buildSavedRestaurantCard),
          ..._boundedSavedStatusCards(
            CustomerBiteSaverSavedSection.restaurants,
          ),
        ];
      case _SavedSection.dishes:
        if (profileData.favoriteDishEntries.isEmpty) {
          return <Widget>[
            _buildEmptyCard(
              'No saved dishes yet. Tap a heart on a dish page to save one.',
            ),
          ];
        }
        return profileData.favoriteDishEntries
            .map(_buildSavedDishCard)
            .toList();
      case _SavedSection.coupons:
        final boundedEntries =
            boundedSaved?.entries(CustomerBiteSaverSavedSection.coupons) ??
            const <CustomerBiteSaverSavedEntry>[];
        if (profileData.favoriteCoupons.isEmpty &&
            boundedEntries.isEmpty &&
            (boundedSaved == null ||
                (boundedSaved.isLoaded(CustomerBiteSaverSavedSection.coupons) &&
                    boundedSaved.errorFor(
                          CustomerBiteSaverSavedSection.coupons,
                        ) ==
                        null))) {
          return <Widget>[
            _buildEmptyCard(
              'No saved coupons yet. Tap a heart on a coupon page to save one.',
            ),
            ..._boundedSavedStatusCards(CustomerBiteSaverSavedSection.coupons),
          ];
        }
        return <Widget>[
          ...boundedEntries.map(_buildSavedBiteSaverCard),
          if (boundedSaved == null)
            ...profileData.favoriteCoupons.map(_buildSavedCouponTile),
          ..._boundedSavedStatusCards(CustomerBiteSaverSavedSection.coupons),
        ];
    }
  }

  Widget _buildReviewCard(BiteScoreUserReviewEntry entry) {
    final headline = entry.review.headline?.trim();
    final notes = entry.review.notes?.trim();
    final category = entry.categoryDisplayName;
    final canEditReview = _canEditReview(entry);

    return Card(
      margin: const EdgeInsets.only(top: 12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => _openDishReview(entry),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Text(
                      entry.dishName,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Text(
                    _scoreLabel(entry.review.overallBiteScore),
                    style: TextStyle(
                      color: Colors.red.shade700,
                      fontSize: 18,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                entry.restaurantName,
                style: const TextStyle(
                  color: Colors.black54,
                  fontWeight: FontWeight.w600,
                ),
              ),
              if (category != null) ...[
                const SizedBox(height: 4),
                Text(
                  category,
                  style: const TextStyle(
                    color: Colors.black54,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
              const SizedBox(height: 8),
              if (headline != null && headline.isNotEmpty)
                Text(
                  headline,
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
              if (headline != null &&
                  headline.isNotEmpty &&
                  notes != null &&
                  notes.isNotEmpty)
                const SizedBox(height: 4),
              if (notes != null && notes.isNotEmpty) Text(notes),
              const SizedBox(height: 10),
              Text(
                _dateLabel(entry.review.createdAt),
                style: const TextStyle(fontSize: 12, color: Colors.black54),
              ),
              if (canEditReview) ...[
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerLeft,
                  child: OutlinedButton.icon(
                    onPressed: () => _openDishReview(entry, editReview: true),
                    icon: const Icon(Icons.edit_outlined, size: 15),
                    label: const Text('Edit review'),
                    style: OutlinedButton.styleFrom(
                      visualDensity: const VisualDensity(
                        horizontal: -2,
                        vertical: -2,
                      ),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 6,
                      ),
                      minimumSize: Size.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildLocalExpertBadgesSection(BiteScoreUserProfileData profileData) {
    return FutureBuilder<List<LocalExpertBadge>>(
      future: _localExpertBadgesFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Padding(
            padding: EdgeInsets.only(top: 16),
            child: Align(
              alignment: Alignment.centerLeft,
              child: SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
          );
        }

        final badges = snapshot.hasError
            ? const <LocalExpertBadge>[]
            : snapshot.data ?? const <LocalExpertBadge>[];

        return Card(
          margin: const EdgeInsets.only(top: 16),
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Local Expert Badges',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900),
                ),
                if (badges.isEmpty) ...[
                  const SizedBox(height: 8),
                  const Text(
                    'Write qualifying reviews at different restaurants to earn Local Expert badges.',
                    style: TextStyle(
                      color: Colors.black54,
                      fontSize: 13,
                      height: 1.35,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ] else ...[
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 10,
                    runSpacing: 10,
                    children: [
                      for (final badge in badges)
                        InkWell(
                          borderRadius: BorderRadius.circular(18),
                          onTap: () => showLocalExpertBadgeDetails(
                            _privateOverlayContext ?? context,
                            badge,
                            reviewerUserId: widget.currentUser.uid,
                            reviewerDisplayName: profileData.publicDisplayName,
                          ),
                          child: LocalExpertBadgeWidget(badge: badge),
                        ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildProfileBody(BiteScoreUserProfileData profileData) {
    if (!_hasSeededUsernameField) {
      _usernameController.text = profileData.chosenUsername ?? '';
      _hasSeededUsernameField = true;
    }

    if (_bounded) return _buildBoundedProfileBody(profileData);
    return RefreshIndicator(
      onRefresh: () async {
        setState(_refresh);
        await _profileFuture;
      },
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _buildPublicUsernameCard(profileData),
          const SizedBox(height: 16),
          _buildBadgeCard(profileData),
          const SizedBox(height: 16),
          ContributionPointsCard(points: profileData.contributionPoints),
          _buildLocalExpertBadgesSection(profileData),
          const SizedBox(height: 24),
          _buildSectionHeader('Saved', Icons.favorite_border),
          const SizedBox(height: 12),
          _buildSavedSectionTabs(),
          ..._buildSavedSectionCards(profileData),
          const SizedBox(height: 28),
          _buildSectionHeader('Your Reviews', Icons.rate_review_outlined),
          if (profileData.reviews.isEmpty)
            _buildEmptyCard('You have not posted a BiteScore review yet.')
          else
            ...profileData.reviews.map(_buildReviewCard),
        ],
      ),
    );
  }

  Widget _buildBoundedProfileBody(BiteScoreUserProfileData profile) {
    final rows = <Widget Function()>[
      () => _buildPublicUsernameCard(profile),
      () => const SizedBox(height: 16),
      () => _buildBadgeCard(profile),
      () => const SizedBox(height: 16),
      () => ContributionPointsCard(points: profile.contributionPoints),
      () => _buildLocalExpertBadgesSection(profile),
      () => const SizedBox(height: 24),
      () => _buildSectionHeader('Saved', Icons.favorite_border),
      () => const SizedBox(height: 12),
      _buildSavedSectionTabs,
    ];
    final saver = widget.boundedSavedCoordinator;
    switch (_savedSection) {
      case _SavedSection.restaurants:
        final biteScore = _savedRestaurants!;
        final saverRows =
            saver?.entries(CustomerBiteSaverSavedSection.restaurants) ??
            const <CustomerBiteSaverSavedEntry>[];
        rows.addAll(
          saverRows.map(
            (entry) =>
                () => _buildSavedBiteSaverCard(entry),
          ),
        );
        if (saver == null) {
          rows.addAll(
            profile.favoriteSaverRestaurants.map(
              (entry) =>
                  () => _buildSavedSaverRestaurantCard(entry),
            ),
          );
        }
        rows.addAll(
          biteScore.items.map(
            (item) =>
                () => _buildSavedRestaurantCard(
                  CustomerBiteScoreProfileService.restaurant(item),
                ),
          ),
        );
        if (biteScore.items.isEmpty &&
            !biteScore.isLoading &&
            biteScore.error == null &&
            saverRows.isEmpty &&
            profile.favoriteSaverRestaurants.isEmpty) {
          rows.add(
            () => _buildEmptyCard('You have not saved any restaurants yet.'),
          );
        }
        rows.add(() => CustomerBiteScorePageStatus(controller: biteScore));
        rows.addAll(
          _boundedSavedStatusCards(
            CustomerBiteSaverSavedSection.restaurants,
          ).map(
            (widget) =>
                () => widget,
          ),
        );
      case _SavedSection.dishes:
        final controller = _savedDishes!;
        rows.addAll(
          controller.items.map(
            (item) =>
                () => _buildSavedDishCard(
                  CustomerBiteScoreProfileService.dish(item),
                ),
          ),
        );
        if (controller.items.isEmpty &&
            !controller.isLoading &&
            controller.error == null) {
          rows.add(() => _buildEmptyCard('You have not saved any dishes yet.'));
        }
        rows.add(() => CustomerBiteScorePageStatus(controller: controller));
      case _SavedSection.coupons:
        final entries =
            saver?.entries(CustomerBiteSaverSavedSection.coupons) ??
            const <CustomerBiteSaverSavedEntry>[];
        rows.addAll(
          entries.map(
            (entry) =>
                () => _buildSavedBiteSaverCard(entry),
          ),
        );
        if (saver == null) {
          rows.addAll(
            profile.favoriteCoupons.map(
              (coupon) =>
                  () => _buildSavedCouponTile(coupon),
            ),
          );
        }
        if (entries.isEmpty && profile.favoriteCoupons.isEmpty) {
          rows.add(
            () => _buildEmptyCard('You have not saved any coupons yet.'),
          );
        }
        rows.addAll(
          _boundedSavedStatusCards(CustomerBiteSaverSavedSection.coupons).map(
            (widget) =>
                () => widget,
          ),
        );
    }
    rows.addAll([
      () => const SizedBox(height: 28),
      () => _buildSectionHeader('Your Reviews', Icons.rate_review_outlined),
    ]);
    final reviews = _reviews!;
    rows.addAll(
      reviews.items.map(
        (item) =>
            () =>
                _buildReviewCard(CustomerBiteScoreProfileService.review(item)),
      ),
    );
    if (reviews.items.isEmpty && !reviews.isLoading && reviews.error == null) {
      rows.add(
        () => _buildEmptyCard('You have not posted a BiteScore review yet.'),
      );
    }
    rows.add(() => CustomerBiteScorePageStatus(controller: reviews));
    return RefreshIndicator(
      onRefresh: () async {
        setState(_refresh);
        await _profileFuture;
      },
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        physics: const AlwaysScrollableScrollPhysics(),
        itemCount: rows.length,
        itemBuilder: (context, index) => rows[index](),
      ),
    );
  }

  Widget _buildPublicUsernameCard(BiteScoreUserProfileData profileData) {
    final chosenUsername = profileData.chosenUsername?.trim() ?? '';
    final hasChosenUsername = chosenUsername.isNotEmpty;
    final statusColor = _isUsernameAvailable == true
        ? Colors.green.shade700
        : Colors.red.shade700;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Public Username',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
            ),
            if (!hasChosenUsername) ...[
              const SizedBox(height: 6),
              Text(
                'Shown on your reviews as ${profileData.publicDisplayName}. If you do not set a username, we use ${profileData.fallbackUsername}.',
                style: const TextStyle(
                  color: Colors.black54,
                  fontSize: 13,
                  height: 1.35,
                ),
              ),
              const SizedBox(height: 14),
            ] else
              const SizedBox(height: 12),
            if (hasChosenUsername && !_isEditingUsername) ...[
              Row(
                children: [
                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 12,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.grey.shade50,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: Colors.grey.shade300),
                      ),
                      child: RichText(
                        text: TextSpan(
                          style: const TextStyle(
                            color: Colors.black87,
                            fontSize: 14,
                          ),
                          children: [
                            const TextSpan(
                              text: 'Username: ',
                              style: TextStyle(fontWeight: FontWeight.w700),
                            ),
                            TextSpan(
                              text: chosenUsername,
                              style: const TextStyle(
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  TextButton(
                    onPressed: () {
                      setState(() {
                        _isEditingUsername = true;
                        _usernameController.text = chosenUsername;
                        _usernameStatusMessage = null;
                        _isUsernameAvailable = null;
                      });
                    },
                    child: const Text('Change'),
                  ),
                ],
              ),
              if (_usernameStatusMessage != null) ...[
                const SizedBox(height: 10),
                Text(
                  _usernameStatusMessage!,
                  style: TextStyle(
                    color: statusColor,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ] else ...[
              TextField(
                controller: _usernameController,
                textInputAction: TextInputAction.done,
                decoration: const InputDecoration(
                  labelText: 'Choose a username',
                  hintText: 'letters, numbers, underscores',
                  border: OutlineInputBorder(),
                ),
                onChanged: (_) {
                  if (_usernameStatusMessage == null &&
                      _isUsernameAvailable == null) {
                    return;
                  }
                  setState(() {
                    _usernameStatusMessage = null;
                    _isUsernameAvailable = null;
                  });
                },
                onSubmitted: (_) => _checkUsernameAvailability(),
              ),
              if (_usernameStatusMessage != null) ...[
                const SizedBox(height: 10),
                Text(
                  _usernameStatusMessage!,
                  style: TextStyle(
                    color: statusColor,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: _isCheckingUsername || _isSavingUsername
                          ? null
                          : _checkUsernameAvailability,
                      child: Text(
                        _isCheckingUsername
                            ? 'Checking...'
                            : 'Check availability',
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton(
                      onPressed: _isCheckingUsername || _isSavingUsername
                          ? null
                          : _saveUsername,
                      child: Text(
                        _isSavingUsername ? 'Saving...' : 'Save username',
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildBadgeCard(BiteScoreUserProfileData profileData) {
    return Card(
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          border: Border(
            left: BorderSide(
              color: Colors.blue.shade700.withValues(alpha: 0.28),
              width: 4,
            ),
          ),
        ),
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: 10,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(
                  profileData.publicDisplayName,
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                ReviewerActivityPill(reviewCount: profileData.reviewCount),
              ],
            ),
            const SizedBox(height: 14),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                _buildStatChip(
                  '${profileData.reviewCount} reviews',
                  Icons.rate_review_outlined,
                ),
                _buildStatChip(
                  '${profileData.helpfulVotesReceived} helpful votes',
                  Icons.thumb_up_alt_outlined,
                ),
                _buildStatChip(
                  '${profileData.accountAgeDays} days on BiteScore',
                  Icons.calendar_today_outlined,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStatChip(String label, IconData icon) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.grey.shade100,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: Colors.black54),
          const SizedBox(width: 6),
          Text(
            label,
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: Colors.black87,
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (!_isOpeningUserCurrent()) {
      return const Scaffold(
        body: Center(child: Text('Profile session changed.')),
      );
    }
    final content = Scaffold(
      appBar: AppBar(title: const Text('My Profile'), centerTitle: true),
      body: FutureBuilder<BiteScoreUserProfileData>(
        future: _profileFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }

          if (snapshot.hasError) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      AppErrorText.friendly(
                        snapshot.error ??
                            StateError(
                              'Could not load your profile right now.',
                            ),
                        fallback: 'Could not load your profile right now.',
                      ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 12),
                    ElevatedButton(
                      onPressed: () {
                        setState(_refresh);
                      },
                      child: const Text('Try Again'),
                    ),
                  ],
                ),
              ),
            );
          }

          return _buildProfileBody(
            snapshot.data ??
                const BiteScoreUserProfileData(
                  publicDisplayName: 'Reviewer',
                  chosenUsername: null,
                  fallbackUsername: 'anon1',
                  favoriteRestaurants: <BitescoreRestaurant>[],
                  favoriteSaverRestaurants: <SavedBiteSaverRestaurantEntry>[],
                  favoriteDishEntries: <BiteScoreHomeEntry>[],
                  favoriteCoupons: <Coupon>[],
                  reviews: <BiteScoreUserReviewEntry>[],
                  badgeLabel: 'New Reviewer',
                  reviewCount: 0,
                  helpfulVotesReceived: 0,
                  accountAgeDays: 0,
                  moderationFlagCount: 0,
                  contributionPoints: 0,
                ),
          );
        },
      ),
    );
    final binding = _authBoundRouteBinding;
    if (binding == null) {
      return content;
    }
    return MainNavigationAuthBoundOverlayScope(
      binding: binding,
      child: Builder(
        builder: (scopeContext) {
          _privateOverlayContext = scopeContext;
          return content;
        },
      ),
    );
  }
}
