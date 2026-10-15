import 'dart:async';

import 'package:coupon_app/models/customer_bitescore_search.dart';
import 'package:coupon_app/screens/bitescore_dish_detail_screen.dart';
import 'package:coupon_app/services/app_mode_state_service.dart';
import 'package:coupon_app/services/customer_bitescore_reads.dart';
import 'package:coupon_app/services/customer_bitescore_runtime.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../services/customer_bitescore_reads_test.dart' show review, detail;
import '../services/customer_bitescore_search_service_test.dart'
    show dishProjection;

const emptyPage = <String, Object?>{'items': [], 'nextCursor': null};

Future<void> showDish(
  WidgetTester tester,
  CustomerBiteScoreReads reads, {
  String? targetReviewId,
  String? editReviewId,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: BiteScoreDishDetailScreen(
        entry: CustomerBiteScorePublicData.entry(dishProjection('dish')),
        testCustomerReads: reads,
        testCurrentUserProvider: () => null,
        targetReviewId: targetReviewId,
        editReviewId: editReviewId,
      ),
    ),
  );
  await tester.pump();
}

void main() {
  setUp(() => CustomerBiteScoreRuntime.testEnabled = true);
  tearDown(() {
    CustomerBiteScoreRuntime.testEnabled = null;
    AppModeStateService.setMode(AppMode.biteSaver);
  });

  for (final reviewsFirst in [true, false]) {
    testWidgets(
      'validated shell precedes pages; reviews first: $reviewsFirst',
      (tester) async {
        final authority = Completer<Object?>();
        final reviews = Completer<Object?>();
        final images = Completer<Object?>();
        final calls = <String>[];
        await showDish(
          tester,
          CustomerBiteScoreReads(
            actorKey: () => 'guest',
            boundary: (name, _) {
              calls.add(name);
              return switch (name) {
                'getCustomerBiteScoreDetail' => authority.future,
                'pageCustomerBiteScoreReviews' => reviews.future,
                _ => images.future,
              };
            },
          ),
        );
        expect(find.text('Same Dish'), findsNothing);
        expect(calls, ['getCustomerBiteScoreDetail']);
        await tester.pump(const Duration(seconds: 1));
        authority.complete(detail());
        await tester.pump();
        await tester.pump();
        expect(find.text('Same Dish'), findsOneWidget);
        expect(find.text('Kitchen'), findsOneWidget);
        expect(
          calls,
          containsAll([
            'pageCustomerBiteScoreReviews',
            'pageCustomerBiteScoreImages',
          ]),
        );
        expect(find.text('Loading reviews…'), findsOneWidget);
        expect(find.text('Loading photos…'), findsOneWidget);
        expect(find.text('No reviews yet for this dish.'), findsNothing);
        if (reviewsFirst) {
          reviews.complete({
            'items': [review('one')],
            'nextCursor': null,
          });
        } else {
          images.complete(emptyPage);
        }
        await tester.pumpAndSettle();
        expect(
          find.text('Loading reviews…'),
          reviewsFirst ? findsNothing : findsOneWidget,
        );
        expect(
          find.text('Loading photos…'),
          reviewsFirst ? findsOneWidget : findsNothing,
        );
        if (reviewsFirst) {
          images.complete(emptyPage);
        } else {
          reviews.complete({
            'items': [review('one')],
            'nextCursor': null,
          });
        }
        await tester.pumpAndSettle();
        expect(find.text('Review one'), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );
  }

  for (final failedImages in [true, false]) {
    testWidgets('independent failure and section retry: images $failedImages', (
      tester,
    ) async {
      var failed = false;
      var details = 0;
      var secondary = 0;
      await showDish(
        tester,
        CustomerBiteScoreReads(
          actorKey: () => 'guest',
          boundary: (name, _) async {
            if (name == 'getCustomerBiteScoreDetail') {
              details++;
              return detail();
            }
            if ((name == 'pageCustomerBiteScoreImages') == failedImages) {
              if (!failed) {
                failed = true;
                throw StateError('offline');
              }
            } else {
              secondary++;
            }
            return emptyPage;
          },
        ),
      );
      await tester.pumpAndSettle();
      final label = failedImages ? 'photos' : 'reviews';
      expect(find.text('Same Dish'), findsOneWidget);
      expect(find.text('Could not load $label.'), findsOneWidget);
      expect(find.text('Could not load dish details.'), findsNothing);
      expect(
        find.text('No reviews yet for this dish.'),
        failedImages ? findsOneWidget : findsNothing,
      );
      await tester.ensureVisible(find.text('Retry $label'));
      await tester.tap(find.text('Retry $label'));
      await tester.pumpAndSettle();
      expect(find.text('Could not load $label.'), findsNothing);
      expect(details, 1);
      expect(secondary, 1);
      expect(tester.takeException(), isNull);
    });
  }

  for (final field in ['publicVisible', 'identity', 'network']) {
    testWidgets('failed or unavailable authority never reveals entry: $field', (
      tester,
    ) async {
      final calls = <String>[];
      await showDish(
        tester,
        CustomerBiteScoreReads(
          actorKey: () => 'guest',
          boundary: (name, _) async {
            calls.add(name);
            if (field == 'network') throw StateError('unavailable');
            return {
              ...detail(),
              'dish': {
                ...dishProjection(field == 'identity' ? 'wrong' : 'dish'),
                if (field == 'publicVisible') 'publicVisible': false,
              },
            };
          },
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Same Dish'), findsNothing);
      expect(find.text('Could not load dish details.'), findsOneWidget);
      expect(calls, ['getCustomerBiteScoreDetail']);
    });
  }

  for (final edit in [true, false]) {
    testWidgets(
      'delayed review does not prematurely consume deep link: edit $edit',
      (tester) async {
        final pending = Completer<Object?>();
        final requests = <Map<String, Object?>>[];
        await showDish(
          tester,
          CustomerBiteScoreReads(
            actorKey: () => 'guest',
            boundary: (name, request) async {
              if (name == 'getCustomerBiteScoreDetail') return detail();
              if (name == 'pageCustomerBiteScoreReviews') {
                requests.add(request);
                return pending.future;
              }
              return emptyPage;
            },
          ),
          targetReviewId: edit ? null : 'target',
          editReviewId: edit ? 'target' : null,
        );
        await tester.pumpAndSettle();
        expect(requests.single['targetReviewId'], 'target');
        expect(find.text('That review could not be located.'), findsNothing);
        pending.complete({
          'items': [review('target')],
          'nextCursor': null,
        });
        await tester.pumpAndSettle();
        expect(find.text('Review target'), findsOneWidget);
        expect(find.text('That review could not be located.'), findsNothing);
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets('rapid open back open discards disposed secondary responses', (
    tester,
  ) async {
    final oldReviews = Completer<Object?>();
    final oldImages = Completer<Object?>();
    var opens = 0;
    final reads = CustomerBiteScoreReads(
      actorKey: () => 'guest',
      boundary: (name, _) async {
        if (name == 'getCustomerBiteScoreDetail') {
          opens++;
          return detail();
        }
        if (opens == 1) {
          return name == 'pageCustomerBiteScoreReviews'
              ? oldReviews.future
              : oldImages.future;
        }
        return emptyPage;
      },
    );
    final nav = GlobalKey<NavigatorState>();
    await tester.pumpWidget(
      MaterialApp(
        navigatorKey: nav,
        home: const Scaffold(body: Text('Home')),
      ),
    );
    void open() => nav.currentState!.push(
      MaterialPageRoute<void>(
        builder: (_) => BiteScoreDishDetailScreen(
          entry: CustomerBiteScorePublicData.entry(dishProjection('dish')),
          testCustomerReads: reads,
          testCurrentUserProvider: () => null,
        ),
      ),
    );
    open();
    await tester.pumpAndSettle();
    expect(find.text('Loading reviews…'), findsOneWidget);
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('Home'), findsOneWidget);
    open();
    await tester.pumpAndSettle();
    oldReviews.complete({
      'items': [review('stale')],
      'nextCursor': null,
    });
    oldImages.completeError(StateError('late failure'));
    await tester.pumpAndSettle();
    expect(find.text('Review stale'), findsNothing);
    expect(find.text('No reviews yet for this dish.'), findsOneWidget);
    expect(find.text('Could not load photos.'), findsNothing);
    expect(opens, 2);
    expect(tester.takeException(), isNull);
  });
  for (final appendReviews in [true, false]) {
    testWidgets(
      'photo handoff retains arriving photos and cursor; review append $appendReviews',
      (tester) async {
        final initialImages = Completer<Object?>();
        final reviewAppend = Completer<Object?>();
        final imageCursors = <Object?>[];
        final image = <String, Object?>{
          'id': 'photo',
          'dishId': 'dish',
          'restaurantId': 'restaurant-1',
          'imageUrl': 'https://example.test/photo.jpg',
          'sortOrder': 0,
          'helpfulCount': 0,
          'notHelpfulCount': 0,
          'createdAtMs': 100,
        };
        await showDish(
          tester,
          CustomerBiteScoreReads(
            actorKey: () => 'guest',
            boundary: (name, request) async {
              if (name == 'getCustomerBiteScoreDetail') return detail();
              if (name == 'pageCustomerBiteScoreReviews') {
                if (request['cursor'] != null) return reviewAppend.future;
                return {
                  'items': [
                    {...review('one'), 'image': image},
                  ],
                  'nextCursor': appendReviews ? 'reviews-next' : null,
                };
              }
              imageCursors.add(request['cursor']);
              return request['cursor'] == null
                  ? initialImages.future
                  : emptyPage;
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
        if (appendReviews) {
          await tester.ensureVisible(
            find.widgetWithText(OutlinedButton, 'Load more'),
          );
          await tester.tap(find.widgetWithText(OutlinedButton, 'Load more'));
          await tester.pump();
        } else {
          await tester.ensureVisible(thumbnail);
          await tester.tap(thumbnail);
          await tester.pumpAndSettle();
          expect(find.byType(BiteScoreDishImageGalleryScreen), findsNothing);
          expect(find.text('Loading photos…'), findsOneWidget);
          await tester.tap(thumbnail);
          await tester.pump();
        }
        initialImages.complete({
          'items': [image],
          'nextCursor': 'images-next',
        });
        await tester.pumpAndSettle();
        if (appendReviews) {
          reviewAppend.complete({
            'items': [review('two')],
            'nextCursor': null,
          });
          await tester.pumpAndSettle();
          await tester.ensureVisible(thumbnail);
          await tester.tap(thumbnail);
          await tester.pumpAndSettle();
        }
        final gallery = tester.widget<BiteScoreDishImageGalleryScreen>(
          find.byType(BiteScoreDishImageGalleryScreen),
        );
        expect(gallery.images.map((image) => image.id), ['photo']);
        expect(gallery.initialCursor, 'images-next');
        await tester.tap(find.widgetWithText(TextButton, 'Load more photos'));
        await tester.pumpAndSettle();
        expect(imageCursors, [null, 'images-next']);
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        await tester.ensureVisible(thumbnail);
        await tester.tap(thumbnail);
        await tester.pumpAndSettle();
        expect(find.byType(BiteScoreDishImageGalleryScreen), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );
  }
}
