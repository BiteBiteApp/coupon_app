import 'package:coupon_app/models/customer_bitescore_search.dart';
import 'package:coupon_app/models/dish_review.dart';
import 'package:coupon_app/models/rating_admin_paging_models.dart';
import 'package:coupon_app/models/review_report.dart';
import 'package:coupon_app/screens/bitescore_dish_detail_screen.dart';
import 'package:coupon_app/services/app_mode_state_service.dart';
import 'package:coupon_app/services/bitescore_service.dart';
import 'package:coupon_app/services/customer_bitescore_reads.dart';
import 'package:coupon_app/services/customer_bitescore_runtime.dart';
import 'package:coupon_app/services/rating_admin_paging_service.dart';
import 'package:coupon_app/widgets/rating_admin_paged_dashboard.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../services/customer_bitescore_reads_test.dart' show review, detail;
import '../services/customer_bitescore_search_service_test.dart'
    show dishProjection;
import '../widgets/rating_admin_paged_dashboard_test.dart' show page;

const reasons = [
  'Spam',
  'Harassment',
  'Off-topic',
  'Suspicious or fake',
  'Profanity / Inappropriate Content',
  'Threats or Hate Speech',
  'Private Personal Information',
  'Other',
];

Future<void> openReport(
  WidgetTester tester, {
  required Future<bool> Function(DishReview, String) submit,
  bool pending = false,
  bool allowed = true,
  double dialogScale = 1,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(dialogScale)),
        child: child!,
      ),
      home: MediaQuery.withNoTextScaling(
        child: BiteScoreDishDetailScreen(
          entry: CustomerBiteScorePublicData.entry(dishProjection('dish')),
          testCurrentUserProvider: () => null,
          testWriteGate: (_) async => allowed,
          testReviewReporter: submit,
          testCustomerReads: CustomerBiteScoreReads(
            actorKey: () => 'guest',
            boundary: (name, _) async {
              if (name == 'getCustomerBiteScoreDetail') return detail();
              return {
                'items': name == 'pageCustomerBiteScoreReviews'
                    ? [
                        {...review('one'), 'hasPendingUserReport': pending},
                      ]
                    : [],
                'nextCursor': null,
              };
            },
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  final actions = find.byTooltip('Review actions');
  await tester.ensureVisible(actions);
  await tester.tap(actions);
  await tester.pumpAndSettle();
  if (!pending) {
    await tester.tap(find.text('Report review'));
    await tester.pumpAndSettle();
  }
}

void main() {
  setUp(() => CustomerBiteScoreRuntime.testEnabled = true);
  tearDown(() {
    CustomerBiteScoreRuntime.testEnabled = null;
    AppModeStateService.setMode(AppMode.biteSaver);
  });

  for (final reason in reasons) {
    testWidgets('report selection and storage/Admin round trip: $reason', (
      tester,
    ) async {
      ReviewReport? stored;
      DishReview? reported;
      await openReport(
        tester,
        submit: (value, text) async {
          reported = value;
          final record = ReviewReport(
            id: 'report',
            reviewId: value.id,
            dishId: value.dishId,
            restaurantId: value.restaurantId,
            reportingUserId: 'reporter',
            reason: text,
            status: 'pending',
          );
          stored = ReviewReport.tryFromFirestore(
            record.toFirestoreMap(),
            fallbackId: 'report',
          );
          return true;
        },
      );
      await tester.tap(find.byType(DropdownButtonFormField<String>));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text(reason).last);
      await tester.tap(find.text(reason).last);
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Submit'));
      await tester.pumpAndSettle();
      expect(stored!.reason, reason);
      expect(stored!.reviewId, 'one');
      expect(stored!.dishId, 'dish');
      expect(stored!.restaurantId, 'restaurant-1');
      expect(find.text('Review reported.'), findsOneWidget);
      expect(find.text('Review one'), findsOneWidget);
      final legacyEntry = BiteScoreReportedReviewAdminEntry(
        review: reported!,
        dishName: 'Dish',
        restaurantName: 'Restaurant',
        reviewerDisplayName: 'Reviewer',
        reports: [stored!],
      );
      expect(legacyEntry.distinctReasons, [reason]);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: RatingAdminQueuePagedView(
              kind: RatingAdminQueueKind.reportedReviews,
              service: RatingAdminPagingService(
                functionsBoundary: (_, _) async => page(
                  items: [
                    {
                      'kind': 'reportedReviews',
                      'id': 'report',
                      'reportId': 'report',
                      'reviewId': stored!.reviewId,
                      'reportDishId': stored!.dishId,
                      'reportRestaurantId': stored!.restaurantId,
                      'reportingUserId': stored!.reportingUserId,
                      'reason': stored!.reason,
                      'status': stored!.status,
                      'reportCreatedAtMillis': null,
                      'reportUpdatedAtMillis': null,
                      'review':
                          {
                              ...reported!.toFirestoreMap(),
                              'createdAtMillis': null,
                              'updatedAtMillis': null,
                            }
                            ..remove('createdAt')
                            ..remove('updatedAt'),
                      'dishName': 'Dish',
                      'restaurantName': 'Restaurant',
                      'reviewerDisplayName': 'Reviewer',
                    },
                  ],
                  pageSize: 25,
                  pageNumber: 1,
                ),
              ),
              onEditRestaurant: (_) async => false,
              onEditDish: (_) async => false,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('Reason: $reason'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('cancel never submits; optional reason remains supported', (
    tester,
  ) async {
    final submitted = <String>[];
    await openReport(
      tester,
      submit: (_, text) async {
        submitted.add(text);
        return true;
      },
    );
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(submitted, isEmpty);
    await tester.tap(find.byTooltip('Review actions'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Report review'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Submit'));
    await tester.pumpAndSettle();
    expect(submitted, ['']);
  });

  testWidgets(
    'duplicate submission result keeps the review; existing pending report disables action',
    (tester) async {
      var calls = 0;
      Future<bool> submit(DishReview _, String text) async {
        calls++;
        return false;
      }

      await openReport(tester, submit: submit);
      await tester.tap(find.widgetWithText(FilledButton, 'Submit'));
      await tester.pumpAndSettle();
      expect(calls, 1);
      expect(find.text('You already reported this review.'), findsOneWidget);
      expect(find.text('Review one'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
      await openReport(tester, submit: submit, pending: true);
      final item = tester.widget<PopupMenuItem<String>>(
        find.ancestor(
          of: find.text('Review reported'),
          matching: find.byType(PopupMenuItem<String>),
        ),
      );
      expect(item.enabled, false);
      expect(calls, 1);
    },
  );

  testWidgets('denied authentication gate cannot open or submit report', (
    tester,
  ) async {
    var called = false;
    await openReport(
      tester,
      allowed: false,
      submit: (_, _) async {
        called = true;
        return true;
      },
    );
    expect(find.text('Report Review'), findsNothing);
    expect(called, false);
  });

  for (final scale in [1.0, 2.0, 3.0]) {
    testWidgets('review dialog at 320dp and text scale $scale', (tester) async {
      tester.view.physicalSize = const Size(320, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await openReport(
        tester,
        dialogScale: scale,
        submit: (_, _) async => true,
      );
      await tester.tap(find.byType(DropdownButtonFormField<String>));
      await tester.pumpAndSettle();
      for (final reason in reasons) {
        await tester.scrollUntilVisible(
          find.text(reason),
          80,
          scrollable: find.byType(Scrollable).last,
        );
        expect(tester.takeException(), isNull, reason: reason);
      }
      await tester.scrollUntilVisible(
        find.text(reasons[4]),
        -80,
        scrollable: find.byType(Scrollable).last,
      );
      await tester.ensureVisible(find.text(reasons[4]).last);
      await tester.pumpAndSettle();
      await tester.tap(find.text(reasons[4]).last);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      final submit = find.widgetWithText(FilledButton, 'Submit');
      await tester.ensureVisible(submit);
      await tester.tap(submit);
      await tester.pumpAndSettle();
      expect(find.text('Review reported.'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }
}
