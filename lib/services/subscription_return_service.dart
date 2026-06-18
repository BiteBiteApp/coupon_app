import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

enum SubscriptionCheckoutReturnStatus { success, cancel }

class SubscriptionCheckoutReturnEvent {
  final int id;
  final SubscriptionCheckoutReturnStatus status;

  const SubscriptionCheckoutReturnEvent({
    required this.id,
    required this.status,
  });
}

class SubscriptionReturnService {
  static const String restaurantHubContext = 'restaurant_hub';
  static const String _pendingReturnContextKey =
      'pending_subscription_return_context';

  static final ValueNotifier<SubscriptionCheckoutReturnEvent?> latestReturn =
      ValueNotifier<SubscriptionCheckoutReturnEvent?>(null);

  static int _nextEventId = 0;
  static int _activeRestaurantHubCount = 0;

  static bool get hasActiveRestaurantHub => _activeRestaurantHubCount > 0;

  static void registerRestaurantHub() {
    _activeRestaurantHubCount += 1;
  }

  static void unregisterRestaurantHub() {
    if (_activeRestaurantHubCount == 0) {
      return;
    }
    _activeRestaurantHubCount -= 1;
  }

  static Future<void> markRestaurantHubCheckoutStarted() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_pendingReturnContextKey, restaurantHubContext);
  }

  static Future<String?> pendingReturnContext() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_pendingReturnContextKey);
  }

  static Future<void> clearPendingReturnContext() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_pendingReturnContextKey);
  }

  static Future<void> dispatchReturn(
    SubscriptionCheckoutReturnStatus status,
  ) async {
    latestReturn.value = SubscriptionCheckoutReturnEvent(
      id: _nextEventId++,
      status: status,
    );
    await clearPendingReturnContext();
  }

  @visibleForTesting
  static void resetForTesting() {
    _nextEventId = 0;
    _activeRestaurantHubCount = 0;
    latestReturn.value = null;
  }
}
