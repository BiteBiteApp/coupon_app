import 'dart:async';
import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/customer_bitesaver_search.dart';
import '../services/app_error_text.dart';
import '../services/bitesaver_location_search.dart';
import '../services/customer_bitesaver_search_coordinator.dart';
import '../services/customer_load_more_controller.dart';
import '../services/shared_location_state_service.dart';
import '../widgets/bitesaver_colors.dart';
import '../widgets/bitesaver_restaurant_images.dart';
import 'home_screen.dart' show BiteSaverHomeDealBubble;

typedef CustomerBiteSaverTimeContextProvider =
    Future<CustomerBiteSaverTimeContext> Function();
typedef CustomerBiteSaverBrowseActionHandler =
    Future<CustomerBiteSaverBrowseActionResult> Function(
      BuildContext context,
      CustomerBiteSaverBrowseSelection selection,
    );
typedef CustomerBiteSaverReverseGeocoder =
    Future<({String? city, String? zip})> Function(Position position);

@immutable
final class CustomerBiteSaverTimeContext {
  const CustomerBiteSaverTimeContext({
    required this.timeZone,
    required this.utcOffsetMinutes,
  });

  /// An authoritative IANA timezone name supplied by app composition.
  final String timeZone;
  final int utcOffsetMinutes;
}

enum CustomerBiteSaverBrowseAction { restaurantProfile, offer, menu }

@immutable
final class CustomerBiteSaverBrowseSelection {
  const CustomerBiteSaverBrowseSelection._({
    required this.action,
    required this.restaurant,
    required this.offer,
    required this.session,
    required this.access,
  });

  factory CustomerBiteSaverBrowseSelection.restaurantProfile({
    required CustomerBiteSaverRestaurant restaurant,
    required CustomerBiteSaverSearchCoordinator session,
    CustomerBiteSaverBrowseAccess? access,
  }) {
    final selectedAccess =
        access ?? session.captureBrowseAccess(restaurant: restaurant);
    if (!identical(
      session.currentAcceptedRestaurantForAccess(
        selectedAccess,
        restaurant.restaurantId,
      ),
      restaurant,
    )) {
      throw const CustomerBiteSaverFreshSearchRequiredException();
    }
    return CustomerBiteSaverBrowseSelection._(
      action: CustomerBiteSaverBrowseAction.restaurantProfile,
      restaurant: restaurant,
      offer: null,
      session: session,
      access: selectedAccess,
    );
  }

  factory CustomerBiteSaverBrowseSelection.menu({
    required CustomerBiteSaverRestaurant restaurant,
    required CustomerBiteSaverSearchCoordinator session,
  }) => CustomerBiteSaverBrowseSelection._(
    action: CustomerBiteSaverBrowseAction.menu,
    restaurant: restaurant,
    offer: null,
    session: session,
    access: session.captureBrowseAccess(restaurant: restaurant),
  );

  factory CustomerBiteSaverBrowseSelection.offer({
    required CustomerBiteSaverRestaurant restaurant,
    required CustomerBiteSaverOffer offer,
    required CustomerBiteSaverSearchCoordinator session,
    CustomerBiteSaverBrowseAccess? access,
  }) {
    final selectedAccess =
        access ??
        session.captureBrowseAccess(restaurant: restaurant, offer: offer);
    final current = session.currentAcceptedOfferSelectionForAccess(
      selectedAccess,
      restaurant.restaurantId,
      offer.offerId,
    );
    if (!identical(current?.restaurant, restaurant) ||
        !identical(current?.offer, offer) ||
        current?.offer.offerOccurrence != offer.offerOccurrence) {
      throw const CustomerBiteSaverFreshSearchRequiredException();
    }
    return CustomerBiteSaverBrowseSelection._(
      action: CustomerBiteSaverBrowseAction.offer,
      restaurant: restaurant,
      offer: offer,
      session: session,
      access: selectedAccess,
    );
  }

  final CustomerBiteSaverBrowseAction action;
  final CustomerBiteSaverRestaurant restaurant;
  final CustomerBiteSaverOffer? offer;

  /// The already-fenced session capability. Raw restaurant/coupon IDs are not
  /// reconstructed or sent to legacy screens by this presentation layer.
  final CustomerBiteSaverSearchCoordinator session;
  final CustomerBiteSaverBrowseAccess access;

  bool get isCurrent {
    final currentRestaurant = session.currentAcceptedRestaurantForAccess(
      access,
      restaurant.restaurantId,
    );
    if (currentRestaurant == null) return false;
    final selectedOffer = offer;
    if (selectedOffer == null) return true;
    final current = session.currentAcceptedOfferSelectionForAccess(
      access,
      restaurant.restaurantId,
      selectedOffer.offerId,
    );
    return current != null &&
        current.offer.offerOccurrence == selectedOffer.offerOccurrence;
  }
}

@immutable
final class CustomerBiteSaverBrowseActionResult {
  const CustomerBiteSaverBrowseActionResult({
    this.refreshFavoriteDecorations = false,
  });

  final bool refreshFavoriteDecorations;
}

/// An opt-in customer browse surface over [CustomerBiteSaverSearchCoordinator].
///
/// It intentionally requires both an action handler and an authoritative IANA
/// timezone provider. The default app entry remains [HomeScreen] until the
/// detail/menu/Saved/redemption consumers and timezone composition are ready.
class CustomerBiteSaverBrowseScreen extends StatefulWidget {
  const CustomerBiteSaverBrowseScreen({
    super.key,
    required this.coordinator,
    required this.timeContextProvider,
    required this.onAction,
    this.locationGeocoder,
    this.currentPositionLoader,
    this.reverseGeocoder,
    this.locationRestoreLoader,
    this.navigationRefreshGeneration = 0,
    this.disposeCoordinator = true,
  });

  final CustomerBiteSaverSearchCoordinator coordinator;
  final CustomerBiteSaverTimeContextProvider timeContextProvider;
  final CustomerBiteSaverBrowseActionHandler onAction;
  final Future<List<Location>> Function(String query)? locationGeocoder;
  final Future<Position> Function()? currentPositionLoader;
  final CustomerBiteSaverReverseGeocoder? reverseGeocoder;
  final Future<SharedLocationRestoreResult> Function()? locationRestoreLoader;
  final int navigationRefreshGeneration;
  final bool disposeCoordinator;

  @override
  State<CustomerBiteSaverBrowseScreen> createState() =>
      _CustomerBiteSaverBrowseScreenState();
}

class _CustomerBiteSaverBrowseScreenState
    extends State<CustomerBiteSaverBrowseScreen>
    with WidgetsBindingObserver {
  static const String _selectedRadiusPreferenceKey = 'selected_radius';
  static const List<int> _supportedRadii = <int>[1, 3, 5, 10, 15, 20, 30];

  final TextEditingController _locationController = TextEditingController();
  final TextEditingController _contentController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final Set<String> _expandedRestaurants = <String>{};
  final Set<String> _pendingFavoriteIds = <String>{};

  CustomerLoadMoreController<CustomerBiteSaverRestaurant>?
  _observedRestaurantPager;
  _PendingBrowseSearchSetup? _pendingSearchSetup;
  SharedLocationRestoreLease? _restoreLease;
  SharedLocationOperationToken? _ownedLocationOperation;
  List<CustomerBiteSaverRestaurant> _lastAcceptedRestaurants =
      const <CustomerBiteSaverRestaurant>[];
  int _selectedRadiusMiles = 15;
  int _locationGeneration = 0;
  int _searchIntentGeneration = 0;
  bool _restoreStarted = false;
  bool _restored = false;
  bool _locating = false;
  bool _geocoding = false;
  bool _suppressLocationListener = false;
  String? _locationMessage;
  String? _inputError;
  late String _observedAuthRealmKey;
  SharedLocationState _location = const SharedLocationState();

  @override
  void initState() {
    super.initState();
    _observedAuthRealmKey = widget.coordinator.auth.realmKey;
    WidgetsBinding.instance.addObserver(this);
    widget.coordinator.addListener(_handleCoordinatorChanged);
    _locationController.addListener(_handleLocationTextChanged);
    unawaited(_restoreCriteriaOnce());
  }

  @override
  void didUpdateWidget(covariant CustomerBiteSaverBrowseScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.coordinator, widget.coordinator)) {
      _invalidatePendingSearchSetup();
      _detachRestaurantPager();
      oldWidget.coordinator.removeListener(_handleCoordinatorChanged);
      if (oldWidget.disposeCoordinator) {
        oldWidget.coordinator.dispose();
      }
      widget.coordinator.addListener(_handleCoordinatorChanged);
      _observedAuthRealmKey = widget.coordinator.auth.realmKey;
      _lastAcceptedRestaurants = const <CustomerBiteSaverRestaurant>[];
      _expandedRestaurants.clear();
      if (_restored && _hasUsableCenter) {
        unawaited(_startSearch());
      }
    } else if (oldWidget.navigationRefreshGeneration !=
        widget.navigationRefreshGeneration) {
      unawaited(widget.coordinator.refreshFavoriteStates());
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (widget.coordinator.isDisposed) return;
    switch (state) {
      case AppLifecycleState.paused:
      case AppLifecycleState.inactive:
      case AppLifecycleState.detached:
      case AppLifecycleState.hidden:
        _invalidatePendingSearchSetup();
        if (widget.coordinator.status !=
            CustomerBiteSaverCoordinatorStatus.paused) {
          widget.coordinator.pause();
        }
      case AppLifecycleState.resumed:
        unawaited(widget.coordinator.resume());
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _locationGeneration += 1;
    _invalidatePendingSearchSetup();
    final lease = _restoreLease;
    if (lease != null) {
      SharedLocationStateService.releaseRestoreLease(
        lease,
        cancelIfLastOwner: true,
      );
    }
    final operation = _ownedLocationOperation;
    if (operation != null) {
      SharedLocationStateService.cancelLocationOperationIfCurrent(operation);
    }
    _detachRestaurantPager();
    widget.coordinator.removeListener(_handleCoordinatorChanged);
    if (widget.disposeCoordinator) {
      widget.coordinator.dispose();
    }
    _locationController.removeListener(_handleLocationTextChanged);
    _locationController.dispose();
    _contentController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _handleCoordinatorChanged() {
    final authRealmKey = widget.coordinator.auth.realmKey;
    if (authRealmKey != _observedAuthRealmKey) {
      _observedAuthRealmKey = authRealmKey;
      _invalidatePendingSearchSetup();
    }
    _attachRestaurantPager(widget.coordinator.restaurantPager);
    if (mounted) setState(() {});
  }

  void _attachRestaurantPager(
    CustomerLoadMoreController<CustomerBiteSaverRestaurant>? pager,
  ) {
    if (identical(pager, _observedRestaurantPager)) return;
    _detachRestaurantPager();
    _observedRestaurantPager = pager;
    pager?.addListener(_handleRestaurantPagerChanged);
    _captureAcceptedRestaurants(pager);
  }

  void _detachRestaurantPager() {
    _observedRestaurantPager?.removeListener(_handleRestaurantPagerChanged);
    _observedRestaurantPager = null;
  }

  void _handleRestaurantPagerChanged() {
    _captureAcceptedRestaurants(_observedRestaurantPager);
    if (mounted) setState(() {});
  }

  void _captureAcceptedRestaurants(
    CustomerLoadMoreController<CustomerBiteSaverRestaurant>? pager,
  ) {
    if (pager != null && !pager.isDisposed && pager.items.isNotEmpty) {
      _lastAcceptedRestaurants = pager.items;
    }
  }

  Future<void> _restoreCriteriaOnce() async {
    if (_restoreStarted) return;
    _restoreStarted = true;
    final generation = _locationGeneration;
    final lease = SharedLocationStateService.acquireRestoreLease();
    _restoreLease = lease;
    try {
      final preferences = await SharedPreferences.getInstance();
      final savedRadius = preferences.getString(_selectedRadiusPreferenceKey);
      final parsedRadius = _parseRadius(savedRadius);
      final restored =
          await (widget.locationRestoreLoader?.call() ??
              SharedLocationStateService.restoreOnLaunch(
                reverseLookupLocation: _reverseGeocode,
              ));
      if (!mounted || generation != _locationGeneration) return;
      setState(() {
        _restored = true;
        if (parsedRadius != null) _selectedRadiusMiles = parsedRadius;
        _applySharedLocation(restored.state);
        _locationMessage = restored.message;
      });
      if (_hasUsableCenter) await _startSearch();
    } catch (error) {
      if (!mounted || generation != _locationGeneration) return;
      setState(() {
        _restored = true;
        _locationMessage = AppErrorText.friendly(
          error,
          fallback: 'Could not restore your location right now.',
        );
      });
    } finally {
      if (identical(_restoreLease, lease)) _restoreLease = null;
      SharedLocationStateService.releaseRestoreLease(
        lease,
        cancelIfLastOwner: false,
      );
    }
  }

  int? _parseRadius(String? value) {
    if (value == null) return null;
    final parsed = int.tryParse(value.split(' ').first);
    return _supportedRadii.contains(parsed) ? parsed : null;
  }

  void _applySharedLocation(SharedLocationState location) {
    _location = location;
    _replaceLocationText(
      location.usingCurrentLocation ? '' : location.searchText,
    );
  }

  void _replaceLocationText(String text) {
    _suppressLocationListener = true;
    _locationController.value = TextEditingValue(
      text: text,
      selection: TextSelection.collapsed(offset: text.length),
    );
    _suppressLocationListener = false;
  }

  void _handleLocationTextChanged() {
    if (_suppressLocationListener) return;
    _locationGeneration += 1;
    _geocoding = false;
    _locating = false;
  }

  SharedLocationOperationToken _beginLocationOperation() {
    _locationGeneration += 1;
    _invalidatePendingSearchSetup();
    final token = SharedLocationStateService.beginLocationOperation();
    _ownedLocationOperation = token;
    return token;
  }

  bool _ownsLocationOperation(
    int generation,
    SharedLocationOperationToken token,
  ) =>
      mounted &&
      generation == _locationGeneration &&
      SharedLocationStateService.ownsLocationOperation(token);

  bool get _hasUsableCenter {
    if (_location.usingCurrentLocation) {
      final position = _location.currentPosition;
      return position != null &&
          BiteSaverLocationSearch.hasValidCoordinates(
            position.latitude,
            position.longitude,
          );
    }
    return _location.usingTypedSearchLocation &&
        _location.typedLatitude != null &&
        _location.typedLongitude != null &&
        BiteSaverLocationSearch.hasValidCoordinates(
          _location.typedLatitude!,
          _location.typedLongitude!,
        );
  }

  _SubmittedBrowseSearch _submittedSearch() {
    final content = _contentController.text.trim();
    if (!BiteSaverLocationSearch.isValidCompatibilitySearchText(content)) {
      throw const FormatException(
        'Search must be at most 200 characters and 800 UTF-8 bytes.',
      );
    }
    if (!_hasUsableCenter) {
      throw const FormatException(
        'Use your current location or search for a city or ZIP first.',
      );
    }
    if (_location.usingCurrentLocation) {
      final position = _location.currentPosition!;
      return _SubmittedBrowseSearch(
        latitude: position.latitude,
        longitude: position.longitude,
        radiusMiles: _selectedRadiusMiles,
        locationMode: CustomerBiteSaverLocationMode.current,
        typedLocation: null,
        searchText: content,
      );
    }
    return _SubmittedBrowseSearch(
      latitude: _location.typedLatitude!,
      longitude: _location.typedLongitude!,
      radiusMiles: _selectedRadiusMiles,
      locationMode: CustomerBiteSaverLocationMode.typed,
      typedLocation: _typedLocation(_location.searchText),
      searchText: content,
    );
  }

  CustomerBiteSaverTypedLocation _typedLocation(String value) {
    final normalized = value.trim();
    if (RegExp(r'^\d{5}(?:-\d{4})?$').hasMatch(normalized)) {
      return CustomerBiteSaverZipLocation(normalized);
    }
    final parts = normalized.split(',');
    return CustomerBiteSaverCityLocation(
      city: parts.first,
      state: parts.length > 1 ? parts.last : null,
    );
  }

  Future<void> _startSearch({bool fresh = false}) {
    if (_locating || _geocoding) return Future<void>.value();
    late final _SubmittedBrowseSearch snapshot;
    try {
      snapshot = _submittedSearch();
    } on CustomerBiteSaverProtocolException {
      _invalidatePendingSearchSetup();
      if (!widget.coordinator.isDisposed) {
        widget.coordinator.revokePendingSearchStart();
      }
      _setSearchSetupError(
        'Search settings are invalid. Check the location and try again.',
      );
      return Future<void>.value();
    } on FormatException catch (error) {
      _invalidatePendingSearchSetup();
      if (!widget.coordinator.isDisposed) {
        widget.coordinator.revokePendingSearchStart();
      }
      _setSearchSetupError(error.message);
      return Future<void>.value();
    }

    final coordinator = widget.coordinator;
    final authRealmKey = coordinator.auth.realmKey;
    final pending = _pendingSearchSetup;
    if (pending != null &&
        pending.matches(
          snapshot: snapshot,
          fresh: fresh,
          coordinator: coordinator,
          authRealmKey: authRealmKey,
        )) {
      return pending.future;
    }

    // A distinct submission owns the search immediately, even while its time
    // context is still loading. Any older transported start may finish, but it
    // must not install state while this newer setup is pending.
    if (!coordinator.isDisposed) {
      coordinator.revokePendingSearchStart();
    }

    final setup = _PendingBrowseSearchSetup(
      generation: ++_searchIntentGeneration,
      snapshot: snapshot,
      fresh: fresh,
      coordinator: coordinator,
      authRealmKey: authRealmKey,
    );
    _pendingSearchSetup = setup;
    setup.future = _completeSearchSetup(setup);
    return setup.future;
  }

  Future<void> _completeSearchSetup(_PendingBrowseSearchSetup setup) async {
    try {
      final time = await widget.timeContextProvider();
      if (!_isCurrentSearchSetup(setup)) return;
      final criteria = setup.snapshot.criteria(time);
      if (!_isCurrentSearchSetup(setup)) return;
      setState(() => _inputError = null);
      if (setup.fresh) {
        await setup.coordinator.freshSearch(criteria);
      } else {
        await setup.coordinator.startSearch(criteria);
      }
    } on CustomerBiteSaverProtocolException {
      if (_isCurrentSearchSetup(setup)) {
        _setSearchSetupError(
          'Search settings are invalid. Check the location and try again.',
        );
      }
    } on FormatException catch (error) {
      if (_isCurrentSearchSetup(setup)) {
        _setSearchSetupError(error.message);
      }
    } catch (error) {
      if (_isCurrentSearchSetup(setup)) {
        _setSearchSetupError(
          AppErrorText.friendly(
            error,
            fallback: 'Could not start this search.',
          ),
        );
      }
    } finally {
      if (setup.generation == _searchIntentGeneration &&
          identical(_pendingSearchSetup, setup)) {
        _pendingSearchSetup = null;
      }
    }
  }

  bool _isCurrentSearchSetup(_PendingBrowseSearchSetup setup) =>
      mounted &&
      setup.generation == _searchIntentGeneration &&
      identical(_pendingSearchSetup, setup) &&
      identical(widget.coordinator, setup.coordinator) &&
      !setup.coordinator.isDisposed &&
      setup.coordinator.auth.realmKey == setup.authRealmKey;

  void _invalidatePendingSearchSetup() {
    _searchIntentGeneration += 1;
    _pendingSearchSetup = null;
  }

  void _setSearchSetupError(String message) {
    if (mounted) setState(() => _inputError = message);
  }

  Future<void> _searchTypedLocation() async {
    final query = _locationController.text.trim();
    if (query.isEmpty) {
      setState(() => _inputError = 'Enter a city or ZIP code.');
      return;
    }
    try {
      _typedLocation(query);
    } on CustomerBiteSaverProtocolException {
      setState(() {
        _inputError = 'Enter a ZIP code or a city, optionally with its state.';
      });
      return;
    }

    final token = _beginLocationOperation();
    final generation = _locationGeneration;
    setState(() {
      _geocoding = true;
      _locating = false;
      _inputError = null;
      _locationMessage = null;
    });
    try {
      final locations =
          await (widget.locationGeocoder?.call(query) ??
              SharedLocationStateService.geocodeSearchQuery(query));
      if (!_ownsLocationOperation(generation, token)) return;
      if (locations.isEmpty ||
          !BiteSaverLocationSearch.hasValidCoordinates(
            locations.first.latitude,
            locations.first.longitude,
          )) {
        throw const FormatException('That location could not be found.');
      }
      final first = locations.first;
      final accepted =
          await SharedLocationStateService.saveTypedLocationForOperation(
            token,
            latitude: first.latitude,
            longitude: first.longitude,
            label: query,
            searchText: query,
          );
      if (!accepted || !_ownsLocationOperation(generation, token)) return;
      setState(() {
        _restored = true;
        _location = SharedLocationStateService.state;
        _geocoding = false;
        _locationMessage = 'Using "$query" as your search center.';
      });
      await _startSearch();
    } catch (error) {
      if (!_ownsLocationOperation(generation, token)) return;
      await SharedLocationStateService.clearTypedLocationForOperation(token);
      if (!mounted) return;
      setState(() {
        _restored = true;
        _geocoding = false;
        _location = SharedLocationStateService.state;
        _inputError = AppErrorText.friendly(
          error,
          fallback: 'Could not search that city or ZIP.',
        );
      });
    }
  }

  Future<void> _useCurrentLocation() async {
    final token = _beginLocationOperation();
    final generation = _locationGeneration;
    setState(() {
      _locating = true;
      _geocoding = false;
      _inputError = null;
      _locationMessage = null;
    });
    try {
      final position =
          await (widget.currentPositionLoader?.call() ??
              _loadCurrentPosition());
      if (!_ownsLocationOperation(generation, token)) return;
      final details = await _reverseGeocode(position);
      if (!_ownsLocationOperation(generation, token)) return;
      final accepted =
          await SharedLocationStateService.saveCurrentLocationForOperation(
            token,
            position: position,
            searchText: '',
            detectedCity: details.city,
            detectedZip: details.zip,
          );
      if (!accepted || !_ownsLocationOperation(generation, token)) return;
      setState(() {
        _restored = true;
        _applySharedLocation(SharedLocationStateService.state);
        _locating = false;
        _locationMessage = 'Using your current location.';
      });
      await _startSearch();
    } catch (error) {
      if (!_ownsLocationOperation(generation, token)) return;
      setState(() {
        _restored = true;
        _locating = false;
        _inputError = AppErrorText.friendly(
          error,
          fallback: 'Could not get your location right now.',
        );
      });
    }
  }

  Future<Position> _loadCurrentPosition() async {
    final enabled = await Geolocator.isLocationServiceEnabled();
    if (!enabled) throw StateError('Location services are turned off.');
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied) {
      throw StateError('Location permission was denied.');
    }
    if (permission == LocationPermission.deniedForever) {
      throw StateError(
        'Location permission is permanently denied. Enable it in settings.',
      );
    }
    return Geolocator.getCurrentPosition();
  }

  Future<({String? city, String? zip})> _reverseGeocode(
    Position position,
  ) async {
    final injected = widget.reverseGeocoder;
    if (injected != null) return injected(position);
    if (kIsWeb || (!Platform.isAndroid && !Platform.isIOS)) {
      return (city: null, zip: null);
    }
    try {
      final placemarks = await placemarkFromCoordinates(
        position.latitude,
        position.longitude,
      );
      if (placemarks.isNotEmpty) {
        return (
          city: (placemarks.first.locality ?? '').trim(),
          zip: (placemarks.first.postalCode ?? '').trim(),
        );
      }
    } catch (_) {}
    return (city: null, zip: null);
  }

  Future<void> _selectRadius(int radius) async {
    if (_selectedRadiusMiles == radius) return;
    setState(() => _selectedRadiusMiles = radius);
    final preferences = await SharedPreferences.getInstance();
    await preferences.setString(
      _selectedRadiusPreferenceKey,
      '$radius ${radius == 1 ? 'mile' : 'miles'}',
    );
    if (mounted && !_locating && !_geocoding && _hasUsableCenter) {
      await _startSearch();
    }
  }

  Future<void> _retryCoordinator() async {
    final coordinator = widget.coordinator;
    if (coordinator.status == CustomerBiteSaverCoordinatorStatus.error &&
        coordinator.hasSession) {
      await coordinator.retryStatusPoll();
      if (coordinator.status != CustomerBiteSaverCoordinatorStatus.error) {
        return;
      }
      await _startSearch(fresh: true);
      return;
    }
    await coordinator.retrySearch();
  }

  Future<void> _toggleRestaurantFavorite(
    CustomerBiteSaverRestaurant restaurant,
  ) async {
    final state = widget.coordinator.restaurantFavoriteState(
      restaurant.restaurantId,
    );
    if (!widget.coordinator.auth.isSigned ||
        state == CustomerBiteSaverFavoriteState.unknown) {
      return;
    }
    await _runFavorite(
      restaurant.restaurantId.value,
      () => widget.coordinator.setRestaurantFavorite(
        restaurant.restaurantId,
        state != CustomerBiteSaverFavoriteState.favorite,
      ),
    );
  }

  Future<void> _toggleOfferFavorite(CustomerBiteSaverOffer offer) async {
    final state = widget.coordinator.offerFavoriteState(offer.offerId);
    if (!widget.coordinator.auth.isSigned ||
        offer.offerType != CustomerBiteSaverOfferType.coupon ||
        state == CustomerBiteSaverFavoriteState.unknown) {
      return;
    }
    await _runFavorite(
      offer.offerId.value,
      () => widget.coordinator.setOfferFavorite(
        offer.offerId,
        state != CustomerBiteSaverFavoriteState.favorite,
      ),
    );
  }

  Future<void> _runFavorite(String id, Future<void> Function() action) async {
    if (_pendingFavoriteIds.contains(id)) return;
    setState(() => _pendingFavoriteIds.add(id));
    try {
      await action();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              AppErrorText.friendly(
                error,
                fallback: 'Could not update that saved item.',
              ),
            ),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _pendingFavoriteIds.remove(id));
    }
  }

  Future<void> _dispatch(CustomerBiteSaverBrowseSelection selection) async {
    try {
      final result = await widget.onAction(context, selection);
      if (mounted && result.refreshFavoriteDecorations) {
        await widget.coordinator.refreshFavoriteStates();
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              AppErrorText.friendly(
                error,
                fallback: 'Could not open that item.',
              ),
            ),
          ),
        );
      }
    }
  }

  String get _locationSummary {
    if (_location.usingCurrentLocation) {
      final city = _location.detectedCity?.trim();
      return city == null || city.isEmpty ? 'Current location' : city;
    }
    final text = _location.searchText.trim();
    return text.isEmpty ? 'Choose a search center' : text;
  }

  @override
  Widget build(BuildContext context) {
    _attachRestaurantPager(widget.coordinator.restaurantPager);
    final pager = _observedRestaurantPager;
    final current = pager != null && !pager.isDisposed ? pager.items : null;
    final restaurants = current?.isNotEmpty == true
        ? current!
        : _shouldRetainExpiredContent
        ? _lastAcceptedRestaurants
        : const <CustomerBiteSaverRestaurant>[];
    return Scaffold(
      backgroundColor: BiteSaverColors.pageBackground,
      body: DecoratedBox(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: <Color>[
              BiteSaverColors.pageBackground,
              BiteSaverColors.secondaryBackground,
            ],
          ),
        ),
        child: CustomScrollView(
          key: const PageStorageKey<String>('bounded-bitesaver-browse-scroll'),
          controller: _scrollController,
          physics: const ClampingScrollPhysics(),
          slivers: <Widget>[
            SliverToBoxAdapter(child: _buildHeader()),
            SliverPadding(
              padding: EdgeInsets.fromLTRB(
                8,
                8,
                8,
                136 + MediaQuery.viewPaddingOf(context).bottom,
              ),
              sliver: _buildBody(restaurants, pager),
            ),
          ],
        ),
      ),
    );
  }

  bool get _shouldRetainExpiredContent {
    switch (widget.coordinator.status) {
      case CustomerBiteSaverCoordinatorStatus.expired:
      case CustomerBiteSaverCoordinatorStatus.failed:
      case CustomerBiteSaverCoordinatorStatus.freshSearchRequired:
      case CustomerBiteSaverCoordinatorStatus.error:
        return true;
      default:
        return false;
    }
  }

  Widget _buildHeader() {
    return LayoutBuilder(
      builder: (context, constraints) {
        final narrow =
            constraints.maxWidth < 430 ||
            MediaQuery.textScalerOf(context).scale(14) > 18;
        final locationField = TextField(
          key: const ValueKey<String>('bounded-location-field'),
          controller: _locationController,
          enabled: !_locating && !_geocoding,
          textInputAction: TextInputAction.search,
          onSubmitted: (_) => _searchTypedLocation(),
          decoration: _inputDecoration(
            hint: 'City or zip code',
            icon: Icons.location_on,
            suffix: IconButton(
              tooltip: 'Search location',
              onPressed: _geocoding ? null : _searchTypedLocation,
              icon: _geocoding
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.arrow_forward, size: 19),
            ),
          ),
        );
        final currentButton = ElevatedButton.icon(
          key: const ValueKey<String>('bounded-current-location'),
          onPressed: _locating ? null : _useCurrentLocation,
          icon: Icon(_locating ? Icons.hourglass_top : Icons.near_me_outlined),
          label: Text(_locating ? 'Locating...' : 'Use My Current Location'),
          style: ElevatedButton.styleFrom(
            minimumSize: const Size.fromHeight(49),
            backgroundColor: const Color(0xFFE94312),
            foregroundColor: Colors.white,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(11),
            ),
          ),
        );
        final contentField = TextField(
          key: const ValueKey<String>('bounded-content-field'),
          controller: _contentController,
          enabled: !_locating && !_geocoding,
          textInputAction: TextInputAction.search,
          onSubmitted: (_) => _startSearch(),
          decoration: _inputDecoration(
            hint: 'Search restaurants or deals',
            icon: Icons.search,
            suffix: IconButton(
              tooltip: 'Search restaurants or deals',
              onPressed: _hasUsableCenter && !_locating && !_geocoding
                  ? _startSearch
                  : null,
              icon: const Icon(Icons.arrow_forward, size: 19),
            ),
          ),
        );
        final radius = DropdownButtonFormField<int>(
          key: const ValueKey<String>('bounded-radius-field'),
          initialValue: _selectedRadiusMiles,
          isExpanded: true,
          decoration: _inputDecoration(hint: 'Radius', icon: Icons.radar),
          items: <DropdownMenuItem<int>>[
            for (final miles in _supportedRadii)
              DropdownMenuItem<int>(value: miles, child: Text('$miles mi')),
          ],
          onChanged: (value) {
            if (value != null) unawaited(_selectRadius(value));
          },
        );

        return Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              SizedBox(
                height: narrow ? 92 : 106,
                child: Stack(
                  children: <Widget>[
                    Positioned.fill(
                      child: Row(
                        children: <Widget>[
                          Expanded(
                            child: FittedBox(
                              fit: BoxFit.scaleDown,
                              alignment: Alignment.centerLeft,
                              child: Text.rich(
                                const TextSpan(
                                  children: <TextSpan>[
                                    TextSpan(text: 'Eat well.\n'),
                                    TextSpan(
                                      text: 'Spend less.',
                                      style: TextStyle(
                                        color: BiteSaverColors.orangeDark,
                                      ),
                                    ),
                                  ],
                                ),
                                style: TextStyle(
                                  color: BiteSaverColors.ink,
                                  fontSize: narrow ? 27 : 32,
                                  height: 1.02,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                            ),
                          ),
                          SizedBox(
                            width: constraints.maxWidth * 0.44,
                            child: BiteSaverHomeHeroLogo(tight: narrow),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                key: const ValueKey<String>('bounded-search-panel'),
                padding: const EdgeInsets.all(7),
                decoration: BoxDecoration(
                  color: BiteSaverColors.surface,
                  borderRadius: BorderRadius.circular(15),
                  border: Border.all(color: BiteSaverColors.border),
                  boxShadow: const <BoxShadow>[
                    BoxShadow(
                      color: Color.fromRGBO(15, 23, 42, 0.085),
                      blurRadius: 18,
                      offset: Offset(0, 7),
                    ),
                  ],
                ),
                child: Column(
                  children: <Widget>[
                    if (narrow) ...<Widget>[
                      currentButton,
                      const SizedBox(height: 7),
                      locationField,
                    ] else
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Expanded(child: currentButton),
                          const SizedBox(width: 9),
                          Expanded(child: locationField),
                        ],
                      ),
                    const SizedBox(height: 7),
                    if (narrow) ...<Widget>[
                      contentField,
                      const SizedBox(height: 7),
                      radius,
                    ] else
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Expanded(child: contentField),
                          const SizedBox(width: 7),
                          SizedBox(width: 132, child: radius),
                        ],
                      ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(4, 8, 4, 0),
                child: Text(
                  _inputError ??
                      _locationMessage ??
                      '$_locationSummary • $_selectedRadiusMiles miles',
                  key: const ValueKey<String>('bounded-search-status'),
                  style: TextStyle(
                    color: _inputError == null
                        ? BiteSaverColors.secondaryText
                        : Theme.of(context).colorScheme.error,
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  InputDecoration _inputDecoration({
    required String hint,
    required IconData icon,
    Widget? suffix,
  }) {
    final border = OutlineInputBorder(
      borderRadius: BorderRadius.circular(11),
      borderSide: const BorderSide(color: BiteSaverColors.border),
    );
    return InputDecoration(
      filled: true,
      fillColor: BiteSaverColors.surface,
      hintText: hint,
      prefixIcon: Icon(icon, size: 20, color: BiteSaverColors.ink),
      suffixIcon: suffix,
      isDense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 9, vertical: 14),
      border: border,
      enabledBorder: border,
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(11),
        borderSide: const BorderSide(color: BiteSaverColors.orange, width: 1.3),
      ),
    );
  }

  Widget _buildBody(
    List<CustomerBiteSaverRestaurant> restaurants,
    CustomerLoadMoreController<CustomerBiteSaverRestaurant>? pager,
  ) {
    if (!_restored || _geocoding || _locating) {
      return _messageSliver(
        title: _restored ? 'Finding this location…' : 'Restoring your search…',
        progress: true,
      );
    }
    if (!_hasUsableCenter && restaurants.isEmpty) {
      return _messageSliver(
        title: 'Find great food near you 🍽️',
        detail:
            'Use your location or enter a city or ZIP code to see nearby deals.',
      );
    }

    final status = widget.coordinator.status;
    if ((status == CustomerBiteSaverCoordinatorStatus.starting ||
            status == CustomerBiteSaverCoordinatorStatus.preparing) &&
        restaurants.isEmpty) {
      final progress = widget.coordinator.progress;
      return _messageSliver(
        title: 'Preparing nearby deals…',
        detail: progress == null
            ? 'Starting your bounded search.'
            : '${progress.completedRanges} of ${progress.totalRanges} areas prepared',
        progress: true,
      );
    }

    if (status == CustomerBiteSaverCoordinatorStatus.ready && pager != null) {
      if (restaurants.isEmpty && pager.isLoading) {
        return _messageSliver(
          title: 'Loading nearby restaurants…',
          progress: true,
        );
      }
      if (restaurants.isEmpty && pager.error != null) {
        return _actionMessageSliver(
          title: 'Could not load nearby deals.',
          detail: 'Your search is ready, but the first page did not load.',
          actionLabel: 'Try Again',
          onPressed: pager.retry,
        );
      }
      if (restaurants.isEmpty && pager.partial && pager.hasNext) {
        return _actionMessageSliver(
          title: 'Search is still in progress.',
          detail: 'This page had no matches, but more results are available.',
          actionLabel: 'Continue Search',
          onPressed: pager.loadMore,
        );
      }
      if (restaurants.isEmpty && !pager.hasNext) {
        return _messageSliver(
          title: 'No nearby deals yet',
          detail: 'Try a larger radius, another location, or a broader search.',
        );
      }
    }

    if (restaurants.isEmpty) {
      return switch (status) {
        CustomerBiteSaverCoordinatorStatus.failed => _actionMessageSliver(
          title: 'This search could not be prepared.',
          detail: 'No restaurant page was shown.',
          actionLabel: widget.coordinator.failureRetriable
              ? 'Try Again'
              : 'Fresh Search',
          onPressed: widget.coordinator.failureRetriable
              ? _retryCoordinator
              : () => _startSearch(fresh: true),
        ),
        CustomerBiteSaverCoordinatorStatus.expired ||
        CustomerBiteSaverCoordinatorStatus.freshSearchRequired =>
          _actionMessageSliver(
            title: 'This search has expired.',
            detail: 'Start a fresh search to get current availability.',
            actionLabel: 'Fresh Search',
            onPressed: () => _startSearch(fresh: true),
          ),
        CustomerBiteSaverCoordinatorStatus.error => _actionMessageSliver(
          title: 'Could not continue this search.',
          detail: 'Please try again.',
          actionLabel: 'Try Again',
          onPressed: _retryCoordinator,
        ),
        _ => _messageSliver(title: 'Preparing nearby deals…', progress: true),
      };
    }

    final active = status == CustomerBiteSaverCoordinatorStatus.ready;
    final prefix = <Widget>[
      if (!active)
        _InlineStatusCard(
          title: status == CustomerBiteSaverCoordinatorStatus.failed
              ? 'This search stopped before completion.'
              : 'These retained results may be out of date.',
          actionLabel:
              status == CustomerBiteSaverCoordinatorStatus.failed &&
                  widget.coordinator.failureRetriable
              ? 'Try Again'
              : 'Fresh Search',
          onPressed:
              status == CustomerBiteSaverCoordinatorStatus.failed &&
                  widget.coordinator.failureRetriable
              ? _retryCoordinator
              : () => _startSearch(fresh: true),
        ),
      if (active && widget.coordinator.favoriteError != null)
        _InlineStatusCard(
          title: 'Some saved statuses could not be refreshed.',
          actionLabel: 'Retry Saved Status',
          onPressed: widget.coordinator.refreshFavoriteStates,
        ),
    ];
    final suffix = <Widget>[
      if (active && pager != null && pager.error != null)
        _InlineStatusCard(
          title: 'Could not append the next restaurant page.',
          actionLabel: 'Retry Page',
          onPressed: pager.retry,
        )
      else if (active && pager != null && pager.isLoading)
        const Padding(
          padding: EdgeInsets.all(18),
          child: Center(child: CircularProgressIndicator(strokeWidth: 2.3)),
        )
      else if (active && pager != null && pager.hasNext)
        Padding(
          padding: const EdgeInsets.fromLTRB(8, 10, 8, 4),
          child: FilledButton.icon(
            key: const ValueKey<String>('bounded-restaurant-load-more'),
            onPressed: pager.loadMore,
            icon: const Icon(Icons.expand_more),
            label: Text(pager.partial ? 'Continue Search' : 'Load More'),
          ),
        ),
    ];
    return SliverList.builder(
      itemCount: prefix.length + restaurants.length + suffix.length,
      itemBuilder: (context, index) {
        if (index < prefix.length) return prefix[index];
        final restaurantIndex = index - prefix.length;
        if (restaurantIndex >= restaurants.length) {
          return suffix[restaurantIndex - restaurants.length];
        }
        final restaurant = restaurants[restaurantIndex];
        final id = restaurant.restaurantId.value;
        return _BoundedRestaurantCard(
          key: ValueKey<String>('bounded-restaurant-$id'),
          restaurant: restaurant,
          restaurantIndex: restaurantIndex,
          coordinator: widget.coordinator,
          expanded: _expandedRestaurants.contains(id),
          interactive: active,
          pendingFavoriteIds: _pendingFavoriteIds,
          onToggleExpanded: () {
            setState(() {
              if (!_expandedRestaurants.add(id)) {
                _expandedRestaurants.remove(id);
              }
            });
          },
          onRestaurantFavorite: _toggleRestaurantFavorite,
          onOfferFavorite: _toggleOfferFavorite,
          onAction: _dispatch,
        );
      },
    );
  }

  Widget _messageSliver({
    required String title,
    String? detail,
    bool progress = false,
  }) => SliverToBoxAdapter(
    child: _MessageCard(title: title, detail: detail, progress: progress),
  );

  Widget _actionMessageSliver({
    required String title,
    required String detail,
    required String actionLabel,
    required Future<void> Function() onPressed,
  }) => SliverToBoxAdapter(
    child: _MessageCard(
      title: title,
      detail: detail,
      actionLabel: actionLabel,
      onPressed: onPressed,
    ),
  );
}

@immutable
final class _SubmittedBrowseSearch {
  const _SubmittedBrowseSearch({
    required this.latitude,
    required this.longitude,
    required this.radiusMiles,
    required this.locationMode,
    required this.typedLocation,
    required this.searchText,
  });

  final double latitude;
  final double longitude;
  final int radiusMiles;
  final CustomerBiteSaverLocationMode locationMode;
  final CustomerBiteSaverTypedLocation? typedLocation;
  final String searchText;

  CustomerBiteSaverSearchCriteria criteria(CustomerBiteSaverTimeContext time) =>
      CustomerBiteSaverSearchCriteria(
        latitude: latitude,
        longitude: longitude,
        radiusMiles: radiusMiles,
        locationMode: locationMode,
        typedLocation: typedLocation,
        searchText: searchText,
        timeZone: time.timeZone,
        utcOffsetMinutes: time.utcOffsetMinutes,
      );

  bool sameAs(_SubmittedBrowseSearch other) =>
      latitude == other.latitude &&
      longitude == other.longitude &&
      radiusMiles == other.radiusMiles &&
      locationMode == other.locationMode &&
      searchText == other.searchText &&
      _sameTypedLocation(typedLocation, other.typedLocation);

  static bool _sameTypedLocation(
    CustomerBiteSaverTypedLocation? left,
    CustomerBiteSaverTypedLocation? right,
  ) {
    if (left == null || right == null) return left == null && right == null;
    if (left is CustomerBiteSaverZipLocation &&
        right is CustomerBiteSaverZipLocation) {
      return left.zip == right.zip;
    }
    if (left is CustomerBiteSaverCityLocation &&
        right is CustomerBiteSaverCityLocation) {
      return left.city == right.city && left.state == right.state;
    }
    return false;
  }
}

final class _PendingBrowseSearchSetup {
  _PendingBrowseSearchSetup({
    required this.generation,
    required this.snapshot,
    required this.fresh,
    required this.coordinator,
    required this.authRealmKey,
  });

  final int generation;
  final _SubmittedBrowseSearch snapshot;
  final bool fresh;
  final CustomerBiteSaverSearchCoordinator coordinator;
  final String authRealmKey;
  late final Future<void> future;

  bool matches({
    required _SubmittedBrowseSearch snapshot,
    required bool fresh,
    required CustomerBiteSaverSearchCoordinator coordinator,
    required String authRealmKey,
  }) =>
      this.fresh == fresh &&
      identical(this.coordinator, coordinator) &&
      this.authRealmKey == authRealmKey &&
      this.snapshot.sameAs(snapshot);
}

class _BoundedRestaurantCard extends StatefulWidget {
  const _BoundedRestaurantCard({
    super.key,
    required this.restaurant,
    required this.restaurantIndex,
    required this.coordinator,
    required this.expanded,
    required this.interactive,
    required this.pendingFavoriteIds,
    required this.onToggleExpanded,
    required this.onRestaurantFavorite,
    required this.onOfferFavorite,
    required this.onAction,
  });

  final CustomerBiteSaverRestaurant restaurant;
  final int restaurantIndex;
  final CustomerBiteSaverSearchCoordinator coordinator;
  final bool expanded;
  final bool interactive;
  final Set<String> pendingFavoriteIds;
  final VoidCallback onToggleExpanded;
  final Future<void> Function(CustomerBiteSaverRestaurant restaurant)
  onRestaurantFavorite;
  final Future<void> Function(CustomerBiteSaverOffer offer) onOfferFavorite;
  final Future<void> Function(CustomerBiteSaverBrowseSelection selection)
  onAction;

  @override
  State<_BoundedRestaurantCard> createState() => _BoundedRestaurantCardState();
}

class _BoundedRestaurantCardState extends State<_BoundedRestaurantCard> {
  CustomerLoadMoreController<CustomerBiteSaverOffer>? _offerPager;
  Object? _localOfferError;
  bool _loadingOffers = false;

  @override
  void initState() {
    super.initState();
    widget.coordinator.addListener(_handleCoordinatorChange);
    _bindPager(
      widget.coordinator.offerPagerFor(widget.restaurant.restaurantId),
    );
    if (widget.expanded) unawaited(_ensureOffers());
  }

  @override
  void didUpdateWidget(covariant _BoundedRestaurantCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.coordinator, widget.coordinator)) {
      oldWidget.coordinator.removeListener(_handleCoordinatorChange);
      _bindPager(null);
      widget.coordinator.addListener(_handleCoordinatorChange);
    }
    if (widget.expanded && !oldWidget.expanded) unawaited(_ensureOffers());
  }

  @override
  void dispose() {
    widget.coordinator.removeListener(_handleCoordinatorChange);
    _bindPager(null);
    super.dispose();
  }

  void _handleCoordinatorChange() {
    _bindPager(
      widget.coordinator.offerPagerFor(widget.restaurant.restaurantId),
    );
    if (mounted) setState(() {});
  }

  void _bindPager(CustomerLoadMoreController<CustomerBiteSaverOffer>? pager) {
    if (identical(_offerPager, pager)) return;
    _offerPager?.removeListener(_handlePagerChange);
    _offerPager = pager;
    pager?.addListener(_handlePagerChange);
  }

  void _handlePagerChange() {
    if (mounted) setState(() {});
  }

  CustomerBiteSaverRestaurant? get _currentRestaurant => widget.coordinator
      .currentAcceptedRestaurantFor(widget.restaurant.restaurantId);

  Future<void> _openRestaurant(CustomerBiteSaverBrowseAction action) async {
    final restaurant = _currentRestaurant;
    if (!widget.interactive || restaurant == null) return;
    final selection = switch (action) {
      CustomerBiteSaverBrowseAction.restaurantProfile =>
        CustomerBiteSaverBrowseSelection.restaurantProfile(
          restaurant: restaurant,
          session: widget.coordinator,
        ),
      CustomerBiteSaverBrowseAction.menu =>
        CustomerBiteSaverBrowseSelection.menu(
          restaurant: restaurant,
          session: widget.coordinator,
        ),
      CustomerBiteSaverBrowseAction.offer => throw StateError(
        'Offer actions require an accepted offer snapshot.',
      ),
    };
    await widget.onAction(selection);
  }

  Future<void> _openOffer(CustomerBiteSaverOffer displayedOffer) async {
    if (!widget.interactive) return;
    final current = widget.coordinator.currentAcceptedOfferSelectionFor(
      widget.restaurant.restaurantId,
      displayedOffer.offerId,
    );
    if (current == null) return;
    await widget.onAction(
      CustomerBiteSaverBrowseSelection.offer(
        restaurant: current.restaurant,
        offer: current.offer,
        session: widget.coordinator,
      ),
    );
  }

  Future<void> _ensureOffers() async {
    final restaurant = _currentRestaurant;
    if (!widget.interactive || restaurant == null || _loadingOffers) return;
    final existing = widget.coordinator.offerPagerFor(restaurant.restaurantId);
    if (existing != null &&
        !widget.coordinator.offerPageRequiresRestart(restaurant.restaurantId)) {
      _bindPager(existing);
      return;
    }
    setState(() {
      _loadingOffers = true;
      _localOfferError = null;
    });
    try {
      final pager = await widget.coordinator.loadOffers(
        restaurant.restaurantId,
      );
      if (!mounted) return;
      _bindPager(pager);
    } catch (error) {
      if (mounted) _localOfferError = error;
    } finally {
      if (mounted) setState(() => _loadingOffers = false);
    }
  }

  List<CustomerBiteSaverOffer> get _visibleOffers {
    final ordered = <CustomerBiteSaverOffer>[];
    final indexes = <String, int>{};
    void accept(CustomerBiteSaverOffer offer) {
      final existing = indexes[offer.offerId.value];
      if (existing == null) {
        indexes[offer.offerId.value] = ordered.length;
        ordered.add(offer);
      } else {
        ordered[existing] = offer;
      }
    }

    final currentRestaurant = _currentRestaurant;
    final previews = widget.interactive
        ? currentRestaurant?.offers ?? const <CustomerBiteSaverOffer>[]
        : widget.restaurant.offers;
    for (final offer in previews) {
      accept(offer);
    }
    if (!widget.interactive || currentRestaurant != null) {
      for (final offer
          in _offerPager?.items ?? const <CustomerBiteSaverOffer>[]) {
        accept(offer);
      }
    }
    return ordered;
  }

  @override
  Widget build(BuildContext context) {
    final currentRestaurant = _currentRestaurant;
    final restaurant = currentRestaurant ?? widget.restaurant;
    final interactive = widget.interactive && currentRestaurant != null;
    final preview = interactive ? restaurant.offers : widget.restaurant.offers;
    final restaurantFavorite = widget.coordinator.restaurantFavoriteState(
      restaurant.restaurantId,
    );
    final canExpand = restaurant.hasMoreOffers || _offerPager != null;
    return Padding(
      padding: const EdgeInsets.only(bottom: 7),
      child: Material(
        color: Colors.transparent,
        child: Ink(
          decoration: BoxDecoration(
            color: BiteSaverColors.surface,
            borderRadius: BorderRadius.circular(15),
            border: Border.all(color: BiteSaverColors.border, width: 0.7),
            boxShadow: const <BoxShadow>[
              BoxShadow(
                color: Color.fromRGBO(15, 23, 42, 0.065),
                blurRadius: 13,
                offset: Offset(0, 6),
              ),
            ],
          ),
          child: Padding(
            padding: const EdgeInsets.all(7),
            child: Column(
              children: <Widget>[
                InkWell(
                  onTap: interactive
                      ? () => _openRestaurant(
                          CustomerBiteSaverBrowseAction.restaurantProfile,
                        )
                      : null,
                  borderRadius: BorderRadius.circular(12),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      ClipRRect(
                        borderRadius: BorderRadius.circular(12),
                        child: SizedBox.square(
                          dimension: 92,
                          child: BiteSaverRestaurantCardImage(
                            imageUrl: restaurant.imageUrl,
                            fallbackImagePath:
                                BiteSaverRestaurantPlaceholderImages.assetForPlaceholderOnlyIndex(
                                  widget.restaurantIndex,
                                ),
                            semanticLabel:
                                '${restaurant.displayName} restaurant image',
                          ),
                        ),
                      ),
                      const SizedBox(width: 9),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Row(
                              children: <Widget>[
                                Expanded(
                                  child: Text(
                                    restaurant.displayName,
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      color: BiteSaverColors.ink,
                                      fontSize: 17.2,
                                      fontWeight: FontWeight.w800,
                                      height: 1.08,
                                    ),
                                  ),
                                ),
                                if (widget.coordinator.auth.isSigned)
                                  _FavoriteButton(
                                    state: restaurantFavorite,
                                    pending: widget.pendingFavoriteIds.contains(
                                      restaurant.restaurantId.value,
                                    ),
                                    itemLabel: 'restaurant',
                                    onPressed: interactive
                                        ? () => widget.onRestaurantFavorite(
                                            restaurant,
                                          )
                                        : null,
                                  ),
                                const Icon(
                                  Icons.chevron_right,
                                  color: Color(0xFFE24A17),
                                  size: 20,
                                ),
                              ],
                            ),
                            const SizedBox(height: 4),
                            Text(
                              '${restaurant.distanceMiles.toStringAsFixed(1)} mi • ${restaurant.city}',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: BiteSaverColors.secondaryText,
                                fontSize: 12.7,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            if (restaurant.formattedAddress?.isNotEmpty == true)
                              Padding(
                                padding: const EdgeInsets.only(top: 3),
                                child: Text(
                                  restaurant.formattedAddress!,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    color: BiteSaverColors.mutedText,
                                    fontSize: 11.5,
                                  ),
                                ),
                              ),
                            if (restaurant.catalogBindingAvailable)
                              Align(
                                alignment: Alignment.centerLeft,
                                child: TextButton.icon(
                                  onPressed: interactive
                                      ? () => _openRestaurant(
                                          CustomerBiteSaverBrowseAction.menu,
                                        )
                                      : null,
                                  icon: const Icon(
                                    Icons.restaurant_menu,
                                    size: 15,
                                  ),
                                  label: const Text('View Menu'),
                                  style: TextButton.styleFrom(
                                    visualDensity: VisualDensity.compact,
                                    padding: EdgeInsets.zero,
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                if (!widget.expanded)
                  for (final offer in preview.take(2))
                    Padding(
                      padding: const EdgeInsets.only(top: 5),
                      child: _OfferRow(
                        offer: offer,
                        availability: interactive
                            ? widget.coordinator.effectiveOfferAvailability(
                                offer.offerId,
                              )
                            : null,
                        favoriteState: widget.coordinator.offerFavoriteState(
                          offer.offerId,
                        ),
                        showFavorite: widget.coordinator.auth.isSigned,
                        favoritePending: widget.pendingFavoriteIds.contains(
                          offer.offerId.value,
                        ),
                        interactive: interactive,
                        onFavorite: () => widget.onOfferFavorite(offer),
                        onTap: () => _openOffer(offer),
                      ),
                    ),
                if (widget.expanded) _buildExpandedOffers(),
                if (canExpand)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      key: ValueKey<String>(
                        'bounded-offer-expand-${restaurant.restaurantId.value}',
                      ),
                      onPressed: interactive
                          ? () {
                              widget.onToggleExpanded();
                              if (!widget.expanded) unawaited(_ensureOffers());
                            }
                          : null,
                      icon: Icon(
                        widget.expanded ? Icons.expand_less : Icons.expand_more,
                      ),
                      label: Text(
                        widget.expanded ? 'Show fewer deals' : 'More deals',
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildExpandedOffers() {
    final offers = _visibleOffers;
    final currentRestaurant = _currentRestaurant;
    final interactive = widget.interactive && currentRestaurant != null;
    final pager = _offerPager;
    final error = _localOfferError ?? pager?.error;
    if ((_loadingOffers || pager?.isLoading == true) && offers.isEmpty) {
      return const Padding(
        padding: EdgeInsets.all(14),
        child: CircularProgressIndicator(strokeWidth: 2.2),
      );
    }
    if (error != null && offers.isEmpty) {
      return _InlineStatusCard(
        title: 'Could not load this restaurant’s deals.',
        actionLabel: 'Retry Deals',
        onPressed: pager?.retry ?? _ensureOffers,
      );
    }
    final listHeight = (offers.length * 58.0).clamp(58.0, 280.0);
    return Column(
      children: <Widget>[
        if (offers.isNotEmpty)
          SizedBox(
            height: listHeight,
            child: Scrollbar(
              child: ListView.builder(
                key: PageStorageKey<String>(
                  'bounded-offers-${widget.restaurant.restaurantId.value}',
                ),
                primary: false,
                padding: const EdgeInsets.only(top: 5),
                itemCount: offers.length,
                itemBuilder: (context, index) {
                  final offer = offers[index];
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 5),
                    child: _OfferRow(
                      offer: offer,
                      availability: interactive
                          ? widget.coordinator.effectiveOfferAvailability(
                              offer.offerId,
                            )
                          : null,
                      favoriteState: widget.coordinator.offerFavoriteState(
                        offer.offerId,
                      ),
                      showFavorite: widget.coordinator.auth.isSigned,
                      favoritePending: widget.pendingFavoriteIds.contains(
                        offer.offerId.value,
                      ),
                      interactive: interactive,
                      onFavorite: () => widget.onOfferFavorite(offer),
                      onTap: () => _openOffer(offer),
                    ),
                  );
                },
              ),
            ),
          ),
        if (error != null)
          _InlineStatusCard(
            title: 'Could not append more deals for this restaurant.',
            actionLabel: 'Retry Deals',
            onPressed: pager?.retry ?? _ensureOffers,
          )
        else if (pager?.isLoading == true)
          const Padding(
            padding: EdgeInsets.all(10),
            child: CircularProgressIndicator(strokeWidth: 2.1),
          )
        else if (pager?.hasNext == true)
          TextButton.icon(
            key: ValueKey<String>(
              'bounded-offer-load-more-${widget.restaurant.restaurantId.value}',
            ),
            onPressed: interactive ? pager!.loadMore : null,
            icon: const Icon(Icons.expand_more),
            label: Text(pager!.partial ? 'Continue Deals' : 'Load More Deals'),
          ),
      ],
    );
  }
}

class _OfferRow extends StatelessWidget {
  const _OfferRow({
    required this.offer,
    required this.availability,
    required this.favoriteState,
    required this.showFavorite,
    required this.favoritePending,
    required this.interactive,
    required this.onFavorite,
    required this.onTap,
  });

  final CustomerBiteSaverOffer offer;
  final CustomerBiteSaverEffectiveOfferAvailability? availability;
  final CustomerBiteSaverFavoriteState favoriteState;
  final bool showFavorite;
  final bool favoritePending;
  final bool interactive;
  final VoidCallback onFavorite;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final isSpecial =
        offer.offerType == CustomerBiteSaverOfferType.dailySpecial;
    final effective = availability;
    final available = effective?.available == true;
    final availabilityLabel = effective == null
        ? 'Fresh search required'
        : available
        ? 'Available'
        : offer.availabilityReason.isEmpty
        ? 'Availability unavailable'
        : offer.availabilityReason;
    return BiteSaverHomeDealBubble(
      key: ValueKey<String>('bounded-offer-${offer.offerId.value}'),
      onTap: interactive ? onTap : null,
      backgroundColor: isSpecial
          ? BiteSaverColors.secondaryBackground
          : const Color(0xFFF8FCF2),
      borderColor: isSpecial
          ? BiteSaverColors.borderStrong
          : const Color(0xFFB9D99E),
      child: Row(
        children: <Widget>[
          Icon(
            isSpecial
                ? Icons.local_fire_department_outlined
                : Icons.local_offer,
            color: isSpecial
                ? const Color(0xFFC95F17)
                : const Color(0xFF5F8F25),
            size: 17,
          ),
          const SizedBox(width: 6),
          Expanded(
            child: LayoutBuilder(
              builder: (context, constraints) {
                return FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: SizedBox(
                    width: constraints.maxWidth,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          offer.title.isEmpty
                              ? 'Limited time deal'
                              : offer.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: isSpecial
                                ? const Color(0xFFC95F17)
                                : const Color(0xFF4E7B20),
                            fontSize: 13.8,
                            fontWeight: FontWeight.w900,
                            height: 1.05,
                          ),
                        ),
                        Text(
                          availabilityLabel,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: available
                                ? BiteSaverColors.greenDark
                                : BiteSaverColors.secondaryText,
                            fontSize: 10.8,
                            height: 1,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
          if (showFavorite &&
              offer.offerType == CustomerBiteSaverOfferType.coupon)
            _FavoriteButton(
              state: favoriteState,
              pending: favoritePending,
              itemLabel: 'deal',
              onPressed: interactive ? onFavorite : null,
            ),
          const Icon(Icons.chevron_right, size: 18),
        ],
      ),
    );
  }
}

class _FavoriteButton extends StatelessWidget {
  const _FavoriteButton({
    required this.state,
    required this.pending,
    required this.itemLabel,
    required this.onPressed,
  });

  final CustomerBiteSaverFavoriteState state;
  final bool pending;
  final String itemLabel;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    if (pending) {
      return const SizedBox.square(
        dimension: 32,
        child: Padding(
          padding: EdgeInsets.all(8),
          child: CircularProgressIndicator(strokeWidth: 2),
        ),
      );
    }
    final known = state != CustomerBiteSaverFavoriteState.unknown;
    final favorite = state == CustomerBiteSaverFavoriteState.favorite;
    return IconButton(
      visualDensity: VisualDensity.compact,
      tooltip: known
          ? '${favorite ? 'Unsave' : 'Save'} $itemLabel'
          : 'Saved status unavailable',
      onPressed: known ? onPressed : null,
      icon: Icon(
        known
            ? favorite
                  ? Icons.favorite
                  : Icons.favorite_border
            : Icons.help_outline,
        color: favorite ? Colors.red.shade400 : BiteSaverColors.mutedText,
        size: 19,
      ),
    );
  }
}

class _MessageCard extends StatelessWidget {
  const _MessageCard({
    required this.title,
    this.detail,
    this.progress = false,
    this.actionLabel,
    this.onPressed,
  });

  final String title;
  final String? detail;
  final bool progress;
  final String? actionLabel;
  final Future<void> Function()? onPressed;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(22),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            if (progress) ...<Widget>[
              const CircularProgressIndicator(strokeWidth: 2.3),
              const SizedBox(height: 14),
            ],
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
            ),
            if (detail != null) ...<Widget>[
              const SizedBox(height: 8),
              Text(
                detail!,
                textAlign: TextAlign.center,
                style: const TextStyle(color: BiteSaverColors.secondaryText),
              ),
            ],
            if (actionLabel != null && onPressed != null) ...<Widget>[
              const SizedBox(height: 14),
              FilledButton(
                onPressed: () => unawaited(onPressed!()),
                child: Text(actionLabel!),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _InlineStatusCard extends StatelessWidget {
  const _InlineStatusCard({
    required this.title,
    required this.actionLabel,
    required this.onPressed,
  });

  final String title;
  final String actionLabel;
  final Future<void> Function() onPressed;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: const Color(0xFFFFFBF2),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: Row(
          children: <Widget>[
            Expanded(
              child: Text(
                title,
                style: const TextStyle(
                  color: BiteSaverColors.secondaryText,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            TextButton(
              onPressed: () => unawaited(onPressed()),
              child: Text(actionLabel),
            ),
          ],
        ),
      ),
    );
  }
}
