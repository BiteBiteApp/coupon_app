import 'package:coupon_app/services/subscription_return_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    SubscriptionReturnService.resetForTesting();
  });

  test(
    'stores Restaurant Hub as the intended subscription return context',
    () async {
      await SubscriptionReturnService.markRestaurantHubCheckoutStarted();

      expect(
        await SubscriptionReturnService.pendingReturnContext(),
        SubscriptionReturnService.restaurantHubContext,
      );
    },
  );

  test(
    'dispatching a successful return emits an event and clears context',
    () async {
      await SubscriptionReturnService.markRestaurantHubCheckoutStarted();

      await SubscriptionReturnService.dispatchReturn(
        SubscriptionCheckoutReturnStatus.success,
      );

      final event = SubscriptionReturnService.latestReturn.value;
      expect(event, isNotNull);
      expect(event!.status, SubscriptionCheckoutReturnStatus.success);
      expect(await SubscriptionReturnService.pendingReturnContext(), isNull);
    },
  );

  test('dispatching a canceled return emits a cancel event', () async {
    await SubscriptionReturnService.dispatchReturn(
      SubscriptionCheckoutReturnStatus.cancel,
    );

    expect(
      SubscriptionReturnService.latestReturn.value?.status,
      SubscriptionCheckoutReturnStatus.cancel,
    );
  });

  test('tracks whether a Restaurant Hub is already active', () {
    expect(SubscriptionReturnService.hasActiveRestaurantHub, isFalse);

    SubscriptionReturnService.registerRestaurantHub();
    expect(SubscriptionReturnService.hasActiveRestaurantHub, isTrue);

    SubscriptionReturnService.unregisterRestaurantHub();
    expect(SubscriptionReturnService.hasActiveRestaurantHub, isFalse);
  });

  test(
    'active Restaurant Hub tracking is safe if unregister is called extra',
    () {
      SubscriptionReturnService.unregisterRestaurantHub();

      expect(SubscriptionReturnService.hasActiveRestaurantHub, isFalse);
    },
  );
}
