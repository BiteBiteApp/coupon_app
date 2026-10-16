import 'package:coupon_app/models/rating_admin_paging_models.dart';
import 'package:coupon_app/models/review_report.dart';
import 'package:coupon_app/services/photo_report_service.dart';
import 'package:coupon_app/services/rating_admin_paging_service.dart';
import 'package:coupon_app/widgets/rating_admin_paged_dashboard.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../services/reviewer_safety_service_test.dart' show SafetyUser;
import 'rating_admin_paged_dashboard_test.dart' show page;

Map<String, Object?> report({String state = 'available'}) => {
  'kind': 'reportedReviews',
  'schemaVersion': 1,
  'reportScope': 'photo',
  'id': 'case',
  'reportId': 'case',
  'imageId': 'photo',
  'dishId': 'dish',
  'restaurantId': 'restaurant',
  'supportingReviewId': 'deleted-review',
  'reason': 'Other',
  'status': 'pending',
  'imageState': state,
  'imageUrl': state == 'available' ? 'https://example.test/photo.jpg' : null,
  'dishName': 'Food',
  'restaurantName': 'Restaurant',
};
void main() {
  test(
    'photo model is distinct; no fake review, private reporter, or copied evidence required',
    () {
      final record = RatingAdminQueueRecord.fromJson(report());
      expect(record.isPhotoReport, isTrue);
      expect(record.photoReport.imageId, 'photo');
      expect(() => record.reviewReport, throwsStateError);
      expect(() => record.reportedReview, throwsStateError);
      expect(
        ReviewReport.tryFromFirestore(report(), fallbackId: 'case'),
        isNull,
      );
      for (final change in [
        {'imageId': ''},
        {'imageState': 'wrong'},
        {'imageUrl': null},
        {'reportId': 'different'},
        {'reviewId': 'fake'},
      ]) {
        expect(
          () => RatingAdminQueueRecord.fromJson({...report(), ...change}),
          throwsFormatException,
        );
      }
    },
  );
  for (final action in ['dismiss', 'remove']) {
    testWidgets(
      'Admin $action handles exact photo with a missing review and confirms removal',
      (tester) async {
        var handled = false;
        final service = RatingAdminPagingService(
          functionsBoundary: (_, _) async => page(
            items: handled ? [] : [report()],
            pageSize: 25,
            pageNumber: 1,
          ),
        );
        final moderation = PhotoReportService(
          currentUser: () => SafetyUser('admin'),
          boundary: (name, data) async {
            expect(name, 'moderatePhotoReport');
            expect(data['reportId'], 'case');
            expect(data['imageId'], 'photo');
            expect(data['action'], action);
            handled = true;
            return {
              'schemaVersion': 1,
              'reportId': 'case',
              'imageId': 'photo',
              'status': action == 'dismiss' ? 'dismissed' : 'resolved',
            };
          },
        );
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: RatingAdminQueuePagedView(
                kind: RatingAdminQueueKind.reportedReviews,
                service: service,
                onEditRestaurant: (_) async => false,
                onEditDish: (_) async => false,
                photoReportService: moderation,
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text('Photo report'), findsOneWidget);
        expect(find.textContaining('Photo ID: photo'), findsOneWidget);
        expect(find.text('Delete Review'), findsNothing);
        await tester.ensureVisible(
          find.text(action == 'dismiss' ? 'Dismiss Report' : 'Remove Photo'),
        );
        await tester.tap(
          find.text(action == 'dismiss' ? 'Dismiss Report' : 'Remove Photo'),
        );
        await tester.pumpAndSettle();
        if (action == 'remove') {
          expect(handled, isFalse);
          expect(
            find.textContaining(
              'Other photos, reviews and ratings will remain.',
            ),
            findsOneWidget,
          );
          await tester.tap(
            find.widgetWithText(FilledButton, 'Remove Photo').last,
          );
          await tester.pumpAndSettle();
        }
        expect(handled, isTrue);
        expect(find.text('Photo report'), findsNothing);
        expect(tester.takeException(), isNull);
      },
    );
  }
  testWidgets(
    'changed/unavailable image state is truthful and cancel does not remove',
    (tester) async {
      for (final state in ['changed', 'unavailable', 'removed']) {
        await tester.pumpWidget(const SizedBox());
        final service = RatingAdminPagingService(
          functionsBoundary: (_, _) async =>
              page(items: [report(state: state)], pageSize: 25, pageNumber: 1),
        );
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: RatingAdminQueuePagedView(
                kind: RatingAdminQueueKind.reportedReviews,
                service: service,
                onEditRestaurant: (_) async => false,
                onEditDish: (_) async => false,
                photoReportService: PhotoReportService(
                  currentUser: () => SafetyUser('admin'),
                  boundary: (_, _) async => throw StateError('unexpected'),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.byType(Image), findsNothing);
        if (state == 'changed') {
          expect(find.text('Remove Photo'), findsNothing);
        } else {
          await tester.ensureVisible(find.text('Remove Photo'));
          await tester.tap(find.text('Remove Photo'));
          await tester.pumpAndSettle();
          await tester.tap(find.text('Cancel'));
          await tester.pumpAndSettle();
          expect(find.text('Photo report'), findsOneWidget);
        }
      }
    },
  );
}
