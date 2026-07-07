import 'package:flutter/material.dart';

class BiteSaverImageAssets {
  static const String hero = 'assets/images/br_logo_black.png';
  static const String firstPlaceholder = 'assets/images/placeholder_main.png';
  static const String secondPlaceholder =
      'assets/images/Placeholder_second.png';

  static const List<String> restaurantPlaceholders = [
    firstPlaceholder,
    secondPlaceholder,
  ];

  const BiteSaverImageAssets._();
}

class BiteSaverRestaurantPlaceholderImages {
  const BiteSaverRestaurantPlaceholderImages._();

  static bool hasRealImage(String? imageUrl) =>
      imageUrl != null && imageUrl.trim().isNotEmpty;

  static String assetForPlaceholderOnlyIndex(int placeholderOnlyIndex) {
    final safeIndex = placeholderOnlyIndex < 0 ? 0 : placeholderOnlyIndex;
    return BiteSaverImageAssets.restaurantPlaceholders[safeIndex %
        BiteSaverImageAssets.restaurantPlaceholders.length];
  }

  static List<String> fallbackPathsForVisibleCards(
    Iterable<String?> realImageUrls,
  ) {
    var placeholderOnlyIndex = 0;
    final fallbackPaths = <String>[];

    for (final imageUrl in realImageUrls) {
      fallbackPaths.add(assetForPlaceholderOnlyIndex(placeholderOnlyIndex));
      if (!hasRealImage(imageUrl)) {
        placeholderOnlyIndex += 1;
      }
    }

    return fallbackPaths;
  }
}

Widget buildBiteSaverHomeHeroImage({Key? key}) {
  return Image.asset(BiteSaverImageAssets.hero, key: key, fit: BoxFit.contain);
}

class BiteSaverHomeHeroLogo extends StatelessWidget {
  static const double previousTightWidthFactor = 0.82;
  static const double previousRegularWidthFactor = 0.78;
  static const double preFollowUpTightWidthFactor = 1.44;
  static const double preFollowUpRegularWidthFactor = 1.56;
  static const double previousLayoutTightWidthFactor = 1.24;
  static const double previousLayoutRegularWidthFactor = 1.3;
  static const double previousLayoutTightVerticalOffset = 10;
  static const double previousLayoutRegularVerticalOffset = 8;
  static const double preStaggerTightWidthFactor = 1.42;
  static const double preStaggerRegularWidthFactor = 1.48;
  static const double preStaggerTightVerticalOffset = -2;
  static const double preStaggerRegularVerticalOffset = -4;
  static const double preHeroRefinementTightWidthFactor = 1.54;
  static const double preHeroRefinementRegularWidthFactor = 1.62;
  static const double preHeroRefinementTightVerticalOffset = -14;
  static const double preHeroRefinementRegularVerticalOffset = -16;
  static const double tightWidthFactor = 2.0;
  static const double regularWidthFactor = 2.1;
  static const double tightVerticalOffset = -22;
  static const double regularVerticalOffset = -24;
  static const double tightHorizontalOffset = 75;
  static const double regularHorizontalOffset = 88;

  final bool tight;

  const BiteSaverHomeHeroLogo({super.key, required this.tight});

  static double widthFactorFor({required bool tight}) =>
      tight ? tightWidthFactor : regularWidthFactor;

  static double verticalOffsetFor({required bool tight}) =>
      tight ? tightVerticalOffset : regularVerticalOffset;

  static double horizontalOffsetFor({required bool tight}) =>
      tight ? tightHorizontalOffset : regularHorizontalOffset;

  @override
  Widget build(BuildContext context) {
    return FractionallySizedBox(
      alignment: Alignment.centerRight,
      widthFactor: widthFactorFor(tight: tight),
      child: buildBiteSaverHomeHeroImage(),
    );
  }
}

class BiteSaverRestaurantCardImage extends StatelessWidget {
  final String? imageUrl;
  final String fallbackImagePath;

  const BiteSaverRestaurantCardImage({
    super.key,
    required this.imageUrl,
    required this.fallbackImagePath,
  });

  @override
  Widget build(BuildContext context) {
    final trimmedImageUrl = imageUrl?.trim();
    if (trimmedImageUrl != null && trimmedImageUrl.isNotEmpty) {
      return Image.network(
        trimmedImageUrl,
        fit: BoxFit.cover,
        errorBuilder: (context, error, stackTrace) =>
            Image.asset(fallbackImagePath, fit: BoxFit.cover),
      );
    }

    return Image.asset(fallbackImagePath, fit: BoxFit.cover);
  }
}
