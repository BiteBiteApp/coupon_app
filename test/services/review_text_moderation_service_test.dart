import 'dart:async';
import 'package:coupon_app/models/dish_review.dart';
import 'package:coupon_app/services/bitescore_service.dart';
import 'package:coupon_app/services/review_text_moderation_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('source flags stay off', () => expect(ReviewTextModerationService.enabled, false));
  test('late private response is discarded after account switch', () async {
    var uid = 'A'; final pending = Completer<Object?>();
    final service = ReviewTextModerationService(currentUserId: () => uid, transport: (_, data) {expect(data['expectedUserId'], 'A'); return pending.future;});
    final result = service.request('getOwnBiteScoreReviewText', 'A', {'reviewId': 'review'});
    uid = 'B'; pending.complete({'schemaVersion': 1, 'proposal': {'notes': 'PRIVATE'}});
    await expectLater(result, throwsStateError);
    await expectLater(service.request('listBiteScoreReviewText', 'A', {}), throwsStateError);
  });
  for (final status in ['published', 'pending', 'screening_failed', 'rejected', 'screening', 'expired', 'superseded']) {
    test('trusted save reports $status separately from public words and ratings', () async {
      final review = await BiteScoreService.saveReviewWithTrustedAggregate(dishId: 'dish', restaurantId: 'restaurant', userId: 'A', headline: 'PROPOSED', notes: 'PRIVATE', overallImpression: 8, tastinessScore: 8, qualityScore: 8, valueScore: 8,
        transport: (_, data) async => {'schemaVersion': 1, 'textStatus': status, 'review': {'id': 'review', 'dishId': 'dish', 'restaurantId': 'restaurant', 'userId': 'A', 'headline': 'Approved', 'notes': 'Public', 'overallImpression': 8, 'overallBiteScore': 80, 'createdAtMillis': 1000, 'updatedAtMillis': 2000}});
      expect(review.textStatus, status); expect(review.notes, 'Public');expect(review.overallBiteScore, 80);
      expect(review.hasUnpublishedText, status != 'published');expect(review.textStatusMessage, isNotNull);expect(review.toFirestoreMap().containsKey('textStatus'), false);
    });
  }
  test('historical review has unchanged neutral save outcome', () {
    const r = DishReview(id:'r',dishId:'d',restaurantId:'x',userId:'u',overallImpression:8,overallBiteScore:80);
    expect(r.textStatusMessage, isNull);expect(r.hasUnpublishedText, false);
  });
}
