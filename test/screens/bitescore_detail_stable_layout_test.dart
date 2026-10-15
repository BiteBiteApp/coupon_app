import 'dart:async';

import 'package:coupon_app/models/customer_bitescore_search.dart';
import 'package:coupon_app/screens/bitescore_dish_detail_screen.dart';
import 'package:coupon_app/services/app_mode_state_service.dart';
import 'package:coupon_app/services/customer_bitescore_reads.dart';
import 'package:coupon_app/services/customer_bitescore_runtime.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../services/customer_bitescore_search_service_test.dart'
    show dishProjection;
import '../services/customer_bitescore_reads_test.dart' show detail;

const _emptyPage = <String, Object?>{'items': [], 'nextCursor': null};
const _loadingKey = ValueKey('bitescore-dish-image-loading-placeholder');
const _missingKey = ValueKey('bitescore-dish-add-image-placeholder');

Future<void> _showDish(
  WidgetTester tester,
  CustomerBiteScoreReads reads, {
  double scale = 1,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(scale)),
        child: child!,
      ),
      home: BiteScoreDishDetailScreen(
        entry: CustomerBiteScorePublicData.entry(dishProjection('dish')),
        testCustomerReads: reads,
        testCurrentUserProvider: () => null,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  setUp(() => CustomerBiteScoreRuntime.testEnabled = true);
  tearDown(() {
    CustomerBiteScoreRuntime.testEnabled = null;
    AppModeStateService.setMode(AppMode.biteSaver);
  });

  for (final hasPhoto in [true, false]) {
    for (final scale in [1.0, 2.0, 3.0]) {
      testWidgets(
        'photo geometry and controls remain stable at 320dp scale $scale, photo $hasPhoto',
        (tester) async {
          tester.view.physicalSize = const Size(320, 1200);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.reset);
          final images = Completer<Object?>();
          final reviews = Completer<Object?>();
          await _showDish(
            tester,
            CustomerBiteScoreReads(
              actorKey: () => 'guest',
              boundary: (name, _) async {
                if (name == 'getCustomerBiteScoreDetail') {
                  return {
                    ...detail(),
                    'dish': {
                      ...dishProjection('dish'),
                      if (hasPhoto)
                        'primaryImageUrl': 'https://example.test/photo.jpg',
                    },
                  };
                }
                return name == 'pageCustomerBiteScoreReviews'
                    ? reviews.future
                    : images.future;
              },
            ),
            scale: scale,
          );
          final loading = tester.getRect(find.byKey(_loadingKey));
          expect(loading.height, BiteScoreDishImagePreview.imageSize.height);
          expect(
            loading.width,
            lessThanOrEqualTo(BiteScoreDishImagePreview.imageSize.width),
          );
          expect(find.byKey(_missingKey), findsNothing);
          expect(
            find.byKey(const ValueKey('bitescore-dish-add-image-button')),
            findsNothing,
          );
          expect(find.text('Loading reviews…'), findsOneWidget);
          final title = tester.getRect(find.text('Same Dish'));
          final action = tester.getRect(find.text('Report dish').last);
          final reviewHeading = tester.getRect(find.text('Reviews'));
          images.complete(_emptyPage);
          await tester.pumpAndSettle();
          final completed = hasPhoto
              ? find.descendant(
                  of: find.byType(BiteScoreDishImagePreview),
                  matching: find.byType(Image),
                )
              : find.byKey(_missingKey);
          expect(tester.getRect(completed), loading);
          expect(tester.getRect(find.text('Same Dish')), title);
          expect(tester.getRect(find.text('Report dish').last), action);
          expect(tester.getRect(find.text('Reviews')), reviewHeading);
          expect(find.text('Loading reviews…'), findsOneWidget);
          expect(
            find.byKey(const ValueKey('bitescore-dish-add-image-button')),
            hasPhoto ? findsNothing : findsOneWidget,
          );
          if (!hasPhoto) {
            expect(
              tester
                  .widget<FilledButton>(
                    find.byKey(
                      const ValueKey('bitescore-dish-add-image-button'),
                    ),
                  )
                  .onPressed,
              isNotNull,
            );
          }
          expect(tester.takeException(), isNull);
          reviews.complete(_emptyPage);
          await tester.pumpAndSettle();
          expect(find.text('No reviews yet for this dish.'), findsOneWidget);
          expect(tester.takeException(), isNull);
        },
      );
    }
  }

  testWidgets(
    'photo error retains Retry and restores reserved space during retry',
    (tester) async {
      final first = Completer<Object?>();
      final retry = Completer<Object?>();
      var calls = 0;
      await _showDish(
        tester,
        CustomerBiteScoreReads(
          actorKey: () => 'guest',
          boundary: (name, _) async {
            if (name == 'getCustomerBiteScoreDetail') return detail();
            if (name == 'pageCustomerBiteScoreReviews') return _emptyPage;
            return ++calls == 1 ? first.future : retry.future;
          },
        ),
      );
      final reserved = tester.getRect(find.byKey(_loadingKey));
      first.completeError(StateError('offline'));
      await tester.pumpAndSettle();
      expect(find.text('Could not load photos.'), findsOneWidget);
      expect(find.byKey(_missingKey), findsNothing);
      expect(find.text('No reviews yet for this dish.'), findsOneWidget);
      await tester.tap(find.text('Retry photos'));
      await tester.pumpAndSettle();
      expect(tester.getRect(find.byKey(_loadingKey)), reserved);
      expect(find.byKey(_missingKey), findsNothing);
      retry.complete(_emptyPage);
      await tester.pumpAndSettle();
      expect(calls, 2);
      expect(tester.getRect(find.byKey(_missingKey)), reserved);
      expect(find.text('Could not load photos.'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'loading reviews uses established empty-state padding without a height estimate',
    (tester) async {
      final reviews = Completer<Object?>();
      await _showDish(
        tester,
        CustomerBiteScoreReads(
          actorKey: () => 'guest',
          boundary: (name, _) async {
            if (name == 'getCustomerBiteScoreDetail') return detail();
            return name == 'pageCustomerBiteScoreReviews'
                ? reviews.future
                : _emptyPage;
          },
        ),
      );
      final loading = find
          .ancestor(
            of: find.text('Loading reviews…'),
            matching: find.byType(Container),
          )
          .first;
      final bounds = tester.getRect(loading);
      reviews.complete(_emptyPage);
      await tester.pumpAndSettle();
      final empty = find
          .ancestor(
            of: find.text('No reviews yet for this dish.'),
            matching: find.byType(Container),
          )
          .first;
      expect(tester.getRect(empty), bounds);
      expect(tester.takeException(), isNull);
    },
  );
}
