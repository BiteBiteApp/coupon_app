import 'dart:convert';
import 'dart:typed_data';

import 'package:coupon_app/widgets/bitesaver_colors.dart';
import 'package:coupon_app/widgets/bitesaver_restaurant_images.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const oldPlaceholders = [
    'assets/images/placeholder_outside.png',
    'assets/images/placeholder_kitchen.png',
    'assets/images/placeholder_dining.png',
  ];

  group('BiteSaver home hero image', () {
    testWidgets('uses compact logo while retaining parent-driven layout', (
      tester,
    ) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(body: Center(child: _HeroImageTestHost())),
        ),
      );

      final image = tester.widget<Image>(find.byType(Image));
      final provider = image.image as AssetImage;

      expect(provider.assetName, BiteSaverImageAssets.hero);
      expect(image.fit, BoxFit.contain);
      expect(image.width, isNull);
      expect(image.height, isNull);
    });

    test('hero logo constraints make the logo larger and higher-right', () {
      expect(
        BiteSaverHomeHeroLogo.widthFactorFor(tight: false),
        closeTo(
          BiteSaverHomeHeroLogo.preHeroRefinementRegularWidthFactor * 1.3,
          0.01,
        ),
      );
      expect(
        BiteSaverHomeHeroLogo.widthFactorFor(tight: true),
        closeTo(
          BiteSaverHomeHeroLogo.preHeroRefinementTightWidthFactor * 1.3,
          0.01,
        ),
      );
      expect(
        BiteSaverHomeHeroLogo.verticalOffsetFor(tight: false),
        lessThan(BiteSaverHomeHeroLogo.preHeroRefinementRegularVerticalOffset),
      );
      expect(
        BiteSaverHomeHeroLogo.verticalOffsetFor(tight: true),
        lessThan(BiteSaverHomeHeroLogo.preHeroRefinementTightVerticalOffset),
      );
      expect(
        BiteSaverHomeHeroLogo.horizontalOffsetFor(tight: false),
        BiteSaverHomeHeroLogo.regularHorizontalOffset,
      );
      expect(
        BiteSaverHomeHeroLogo.horizontalOffsetFor(tight: true),
        BiteSaverHomeHeroLogo.tightHorizontalOffset,
      );
      expect(
        BiteSaverHomeHeroLogo.horizontalOffsetFor(tight: false),
        greaterThan(BiteSaverHomeHeroLogo.horizontalOffsetFor(tight: true)),
      );
      expect(
        BiteSaverHomeHeroLogo.horizontalOffsetFor(
          tight: true,
          availableWidth: 320,
        ),
        320 * BiteSaverHomeHeroLogo.tightMaxHorizontalOffsetFraction,
      );
      expect(
        BiteSaverHomeHeroLogo.horizontalOffsetFor(
          tight: false,
          availableWidth: 520,
        ),
        BiteSaverHomeHeroLogo.regularHorizontalOffset,
      );
    });

    testWidgets('larger logo builds without overflow or text collision', (
      tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SizedBox(
              width: 320,
              child: Row(
                children: [
                  Expanded(
                    flex: 58,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [Text('Eat well.'), Text('Spend less.')],
                    ),
                  ),
                  SizedBox(width: 12),
                  Expanded(
                    flex: 42,
                    child: Transform.translate(
                      offset: Offset(
                        BiteSaverHomeHeroLogo.horizontalOffsetFor(
                          tight: true,
                          availableWidth: 320,
                        ),
                        BiteSaverHomeHeroLogo.verticalOffsetFor(tight: true),
                      ),
                      child: const Align(
                        alignment: Alignment.topRight,
                        child: BiteSaverHomeHeroLogo(tight: true),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      );

      expect(tester.takeException(), isNull);
      expect(
        tester.getTopRight(find.text('Spend less.')).dx,
        lessThan(tester.getTopLeft(find.byType(BiteSaverHomeHeroLogo)).dx),
      );
    });
  });

  group('BiteSaver restaurant placeholder selection', () {
    test('uses exactly the two requested placeholders', () {
      expect(BiteSaverImageAssets.restaurantPlaceholders, [
        'assets/images/placeholder_main.png',
        'assets/images/Placeholder_second.png',
      ]);
    });

    test('first second and third fallback cards alternate', () {
      final fallbacks =
          BiteSaverRestaurantPlaceholderImages.fallbackPathsForVisibleCards([
            null,
            '',
            '   ',
          ]);

      expect(fallbacks, [
        'assets/images/placeholder_main.png',
        'assets/images/Placeholder_second.png',
        'assets/images/placeholder_main.png',
      ]);
    });

    test('consecutive fallback cards alternate without old placeholders', () {
      final fallbacks =
          BiteSaverRestaurantPlaceholderImages.fallbackPathsForVisibleCards([
            null,
            '',
            null,
            '',
          ]);

      expect(fallbacks[0], isNot(fallbacks[1]));
      expect(fallbacks[1], isNot(fallbacks[2]));
      expect(fallbacks[2], isNot(fallbacks[3]));
      for (final oldPlaceholder in oldPlaceholders) {
        expect(fallbacks, isNot(contains(oldPlaceholder)));
      }
    });

    test('real image cards do not consume placeholder-only alternation', () {
      final fallbacks =
          BiteSaverRestaurantPlaceholderImages.fallbackPathsForVisibleCards([
            null,
            ' https://example.com/restaurant.jpg ',
            '',
          ]);

      expect(fallbacks, [
        'assets/images/placeholder_main.png',
        'assets/images/Placeholder_second.png',
        'assets/images/Placeholder_second.png',
      ]);
    });

    test('rebuilding keeps deterministic fallback choices', () {
      const imageUrls = [null, 'https://example.com/a.jpg', '', null];

      final firstBuild =
          BiteSaverRestaurantPlaceholderImages.fallbackPathsForVisibleCards(
            imageUrls,
          );
      final secondBuild =
          BiteSaverRestaurantPlaceholderImages.fallbackPathsForVisibleCards(
            imageUrls,
          );

      expect(secondBuild, firstBuild);
    });

    test('selection preserves one fallback per visible card', () {
      final fallbacks =
          BiteSaverRestaurantPlaceholderImages.fallbackPathsForVisibleCards([
            null,
            'https://example.com/a.jpg',
            '',
          ]);

      expect(fallbacks, hasLength(3));
    });
  });

  group('BiteSaverRestaurantImage', () {
    const storageUrl =
        'https://firebasestorage.googleapis.com/v0/b/example.appspot.com/o/'
        'bitesaver_restaurants%2Fowner-1%2Frestaurant_images%2F'
        'main_image.jpg?alt=media&token=synthetic-token';

    testWidgets('passes the complete network URL to the web-safe renderer', (
      tester,
    ) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: BiteSaverRestaurantImage(
              imageUrl: storageUrl,
              width: 240,
              height: 120,
              semanticLabel: 'Cafe restaurant image',
            ),
          ),
        ),
      );

      final image = tester.widget<Image>(find.byType(Image));
      final provider = image.image as NetworkImage;

      expect(provider.url, storageUrl);
      expect(provider.headers, isNull);
      expect(provider.webHtmlElementStrategy, WebHtmlElementStrategy.prefer);
      expect(
        BiteSaverRestaurantImage.networkWebHtmlElementStrategy,
        WebHtmlElementStrategy.prefer,
      );
      expect(image.semanticLabel, 'Cafe restaurant image');
      expect(image.fit, BoxFit.cover);
      expect(image.width, 240);
      expect(image.height, 120);
    });

    testWidgets('selected bytes take priority without a filesystem path', (
      tester,
    ) async {
      final bytes = _onePixelPng();

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: BiteSaverRestaurantImage(
              imageBytes: bytes,
              imageUrl: storageUrl,
              semanticLabel: 'Selected restaurant image preview',
            ),
          ),
        ),
      );

      final image = tester.widget<Image>(find.byType(Image));
      final provider = image.image as MemoryImage;

      expect(identical(provider.bytes, bytes), isTrue);
      expect(image.image, isNot(isA<NetworkImage>()));
      expect(image.semanticLabel, 'Selected restaurant image preview');
    });

    testWidgets('empty URLs retain the caller-controlled empty state', (
      tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: BiteSaverRestaurantImage(
              imageUrl: '   ',
              emptyBuilder: (context) => const Text('No restaurant image'),
            ),
          ),
        ),
      );

      expect(find.text('No restaurant image'), findsOneWidget);
      expect(find.byType(Image), findsNothing);
    });

    testWidgets('invalid bytes retain the controlled error state', (
      tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: BiteSaverRestaurantImage(
              imageBytes: Uint8List.fromList(const [0, 1, 2, 3]),
              errorBuilder: (context) =>
                  const Text('Image preview unavailable'),
            ),
          ),
        ),
      );

      final image = tester.widget<Image>(find.byType(Image));
      final fallback = image.errorBuilder!(
        tester.element(find.byType(Image)),
        Exception('invalid image'),
        StackTrace.current,
      );

      expect(fallback, isA<Text>());
      expect((fallback as Text).data, 'Image preview unavailable');
    });

    testWidgets('loading remains neutral until the first image frame', (
      tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: BiteSaverRestaurantImage(
              imageUrl: storageUrl,
              loadingBuilder: (context) =>
                  const Text('Restaurant image loading'),
            ),
          ),
        ),
      );

      final imageFinder = find.byType(Image);
      final image = tester.widget<Image>(imageFinder);
      const loadedChild = SizedBox(key: ValueKey('loaded-image'));
      final loading = image.frameBuilder!(
        tester.element(imageFinder),
        loadedChild,
        null,
        false,
      );
      final loaded = image.frameBuilder!(
        tester.element(imageFinder),
        loadedChild,
        0,
        false,
      );

      expect(loading, isA<Text>());
      expect((loading as Text).data, 'Restaurant image loading');
      expect(identical(loaded, loadedChild), isTrue);
    });
  });

  group('BiteSaverRestaurantCardImage', () {
    testWidgets('valid real image remains displayed', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: BiteSaverRestaurantCardImage(
              imageUrl: 'https://example.com/real.jpg?token=complete',
              fallbackImagePath: BiteSaverImageAssets.firstPlaceholder,
            ),
          ),
        ),
      );

      final image = tester.widget<Image>(find.byType(Image));
      final provider = image.image as NetworkImage;

      expect(provider.url, 'https://example.com/real.jpg?token=complete');
      expect(provider.webHtmlElementStrategy, WebHtmlElementStrategy.prefer);
      expect(find.byType(BiteSaverRestaurantImage), findsOneWidget);
      expect(image.fit, BoxFit.cover);
    });

    testWidgets('null image uses the new placeholder', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: BiteSaverRestaurantCardImage(
              imageUrl: null,
              fallbackImagePath: BiteSaverImageAssets.firstPlaceholder,
            ),
          ),
        ),
      );

      final image = tester.widget<Image>(find.byType(Image));
      final provider = image.image as AssetImage;

      expect(provider.assetName, 'assets/images/placeholder_main.png');
      expect(image.fit, BoxFit.cover);
    });

    testWidgets('blank image uses the new placeholder', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: BiteSaverRestaurantCardImage(
              imageUrl: '   ',
              fallbackImagePath: BiteSaverImageAssets.secondPlaceholder,
            ),
          ),
        ),
      );

      final image = tester.widget<Image>(find.byType(Image));
      final provider = image.image as AssetImage;

      expect(provider.assetName, 'assets/images/Placeholder_second.png');
      expect(image.fit, BoxFit.cover);
    });

    testWidgets('failed network image falls back to the selected placeholder', (
      tester,
    ) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: BiteSaverRestaurantCardImage(
              imageUrl: 'https://example.com/broken.jpg',
              fallbackImagePath: BiteSaverImageAssets.secondPlaceholder,
            ),
          ),
        ),
      );

      final image = tester.widget<Image>(find.byType(Image));
      final fallback =
          image.errorBuilder!(
                tester.element(find.byType(Image)),
                Exception('failed'),
                StackTrace.current,
              )
              as Image;
      final provider = fallback.image as AssetImage;

      expect(provider.assetName, 'assets/images/Placeholder_second.png');
      expect(fallback.fit, BoxFit.cover);
    });
  });

  group('Scope guards', () {
    test(
      'BiteScore placeholder assets are not changed by BiteSaver helper',
      () {
        expect(
          BiteSaverImageAssets.restaurantPlaceholders,
          isNot(contains('assets/images/hero.png')),
        );
        for (final oldPlaceholder in oldPlaceholders) {
          expect(
            BiteSaverImageAssets.restaurantPlaceholders,
            isNot(contains(oldPlaceholder)),
          );
        }
      },
    );

    test('BiteSaver color constants remain unchanged', () {
      expect(BiteSaverColors.pageBackground, const Color(0xFFFFFFFF));
      expect(BiteSaverColors.secondaryBackground, const Color(0xFFF6FAFF));
      expect(BiteSaverColors.surface, const Color(0xFFFFFFFF));
      expect(BiteSaverColors.subtleSurface, const Color(0xFFF7FAFC));
      expect(BiteSaverColors.imageFallback, const Color(0xFFEFF6FF));
      expect(BiteSaverColors.border, const Color(0xFFE2E8F0));
      expect(BiteSaverColors.borderStrong, const Color(0xFFCBD5E1));
      expect(BiteSaverColors.ink, const Color(0xFF111827));
      expect(BiteSaverColors.labelInk, const Color(0xFF1F2937));
      expect(BiteSaverColors.valueInk, const Color(0xFF475569));
      expect(BiteSaverColors.mutedInk, const Color(0xFF64748B));
      expect(BiteSaverColors.softMutedInk, const Color(0xFF94A3B8));
      expect(BiteSaverColors.primaryText, BiteSaverColors.ink);
      expect(BiteSaverColors.secondaryText, BiteSaverColors.valueInk);
      expect(BiteSaverColors.mutedText, BiteSaverColors.mutedInk);
      expect(BiteSaverColors.disabledText, BiteSaverColors.softMutedInk);
      expect(BiteSaverColors.coolShadow, const Color(0xFF0F172A));
      expect(BiteSaverColors.orange, const Color(0xFFD06C3B));
      expect(BiteSaverColors.orangeDark, const Color(0xFFB7542D));
      expect(BiteSaverColors.green, const Color(0xFF5F8F25));
      expect(BiteSaverColors.greenDark, const Color(0xFF4F7D1F));
      expect(BiteSaverColors.blue, const Color(0xFF2563EB));
    });

    test('readable BiteSaver text colors are not pale gray', () {
      expect(BiteSaverColors.primaryText, const Color(0xFF111827));
      expect(BiteSaverColors.secondaryText, const Color(0xFF475569));
      expect(
        BiteSaverColors.secondaryText.computeLuminance(),
        lessThan(BiteSaverColors.mutedText.computeLuminance()),
      );
      expect(
        BiteSaverColors.mutedText.computeLuminance(),
        lessThan(BiteSaverColors.disabledText.computeLuminance()),
      );
    });
  });
}

Uint8List _onePixelPng() {
  return base64Decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8'
    '/x8AAusB9Y9Zl1EAAAAASUVORK5CYII=',
  );
}

class _HeroImageTestHost extends StatelessWidget {
  const _HeroImageTestHost();

  @override
  Widget build(BuildContext context) => buildBiteSaverHomeHeroImage();
}
