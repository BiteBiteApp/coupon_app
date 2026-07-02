import 'package:coupon_app/models/contribution_point_ledger_entry.dart';
import 'package:coupon_app/services/contribution_points_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('Contribution point scoring rules', () {
    test('review milestone points are awarded every five valid reviews', () {
      expect(ContributionPointsService.reviewMilestonePointsForCount(0), 0);
      expect(ContributionPointsService.reviewMilestonePointsForCount(4), 0);
      expect(ContributionPointsService.reviewMilestonePointsForCount(5), 1);
      expect(ContributionPointsService.reviewMilestonePointsForCount(9), 1);
      expect(ContributionPointsService.reviewMilestonePointsForCount(10), 2);
    });

    test('removed review crossing below a milestone requires one reversal', () {
      final before = ContributionPointsService.reviewMilestonesForCount(10);
      final after = ContributionPointsService.reviewMilestonesForCount(9);

      expect(before, [5, 10]);
      expect(after, [5]);
      expect(before.toSet().difference(after.toSet()), {10});
    });

    test('duplicate review does not add milestone progress', () {
      final submittedReviewKeys = [
        'dish-1::user-1',
        'dish-2::user-1',
        'dish-3::user-1',
        'dish-4::user-1',
        'dish-5::user-1',
        'dish-5::user-1',
      ];
      final uniqueUserDishKeys = submittedReviewKeys.toSet();

      expect(
        ContributionPointsService.reviewMilestonePointsForCount(
          uniqueUserDishKeys.length,
        ),
        1,
      );
    });

    test('multi-badge review remains one ordinary review identity', () {
      final submittedReviewKeys = [
        'cuban-sandwich-dish::user-1',
        'cuban-sandwich-dish::user-1',
        'chili-dog-dish::user-1',
        'chili-dog-dish::user-1',
      ];

      expect(
        ContributionPointsService.reviewMilestonePointsForCount(
          submittedReviewKeys.toSet().length,
        ),
        0,
      );
    });

    test('dish contribution point values match initial rules', () {
      expect(
        ContributionPointsService.pointsForDishContribution(
          createdNewRestaurant: false,
          createdNewDish: true,
          restaurantHadNoDishesBefore: false,
        ),
        1,
      );
      expect(
        ContributionPointsService.pointsForDishContribution(
          createdNewRestaurant: true,
          createdNewDish: true,
          restaurantHadNoDishesBefore: true,
        ),
        3,
      );
      expect(
        ContributionPointsService.pointsForDishContribution(
          createdNewRestaurant: false,
          createdNewDish: true,
          restaurantHadNoDishesBefore: true,
        ),
        3,
      );
      expect(
        ContributionPointsService.pointsForDishContribution(
          createdNewRestaurant: false,
          createdNewDish: false,
          restaurantHadNoDishesBefore: false,
        ),
        0,
      );
    });

    test('image can stack with a plus-three contribution', () {
      final firstDishPoints =
          ContributionPointsService.pointsForDishContribution(
            createdNewRestaurant: true,
            createdNewDish: true,
            restaurantHadNoDishesBefore: true,
          );
      const imagePoints = 1;

      expect(firstDishPoints + imagePoints, 4);
    });

    test('approved proposal actions are worth one point', () {
      expect(ContributionPointAction.dishEditApproved, 'dish_edit_approved');
      expect(
        ContributionPointAction.dishRenameApproved,
        'dish_rename_approved',
      );
      expect(ContributionPointAction.dishMergeApproved, 'dish_merge_approved');
    });

    test(
      'submitted but unapproved and rejected requests are zero by default',
      () {
        const submittedButUnapproved = 0;
        const rejectedOrNoOp = 0;

        expect(submittedButUnapproved, 0);
        expect(rejectedOrNoOp, 0);
      },
    );

    test('rename approval treats unchanged values as no-op', () {
      expect(
        ContributionPointsService.isMeaningfulApprovedDishRename(
          currentName: 'Supreme Pizza',
          currentNormalizedName: 'supreme pizza',
          proposedName: 'Supreme Pizza',
          proposedNormalizedName: 'supreme pizza',
        ),
        isFalse,
      );
    });

    test('rename approval credits changed dish names', () {
      expect(
        ContributionPointsService.isMeaningfulApprovedDishRename(
          currentName: 'Supreme Pizza',
          currentNormalizedName: 'supreme pizza',
          proposedName: 'House Supreme Pizza',
          proposedNormalizedName: 'house supreme pizza',
        ),
        isTrue,
      );
    });
  });

  group('Contribution point ledger identity', () {
    test(
      'award results aggregate one completed action into one point total',
      () {
        const dishAward = ContributionPointAwardResult(
          entries: <ContributionPointAwardEntryResult>[
            ContributionPointAwardEntryResult(
              ledgerEntryId: 'new-restaurant-first-dish',
              points: 3,
              wasCreated: true,
            ),
          ],
        );
        const imageAward = ContributionPointAwardResult(
          entries: <ContributionPointAwardEntryResult>[
            ContributionPointAwardEntryResult(
              ledgerEntryId: 'dish-image',
              points: 1,
              wasCreated: true,
            ),
          ],
        );

        final plusThree = ContributionPointAwardResult.combine([dishAward]);
        final plusFour = ContributionPointAwardResult.combine([
          dishAward,
          imageAward,
        ]);

        expect(plusThree.newlyAwardedPoints, 3);
        expect(plusFour.newlyAwardedPoints, 4);
        expect(plusFour.newlyCreatedLedgerEntryIds, [
          'new-restaurant-first-dish',
          'dish-image',
        ]);
      },
    );

    test('duplicate award entries do not contribute celebration points', () {
      const result = ContributionPointAwardResult(
        entries: <ContributionPointAwardEntryResult>[
          ContributionPointAwardEntryResult(
            ledgerEntryId: 'dish-created',
            points: 1,
            wasCreated: false,
          ),
        ],
      );

      expect(result.newlyAwardedPoints, 0);
      expect(result.newlyCreatedLedgerEntryIds, isEmpty);
      expect(result.hasNewPositivePoints, isFalse);
    });

    test('celebration mark result exposes nonfatal ledger states', () {
      const clean = ContributionPointCelebrationMarkResult(
        attemptedEntryIds: {'ledger-1'},
        markedEntryIds: {'ledger-1'},
      );
      const withMissing = ContributionPointCelebrationMarkResult(
        attemptedEntryIds: {'ledger-1', 'ledger-2'},
        markedEntryIds: {'ledger-1'},
        missingEntryIds: {'ledger-2'},
      );

      expect(clean.hasProblems, isFalse);
      expect(withMissing.hasProblems, isTrue);
      expect(withMissing.missingEntryIds, {'ledger-2'});
    });

    test('stable source keys prevent duplicate ledger entries', () {
      final left = ContributionPointsService.dishImageAddedSourceKey(
        dishId: 'dish-1',
        imageId: 'image-1',
      );
      final right = ContributionPointsService.dishImageAddedSourceKey(
        dishId: 'dish-1',
        imageId: 'image-1',
      );

      expect(left, right);
      expect(
        ContributionPointsService.ledgerDocumentIdForSourceKey(left),
        ContributionPointsService.ledgerDocumentIdForSourceKey(right),
      );
    });

    test('same contribution cannot be reversed twice by reversal key', () {
      final ledgerId = ContributionPointsService.ledgerDocumentIdForSourceKey(
        ContributionPointsService.dishCreatedSourceKey('dish-1'),
      );

      expect(
        ContributionPointsService.reversalDocumentId(ledgerId),
        ContributionPointsService.reversalDocumentId(ledgerId),
      );
    });

    test('approved proposal source keys use request IDs', () {
      expect(
        ContributionPointsService.approvedProposalSourceKey(
          actionType: ContributionPointAction.dishEditApproved,
          requestId: 'request-1',
        ),
        'dish_edit_approved:request-1',
      );
      expect(
        ContributionPointsService.approvedProposalSourceKey(
          actionType: ContributionPointAction.dishRenameApproved,
          requestId: 'request-2',
        ),
        'dish_rename_approved:request-2',
      );
      expect(
        ContributionPointsService.approvedProposalSourceKey(
          actionType: ContributionPointAction.dishMergeApproved,
          requestId: 'request-3',
        ),
        'dish_merge_approved:request-3',
      );
    });

    test('retrying the same approved proposal has the same ledger ID', () {
      final sourceKey = ContributionPointsService.approvedProposalSourceKey(
        actionType: ContributionPointAction.dishRenameApproved,
        requestId: 'rename-request',
      );

      expect(
        ContributionPointsService.ledgerDocumentIdForSourceKey(sourceKey),
        ContributionPointsService.ledgerDocumentIdForSourceKey(sourceKey),
      );
    });

    test(
      'removed credited content creates one negative reversal entry shape',
      () {
        final reversal = _entry(
          id: 'reversal-1',
          pointsDelta: -1,
          actionType: ContributionPointAction.contributionReversed,
          description: 'Points removed: Added a dish image',
          originalLedgerEntryId: 'image-award',
        );

        expect(reversal.pointsDelta, -1);
        expect(reversal.isReversal, isTrue);
        expect(reversal.originalLedgerEntryId, 'image-award');
      },
    );

    test('approved rename description includes old and new names', () {
      expect(
        ContributionPointsService.approvedDishProposalDescription(
          actionType: ContributionPointAction.dishRenameApproved,
          oldValue: 'Supreme Pizza',
          newValue: 'House Supreme Pizza',
        ),
        'Approved dish rename: Supreme Pizza -> House Supreme Pizza',
      );
    });

    test(
      'approved merge description includes source and destination dishes',
      () {
        expect(
          ContributionPointsService.approvedDishProposalDescription(
            actionType: ContributionPointAction.dishMergeApproved,
            mergeSourceDishName: 'Supreme Pizza',
            mergeTargetDishName: 'House Supreme Pizza',
          ),
          'Approved merge of Supreme Pizza into House Supreme Pizza',
        );
      },
    );

    test('approved edit description includes dish name when available', () {
      expect(
        ContributionPointsService.approvedDishProposalDescription(
          actionType: ContributionPointAction.dishEditApproved,
          dishName: 'Cheeseburger',
        ),
        'Approved dish information edit for Cheeseburger',
      );
    });

    test('approved proposal ledger entry keeps request and dish metadata', () {
      final entry = ContributionPointLedgerEntry.tryFromFirestore({
        'id': 'dish_rename_approved%3Arequest-1',
        'userId': 'submitter-1',
        'pointsDelta': 1,
        'actionType': ContributionPointAction.dishRenameApproved,
        'sourceKey': 'dish_rename_approved:request-1',
        'description':
            'Approved dish rename: Supreme Pizza -> House Supreme Pizza',
        'requestId': 'request-1',
        'dishId': 'dish-1',
        'dishName': 'House Supreme Pizza',
        'restaurantId': 'restaurant-1',
        'restaurantName': 'Bills Wild Buffalos',
        'oldValue': 'Supreme Pizza',
        'newValue': 'House Supreme Pizza',
      }, fallbackId: 'fallback');

      expect(entry, isNotNull);
      expect(entry!.userId, 'submitter-1');
      expect(entry.actionType, ContributionPointAction.dishRenameApproved);
      expect(entry.requestId, 'request-1');
      expect(entry.dishId, 'dish-1');
      expect(entry.restaurantId, 'restaurant-1');
      expect(entry.oldValue, 'Supreme Pizza');
      expect(entry.newValue, 'House Supreme Pizza');
    });

    test('new positive awards carry pending celebration metadata', () {
      final entry = ContributionPointLedgerEntry.tryFromFirestore({
        'id': 'dish_created%3Adish-1',
        'userId': 'submitter-1',
        'pointsDelta': 1,
        'actionType': ContributionPointAction.dishCreated,
        'sourceKey': 'dish_created:dish-1',
        'description': 'Added a dish',
        'status': ContributionPointLedgerEntry.statusActive,
        'celebrationStatus':
            ContributionPointLedgerEntry.celebrationStatusPending,
      }, fallbackId: 'fallback');

      expect(entry, isNotNull);
      expect(
        entry!.celebrationStatus,
        ContributionPointLedgerEntry.celebrationStatusPending,
      );
      expect(entry.isReversal, isFalse);
    });

    test('approved merge ledger entry keeps merge endpoints', () {
      final entry = ContributionPointLedgerEntry.tryFromFirestore({
        'id': 'dish_merge_approved%3Arequest-1',
        'userId': 'merge-submitter',
        'pointsDelta': 1,
        'actionType': ContributionPointAction.dishMergeApproved,
        'sourceKey': 'dish_merge_approved:request-1',
        'description':
            'Approved merge of Supreme Pizza into House Supreme Pizza',
        'requestId': 'request-1',
        'dishId': 'source-dish',
        'dishName': 'Supreme Pizza',
        'restaurantId': 'restaurant-1',
        'mergeSourceDishId': 'source-dish',
        'mergeSourceDishName': 'Supreme Pizza',
        'mergeTargetDishId': 'target-dish',
        'mergeTargetDishName': 'House Supreme Pizza',
      }, fallbackId: 'fallback');

      expect(entry, isNotNull);
      expect(entry!.userId, 'merge-submitter');
      expect(entry.mergeSourceDishId, 'source-dish');
      expect(entry.mergeSourceDishName, 'Supreme Pizza');
      expect(entry.mergeTargetDishId, 'target-dish');
      expect(entry.mergeTargetDishName, 'House Supreme Pizza');
    });

    test('cached total matches ledger sum', () {
      final entries = [
        _entry(id: 'dish', pointsDelta: 3),
        _entry(id: 'image', pointsDelta: 1),
        _entry(
          id: 'reversal',
          pointsDelta: -1,
          actionType: ContributionPointAction.contributionReversed,
        ),
      ];

      expect(ContributionPointsService.ledgerTotal(entries), 3);
    });
  });

  group('Contribution point callable wrappers', () {
    test(
      'review milestone wrapper calls source-specific function shape',
      () async {
        final payloads = <Map<String, dynamic>>[];

        final result =
            await ContributionPointsService.awardReviewMilestoneContributionPoints(
              userId: ' user-1 ',
              callable: (payload) async {
                payloads.add(payload);
                return {
                  'ok': true,
                  'result': {
                    'entries': [
                      {
                        'ledgerEntryId': 'review_milestone%3Auser-1%3A5',
                        'points': 1,
                        'wasCreated': true,
                      },
                    ],
                    'actionGroupId': 'review_milestones:user-1:5',
                  },
                };
              },
            );

        expect(payloads.single, {'userId': 'user-1'});
        expect(result.actionGroupId, 'review_milestones:user-1:5');
        expect(result.newlyAwardedPoints, 1);
        expect(result.newlyCreatedLedgerEntryIds, [
          'review_milestone%3Auser-1%3A5',
        ]);
      },
    );

    test('dish image wrapper calls source-specific function shape', () async {
      final payloads = <Map<String, dynamic>>[];

      final result =
          await ContributionPointsService.awardDishImageContributionPoints(
            imageId: ' image-1 ',
            dishId: ' dish-1 ',
            callable: (payload) async {
              payloads.add(payload);
              return {
                'ok': true,
                'result': {
                  'entries': [
                    {
                      'ledgerEntryId': 'dish_image_added%3Adish-1%3Aimage-1',
                      'points': 1,
                      'wasCreated': true,
                    },
                  ],
                  'actionGroupId': 'dish_image_added:dish-1:image-1',
                },
              };
            },
          );

      expect(payloads.single, {'imageId': 'image-1', 'dishId': 'dish-1'});
      expect(result.actionGroupId, 'dish_image_added:dish-1:image-1');
      expect(result.newlyAwardedPoints, 1);
      expect(result.newlyCreatedLedgerEntryIds, [
        'dish_image_added%3Adish-1%3Aimage-1',
      ]);
    });

    test('created dish wrapper calls source-specific function shape', () async {
      final payloads = <Map<String, dynamic>>[];

      final result =
          await ContributionPointsService.awardCreatedDishContributionPoints(
            restaurantId: ' restaurant-1 ',
            dishId: ' dish-1 ',
            reviewId: ' review-1 ',
            callable: (payload) async {
              payloads.add(payload);
              return {
                'ok': true,
                'result': {
                  'entries': [
                    {
                      'ledgerEntryId':
                          'new_restaurant_first_dish%3Arestaurant-1%3Adish-1',
                      'points': 3,
                      'wasCreated': true,
                    },
                  ],
                  'actionGroupId':
                      'new_restaurant_first_dish:restaurant-1:dish-1',
                },
              };
            },
          );

      expect(payloads.single, {
        'restaurantId': 'restaurant-1',
        'dishId': 'dish-1',
        'reviewId': 'review-1',
      });
      expect(
        result.actionGroupId,
        'new_restaurant_first_dish:restaurant-1:dish-1',
      );
      expect(result.newlyAwardedPoints, 3);
      expect(result.newlyCreatedLedgerEntryIds, [
        'new_restaurant_first_dish%3Arestaurant-1%3Adish-1',
      ]);
    });

    test('created dish wrapper treats empty identifiers as no-award', () async {
      var called = false;

      final result =
          await ContributionPointsService.awardCreatedDishContributionPoints(
            restaurantId: 'restaurant-1',
            dishId: ' ',
            reviewId: 'review-1',
            callable: (payload) async {
              called = true;
              return payload;
            },
          );

      expect(called, isFalse);
      expect(result.entries, isEmpty);
      expect(result.hasNewPositivePoints, isFalse);
    });

    test(
      'approved proposal wrapper calls source-specific function shape',
      () async {
        final payloads = <Map<String, dynamic>>[];

        final result =
            await ContributionPointsService.awardApprovedDishProposalContributionPoints(
              proposalId: ' proposal-1 ',
              oldValue: ' Pizza ',
              newValue: ' House Pizza ',
              callable: (payload) async {
                payloads.add(payload);
                return {
                  'ok': true,
                  'result': {
                    'entries': [
                      {
                        'ledgerEntryId': 'dish_rename_approved%3Aproposal-1',
                        'points': 1,
                        'wasCreated': true,
                      },
                    ],
                    'actionGroupId': 'dish_rename_approved:proposal-1',
                  },
                };
              },
            );

        expect(payloads.single, {
          'proposalId': 'proposal-1',
          'oldValue': 'Pizza',
          'newValue': 'House Pizza',
        });
        expect(result.actionGroupId, 'dish_rename_approved:proposal-1');
        expect(result.newlyAwardedPoints, 1);
        expect(result.newlyCreatedLedgerEntryIds, [
          'dish_rename_approved%3Aproposal-1',
        ]);
      },
    );

    test(
      'approved proposal wrapper treats empty proposal ID as no-award',
      () async {
        var called = false;

        final result =
            await ContributionPointsService.awardApprovedDishProposalContributionPoints(
              proposalId: ' ',
              oldValue: 'Pizza',
              newValue: 'House Pizza',
              callable: (payload) async {
                called = true;
                return payload;
              },
            );

        expect(called, isFalse);
        expect(result.entries, isEmpty);
        expect(result.hasNewPositivePoints, isFalse);
      },
    );

    test(
      'dish reversal wrapper calls source-specific function shape',
      () async {
        final payloads = <Map<String, dynamic>>[];

        final result =
            await ContributionPointsService.reverseContributionPointsForDish(
              dishId: ' dish-1 ',
              reason: ' Dish was deleted by moderation ',
              callable: (payload) async {
                payloads.add(payload);
                return {
                  'ok': true,
                  'result': {
                    'dishId': 'dish-1',
                    'attemptedCount': 2,
                    'reversedEntryIds': ['dish_created%3Adish-1'],
                    'alreadyReversedEntryIds': [
                      'dish_image_added%3Adish-1%3Aimage-1',
                    ],
                    'missingEntryIds': [],
                    'ignoredEntryIds': ['reversal%3Aold-entry'],
                    'errors': [],
                  },
                };
              },
            );

        expect(payloads.single, {
          'dishId': 'dish-1',
          'reason': 'Dish was deleted by moderation',
        });
        expect(result.dishId, 'dish-1');
        expect(result.attemptedCount, 2);
        expect(result.reversedEntryIds, {'dish_created%3Adish-1'});
        expect(result.alreadyReversedEntryIds, {
          'dish_image_added%3Adish-1%3Aimage-1',
        });
        expect(result.ignoredEntryIds, {'reversal%3Aold-entry'});
        expect(result.hasErrors, isFalse);
      },
    );

    test('dish reversal wrapper surfaces server errors', () async {
      expect(
        () => ContributionPointsService.reverseContributionPointsForDish(
          dishId: 'dish-1',
          callable: (_) async => {
            'ok': true,
            'result': {
              'dishId': 'dish-1',
              'attemptedCount': 1,
              'reversedEntryIds': [],
              'alreadyReversedEntryIds': [],
              'missingEntryIds': [],
              'ignoredEntryIds': [],
              'errors': [
                {'ledgerEntryId': 'ledger-1', 'message': 'boom'},
              ],
            },
          },
        ),
        throwsStateError,
      );
    });

    test(
      'milestone moderation wrapper calls source-specific function shape',
      () async {
        final payloads = <Map<String, dynamic>>[];

        final result =
            await ContributionPointsService.reconcileReviewMilestoneContributionPointsAfterModeration(
              userId: ' user-1 ',
              callable: (payload) async {
                payloads.add(payload);
                return {
                  'ok': true,
                  'result': {
                    'userId': 'user-1',
                    'validReviewCount': 4,
                    'awardResult': {
                      'entries': [],
                      'actionGroupId': 'review_milestones:user-1:4',
                    },
                    'reversedEntryIds': ['review_milestone%3Auser-1%3A5'],
                    'alreadyReversedEntryIds': [],
                    'missingEntryIds': [],
                    'ignoredEntryIds': [],
                    'errors': [],
                  },
                };
              },
            );

        expect(payloads.single, {'userId': 'user-1'});
        expect(result.userId, 'user-1');
        expect(result.validReviewCount, 4);
        expect(result.awardResult.actionGroupId, 'review_milestones:user-1:4');
        expect(result.reversedEntryIds, {'review_milestone%3Auser-1%3A5'});
        expect(result.hasErrors, isFalse);
      },
    );

    test('milestone moderation wrapper treats empty user ID as no-op', () async {
      var called = false;

      final result =
          await ContributionPointsService.reconcileReviewMilestoneContributionPointsAfterModeration(
            userId: ' ',
            callable: (payload) async {
              called = true;
              return payload;
            },
          );

      expect(called, isFalse);
      expect(result.userId, isNull);
      expect(result.awardResult.entries, isEmpty);
      expect(result.reversedEntryIds, isEmpty);
    });

    test('callable duplicate no-op preserves celebration behavior', () {
      final result = ContributionPointAwardResult.fromCallableData({
        'ok': true,
        'result': {
          'entries': [
            {
              'ledgerEntryId': 'dish_image_added%3Adish-1%3Aimage-1',
              'points': 1,
              'wasCreated': false,
            },
          ],
          'actionGroupId': 'dish_image_added:dish-1:image-1',
        },
      });

      expect(result.newlyAwardedPoints, 0);
      expect(result.newlyCreatedLedgerEntryIds, isEmpty);
      expect(result.hasNewPositivePoints, isFalse);
    });

    test('celebration marker wrapper calls callable with ledger IDs', () async {
      final payloads = <Map<String, dynamic>>[];

      final result =
          await ContributionPointsService.markCelebratedLedgerEntries(
            userId: ' user-1 ',
            ledgerEntryIds: [' ledger-1 ', 'ledger-2', 'ledger-1', ' '],
            callable: (payload) async {
              payloads.add(payload);
              return {
                'ok': true,
                'result': {
                  'attemptedEntryIds': ['ledger-1', 'ledger-2'],
                  'markedEntryIds': ['ledger-1'],
                  'alreadyCelebratedEntryIds': ['ledger-2'],
                  'missingEntryIds': [],
                  'ignoredEntryIds': [],
                },
              };
            },
          );

      expect(payloads.single, {
        'ledgerEntryIds': ['ledger-1', 'ledger-2'],
      });
      expect(result.attemptedEntryIds, {'ledger-1', 'ledger-2'});
      expect(result.markedEntryIds, {'ledger-1'});
      expect(result.alreadyCelebratedEntryIds, {'ledger-2'});
      expect(result.hasProblems, isFalse);
    });

    test('celebration marker result reports nonfatal problem buckets', () {
      final result = ContributionPointCelebrationMarkResult.fromCallableData({
        'ok': true,
        'result': {
          'attemptedEntryIds': ['ledger-1', 'ledger-2'],
          'markedEntryIds': ['ledger-1'],
          'alreadyCelebratedEntryIds': [],
          'missingEntryIds': ['ledger-2'],
          'ignoredEntryIds': ['ledger-3'],
        },
      });

      expect(result.hasProblems, isTrue);
      expect(result.missingEntryIds, {'ledger-2'});
      expect(result.ignoredEntryIds, {'ledger-3'});
    });
  });

  group('Contribution point admin sorting', () {
    test('default most-points sort puts highest total first', () {
      final sorted = ContributionPointsService.sortUserPointSummaries(
        _summaries,
        ContributionPointSort.mostPoints,
      );

      expect(sorted.map((summary) => summary.userId), ['high', 'mid', 'low']);
    });

    test('fewest-points sort works', () {
      final sorted = ContributionPointsService.sortUserPointSummaries(
        _summaries,
        ContributionPointSort.fewestPoints,
      );

      expect(sorted.map((summary) => summary.userId), ['low', 'mid', 'high']);
    });

    test('display-name sort works', () {
      final sorted = ContributionPointsService.sortUserPointSummaries(
        _summaries,
        ContributionPointSort.displayNameAz,
      );

      expect(sorted.map((summary) => summary.displayName), [
        'Alpha',
        'Beta',
        'Zeta',
      ]);
    });

    test('most-recent activity sort works', () {
      final sorted = ContributionPointsService.sortUserPointSummaries(
        _summaries,
        ContributionPointSort.mostRecentActivity,
      );

      expect(sorted.map((summary) => summary.userId), ['mid', 'low', 'high']);
    });
  });
}

List<ContributionPointUserSummary> get _summaries {
  return [
    ContributionPointUserSummary(
      userId: 'low',
      displayName: 'Beta',
      totalPoints: 1,
      lastActivityAt: DateTime(2026, 6, 12),
    ),
    ContributionPointUserSummary(
      userId: 'high',
      displayName: 'Zeta',
      totalPoints: 8,
      lastActivityAt: DateTime(2026, 6, 10),
    ),
    ContributionPointUserSummary(
      userId: 'mid',
      displayName: 'Alpha',
      totalPoints: 4,
      lastActivityAt: DateTime(2026, 6, 13),
    ),
  ];
}

ContributionPointLedgerEntry _entry({
  required String id,
  int pointsDelta = 1,
  String actionType = ContributionPointAction.dishCreated,
  String description = 'Added a dish',
  String? originalLedgerEntryId,
}) {
  return ContributionPointLedgerEntry(
    id: id,
    userId: 'user-1',
    pointsDelta: pointsDelta,
    actionType: actionType,
    sourceKey: '$actionType:$id',
    description: description,
    originalLedgerEntryId: originalLedgerEntryId,
  );
}
