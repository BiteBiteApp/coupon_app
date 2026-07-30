import 'dart:typed_data';

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
  static const double tightHorizontalOffset = 104;
  static const double regularHorizontalOffset = 118;
  static const double tightMaxHorizontalOffsetFraction = 0.22;
  static const double regularMaxHorizontalOffsetFraction = 0.24;

  static const double tightVerticalOffset = -15;
  static const double regularVerticalOffset = -17;

  final bool tight;

  const BiteSaverHomeHeroLogo({super.key, required this.tight});

  static double widthFactorFor({required bool tight}) =>
      tight ? tightWidthFactor : regularWidthFactor;

  static double verticalOffsetFor({required bool tight}) =>
      tight ? tightVerticalOffset : regularVerticalOffset;

  static double horizontalOffsetFor({
    required bool tight,
    double? availableWidth,
  }) {
    final baseOffset = tight ? tightHorizontalOffset : regularHorizontalOffset;
    final width = availableWidth;
    if (width == null || width <= 0) {
      return baseOffset;
    }

    final maxOffsetFraction = tight
        ? tightMaxHorizontalOffsetFraction
        : regularMaxHorizontalOffsetFraction;
    return baseOffset.clamp(0.0, width * maxOffsetFraction).toDouble();
  }

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
  final String semanticLabel;

  const BiteSaverRestaurantCardImage({
    super.key,
    required this.imageUrl,
    required this.fallbackImagePath,
    this.semanticLabel = 'Restaurant image',
  });

  @override
  Widget build(BuildContext context) {
    Widget buildFallback(BuildContext context) =>
        Image.asset(fallbackImagePath, fit: BoxFit.cover);

    return BiteSaverRestaurantImage(
      imageUrl: imageUrl,
      fit: BoxFit.cover,
      semanticLabel: semanticLabel,
      loadingBuilder: (context) => const ColoredBox(color: Color(0xFFEFF6FF)),
      emptyBuilder: buildFallback,
      errorBuilder: buildFallback,
    );
  }
}

typedef BiteSaverRestaurantImageStateBuilder =
    Widget Function(BuildContext context);

class BiteSaverRestaurantImage extends StatelessWidget {
  static const WebHtmlElementStrategy networkWebHtmlElementStrategy =
      WebHtmlElementStrategy.prefer;

  final Uint8List? imageBytes;
  final String? imageUrl;
  final double? width;
  final double? height;
  final BoxFit fit;
  final AlignmentGeometry alignment;
  final String? semanticLabel;
  final BiteSaverRestaurantImageStateBuilder? loadingBuilder;
  final BiteSaverRestaurantImageStateBuilder? emptyBuilder;
  final BiteSaverRestaurantImageStateBuilder? errorBuilder;

  const BiteSaverRestaurantImage({
    super.key,
    this.imageBytes,
    this.imageUrl,
    this.width,
    this.height,
    this.fit = BoxFit.cover,
    this.alignment = Alignment.center,
    this.semanticLabel,
    this.loadingBuilder,
    this.emptyBuilder,
    this.errorBuilder,
  });

  Widget _buildSizedState(Widget child) {
    return SizedBox(width: width, height: height, child: child);
  }

  Widget _buildLoading(BuildContext context) {
    return loadingBuilder?.call(context) ??
        _buildSizedState(const ColoredBox(color: Color(0xFFF3E8DD)));
  }

  Widget _buildEmpty(BuildContext context) {
    return emptyBuilder?.call(context) ?? _buildSizedState(const SizedBox());
  }

  Widget _buildError(BuildContext context) {
    return errorBuilder?.call(context) ?? _buildEmpty(context);
  }

  ImageFrameBuilder get _frameBuilder {
    return (context, child, frame, wasSynchronouslyLoaded) {
      if (wasSynchronouslyLoaded || frame != null) {
        return child;
      }
      return _buildLoading(context);
    };
  }

  ImageErrorWidgetBuilder get _errorBuilder {
    return (context, error, stackTrace) => _buildError(context);
  }

  @override
  Widget build(BuildContext context) {
    final bytes = imageBytes;
    if (bytes != null) {
      return Image.memory(
        bytes,
        width: width,
        height: height,
        fit: fit,
        alignment: alignment,
        semanticLabel: semanticLabel,
        frameBuilder: _frameBuilder,
        errorBuilder: _errorBuilder,
      );
    }

    final url = imageUrl;
    if (url == null || url.trim().isEmpty) {
      return _buildEmpty(context);
    }

    return Image.network(
      url,
      width: width,
      height: height,
      fit: fit,
      alignment: alignment,
      semanticLabel: semanticLabel,
      frameBuilder: _frameBuilder,
      errorBuilder: _errorBuilder,
      webHtmlElementStrategy: networkWebHtmlElementStrategy,
    );
  }
}
