import 'dart:math' as math;
import 'package:flutter/material.dart';

import '../models/customer_bitesaver_search.dart';
import '../screens/coupon_detail_screen.dart'
    show CustomerBiteSaverOfferPresentation;
import '../models/daily_special.dart';
import '../screens/home_screen.dart' show BiteSaverHomeDealBubble;
import 'bitesaver_colors.dart';
import 'bitesaver_restaurant_images.dart';

/// Reuses the approved Home coupon/special bubble, allowing readable titles.
class BiteSaverProfileDealCard extends StatelessWidget {
  final String title;
  final String? imageUrl;
  final bool isSpecial;
  final VoidCallback? onTap;

  const BiteSaverProfileDealCard({
    super.key,
    required this.title,
    this.imageUrl,
    this.isSpecial = false,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final hasImage = BiteSaverRestaurantPlaceholderImages.hasRealImage(
      imageUrl,
    );
    final style = TextStyle(
      color: isSpecial ? const Color(0xFFC95F17) : const Color(0xFF4E7B20),
      fontSize: 15,
      fontWeight: FontWeight.w800,
      height: 1.2,
    );
    return LayoutBuilder(
      builder: (context, constraints) {
        final titleWidth = math.max(
          1.0,
          constraints.maxWidth - 56 - (hasImage ? 76 : 0),
        );
        final painter = TextPainter(
          text: TextSpan(text: title, style: style),
          textDirection: Directionality.of(context),
          textScaler: MediaQuery.textScalerOf(context),
        )..layout(maxWidth: titleWidth);
        final height = math.max(hasImage ? 84.0 : 48.0, painter.height + 24);
        painter.dispose();
        return Semantics(
          button: onTap != null,
          child: BiteSaverHomeDealBubble(
            contentHeight: height,
            showBubble: true,
            onTap: onTap,
            backgroundColor: isSpecial
                ? BiteSaverColors.secondaryBackground
                : const Color(0xFFF8FCF2),
            borderColor: isSpecial
                ? BiteSaverColors.borderStrong
                : const Color(0xFFB9D99E),
            child: Row(
              children: [
                if (hasImage) ...[
                  ClipRRect(
                    borderRadius: BorderRadius.circular(10),
                    child: BiteSaverRestaurantImage(
                      imageUrl: imageUrl,
                      width: 64,
                      height: 64,
                      fit: BoxFit.cover,
                      semanticLabel: '$title image',
                      errorBuilder: (_) => const SizedBox(
                        width: 64,
                        height: 64,
                        child: Icon(Icons.broken_image_outlined),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                ],
                Expanded(child: Text(title, style: style)),
                if (onTap != null)
                  const Padding(
                    padding: EdgeInsets.only(left: 8),
                    child: Icon(
                      Icons.chevron_right,
                      size: 20,
                      color: BiteSaverColors.orangeDark,
                    ),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }
}

/// Presentation of an already accepted special; it carries no redemption action.
class BiteSaverSpecialsEntry extends StatelessWidget {
  final CustomerBiteSaverOffer offer;
  final VoidCallback? onTap;
  final VoidCallback? onImageTap;
  const BiteSaverSpecialsEntry.fromOffer({
    super.key,
    required this.offer,
    this.onTap,
    this.onImageTap,
  });

  @override
  Widget build(BuildContext context) {
    final presentation = CustomerBiteSaverOfferPresentation.fromOffer(offer);
    final details = offer.details?.trim();
    final image = offer.imageUrl;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        BiteSaverProfileDealCard(
          title: offer.title.isEmpty ? 'Daily special' : offer.title,
          isSpecial: true,
          onTap: onTap,
        ),
        if (details != null && details.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              details,
              style: const TextStyle(
                color: Color(0xFF315A46),
                fontSize: 15,
                fontWeight: FontWeight.w700,
                height: 1.26,
              ),
            ),
          ),
        if (presentation.scheduleLabel != null)
          Padding(
            padding: const EdgeInsets.only(top: 7),
            child: Text(
              presentation.scheduleLabel!,
              style: const TextStyle(
                color: BiteSaverColors.orangeDark,
                fontSize: 13,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        if (BiteSaverRestaurantPlaceholderImages.hasRealImage(image))
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Semantics(
              button: onImageTap != null,
              label: 'Enlarge ${offer.title} image',
              child: InkWell(
                key: ValueKey('special-image-${offer.offerId.value}'),
                onTap: onImageTap,
                child: SizedBox(
                  height: 110,
                  child: BiteSaverRestaurantImage(
                    imageUrl: image,
                    fit: BoxFit.contain,
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class BiteSaverLegacySpecialsEntry extends StatelessWidget {
  final DailySpecial special;
  const BiteSaverLegacySpecialsEntry({super.key, required this.special});
  String _displayText(String value, String fallback) =>
      value.trim().isEmpty ? fallback : value.trim();
  String? _scheduleLabel(DailySpecial special) {
    final rawLabel = special.scheduleSummaryText(includeToday: false).trim();
    if (rawLabel.isEmpty) {
      return null;
    }

    final isAllDay = rawLabel.toLowerCase() == 'available all day';
    final timeLabel = isAllDay
        ? rawLabel
        : 'Available ${_spacedRange(rawLabel)}';

    if (special.availabilityMode == DailySpecialAvailabilityMode.todayOnly) {
      return 'Today only • $timeLabel';
    }

    return rawLabel
        .replaceAll(', Available all day', ' • Available all day')
        .replaceAll(', available all day', ' • Available all day')
        .replaceAllMapped(
          RegExp(r',\s*([0-9]{1,2}:[0-9]{2}\s[AP]M-.*)$'),
          (match) => ' • Available ${_spacedRange(match.group(1)!)}',
        );
  }

  String _spacedRange(String value) {
    return value.replaceAllMapped(RegExp(r'\s*-\s*'), (match) => ' - ');
  }

  @override
  Widget build(BuildContext context) {
    final details = special.details?.trim();
    final scheduleLabel = _scheduleLabel(special);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 9,
            height: 9,
            margin: const EdgeInsets.only(top: 7),
            decoration: BoxDecoration(
              color: const Color(0xFFE86F2F).withValues(alpha: 0.9),
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                BiteSaverProfileDealCard(
                  title: _displayText(special.title, 'Daily special'),
                  isSpecial: true,
                ),
                if (details != null && details.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(
                    details,
                    style: const TextStyle(
                      color: Color(0xFF315A46),
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      height: 1.26,
                    ),
                  ),
                ],
                if (scheduleLabel != null) ...[
                  const SizedBox(height: 7),
                  Text(
                    scheduleLabel,
                    style: const TextStyle(
                      color: BiteSaverColors.orangeDark,
                      fontSize: 13,
                      fontWeight: FontWeight.w800,
                      height: 1.2,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
