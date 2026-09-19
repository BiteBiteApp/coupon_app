import 'package:coupon_app/services/coupon_admin_paging_service.dart';
import 'package:coupon_app/models/pagination/paged_models.dart';
import 'package:coupon_app/services/firestore_document_id.dart';
import 'package:coupon_app/services/restaurant_invite_service.dart';
import 'package:coupon_app/widgets/coupon_admin_paged_dashboard.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets(
    'report queue shows exact bounded identity and existing context',
    (tester) async {
      final restaurantId = 'bsr_${'R' * 43}';
      final couponId = 'bso_${'O' * 43}';
      final service = CouponAdminPagingService(
        functionsBoundary: (name, request) async {
          expect(name, 'listCouponAdminQueuePage');
          return <String, Object?>{
            'protocolVersion': pageProtocolVersion,
            'items': [
              <String, Object?>{
                'id': 'bounded-report',
                'kind': 'openReports',
                'reportType': 'coupon',
                'restaurantName': 'Reported Restaurant',
                'couponTitle': 'Reported Coupon',
                'restaurantId': restaurantId,
                'couponId': couponId,
                'reason': 'Incorrect information',
                'note': 'Please check.',
                'reporterUid': 'reporter',
                'status': 'open',
                'createdAtMillis': 1786200000000,
              },
            ],
            'pageSize': 25,
            'hasNext': false,
            'hasPrevious': false,
            'currentPageNumber': 1,
            'total': {'state': 'exact', 'value': 1},
            'queryFingerprint': 'a' * 64,
            'snapshotTimestampMs': 1786200000000,
            'capabilities': {
              'first': false,
              'previous': false,
              'numberedVisitedPages': true,
              'next': false,
              'last': false,
            },
          };
        },
      );
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: CouponAdminPagedDashboard(pagingService: service),
          ),
        ),
      );
      await tester.tap(find.text('Reports'));
      await tester.pumpAndSettle();
      expect(find.text('Restaurant: Reported Restaurant'), findsOneWidget);
      expect(find.text('Coupon: Reported Coupon'), findsOneWidget);
      expect(find.text('Restaurant ID: $restaurantId'), findsOneWidget);
      expect(find.text('Coupon ID: $couponId'), findsOneWidget);
      expect(find.text('Mark reviewed'), findsOneWidget);
      expect(find.text('Dismiss'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  Future<void> openDialog(
    WidgetTester tester,
    CouponAdminManualInviteCreator createInvite,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () => showDialog<RestaurantInviteCreationResult>(
                context: context,
                builder: (context) =>
                    CouponAdminManualInviteDialog(createInvite: createInvite),
              ),
              child: const Text('Open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).at(1), 'New Restaurant');
  }

  RestaurantInviteCreationResult result() =>
      const RestaurantInviteCreationResult(
        inviteId: 'invite-exact',
        token: 'one-time-token',
        inviteUrl: 'https://go.bitestar.app/invite/coupon/one-time-token',
        expiresAt: null,
      );

  testWidgets('exactly blank optional restaurant ID is sent as null', (
    tester,
  ) async {
    String? capturedRestaurantId = 'not-called';
    await openDialog(tester, ({
      required restaurantName,
      restaurantId,
      biteScoreCatalogRestaurantId,
      streetAddress,
      city,
      state,
      zipCode,
      phone,
      website,
      latitude,
      longitude,
    }) async {
      capturedRestaurantId = restaurantId;
      return result();
    });

    await tester.tap(find.text('Create Invite'));
    await tester.pumpAndSettle();

    expect(capturedRestaurantId, isNull);
  });

  testWidgets('valid optional restaurant ID is passed unchanged', (
    tester,
  ) async {
    String? capturedRestaurantId;
    await openDialog(tester, ({
      required restaurantName,
      restaurantId,
      biteScoreCatalogRestaurantId,
      streetAddress,
      city,
      state,
      zipCode,
      phone,
      website,
      latitude,
      longitude,
    }) async {
      capturedRestaurantId = restaurantId;
      return result();
    });
    await tester.enterText(find.byType(TextField).first, 'owner-account-exact');

    await tester.tap(find.text('Create Invite'));
    await tester.pumpAndSettle();

    expect(capturedRestaurantId, 'owner-account-exact');
  });

  for (final invalidInput in ['   ', ' owner-account-exact ']) {
    testWidgets('nonempty malformed ID remains exact: ${invalidInput.length}', (
      tester,
    ) async {
      String? capturedRestaurantId;
      await openDialog(tester, ({
        required restaurantName,
        restaurantId,
        biteScoreCatalogRestaurantId,
        streetAddress,
        city,
        state,
        zipCode,
        phone,
        website,
        latitude,
        longitude,
      }) async {
        capturedRestaurantId = restaurantId;
        if (restaurantId != null &&
            exactFirestoreDocumentId(restaurantId) == null) {
          throw ArgumentError('BiteSaver account ID is invalid.');
        }
        return result();
      });
      await tester.enterText(find.byType(TextField).first, invalidInput);

      await tester.tap(find.text('Create Invite'));
      await tester.pumpAndSettle();

      expect(capturedRestaurantId, invalidInput);
      expect(find.text('Create Coupon Invite'), findsOneWidget);
    });
  }
}
