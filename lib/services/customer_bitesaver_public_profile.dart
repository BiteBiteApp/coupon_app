import 'package:flutter/foundation.dart';

import '../models/customer_bitesaver_search.dart';
import 'customer_bitesaver_search_coordinator.dart';
import 'customer_bitesaver_service.dart';

/// Route-owned public presentation. It holds no search session or use access.
final class CustomerBiteSaverPublicProfile extends ChangeNotifier {
  CustomerBiteSaverPublicProfile(
    this.api,
    this.initial,
    this.timeContextProvider,
    this.loadPage,
    this.presentationFor,
    this.nowMillis,
    this.presentationChanges,
    this.onDispose,
  ) {
    presentationChanges.addListener(_presentationChanged);
    restaurant = initial.restaurant;
    offers.addAll(restaurant?.offers ?? const []);
    cursor = initial.nextCursor;
  }
  final Future<({String timeZone, int utcOffsetMinutes})> Function()
  timeContextProvider;
  final Future<CustomerBiteSaverPublicProfileResult> Function(String? cursor)
  loadPage;
  final CustomerBiteSaverRedemptionPresentation? Function(
    CustomerBiteSaverOffer offer,
  )
  presentationFor;
  final int Function() nowMillis;
  final Listenable presentationChanges;
  void _presentationChanged() {
    if (!_disposed) notifyListeners();
  }

  final VoidCallback onDispose;
  final Map<String, String?> _offerPages = {};
  CustomerBiteSaverOffer? _viewedOffer;
  void viewOffer(CustomerBiteSaverOffer? offer) => _viewedOffer = offer;

  /// Public content survives sign-in; only the new account's own state is read.
  /// At most the first page and the currently open coupon's page are refreshed.
  Future<void> refreshFavoriteStates() async {
    final pages = <String?>{null};
    final offer = _viewedOffer;
    if (offer != null) pages.add(_offerPages[offer.offerId.value]);
    for (final page in pages) {
      if (_disposed) return;
      try {
        await loadPage(page);
      } catch (_) {
        return;
      }
    }
  }

  final CustomerBiteSaverService api;
  final CustomerBiteSaverPublicProfileResult initial;
  CustomerBiteSaverRestaurant? restaurant;
  final List<CustomerBiteSaverOffer> offers = [];
  String? cursor;
  bool loading = false;
  bool _disposed = false;
  Object? error;
  String get catalogRestaurantId => initial.catalogRestaurantId;

  bool contains(CustomerBiteSaverOffer offer) =>
      !_disposed && restaurant != null && offers.contains(offer);

  Future<void> loadMore() async {
    final next = cursor;
    if (_disposed || loading || next == null) return;
    loading = true;
    error = null;
    notifyListeners();
    try {
      final page = await loadPage(next);
      if (_disposed) return;
      if (page.restaurant?.restaurantId != restaurant?.restaurantId ||
          page.restaurant == null ||
          page.nextCursor == next) {
        throw const CustomerBiteSaverProtocolException();
      }
      final ids = offers.map((offer) => offer.offerId).toSet();
      for (final offer in page.restaurant!.offers) {
        if (ids.add(offer.offerId)) {
          offers.add(offer);
          _offerPages[offer.offerId.value] = next;
        }
      }
      restaurant = page.restaurant;
      cursor = page.nextCursor;
    } catch (failure) {
      if (!_disposed) error = failure;
    } finally {
      if (!_disposed) {
        loading = false;
        notifyListeners();
      }
    }
  }

  Future<CustomerBiteSaverMenuPageResult> menu(String? cursor) async {
    final current = restaurant;
    if (_disposed || current == null) {
      throw const CustomerBiteSaverProtocolException();
    }
    return api.getPublicProfileMenu(
      catalogRestaurantId,
      current.restaurantId,
      timeContext: await timeContextProvider(),
      cursor: cursor,
    );
  }

  @override
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    onDispose();
    presentationChanges.removeListener(_presentationChanged);
    super.dispose();
  }
}
