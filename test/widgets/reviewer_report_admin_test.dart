import 'package:coupon_app/models/rating_admin_paging_models.dart';
import 'package:coupon_app/models/review_report.dart';
import 'package:coupon_app/services/rating_admin_paging_service.dart';
import 'package:coupon_app/widgets/rating_admin_paged_dashboard.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'rating_admin_paged_dashboard_test.dart' show page;

Map<String, Object?> report({bool supportingReview = false}) => {
  'kind': 'reportedReviews',
  'schemaVersion': 1,
  'reportScope': 'reviewer',
  'id': 'reviewer-report',
  'reportId': 'reviewer-report',
  'reportingUserId': 'reporter',
  'reportedUserId': 'target',
  'reason': 'Harassment',
  'status': 'pending',
  'reportCreatedAtMillis': 1123,
  'reportUpdatedAtMillis': 1123,
  'evidence': {
    'publicDisplayName': 'Captured name',
    'capturedAtMillis': 1123,
    'supportingReview': supportingReview
        ? {
            'reviewId': 'deleted-review',
            'dishId': 'dish',
            'restaurantId': 'restaurant',
            'headline': 'Captured headline',
            'notes': 'Captured notes',
            'textTruncated': true,
          }
        : null,
  },
};

void main() {
  test(
    'reviewer model is distinct, bounded, and does not fabricate a review',
    () {
      final record = RatingAdminQueueRecord.fromJson(report());
      expect(record.isReviewerReport, isTrue);
      expect(record.reviewerReport.reportedUserId, 'target');
      expect(record.reviewerReport.supportingReviewId, isNull);
      expect(record.reviewerReport.capturedAt.millisecondsSinceEpoch, 1123);
      expect(() => record.reportedReview, throwsStateError);
      expect(() => record.reviewReport, throwsStateError);
      expect(
        ReviewReport.tryFromFirestore(report(), fallbackId: 'report'),
        isNull,
      );
      for (final extra in [
        {'review': <String, Object?>{}},
        {'reportedUserId': ''},
      ]) {
        expect(
          () => RatingAdminQueueRecord.fromJson({...report(), ...extra}),
          throwsFormatException,
        );
      }
      final oversized = report();
      (oversized['evidence'] as Map)['publicDisplayName'] = 'x' * 321;
      expect(
        () => RatingAdminQueueRecord.fromJson(oversized),
        throwsFormatException,
      );
    },
  );

  for (final supporting in [false, true]) {
    testWidgets(
      'reviewer Admin card displays evidence and dismisses without Delete Review ($supporting)',
      (tester) async {
        var dismissed = false;
        final service = RatingAdminPagingService(
          functionsBoundary: (_, _) async => page(
            items: dismissed ? [] : [report(supportingReview: supporting)],
            pageSize: 25,
            pageNumber: 1,
          ),
        );
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: RatingAdminQueuePagedView(
                kind: RatingAdminQueueKind.reportedReviews,
                service: service,
                onEditRestaurant: (_) async => false,
                onEditDish: (_) async => false,
                dismissReviewerReport: (id) async {
                  expect(id, 'reviewer-report');
                  dismissed = true;
                },
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text('Reviewer report'), findsOneWidget);
        expect(find.textContaining('Reported UID: target'), findsOneWidget);
        expect(
          find.textContaining(
            supporting
                ? 'Captured notes'
                : 'Profile report; no supporting review selected.',
          ),
          findsOneWidget,
        );
        expect(find.text('Delete Review'), findsNothing);
        await tester.ensureVisible(find.text('Dismiss Report'));
        await tester.tap(find.text('Dismiss Report'));
        await tester.pumpAndSettle();
        expect(dismissed, isTrue);
        expect(find.text('Reviewer report'), findsNothing);
        expect(tester.takeException(), isNull);
      },
    );
  }
}
