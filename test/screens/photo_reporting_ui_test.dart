import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/models/bitescore_dish.dart';
import 'package:coupon_app/models/bitescore_dish_image.dart';
import 'package:coupon_app/models/bitescore_restaurant.dart';
import 'package:coupon_app/screens/bitescore_dish_detail_screen.dart';
import 'package:coupon_app/services/customer_bitescore_runtime.dart';
import 'package:coupon_app/services/photo_report_service.dart';
import 'package:coupon_app/services/customer_bitescore_reads.dart';
import 'bitescore_detail_progressive_test.dart' show showDish;
import '../services/customer_bitescore_reads_test.dart' show review, detail;
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../services/reviewer_safety_service_test.dart' show SafetyUser;
import '../services/photo_report_service_test.dart' show photo;

void main() {
  setUp(() {
    CustomerBiteScoreRuntime.testEnabled = true;
    PhotoReportingUi.testEnabled = true;
  });
  tearDown(() {
    CustomerBiteScoreRuntime.testEnabled = null;
    PhotoReportingUi.testEnabled = null;
  });
  Future<void> open(
    WidgetTester tester, {
    List<BiteScoreDishImage>? images,
    PhotoReportBoundary? boundary,
    User? Function()? user,
    Future<bool> Function(BuildContext)? gate,
  }) async {
    final list = images ?? [photo(id: 'first'), photo(id: 'second')];
    final current = user ?? () => SafetyUser('A');
    await tester.pumpWidget(
      MaterialApp(
        home: BiteScoreDishImageGalleryScreen(
          dish: const BitescoreDish(
            id: 'dish',
            restaurantId: 'restaurant',
            restaurantName: 'Restaurant',
            name: 'Food',
            normalizedName: 'food',
          ),
          restaurant: const BitescoreRestaurant(
            id: 'restaurant',
            name: 'Restaurant',
            normalizedName: 'restaurant',
            address: '1 Main',
            city: 'City',
            state: 'FL',
            zipCode: '00000',
            location: GeoPoint(0, 0),
            restaurantWriteRevision: 0,
          ),
          images: list,
          imageUrls: list.map((i) => i.imageUrl).toList(),
          initialIndex: 0,
          loadCurrentVotes: (_) async => {},
          testCurrentUserProvider: current,
          canReport: gate ?? (_) async => true,
          photoReportService: PhotoReportService(
            currentUser: current,
            boundary:
                boundary ??
                (_, _) async => throw StateError('unexpected submission'),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> reason(WidgetTester tester) async {
    await tester.ensureVisible(find.byType(DropdownButtonFormField<String>));
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('Other'),
      200,
      scrollable: find.byType(Scrollable).last,
    );
    await tester.tap(find.text('Other').last);
    await tester.pumpAndSettle();
  }

  testWidgets(
    'review photo outside first gallery page retains trusted photo identity',
    (tester) async {
      final image = <String, Object?>{
        'id': 'review-photo',
        'dishId': 'dish',
        'restaurantId': 'restaurant-1',
        'reviewId': 'one',
        'imageUrl': 'https://example.test/review.jpg',
        'sortOrder': 0,
        'helpfulCount': 0,
        'notHelpfulCount': 0,
        'createdAtMs': 100,
        'reportTargetVersion': 'a' * 64,
      };
      await showDish(
        tester,
        CustomerBiteScoreReads(
          actorKey: () => 'guest',
          boundary: (name, request) async {
            if (name == 'getCustomerBiteScoreDetail') return detail();
            if (name == 'pageCustomerBiteScoreReviews') {
              return {
                'items': [
                  {...review('one'), 'image': image},
                ],
                'nextCursor': null,
              };
            }
            return {
              'items': [
                {
                  ...image,
                  'id': 'first-page-photo',
                  'reviewId': null,
                  'imageUrl': 'https://example.test/first.jpg',
                },
              ],
              'nextCursor': 'more-photos',
            };
          },
        ),
      );
      await tester.pumpAndSettle();
      final thumbnail = find.byWidgetPredicate(
        (widget) =>
            widget is Image &&
            widget.image is NetworkImage &&
            (widget.image as NetworkImage).url == image['imageUrl'],
      );
      await tester.ensureVisible(thumbnail);
      await tester.tap(thumbnail);
      await tester.pumpAndSettle();
      final gallery = tester.widget<BiteScoreDishImageGalleryScreen>(
        find.byType(BiteScoreDishImageGalleryScreen),
      );
      expect(gallery.images.map((i) => i.id), contains('review-photo'));
      expect(gallery.initialCursor, 'more-photos');
      expect(gallery.imageUrls[gallery.initialIndex], image['imageUrl']);
      expect(
        tester
            .widget<IconButton>(
              find.byKey(const ValueKey('bitescore-gallery-report-photo')),
            )
            .onPressed,
        isNotNull,
      );
    },
  );

  for (final scale in [1.0, 3.0]) {
    testWidgets('photo report remains usable at 320dp and text scale $scale', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1;
      tester.platformDispatcher.textScaleFactorTestValue = scale;
      addTearDown(tester.view.reset);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      await open(tester);
      await tester.tap(find.byTooltip('Next'));
      await tester.pumpAndSettle();
      expect(find.text('2 / 2'), findsOneWidget);
      await tester.tap(find.byTooltip('Previous'));
      await tester.pumpAndSettle();
      expect(find.text('1 / 2'), findsOneWidget);
      expect(find.byTooltip('Add Image'), findsOneWidget);
      await tester.tap(
        find.byKey(const ValueKey('bitescore-gallery-report-photo')),
      );
      await tester.pumpAndSettle();
      await reason(tester);
      await tester.ensureVisible(find.text('Cancel'));
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });
  }

  final flag = find.byKey(const ValueKey('bitescore-gallery-report-photo'));
  testWidgets(
    'Report Photo follows current selection and modal pins it if gallery changes',
    (tester) async {
      Map<String, Object?>? sent;
      await open(
        tester,
        boundary: (_, data) async {
          sent = data;
          return {
            'schemaVersion': 1,
            'imageId': data['imageId'],
            'reportId': 'case',
            'submitted': true,
          };
        },
      );
      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();
      final selectFirst = tester
          .widget<InkWell>(
            find.byKey(
              const ValueKey(
                'bitescore-gallery-thumbnail-https://example.test/first.jpg',
              ),
            ),
          )
          .onTap!;
      await tester.tap(flag);
      await tester.pumpAndSettle();
      expect(find.text('Report Photo'), findsOneWidget);
      expect(
        tester
            .widget<Image>(
              find.descendant(
                of: find.byType(AlertDialog),
                matching: find.byType(Image),
              ),
            )
            .image,
        const NetworkImage('https://example.test/second.jpg'),
      );
      selectFirst();
      await tester.pump();
      await reason(tester);
      await tester.tap(find.text('Submit'));
      await tester.pumpAndSettle();
      expect(sent?['imageId'], 'second');
      expect(
        find.text('Photo reported. An admin will review it.'),
        findsOneWidget,
      );
    },
  );
  testWidgets(
    'cancel does not submit; duplicate message leaves gallery usable',
    (tester) async {
      var calls = 0;
      await open(
        tester,
        boundary: (_, data) async {
          calls++;
          return {
            'schemaVersion': 1,
            'imageId': data['imageId'],
            'reportId': 'case',
            'submitted': false,
          };
        },
      );
      await tester.tap(flag);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(calls, 0);
      await tester.tap(flag);
      await tester.pumpAndSettle();
      await reason(tester);
      await tester.tap(find.text('Submit'));
      await tester.pumpAndSettle();
      expect(find.text('You already reported this photo.'), findsOneWidget);
      expect(calls, 1);
      expect(find.text('Next'), findsOneWidget);
    },
  );
  testWidgets('failure and retry reuse the exact receipt request', (
    tester,
  ) async {
    final requests = <String>[];
    await open(
      tester,
      boundary: (_, data) async {
        requests.add(data['requestId'] as String);
        if (requests.length == 1) throw StateError('offline');
        return {
          'schemaVersion': 1,
          'imageId': data['imageId'],
          'reportId': 'case',
          'submitted': true,
        };
      },
    );
    for (var i = 0; i < 2; i++) {
      await tester.tap(flag);
      await tester.pumpAndSettle();
      await reason(tester);
      await tester.tap(find.text('Submit'));
      await tester.pumpAndSettle();
    }
    expect(requests.length, 2);
    expect(requests[0], requests[1]);
  });
  testWidgets(
    'signed-out cancellation uses sign-in gate; signed-in unverified report is allowed',
    (tester) async {
      User? user;
      var gates = 0;
      var calls = 0;
      await open(
        tester,
        user: () => user,
        gate: (_) async {
          gates++;
          return false;
        },
        boundary: (_, _) async {
          calls++;
          return null;
        },
      );
      await tester.tap(flag);
      await tester.pumpAndSettle();
      expect(gates, 1);
      expect(calls, 0);
      expect(find.byType(AlertDialog), findsNothing);
      user = SafetyUser('A');
      await open(
        tester,
        user: () => user,
        gate: (_) async => true,
        boundary: (_, data) async {
          calls++;
          return {
            'schemaVersion': 1,
            'imageId': data['imageId'],
            'reportId': 'case',
            'submitted': true,
          };
        },
      );
      await tester.tap(flag);
      await tester.pumpAndSettle();
      await reason(tester);
      await tester.tap(find.text('Submit'));
      await tester.pumpAndSettle();
      expect(calls, 1);
    },
  );
  testWidgets(
    'account change while dialog is open cannot submit under replacement account',
    (tester) async {
      User? user = SafetyUser('A');
      var calls = 0;
      await open(
        tester,
        user: () => user,
        boundary: (_, _) async {
          calls++;
          return null;
        },
      );
      await tester.tap(flag);
      await tester.pumpAndSettle();
      user = SafetyUser('B');
      await reason(tester);
      await tester.tap(find.text('Submit'));
      await tester.pumpAndSettle();
      expect(calls, 0);
    },
  );
  testWidgets(
    'default gate hides action; ambiguous and old URL-only identity cannot report',
    (tester) async {
      PhotoReportingUi.testEnabled = null;
      await open(tester);
      expect(flag, findsNothing);
      PhotoReportingUi.testEnabled = true;
      await open(
        tester,
        images: [
          photo(),
          photo(id: 'other').copyWith(),
        ],
      ); // unique source records first
      final duplicate = BiteScoreDishImage(
        id: 'other',
        dishId: 'dish',
        restaurantId: 'restaurant',
        uploadedByUserId: '',
        imageUrl: photo().imageUrl,
        storagePath: '',
        reportTargetVersion: 'b' * 64,
      );
      await tester.pumpWidget(const SizedBox());
      await open(tester, images: [photo(), duplicate]);
      expect(tester.widget<IconButton>(flag).onPressed, isNull);
      await tester.pumpWidget(const SizedBox());
      await open(
        tester,
        images: [
          const BiteScoreDishImage(
            id: 'legacy',
            dishId: 'dish',
            restaurantId: 'restaurant',
            uploadedByUserId: '',
            imageUrl: 'https://example.test/legacy.jpg',
            storagePath: '',
          ),
        ],
      );
      expect(tester.widget<IconButton>(flag).onPressed, isNull);
    },
  );
}
