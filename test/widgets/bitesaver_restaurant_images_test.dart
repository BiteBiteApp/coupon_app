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

  group('BiteSaverRestaurantCardImage', () {
    testWidgets('valid real image remains displayed', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: BiteSaverRestaurantCardImage(
              imageUrl: ' https://example.com/real.jpg ',
              fallbackImagePath: BiteSaverImageAssets.firstPlaceholder,
            ),
          ),
        ),
      );

      final image = tester.widget<Image>(find.byType(Image));
      final provider = image.image as NetworkImage;

      expect(provider.url, 'https://example.com/real.jpg');
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

class _HeroImageTestHost extends StatelessWidget {
  const _HeroImageTestHost();

  @override
  Widget build(BuildContext context) => buildBiteSaverHomeHeroImage();
}
