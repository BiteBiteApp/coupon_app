import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/models/bitescore_dish.dart';
import 'package:coupon_app/models/bitescore_dish_image.dart';
import 'package:coupon_app/models/bitescore_dish_image_vote.dart';
import 'package:coupon_app/models/bitescore_restaurant.dart';
import 'package:coupon_app/models/dish_rating_aggregate.dart';
import 'package:coupon_app/models/dish_review.dart';
import 'package:coupon_app/models/review_feedback_vote.dart';
import 'package:coupon_app/screens/bitescore_create_rate_screen.dart';
import 'package:coupon_app/services/bitescore_service.dart';
import 'package:coupon_app/services/contribution_points_service.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final writerCases = <_WriterCase>[
    _WriterCase(
      label: 'existing-dish review',
      operation: 'addReviewForDish',
      invoke: (expectedUserId) => BiteScoreService.addReviewForDish(
        dish: _dish,
        restaurant: _restaurant,
        expectedUserId: expectedUserId,
        overallImpression: 8,
        headline: 'A draft',
        notes: 'Must remain A review data.',
        tastinessScore: 8,
        qualityScore: 8,
        valueScore: 8,
      ),
    ),
    _WriterCase(
      label: 'create and rate',
      operation: 'createAndRate',
      invoke: (expectedUserId) => BiteScoreService.createAndRate(
        _createRequest,
        expectedUserId: expectedUserId,
      ),
    ),
    _WriterCase(
      label: 'create dish and rate for restaurant',
      operation: 'createDishAndRateForRestaurant',
      invoke: (expectedUserId) =>
          BiteScoreService.createDishAndRateForRestaurant(
            restaurant: _restaurant,
            dishName: 'Boundary Burger',
            category: 'Burgers',
            priceLabel: r'$12',
            headline: 'A draft',
            notes: 'Must remain A review data.',
            overallImpression: 8,
            expectedUserId: expectedUserId,
            tastinessScore: 8,
            qualityScore: 8,
            valueScore: 8,
          ),
    ),
    _WriterCase(
      label: 'gallery image vote',
      operation: 'toggleDishImageVote',
      invoke: (expectedUserId) => BiteScoreService.toggleDishImageVote(
        image: _image,
        voteType: BiteScoreDishImageVote.voteHelpful,
        expectedUserId: expectedUserId,
      ),
    ),
    _WriterCase(
      label: 'review feedback vote',
      operation: 'toggleReviewFeedbackVote',
      invoke: (expectedUserId) async {
        await BiteScoreService.toggleReviewFeedbackVote(
          review: _review(userId: 'review-author', headline: 'Review'),
          voteType: ReviewFeedbackVote.voteHelpful,
          expectedUserId: expectedUserId,
        );
        return null;
      },
    ),
  ];

  group('expected account continuity', () {
    for (final writerCase in writerCases) {
      test('${writerCase.label} rejects A-to-B during real reload', () async {
        User? currentUser = _BoundaryUser(uid: 'A');
        final reloadStarted = Completer<void>();
        final resumeReload = Completer<void>();
        final writes = <String>[];
        final attributedUserIds = <String>[];
        final reviewsByUserId = <String, DishReview>{
          'B': _review(userId: 'B', headline: 'B existing'),
        };
        final votesByUserId = <String, String>{'B': 'notHelpful'};

        await BiteScoreService.runWithAccountContinuityTestSeams<void>(
          currentUserProvider: () => currentUser,
          reloadUser: (_) async {
            reloadStarted.complete();
            await resumeReload.future;
          },
          refreshIdToken: (_) async {},
          write: (operation, pinnedUserId) async {
            writes.add(operation);
            attributedUserIds.add(pinnedUserId);
            reviewsByUserId[pinnedUserId] = _review(
              userId: pinnedUserId,
              headline: '$pinnedUserId saved',
            );
            votesByUserId[pinnedUserId] = 'helpful';
            return _resultForOperation(operation, pinnedUserId);
          },
          body: () async {
            final mutation = writerCase.invoke('A');
            await reloadStarted.future;
            currentUser = _BoundaryUser(uid: 'B');
            resumeReload.complete();

            await expectLater(
              mutation,
              throwsA(
                isA<ArgumentError>().having(
                  (error) => error.message,
                  'message',
                  BiteScoreService.accountChangedMessage,
                ),
              ),
            );
          },
        );

        expect(writes, isEmpty);
        expect(attributedUserIds, isEmpty);
        expect(reviewsByUserId['B']?.headline, 'B existing');
        expect(votesByUserId['B'], 'notHelpful');
      });

      test('${writerCase.label} succeeds while A remains A', () async {
        User? currentUser = _BoundaryUser(uid: 'A');
        final writes = <String>[];
        final attributedUserIds = <String>[];

        final result =
            await BiteScoreService.runWithAccountContinuityTestSeams<Object?>(
              currentUserProvider: () => currentUser,
              reloadUser: (_) async {
                currentUser = _BoundaryUser(uid: 'A');
              },
              refreshIdToken: (_) async {},
              write: (operation, pinnedUserId) async {
                writes.add(operation);
                attributedUserIds.add(pinnedUserId);
                return _resultForOperation(operation, pinnedUserId);
              },
              body: () => writerCase.invoke('A'),
            );

        expect(writes, <String>[writerCase.operation]);
        expect(attributedUserIds, <String>['A']);
        if (result is BiteScoreReviewSaveResult) {
          expect(result.review.userId, 'A');
        }
      });
    }

    for (final replacement in <_AuthReplacement>[
      const _AuthReplacement(label: 'signed-out', user: null),
      _AuthReplacement(
        label: 'anonymous',
        user: _BoundaryUser(uid: 'guest', isAnonymous: true),
      ),
    ]) {
      test('existing-dish review rejects A-to-${replacement.label}', () async {
        User? currentUser = _BoundaryUser(uid: 'A');
        final reloadStarted = Completer<void>();
        final resumeReload = Completer<void>();
        var writeEntries = 0;

        await BiteScoreService.runWithAccountContinuityTestSeams<void>(
          currentUserProvider: () => currentUser,
          reloadUser: (_) async {
            reloadStarted.complete();
            await resumeReload.future;
          },
          refreshIdToken: (_) async {},
          write: (operation, pinnedUserId) async {
            writeEntries += 1;
            return _resultForOperation(operation, pinnedUserId);
          },
          body: () async {
            final mutation = writerCases.first.invoke('A');
            await reloadStarted.future;
            currentUser = replacement.user;
            resumeReload.complete();
            await expectLater(mutation, throwsArgumentError);
          },
        );

        expect(writeEntries, 0);
      });
    }

    test('reload failure cannot swallow an A-to-B mismatch', () async {
      User? currentUser = _BoundaryUser(uid: 'A');
      var writeEntries = 0;

      await BiteScoreService.runWithAccountContinuityTestSeams<void>(
        currentUserProvider: () => currentUser,
        reloadUser: (_) async {
          currentUser = _BoundaryUser(uid: 'B');
          throw StateError('synthetic reload failure');
        },
        refreshIdToken: (_) async {},
        write: (operation, pinnedUserId) async {
          writeEntries += 1;
          return _resultForOperation(operation, pinnedUserId);
        },
        body: () async {
          await expectLater(writerCases.first.invoke('A'), throwsArgumentError);
        },
      );

      expect(writeEntries, 0);
    });

    test(
      'replacement during final pre-mutation await enters no write',
      () async {
        User? currentUser = _BoundaryUser(uid: 'A');
        final mutationCheckStarted = Completer<void>();
        final resumeMutation = Completer<void>();
        var writeEntries = 0;

        await BiteScoreService.runWithAccountContinuityTestSeams<void>(
          currentUserProvider: () => currentUser,
          reloadUser: (_) async {},
          refreshIdToken: (_) async {},
          beforeMutation: (_) async {
            mutationCheckStarted.complete();
            await resumeMutation.future;
          },
          write: (operation, pinnedUserId) async {
            writeEntries += 1;
            return _resultForOperation(operation, pinnedUserId);
          },
          body: () async {
            final mutation = writerCases[1].invoke('A');
            await mutationCheckStarted.future;
            currentUser = _BoundaryUser(uid: 'B');
            resumeMutation.complete();
            await expectLater(mutation, throwsArgumentError);
          },
        );

        expect(writeEntries, 0);
      },
    );

    test('same-UID reload failure preserves the existing fallback', () async {
      User? currentUser = _BoundaryUser(uid: 'A');
      final pinnedUserIds = <String>[];

      final result =
          await BiteScoreService.runWithAccountContinuityTestSeams<Object?>(
            currentUserProvider: () => currentUser,
            reloadUser: (_) async {
              currentUser = _BoundaryUser(uid: 'A');
              throw StateError('synthetic offline refresh');
            },
            refreshIdToken: (_) async {},
            write: (operation, pinnedUserId) async {
              pinnedUserIds.add(pinnedUserId);
              return _resultForOperation(operation, pinnedUserId);
            },
            body: () => writerCases.first.invoke('A'),
          );

      expect(pinnedUserIds, <String>['A']);
      expect((result as BiteScoreReviewSaveResult).review.userId, 'A');
    });

    test('existing email-verification eligibility rejection remains', () async {
      User? currentUser = _BoundaryUser(
        uid: 'A',
        emailVerified: false,
        providerData: <UserInfo>[_PasswordUserInfo()],
      );
      var reloadEntries = 0;
      var writeEntries = 0;

      await BiteScoreService.runWithAccountContinuityTestSeams<void>(
        currentUserProvider: () => currentUser,
        reloadUser: (_) async {
          reloadEntries += 1;
        },
        refreshIdToken: (_) async {},
        write: (operation, pinnedUserId) async {
          writeEntries += 1;
          return _resultForOperation(operation, pinnedUserId);
        },
        body: () async {
          await expectLater(
            writerCases.first.invoke('A'),
            throwsA(
              isA<ArgumentError>().having(
                (error) => error.message,
                'message',
                BiteScoreService.emailVerificationRequiredMessage,
              ),
            ),
          );
        },
      );

      expect(reloadEntries, 0);
      expect(writeEntries, 0);
    });

    test('gallery vote create, replace, and remove stay owned by A', () async {
      User? currentUser = _BoundaryUser(uid: 'A');
      final votesByUserId = <String, String?>{'B': 'notHelpful'};
      final writes = <String>[];

      await BiteScoreService.runWithAccountContinuityTestSeams<void>(
        currentUserProvider: () => currentUser,
        reloadUser: (_) async {},
        refreshIdToken: (_) async {},
        write: (operation, pinnedUserId) async {
          writes.add('$operation:$pinnedUserId');
          final requestedVote = writes.length == 1
              ? BiteScoreDishImageVote.voteHelpful
              : BiteScoreDishImageVote.voteNotHelpful;
          final currentVote = votesByUserId[pinnedUserId];
          votesByUserId[pinnedUserId] = currentVote == requestedVote
              ? null
              : requestedVote;
          return BiteScoreDishImageVoteResult(
            image: _image,
            currentUserVoteType: votesByUserId[pinnedUserId],
          );
        },
        body: () async {
          final created = await BiteScoreService.toggleDishImageVote(
            image: _image,
            voteType: BiteScoreDishImageVote.voteHelpful,
            expectedUserId: 'A',
          );
          expect(created.currentUserVoteType, 'helpful');

          final replaced = await BiteScoreService.toggleDishImageVote(
            image: _image,
            voteType: BiteScoreDishImageVote.voteNotHelpful,
            expectedUserId: 'A',
          );
          expect(replaced.currentUserVoteType, 'notHelpful');

          final removed = await BiteScoreService.toggleDishImageVote(
            image: _image,
            voteType: BiteScoreDishImageVote.voteNotHelpful,
            expectedUserId: 'A',
          );
          expect(removed.currentUserVoteType, isNull);
        },
      );

      expect(writes, List<String>.filled(3, 'toggleDishImageVote:A'));
      expect(votesByUserId['A'], isNull);
      expect(votesByUserId['B'], 'notHelpful');
    });
  });

  testWidgets(
    'guest create-rate draft adopts A and forwards A to the real service',
    (tester) async {
      tester.view.physicalSize = const Size(900, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      User? currentUser = _BoundaryUser(uid: 'guest', isAnonymous: true);
      final writeStarted = Completer<void>();
      final releaseWrite = Completer<void>();
      final writes = <String>[];

      await BiteScoreService.runWithAccountContinuityTestSeams<void>(
        currentUserProvider: () => currentUser,
        reloadUser: (_) async {},
        refreshIdToken: (_) async {},
        write: (operation, pinnedUserId) async {
          writes.add('$operation:$pinnedUserId');
          writeStarted.complete();
          await releaseWrite.future;
          return _resultForOperation(operation, pinnedUserId);
        },
        body: () async {
          await tester.pumpWidget(
            MaterialApp(
              home: BiteScoreCreateRateScreen(
                existingEntry: _entry,
                testCurrentUserProvider: () => currentUser,
                testWriteGate: (_) async {
                  currentUser = _BoundaryUser(uid: 'A');
                  return true;
                },
              ),
            ),
          );

          final screen = find.byType(BiteScoreCreateRateScreen);
          for (final slider in tester.widgetList<Slider>(
            find.descendant(of: screen, matching: find.byType(Slider)),
          )) {
            slider.onChanged?.call(8);
          }
          await tester.pump();
          final saveButton = find.descendant(
            of: screen,
            matching: find.widgetWithText(ElevatedButton, 'Save Review'),
          );
          await tester.ensureVisible(saveButton);
          await tester.tap(saveButton);
          await _pumpUntil(tester, () => writeStarted.isCompleted);

          expect(writes, <String>['addReviewForDish:A']);
          releaseWrite.complete();
          await tester.pump();
          await tester.pumpWidget(const SizedBox.shrink());
        },
      );
    },
  );
}

class _WriterCase {
  final String label;
  final String operation;
  final Future<Object?> Function(String expectedUserId) invoke;

  const _WriterCase({
    required this.label,
    required this.operation,
    required this.invoke,
  });
}

class _AuthReplacement {
  final String label;
  final User? user;

  const _AuthReplacement({required this.label, required this.user});
}

class _BoundaryUser extends Fake implements User {
  @override
  final String uid;

  @override
  final bool isAnonymous;

  @override
  final bool emailVerified;

  @override
  final List<UserInfo> providerData;

  _BoundaryUser({
    required this.uid,
    this.isAnonymous = false,
    this.emailVerified = true,
    this.providerData = const <UserInfo>[],
  });
}

class _PasswordUserInfo extends Fake implements UserInfo {
  @override
  String get providerId => 'password';
}

const _restaurant = BitescoreRestaurant(
  id: 'restaurant-1',
  name: 'Boundary Restaurant',
  normalizedName: 'boundary restaurant',
  address: '1 Main St',
  city: 'Ocala',
  state: 'FL',
  zipCode: '34470',
  location: GeoPoint(29.1872, -82.1401),
  restaurantWriteRevision: 0,
);

const _dish = BitescoreDish(
  id: 'dish-1',
  restaurantId: 'restaurant-1',
  restaurantName: 'Boundary Restaurant',
  name: 'Boundary Burger',
  normalizedName: 'boundary burger',
  category: 'Burgers',
  categoryTags: <String>['burger', 'burgers'],
);

const _image = BiteScoreDishImage(
  id: 'image-1',
  dishId: 'dish-1',
  restaurantId: 'restaurant-1',
  uploadedByUserId: 'A',
  imageUrl: 'https://example.com/burger.jpg',
  storagePath: 'bitescore_dishes/dish-1/images/image-1.jpg',
);

const _entry = BiteScoreHomeEntry(
  dish: _dish,
  restaurant: _restaurant,
  aggregate: DishRatingAggregate(
    dishId: 'dish-1',
    restaurantId: 'restaurant-1',
  ),
);

const _createRequest = BiteScoreCreateRequest(
  restaurantName: 'Boundary Restaurant',
  streetAddress: '1 Main St',
  city: 'Ocala',
  state: 'FL',
  zipCode: '34470',
  dishName: 'Boundary Burger',
  category: 'Burgers',
  priceLabel: r'$12',
  headline: 'A draft',
  notes: 'Must remain A review data.',
  overallImpression: 8,
  tastinessScore: 8,
  qualityScore: 8,
  valueScore: 8,
);

DishReview _review({required String userId, required String headline}) {
  return DishReview(
    id: 'dish-1_$userId',
    dishId: _dish.id,
    restaurantId: _restaurant.id,
    userId: userId,
    headline: headline,
    notes: 'Boundary test review.',
    overallImpression: 8,
    tastinessScore: 8,
    qualityScore: 8,
    valueScore: 8,
    overallBiteScore: 80,
  );
}

Object? _resultForOperation(String operation, String userId) {
  if (operation == 'toggleDishImageVote') {
    return const BiteScoreDishImageVoteResult(
      image: _image,
      currentUserVoteType: BiteScoreDishImageVote.voteHelpful,
    );
  }
  if (operation == 'toggleReviewFeedbackVote') {
    return null;
  }
  return BiteScoreReviewSaveResult(
    dish: _dish,
    restaurant: _restaurant,
    review: _review(userId: userId, headline: '$userId saved'),
    contributionPointAward: const ContributionPointAwardResult(),
  );
}

Future<void> _pumpUntil(WidgetTester tester, bool Function() condition) async {
  for (var attempt = 0; attempt < 60; attempt += 1) {
    if (condition()) {
      await tester.pump();
      return;
    }
    await tester.runAsync<void>(
      () => Future<void>.delayed(const Duration(milliseconds: 1)),
    );
    await tester.pump(const Duration(milliseconds: 25));
  }
  expect(condition(), isTrue);
}
