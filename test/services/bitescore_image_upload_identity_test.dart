import 'package:coupon_app/services/bitescore_image_upload_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('owner key has the same fixed UTF-8 hash contract as Rules and server', () {
    expect(BiteScoreImageUploadService.dishImageOwnerKey('A'), '6d584dd4bedf3a4ac2abe72764b29b76d44b77683b205e1752e163eba5045ee7');
  });
  test('uploader namespace preserves exact Unicode dish identities', () {
    for (final id in ['dish', 'dish one', 'crème brûlée', '寿司🍣', 'dish_1-2']) {
      expect(
        BiteScoreImageUploadService.dishImageStoragePath(
          dishId: id,
          expectedUid: 'A',
          timestamp: 123,
        ),
        'bitescore_user_uploads/${BiteScoreImageUploadService.dishImageOwnerKey('A')}/dish_images/$id/123.jpg',
      );
    }
  });
  test(
    'invalid dish or uploader identity is never normalized into another owner',
    () {
      for (final id in ['', ' dish', 'dish ', 'a/b', '.', '..', 'a\u200bb']) {
        expect(
          () => BiteScoreImageUploadService.dishImageStoragePath(
            dishId: id,
            expectedUid: 'A',
            timestamp: 123,
          ),
          throwsArgumentError,
        );
        expect(
          () => BiteScoreImageUploadService.dishImageStoragePath(
            dishId: 'dish',
            expectedUid: id,
            timestamp: 123,
          ),
          throwsArgumentError,
        );
      }
    },
  );
}
