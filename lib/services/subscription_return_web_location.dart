import 'subscription_return_web_location_stub.dart'
    if (dart.library.js_interop) 'subscription_return_web_location_web.dart'
    as platform;

String? captureInitialSubscriptionReturnWebLocation() {
  return platform.captureInitialSubscriptionReturnWebLocation();
}

Stream<String> get subscriptionReturnWebLocationChanges =>
    platform.subscriptionReturnWebLocationChanges;

Future<void> disposeSubscriptionReturnWebLocationSource() {
  return platform.disposeSubscriptionReturnWebLocationSource();
}
