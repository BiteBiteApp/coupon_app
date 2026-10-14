import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'bitesaver_colors.dart';
import 'bitesaver_restaurant_images.dart';

bool usesAccessibleSearchLayout(BuildContext context) =>
    MediaQuery.textScalerOf(context).scale(14) > 14.1;

// Leave room for results actions and navigation while the expanded controls
// scroll inside the header. Use the actual body viewport, including keyboard resize.
double accessibleSearchHeaderExtent(double viewportHeight) =>
    (viewportHeight * .55).clamp(120, 450).toDouble();

double accessibleSearchFieldHeight(BuildContext context) =>
    math.max(48, MediaQuery.textScalerOf(context).scale(16) * 1.3 + 18);

class ExpandSearchControl extends StatelessWidget {
  const ExpandSearchControl({
    super.key,
    required this.onTap,
    required this.color,
  });
  final VoidCallback onTap;
  final Color color;
  @override
  Widget build(BuildContext context) => Tooltip(
    message: 'Expand search',
    child: InkWell(
      key: const ValueKey('expand-search-control'),
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 48),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Flexible(
                child: Text(
                  'Expand Search',
                  style: TextStyle(
                    color: color,
                    fontSize: 13.4,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Icon(Icons.keyboard_arrow_down, color: color, size: 24),
            ],
          ),
        ),
      ),
    ),
  );
}

/// A presentation-only alternative when larger text needs vertical space.
/// Controllers, callbacks and feedback remain owned by the existing screen.
class AccessibleBiteSaverSearchHeader extends StatelessWidget {
  const AccessibleBiteSaverSearchHeader({
    super.key,
    required this.locationButton,
    required this.locationField,
    required this.searchField,
    required this.radiusField,
    this.feedback,
  });
  final Widget locationButton;
  final Widget locationField;
  final Widget searchField;
  final Widget radiusField;
  final Widget? feedback;
  @override
  Widget build(BuildContext context) => Material(
    color: BiteSaverColors.secondaryBackground,
    child: Scrollbar(
      interactive: false,
      child: SingleChildScrollView(
        key: const PageStorageKey('accessible-bitesaver-search-header'),
        primary: false,
        physics: const ClampingScrollPhysics(),
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Eat well.',
                        style: TextStyle(
                          fontSize: 28,
                          fontWeight: FontWeight.w900,
                          height: 1.04,
                          color: BiteSaverColors.ink,
                        ),
                      ),
                      const Text(
                        'Spend less.',
                        style: TextStyle(
                          fontSize: 28,
                          fontWeight: FontWeight.w900,
                          height: 1.04,
                          color: BiteSaverColors.greenDark,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                const SizedBox(
                  width: 70,
                  height: 70,
                  child: BiteSaverHomeHeroLogo(tight: true),
                ),
              ],
            ),
            const SizedBox(height: 6),
            const Text(
              'Save money at nearby favorites.',
              style: TextStyle(
                fontSize: 12.2,
                height: 1.18,
                color: BiteSaverColors.valueInk,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 12),
            locationButton,
            const SizedBox(height: 8),
            locationField,
            const SizedBox(height: 8),
            searchField,
            const SizedBox(height: 8),
            radiusField,
            if (feedback != null) ...[const SizedBox(height: 8), feedback!],
          ],
        ),
      ),
    ),
  );
}
