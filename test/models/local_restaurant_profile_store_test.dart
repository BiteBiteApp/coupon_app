import 'package:coupon_app/models/local_restaurant_profile_store.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('empty local restaurant profile does not prefill a fake name', () {
    expect(LocalRestaurantProfileStore.emptyProfile.name, isEmpty);
  });
}
