import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:coupon_app/models/customer_bitescore_search.dart';
import 'package:coupon_app/screens/bitescore_dish_detail_screen.dart';
import 'package:coupon_app/screens/blocked_reviewers_screen.dart';
import 'package:coupon_app/screens/customer_profile_screen.dart';
import 'package:coupon_app/services/app_mode_state_service.dart';
import 'package:coupon_app/services/bitescore_service.dart';
import 'package:coupon_app/services/customer_bitescore_reads.dart';
import 'package:coupon_app/services/customer_bitescore_runtime.dart';
import 'package:coupon_app/services/reviewer_safety_service.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../services/customer_bitescore_reads_test.dart' show review, detail;
import '../services/customer_bitescore_search_service_test.dart'
    show dishProjection;
import '../services/reviewer_safety_service_test.dart' show SafetyUser;

Future<void> dish(
  WidgetTester tester, {
  required User? Function() user,
  required ReviewerSafetyService service,
  Future<Object?> Function(Map<String, Object?>)? reviews,
  Future<bool> Function(BuildContext)? signIn,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: BiteScoreDishDetailScreen(
        entry: CustomerBiteScorePublicData.entry(dishProjection('dish')),
        testCurrentUserProvider: user,
        testReviewerSafetyService: service,
        testBlockSignInGate: signIn,
        testCustomerReads: CustomerBiteScoreReads(
          actorKey: () => user()?.uid ?? 'guest',
          boundary: (name, request) async {
            if (name == 'getCustomerBiteScoreDetail') return detail();
            if (name == 'pageCustomerBiteScoreReviews') {
              return reviews != null
                  ? reviews(request)
                  : {
                      'items': [review('one')],
                      'nextCursor': null,
                    };
            }
            return {'items': [], 'nextCursor': null};
          },
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> openMenu(WidgetTester tester) async {
  final menu = find.byTooltip('Review actions').first;
  await tester.ensureVisible(menu);
  await tester.tap(menu);
  await tester.pumpAndSettle();
}

Future<void> openBlock(WidgetTester tester) async {
  await openMenu(tester);
  await tester.tap(find.text('Block reviewer'));
  await tester.pumpAndSettle();
}

ReviewerSafetyService serviceFor(
  User? Function() user,
  List<String> calls, {
  void Function()? onBlock,
}) => ReviewerSafetyService(
  currentUser: user,
  boundary: (name, request) async {
    calls.add(name);
    expect(request['expectedUserId'], user()!.uid);
    expect(request['targetUserId'], 'reviewer');
    if (name == 'blockReviewer') onBlock?.call();
    return {
      'schemaVersion': 1,
      'targetUserId': 'reviewer',
      'blocked': name == 'blockReviewer',
      'revision': name == 'blockReviewer' ? 2 : 1,
    };
  },
);
void main() {
  setUp(() {
    CustomerBiteScoreRuntime.testEnabled = true;
    ReviewerSafetyCustomerUi.testEnabled = true;
  });
  tearDown(() {
    CustomerBiteScoreRuntime.testEnabled = null;
    ReviewerSafetyCustomerUi.testEnabled = null;
    AppModeStateService.setMode(AppMode.biteSaver);
  });
  testWidgets(
    'default disabled menu preserves Report review and makes no safety calls',
    (tester) async {
      ReviewerSafetyCustomerUi.testEnabled = null;
      final calls = <String>[];
      final user = SafetyUser('viewer');
      await dish(
        tester,
        user: () => user,
        service: serviceFor(() => user, calls),
      );
      await openMenu(tester);
      expect(find.text('Report review'), findsOneWidget);
      expect(find.text('Block reviewer'), findsNothing);
      expect(find.text('Report Reviewer'), findsNothing);
      expect(calls, isEmpty);
    },
  );
  testWidgets('self-review keeps Edit and Report review; never self-blocks', (
    tester,
  ) async {
    final calls = <String>[];
    final user = SafetyUser('reviewer');
    await dish(
      tester,
      user: () => user,
      service: serviceFor(() => user, calls),
    );
    await openMenu(tester);
    expect(find.text('Edit review'), findsOneWidget);
    expect(find.text('Report review'), findsOneWidget);
    expect(find.text('Block reviewer'), findsNothing);
    expect(calls, isEmpty);
  });
  testWidgets(
    'confirmation Cancel performs no call; successful block refreshes the trusted review page',
    (tester) async {
      final calls = <String>[];
      final user = SafetyUser('viewer');
      var blocked = false;
      var pages = 0;
      await dish(
        tester,
        user: () => user,
        service: serviceFor(() => user, calls, onBlock: () => blocked = true),
        reviews: (_) async {
          pages++;
          return {
            'items': blocked ? [] : [review('one')],
            'nextCursor': null,
          };
        },
      );
      await openBlock(tester);
      expect(
        find.text(
          "Hide this reviewer's reviews from your BiteStar browsing. You can unblock them from My Profile.",
        ),
        findsOneWidget,
      );
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(calls, isEmpty);
      expect(find.text('Review one'), findsOneWidget);
      expect(pages, 1);
      await openBlock(tester);
      await tester.tap(find.widgetWithText(FilledButton, 'Block Reviewer'));
      await tester.pumpAndSettle();
      expect(calls, ['getReviewerSafetyStatus', 'blockReviewer']);
      expect(pages, 2);
      expect(find.text('Review one'), findsNothing);
      expect(find.text('No reviews to show.'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
  for (final allowed in [false, true]) {
    testWidgets(
      'guest sign-in ${allowed ? 'upgrade' : 'cancellation'} uses existing gate without a safety write',
      (tester) async {
        User? user;
        var prompts = 0;
        final calls = <String>[];
        await dish(
          tester,
          user: () => user,
          service: serviceFor(() => user, calls),
          signIn: (_) async {
            prompts++;
            if (allowed) user = SafetyUser('viewer');
            return allowed;
          },
        );
        await openBlock(tester);
        expect(prompts, 1);
        expect(calls, isEmpty);
        if (allowed) {
          expect(
            find.widgetWithText(FilledButton, 'Block Reviewer'),
            findsOneWidget,
          );
          await tester.tap(find.text('Cancel'));
          await tester.pumpAndSettle();
        } else {
          expect(
            find.widgetWithText(FilledButton, 'Block Reviewer'),
            findsNothing,
          );
        }
        expect(calls, isEmpty);
      },
    );
  }
  testWidgets(
    'account switching during status cannot dispatch a block or apply its result',
    (tester) async {
      User? user = SafetyUser('viewer');
      final pending = Completer<Object?>();
      final calls = <String>[];
      final service = ReviewerSafetyService(
        currentUser: () => user,
        boundary: (name, request) {
          calls.add(name);
          return pending.future;
        },
      );
      await dish(tester, user: () => user, service: service);
      await openBlock(tester);
      await tester.tap(find.widgetWithText(FilledButton, 'Block Reviewer'));
      await tester.pump();
      user = SafetyUser('other');
      pending.complete({
        'schemaVersion': 1,
        'targetUserId': 'reviewer',
        'blocked': false,
        'revision': 0,
      });
      await tester.pumpAndSettle();
      expect(calls, ['getReviewerSafetyStatus']);
      expect(find.text('Reviewer blocked.'), findsNothing);
    },
  );
  for (final enabled in [true, false]) {
    testWidgets(
      'empty review page keeps manual continuation; exhausted empty state (safety=$enabled)',
      (tester) async {
        ReviewerSafetyCustomerUi.testEnabled = enabled;
        final user = SafetyUser('viewer');
        final calls = <String>[];
        final cursors = <Object?>[];
        await dish(
          tester,
          user: () => user,
          service: serviceFor(() => user, calls),
          reviews: (request) async {
            cursors.add(request['cursor']);
            return {
              'items': [],
              'nextCursor': request['cursor'] == null ? 'next' : null,
            };
          },
        );
        expect(cursors, [null]);
        expect(find.text('No reviews yet for this dish.'), findsNothing);
        final more = find.widgetWithText(OutlinedButton, 'Load more');
        await tester.ensureVisible(more);
        await tester.tap(more);
        await tester.pumpAndSettle();
        expect(cursors, [null, 'next']);
        expect(find.text('Load more'), findsNothing);
        expect(
          find.text(
            enabled ? 'No reviews to show.' : 'No reviews yet for this dish.',
          ),
          findsOneWidget,
        );
      },
    );
  }
  testWidgets(
    'refresh-required append clears stale reviews and retry starts from the first page',
    (tester) async {
      final user = SafetyUser('viewer');
      final calls = <String>[];
      var requests = 0;
      await dish(
        tester,
        user: () => user,
        service: serviceFor(() => user, calls),
        reviews: (request) async {
          requests++;
          if (request['cursor'] != null) {
            throw FirebaseFunctionsException(
              code: 'failed-precondition',
              message: 'Refresh',
            );
          }
          return {
            'items': requests == 1 ? [review('one')] : [],
            'nextCursor': requests == 1 ? 'next' : null,
          };
        },
      );
      final more = find.widgetWithText(OutlinedButton, 'Load more');
      await tester.ensureVisible(more);
      await tester.tap(more);
      await tester.pumpAndSettle();
      expect(find.text('Review one'), findsNothing);
      expect(find.text('Retry reviews'), findsOneWidget);
      await tester.ensureVisible(find.text('Retry reviews'));
      await tester.tap(find.text('Retry reviews'));
      await tester.pumpAndSettle();
      expect(requests, 3);
      expect(find.text('No reviews to show.'), findsOneWidget);
    },
  );
  testWidgets(
    'blocked list is bounded and unblocks a reviewer without any surviving public profile',
    (tester) async {
      final user = SafetyUser('viewer');
      final calls = <String>[];
      final cursors = <String?>[];
      final service = ReviewerSafetyService(
        currentUser: () => user,
        pageReader: (uid, after) async {
          expect(uid, 'viewer');
          cursors.add(after);
          return after == null
              ? const BlockedReviewerPage([
                  BlockedReviewer('reviewer'),
                ], 'reviewer')
              : const BlockedReviewerPage([
                  BlockedReviewer('deleted-profile'),
                ], null);
        },
        boundary: (name, request) async {
          calls.add(name);
          expect(request['expectedUserId'], 'viewer');
          expect(request['targetUserId'], 'deleted-profile');
          if (name == 'unblockReviewer') {
            expect(request['expectedRevision'], 4);
            expect(request.containsKey('supportingReviewId'), false);
          }
          return {
            'schemaVersion': 1,
            'targetUserId': 'deleted-profile',
            'blocked': name == 'getReviewerSafetyStatus',
            'revision': 4,
          };
        },
      );
      await tester.pumpWidget(
        MaterialApp(
          home: BlockedReviewersScreen(
            expectedUserId: 'viewer',
            service: service,
            testCurrentUserProvider: () => user,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(cursors, [null]);
      await tester.tap(find.text('Load more'));
      await tester.pumpAndSettle();
      expect(cursors, [null, 'reviewer']);
      final row = find.ancestor(
        of: find.text('deleted-profile'),
        matching: find.byType(ListTile),
      );
      await tester.tap(
        find.descendant(of: row, matching: find.text('Unblock')),
      );
      await tester.pumpAndSettle();
      expect(calls, ['getReviewerSafetyStatus', 'unblockReviewer']);
      expect(find.text('deleted-profile'), findsNothing);
    },
  );
  testWidgets('blocked private page is discarded on account switch', (
    tester,
  ) async {
    User? user = SafetyUser('viewer');
    final pending = Completer<BlockedReviewerPage>();
    final service = ReviewerSafetyService(
      currentUser: () => user,
      pageReader: (_, _) => pending.future,
    );
    await tester.pumpWidget(
      MaterialApp(
        home: BlockedReviewersScreen(
          expectedUserId: 'viewer',
          service: service,
          testCurrentUserProvider: () => user,
        ),
      ),
    );
    await tester.pump();
    user = SafetyUser('other');
    pending.complete(
      const BlockedReviewerPage([BlockedReviewer('private')], null),
    );
    await tester.pumpAndSettle();
    expect(find.text('private'), findsNothing);
    expect(find.text('Reviewer safety session changed.'), findsOneWidget);
  });
  testWidgets(
    'unblocking the visible page keeps Load more when further private records remain',
    (tester) async {
      final user = SafetyUser('viewer');
      final service = ReviewerSafetyService(
        currentUser: () => user,
        pageReader: (_, _) async => const BlockedReviewerPage([
          BlockedReviewer('reviewer'),
        ], 'reviewer'),
        boundary: (name, _) async => {
          'schemaVersion': 1,
          'targetUserId': 'reviewer',
          'blocked': name == 'getReviewerSafetyStatus',
          'revision': 1,
        },
      );
      await tester.pumpWidget(
        MaterialApp(
          home: BlockedReviewersScreen(
            expectedUserId: 'viewer',
            service: service,
            testCurrentUserProvider: () => user,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Unblock'));
      await tester.pumpAndSettle();
      expect(find.text('You have no blocked reviewers.'), findsNothing);
      expect(find.text('Load more'), findsOneWidget);
    },
  );
  testWidgets(
    'stale block revision shows refresh guidance without an automatic mutation retry',
    (tester) async {
      final user = SafetyUser('viewer');
      var writes = 0;
      final service = ReviewerSafetyService(
        currentUser: () => user,
        boundary: (name, request) async {
          if (name == 'blockReviewer') {
            writes++;
            throw FirebaseFunctionsException(
              code: 'failed-precondition',
              message: 'Changed',
            );
          }
          return {
            'schemaVersion': 1,
            'targetUserId': 'reviewer',
            'blocked': false,
            'revision': 1,
          };
        },
      );
      await dish(tester, user: () => user, service: service);
      await openBlock(tester);
      await tester.tap(find.widgetWithText(FilledButton, 'Block Reviewer'));
      await tester.pumpAndSettle();
      expect(writes, 1);
      expect(
        find.text('Reviewer preferences changed. Refresh and try again.'),
        findsOneWidget,
      );
      expect(find.text('Reviewer blocked.'), findsNothing);
    },
  );
  for (final enabled in [false, true]) {
    testWidgets(
      'My Profile exposes Blocked Reviewers only behind safety gate ($enabled)',
      (tester) async {
        ReviewerSafetyCustomerUi.testEnabled = enabled;
        final user = SafetyUser('viewer');
        var pages = 0;
        final service = ReviewerSafetyService(
          currentUser: () => user,
          pageReader: (_, _) async {
            pages++;
            return const BlockedReviewerPage([], null);
          },
        );
        await tester.pumpWidget(
          MaterialApp(
            home: CustomerProfileScreen(
              currentUser: user,
              testCurrentUserProvider: () => user,
              testProfileLoader: (_) async => const BiteScoreUserProfileData(
                publicDisplayName: 'Me',
                chosenUsername: null,
                fallbackUsername: 'anon1',
                favoriteRestaurants: [],
                favoriteSaverRestaurants: [],
                favoriteDishEntries: [],
                favoriteCoupons: [],
                reviews: [],
                badgeLabel: 'New Reviewer',
                reviewCount: 0,
                helpfulVotesReceived: 0,
                accountAgeDays: 0,
                moderationFlagCount: 0,
                contributionPoints: 0,
              ),
              testLocalExpertBadgesLoader: (_) async => [],
              testReviewerSafetyService: service,
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(
          find.text('Blocked Reviewers'),
          enabled ? findsOneWidget : findsNothing,
        );
        expect(pages, 0);
        if (enabled) {
          await tester.tap(find.text('Blocked Reviewers'));
          await tester.pumpAndSettle();
          expect(find.text('You have no blocked reviewers.'), findsOneWidget);
          expect(pages, 1);
        }
      },
    );
  }
}
