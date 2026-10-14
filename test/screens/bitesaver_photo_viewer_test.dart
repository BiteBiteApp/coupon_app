import 'package:coupon_app/screens/bitesaver_photo_viewer.dart';
import 'package:coupon_app/widgets/bitesaver_restaurant_images.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  Widget viewer({
    String title = 'Restaurant A',
    String main = 'https://example.test/main.png',
    List<String> extra = const [],
    double scale = 1,
  }) => MaterialApp(
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(
        context,
      ).copyWith(textScaler: TextScaler.linear(scale)),
      child: child!,
    ),
    home: BiteSaverPhotoViewer(
      title: title,
      imageUrl: main,
      additionalImageUrls: extra,
    ),
  );

  testWidgets('single photo keeps enlarged zoom without gallery controls', (
    tester,
  ) async {
    await tester.pumpWidget(viewer());
    expect(find.byType(InteractiveViewer), findsOneWidget);
    expect(find.text('Next'), findsNothing);
    expect(
      tester
          .widget<BiteSaverRestaurantImage>(
            find.byType(BiteSaverRestaurantImage),
          )
          .imageUrl,
      'https://example.test/main.png',
    );
    await tester.pumpAndSettle();
    expect(find.text('Image unavailable'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('main first, deduplicated extras, previous next and swipe', (
    tester,
  ) async {
    await tester.pumpWidget(
      viewer(
        extra: const [
          ' https://example.test/main.png ',
          '',
          'https://example.test/two.png',
          'https://example.test/three.png',
        ],
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('1 / 3'), findsOneWidget);
    expect(
      tester
          .widget<OutlinedButton>(
            find.widgetWithText(OutlinedButton, 'Previous'),
          )
          .onPressed,
      isNull,
    );
    await tester.tap(find.text('Next'));
    await tester.pumpAndSettle();
    expect(find.text('2 / 3'), findsOneWidget);
    expect(
      find.byWidgetPredicate(
        (w) =>
            w is BiteSaverRestaurantImage &&
            w.imageUrl == 'https://example.test/two.png',
      ),
      findsOneWidget,
    );
    await tester.drag(find.byType(PageView), const Offset(-600, 0));
    await tester.pumpAndSettle();
    expect(find.text('3 / 3'), findsOneWidget);
    expect(
      tester
          .widget<OutlinedButton>(find.widgetWithText(OutlinedButton, 'Next'))
          .onPressed,
      isNull,
    );
    await tester.tap(find.text('Previous'));
    await tester.pumpAndSettle();
    expect(find.text('2 / 3'), findsOneWidget);
    expect(find.byIcon(Icons.thumb_up), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('restaurant/photo changes reset the page to the new main photo', (
    tester,
  ) async {
    await tester.pumpWidget(
      viewer(extra: const ['https://example.test/two.png']),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Next'));
    await tester.pumpAndSettle();
    await tester.pumpWidget(
      viewer(
        title: 'Restaurant B',
        main: 'https://example.test/b.png',
        extra: const ['https://example.test/b2.png'],
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('1 / 2'), findsOneWidget);
    expect(
      find.byWidgetPredicate(
        (w) =>
            w is BiteSaverRestaurantImage &&
            w.imageUrl == 'https://example.test/two.png',
      ),
      findsNothing,
    );
    expect(
      find.byWidgetPredicate(
        (w) =>
            w is BiteSaverRestaurantImage &&
            w.imageUrl == 'https://example.test/b.png',
      ),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('narrow large text and empty gallery have no overflow', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 568);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      viewer(scale: 2, extra: const ['https://example.test/two.png']),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Next'));
    await tester.pumpAndSettle();
    expect(find.text('2 / 2'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(viewer(main: ' ', extra: const ['']));
    await tester.pumpAndSettle();
    expect(find.text('Image unavailable'), findsOneWidget);
    expect(find.byType(Image), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
