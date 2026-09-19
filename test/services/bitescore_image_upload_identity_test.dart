import 'package:coupon_app/services/bitescore_image_upload_service.dart';
import 'package:coupon_app/services/customer_bitescore_runtime.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  tearDown(() => CustomerBiteScoreRuntime.testEnabled = null);

  test(
    'enabled uploads preserve exact valid dish IDs in the existing layout',
    () {
      CustomerBiteScoreRuntime.testEnabled = true;
      for (final id in [
        'dish',
        'dish one',
        'crème brûlée',
        '寿司🍣',
        'dish_1-2',
      ]) {
        expect(
          BiteScoreImageUploadService.dishImageStoragePath(
            dishId: id,
            timestamp: 123,
          ),
          'bitescore_dishes/$id/images/123.jpg',
        );
      }
    },
  );

  test(
    'enabled uploads reject invalid identities instead of aliasing them',
    () {
      CustomerBiteScoreRuntime.testEnabled = true;
      for (final id in ['', ' dish', 'dish ', 'a/b', '.', '..', 'a\u200bb']) {
        expect(
          () => BiteScoreImageUploadService.dishImageStoragePath(
            dishId: id,
            timestamp: 123,
          ),
          throwsArgumentError,
        );
      }
    },
  );

  test('default upload path retains existing legacy normalization', () {
    CustomerBiteScoreRuntime.testEnabled = false;
    expect(
      BiteScoreImageUploadService.dishImageStoragePath(
        dishId: ' dish one ',
        timestamp: 123,
      ),
      'bitescore_dishes/dish_one/images/123.jpg',
    );
    expect(
      BiteScoreImageUploadService.dishImageStoragePath(
        dishId: '',
        timestamp: 123,
      ),
      'bitescore_dishes/image/images/123.jpg',
    );
  });
}
