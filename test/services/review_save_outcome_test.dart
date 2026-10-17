import 'dart:async';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:coupon_app/services/bitescore_service.dart';
import 'package:coupon_app/services/contribution_points_service.dart';
import 'package:coupon_app/services/app_error_text.dart';
import 'package:flutter_test/flutter_test.dart';
import 'bitescore_trusted_review_test.dart' show reviewData;

void main() {
  test(
    'legacy confirmed write versus unknown write is classified without a second write',
    () async {
      var calls = 0;
      await BiteScoreService.confirmReviewWrite(() async {
        calls++;
      });
      expect(calls, 1);
      await expectLater(
        BiteScoreService.confirmReviewWrite(() async {
          calls++;
          throw StateError('lost acknowledgement');
        }),
        throwsA(isA<BiteScoreReviewSaveUnconfirmed>()),
      );
      expect(calls, 2);
    },
  );

  Future<dynamic> save(
    Future<Object?> Function(String, Map<String, Object?>) transport,
  ) => BiteScoreService.saveReviewWithTrustedAggregate(
    dishId: 'dish-1',
    restaurantId: 'restaurant-1',
    userId: 'user-1',
    headline: 'Good',
    notes: 'Damn good burger',
    overallImpression: 8,
    tastinessScore: 7,
    qualityScore: 9,
    valueScore: 6,
    transport: transport,
  );

  test(
    'confirmed review survives milestone or created-dish award exceptions without retrying the write',
    () async {
      for (final awardKind in ['milestone', 'created-dish']) {
        var writes = 0, awards = 0;
        final review = await save((_, _) async {
          writes++;
          return {
            'schemaVersion': 1,
            'review': reviewData(),
            'textStatus': 'pending',
          };
        });
        final followUp = await BiteScoreService.confirmSavedReviewPoints(
          requireSameAccount: () {},
          award: () async {
            awards++;
            throw StateError(awardKind);
          },
        );
        expect(review.id, 'review-1');
        expect(review.textStatus, 'pending');
        expect(followUp.unconfirmed, true);
        expect(followUp.award.newlyAwardedPoints, 0);
        expect(writes, 1);
        expect(awards, 1);
      }
    },
  );
  test('successful award retains the authoritative receipt', () async {
    const award = ContributionPointAwardResult(
      entries: [
        ContributionPointAwardEntryResult(
          ledgerEntryId: 'exact-receipt',
          points: 1,
          wasCreated: true,
        ),
      ],
    );
    final result = await BiteScoreService.confirmSavedReviewPoints(
      requireSameAccount: () {},
      award: () async => award,
    );
    expect(result.unconfirmed, false);
    expect(identical(result.award, award), true);
  });
  test(
    'known rejected write remains a failure and never reaches optional award',
    () async {
      var awards = 0;
      await expectLater(() async {
        await save(
          (_, _) async => throw FirebaseFunctionsException(
            code: 'permission-denied',
            message: 'Review rejected',
          ),
        );
        await BiteScoreService.confirmSavedReviewPoints(
          requireSameAccount: () {},
          award: () async {
            awards++;
            return const ContributionPointAwardResult();
          },
        );
      }(), throwsA(isA<FirebaseFunctionsException>()));
      expect(awards, 0);
    },
  );
  for (final outcome in [
    'lost-response',
    'invalid-response',
    'bad-map',
    'bad-timestamp',
  ]) {
    test(
      '$outcome is explicitly unconfirmed, never asserted saved or automatically rewritten',
      () async {
        var writes = 0;
        await expectLater(
          save((_, _) async {
            writes++;
            if (outcome == 'lost-response') {
              throw FirebaseFunctionsException(
                code: 'unavailable',
                message: 'lost response',
              );
            }
            return {
              'schemaVersion': 1,
              'review': outcome == 'bad-map'
                  ? {1: 'invalid'}
                  : outcome == 'bad-timestamp'
                  ? reviewData({'createdAtMillis': 1e100})
                  : {},
            };
          }),
          throwsA(isA<BiteScoreReviewSaveUnconfirmed>()),
        );
        expect(writes, 1);
        expect(
          AppErrorText.friendly(
            BiteScoreReviewSaveUnconfirmed(),
            fallback: 'Could not save',
          ),
          contains('Check your reviews before trying again'),
        );
      },
    );
  }
  for (final fails in [false, true]) {
    test(
      'account switch after award ${fails ? 'failure' : 'success'} suppresses previous-user result',
      () async {
        var uid = 'A';
        final pending = Completer<ContributionPointAwardResult>();
        final result = BiteScoreService.confirmSavedReviewPoints(
          requireSameAccount: () {
            if (uid != 'A') throw StateError('account changed');
          },
          award: () => pending.future,
        );
        final check = expectLater(result, throwsStateError);
        uid = 'B';
        if (fails) {
          pending.completeError(StateError('lost response'));
        } else {
          pending.complete(const ContributionPointAwardResult());
        }
        await check;
      },
    );
  }
}
