import 'package:coupon_app/models/customer_bitesaver_search.dart';
import 'package:coupon_app/screens/restaurant_menu_screen.dart';
import 'package:coupon_app/services/customer_bitesaver_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

String _opaque(String prefix, String character) => '$prefix${character * 43}';

CustomerBiteSaverMenuPageResult _page({
  required List<Map<String, Object?>> entries,
  String? cursor,
  String state = 'available',
  String style = 'biteSaver',
}) => CustomerBiteSaverMenuPageResult.fromJson(<String, Object?>{
  'schemaVersion': 1,
  'state': state,
  'attemptGeneration': 2,
  'queryFingerprint': 'a' * 64,
  'restaurantId': _opaque('bsr_', 'r'),
  'menuStyle': style,
  'entries': entries,
  'nextCursor': cursor,
  'hasMore': cursor != null,
});

Map<String, Object?> _item(
  String key,
  String name, {
  String price = '',
  String category = 'Dinner',
  int sortOrder = 0,
}) => <String, Object?>{
  'kind': 'item',
  'key': key,
  'name': name,
  'description': 'Authored description for $name',
  'price': price,
  'category': category,
  'sortOrder': sortOrder,
};

Future<void> _openTestViewer(BuildContext context, WidgetBuilder builder) =>
    Navigator.of(context).push(MaterialPageRoute<void>(builder: builder));

void main() {
  testWidgets('append retry retains entries and reuses the consumed cursor', (
    tester,
  ) async {
    final requestedCursors = <String?>[];
    var appendAttempts = 0;
    Future<CustomerBiteSaverMenuPageResult> loader(String? cursor) async {
      requestedCursors.add(cursor);
      if (cursor == null) {
        return _page(
          entries: <Map<String, Object?>>[
            _item(_opaque('bsme_', 'a'), 'First item', price: 'Market price'),
          ],
          cursor: 'bsc1.menu-cursor',
        );
      }
      appendAttempts += 1;
      if (appendAttempts == 1) {
        throw const CustomerBiteSaverServiceException(
          kind: CustomerBiteSaverServiceFailureKind.transport,
          code: 'unavailable',
          message: 'Synthetic transport failure.',
        );
      }
      return _page(
        entries: <Map<String, Object?>>[
          _item(_opaque('bsme_', 'b'), 'Second item', price: r'$12.50'),
        ],
      );
    }

    await tester.pumpWidget(
      MaterialApp(
        home: RestaurantMenuScreen.fromCustomerBiteSaver(
          restaurantName: 'Fixture Cafe',
          pageLoader: loader,
          openImageViewer: _openTestViewer,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('First item'), findsOneWidget);
    expect(find.text('Market price'), findsOneWidget);

    await tester.tap(find.text('Load more'));
    await tester.pumpAndSettle();
    expect(find.text('First item'), findsOneWidget);
    expect(find.text('Could not load more menu entries.'), findsOneWidget);
    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();

    expect(find.text('First item'), findsOneWidget);
    expect(find.text('Second item'), findsOneWidget);
    expect(find.text(r'$12.50'), findsOneWidget);
    expect(requestedCursors, <String?>[
      null,
      'bsc1.menu-cursor',
      'bsc1.menu-cursor',
    ]);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'confirmed source invalidation clears previously loaded content',
    (tester) async {
      Future<CustomerBiteSaverMenuPageResult> loader(String? cursor) async {
        if (cursor == null) {
          return _page(
            entries: <Map<String, Object?>>[
              _item(_opaque('bsme_', 'c'), 'Must be cleared'),
            ],
            cursor: 'bsc1.changed-source',
          );
        }
        throw const CustomerBiteSaverServiceException(
          kind: CustomerBiteSaverServiceFailureKind.callable,
          code: 'functions/failed-precondition',
          message: 'The source changed.',
        );
      }

      await tester.pumpWidget(
        MaterialApp(
          home: RestaurantMenuScreen.fromCustomerBiteSaver(
            restaurantName: 'Fixture Cafe',
            pageLoader: loader,
            openImageViewer: _openTestViewer,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Must be cleared'), findsOneWidget);
      await tester.tap(find.text('Load more'));
      await tester.pumpAndSettle();

      expect(find.text('Must be cleared'), findsNothing);
      expect(
        find.text('This menu access changed. Return to search and try again.'),
        findsOneWidget,
      );
    },
  );

  testWidgets('empty, mixed content, and large text remain reachable', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(520, 760);
    tester.platformDispatcher.textScaleFactorTestValue = 2;
    addTearDown(tester.view.reset);
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    var empty = true;

    Future<CustomerBiteSaverMenuPageResult> loader(String? cursor) async {
      if (empty) return _page(entries: const <Map<String, Object?>>[]);
      return _page(
        style: 'biteScore',
        entries: <Map<String, Object?>>[
          _item(
            _opaque('bsme_', 'd'),
            'Long accessible menu item',
            category: 'Specials',
          ),
          <String, Object?>{
            'kind': 'section',
            'key': _opaque('bsme_', 'e'),
            'title': 'Important section',
            'body': 'A long authored section remains vertically scrollable.',
            'sortOrder': 1,
          },
        ],
      );
    }

    await tester.pumpWidget(
      MaterialApp(
        home: RestaurantMenuScreen.fromCustomerBiteSaver(
          restaurantName: 'Fixture Cafe',
          pageLoader: loader,
          openImageViewer: _openTestViewer,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Menu not available yet.'), findsOneWidget);

    empty = false;
    await tester.pumpWidget(
      MaterialApp(
        home: RestaurantMenuScreen.fromCustomerBiteSaver(
          key: const ValueKey<String>('mixed-menu'),
          restaurantName: 'Fixture Cafe',
          pageLoader: loader,
          openImageViewer: _openTestViewer,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Specials'), findsOneWidget);
    expect(find.text('Long accessible menu item'), findsOneWidget);
    await tester.ensureVisible(find.text('Important section'));
    expect(find.text('Important section'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('mixed menu retains image thumbnails and full-screen viewer', (
    tester,
  ) async {
    final images = List<Map<String, Object?>>.generate(
      4,
      (index) => <String, Object?>{
        'kind': 'image',
        'key': _opaque('bsme_', String.fromCharCode(102 + index)),
        'imageUrl': 'https://example.test/menu-$index.webp',
        'sortOrder': index,
      },
    );
    await tester.pumpWidget(
      MaterialApp(
        home: RestaurantMenuScreen.fromCustomerBiteSaver(
          restaurantName: 'Fixture Cafe',
          pageLoader: (_) async => _page(
            entries: <Map<String, Object?>>[
              ...images,
              _item(_opaque('bsme_', 'j'), 'Mixed item'),
            ],
          ),
          openImageViewer: _openTestViewer,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('View more images (+1)'), findsOneWidget);
    expect(find.text('Mixed item'), findsOneWidget);

    await tester.tap(find.text('View more images (+1)'));
    await tester.pumpAndSettle();
    final fourthImage = tester.widget<Image>(
      find
          .byWidgetPredicate(
            (widget) =>
                widget is Image &&
                widget.image is NetworkImage &&
                (widget.image as NetworkImage).url.endsWith('menu-3.webp'),
          )
          .first,
    );
    expect((fourthImage.image as NetworkImage).url, contains('menu-3.webp'));
    expect(tester.takeException(), isNull);
  });

  for (final viewport in <(String, Size)>[
    ('landscape', const Size(900, 450)),
    ('desktop', const Size(1440, 900)),
  ]) {
    testWidgets('${viewport.$1} keeps paged menu controls reachable', (
      tester,
    ) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = viewport.$2;
      addTearDown(tester.view.reset);
      final entries = List<Map<String, Object?>>.generate(
        12,
        (index) => _item(
          _opaque('bsme_', String.fromCharCode(107 + index)),
          'Responsive item $index',
          category: index.isEven ? 'Lunch' : 'Dinner',
        ),
      );

      await tester.pumpWidget(
        MaterialApp(
          home: RestaurantMenuScreen.fromCustomerBiteSaver(
            restaurantName: 'Responsive Cafe',
            pageLoader: (_) async =>
                _page(entries: entries, cursor: 'bsc1.responsive-menu-page'),
            openImageViewer: _openTestViewer,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text('Responsive item 11'),
        300,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.text('Responsive item 11'), findsOneWidget);
      await tester.scrollUntilVisible(
        find.text('Load more'),
        300,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.text('Load more'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }
}
