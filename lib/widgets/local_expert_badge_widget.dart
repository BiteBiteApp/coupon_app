import 'package:flutter/material.dart';

import '../models/local_expert.dart';
import '../models/local_expert_badge.dart';
import '../models/local_expert_badge_calculator.dart';
import '../screens/local_expert_reviews_screen.dart';
import 'biterater_theme.dart';

enum LocalExpertBadgeDisplayMode { compact, full }

class LocalExpertBadgeVisualMetadata {
  final Color ringColor;
  final Color fillColor;
  final int ringCount;
  final IconData icon;
  final String levelMarker;
  final bool usesCrown;

  const LocalExpertBadgeVisualMetadata({
    required this.ringColor,
    required this.fillColor,
    required this.ringCount,
    required this.icon,
    required this.levelMarker,
    this.usesCrown = false,
  });
}

class LocalExpertBadgeVisuals {
  static LocalExpertBadgeVisualMetadata metadataFor({
    required String expertTypeId,
    required LocalExpertBadgeLevel level,
  }) {
    final iconName = LocalExperts.byId(expertTypeId)?.iconName;
    return LocalExpertBadgeVisualMetadata(
      ringColor: switch (level) {
        LocalExpertBadgeLevel.level1 => const Color(0xFFB66D37),
        LocalExpertBadgeLevel.level2 => const Color(0xFF8E99A8),
        LocalExpertBadgeLevel.level3 => const Color(0xFFE0A71E),
      },
      fillColor: switch (level) {
        LocalExpertBadgeLevel.level1 => const Color(0xFFFFF4EA),
        LocalExpertBadgeLevel.level2 => const Color(0xFFF3F6FA),
        LocalExpertBadgeLevel.level3 => const Color(0xFFFFF7D8),
      },
      ringCount: switch (level) {
        LocalExpertBadgeLevel.level1 => 1,
        LocalExpertBadgeLevel.level2 => 2,
        LocalExpertBadgeLevel.level3 => 3,
      },
      icon: iconForName(iconName),
      levelMarker: switch (level) {
        LocalExpertBadgeLevel.level1 => 'I',
        LocalExpertBadgeLevel.level2 => 'II',
        LocalExpertBadgeLevel.level3 => 'III',
      },
      usesCrown: false,
    );
  }

  static IconData iconForName(String? iconName) {
    return switch (iconName?.trim()) {
      'bakery_dining' => Icons.bakery_dining,
      'dinner_dining' => Icons.dinner_dining,
      'donut_large' => Icons.donut_large,
      'fastfood' => Icons.fastfood,
      'local_pizza' => Icons.local_pizza,
      'lunch_dining' => Icons.lunch_dining,
      'outdoor_grill' => Icons.outdoor_grill,
      'ramen_dining' => Icons.ramen_dining,
      'restaurant' => Icons.restaurant,
      'set_meal' => Icons.set_meal,
      'sports_bar' => Icons.sports_bar,
      _ => Icons.restaurant_menu,
    };
  }
}

class LocalExpertBadgeWidget extends StatelessWidget {
  final LocalExpertBadge badge;
  final LocalExpertBadgeDisplayMode mode;

  const LocalExpertBadgeWidget({
    super.key,
    required this.badge,
    this.mode = LocalExpertBadgeDisplayMode.full,
  });

  @override
  Widget build(BuildContext context) {
    return switch (mode) {
      LocalExpertBadgeDisplayMode.compact => _buildCompact(context),
      LocalExpertBadgeDisplayMode.full => _buildFull(context),
    };
  }

  Widget _buildCompact(BuildContext context) {
    final metadata = LocalExpertBadgeVisuals.metadataFor(
      expertTypeId: badge.expertTypeId,
      level: badge.level,
    );
    return Tooltip(
      message: '${badge.displayName} Expert • ${badge.levelLabel}',
      child: _BadgeMedallion(
        metadata: metadata,
        size: 26,
        iconSize: 13,
        markerFontSize: 6.5,
      ),
    );
  }

  Widget _buildFull(BuildContext context) {
    final metadata = LocalExpertBadgeVisuals.metadataFor(
      expertTypeId: badge.expertTypeId,
      level: badge.level,
    );
    return Container(
      constraints: const BoxConstraints(minWidth: 142),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: metadata.fillColor.withValues(alpha: 0.72),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: metadata.ringColor.withValues(alpha: 0.28)),
        boxShadow: [
          BoxShadow(
            color: metadata.ringColor.withValues(alpha: 0.08),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _BadgeMedallion(
            metadata: metadata,
            size: 38,
            iconSize: 19,
            markerFontSize: 8,
          ),
          const SizedBox(width: 9),
          Flexible(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${badge.displayName} Expert',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: BiteRaterTheme.ink,
                    fontSize: 13,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  badge.levelLabel,
                  style: TextStyle(
                    color: metadata.ringColor,
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _BadgeMedallion extends StatelessWidget {
  final LocalExpertBadgeVisualMetadata metadata;
  final double size;
  final double iconSize;
  final double markerFontSize;

  const _BadgeMedallion({
    required this.metadata,
    required this.size,
    required this.iconSize,
    required this.markerFontSize,
  });

  @override
  Widget build(BuildContext context) {
    Widget ring = _BadgeRing(
      color: metadata.ringColor,
      fillColor: metadata.fillColor,
      icon: metadata.icon,
      iconSize: iconSize,
    );

    for (var i = 1; i < metadata.ringCount; i += 1) {
      ring = Padding(
        padding: const EdgeInsets.all(2),
        child: DecoratedBox(
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(
              color: metadata.ringColor.withValues(alpha: 0.72),
              width: 1.15,
            ),
          ),
          child: ring,
        ),
      );
    }

    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        alignment: Alignment.center,
        clipBehavior: Clip.none,
        children: [
          Positioned.fill(child: ring),
          Positioned(
            right: -1,
            bottom: -2,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 3, vertical: 1),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(999),
                border: Border.all(color: metadata.ringColor, width: 0.8),
              ),
              child: Text(
                metadata.levelMarker,
                style: TextStyle(
                  color: metadata.ringColor,
                  fontSize: markerFontSize,
                  fontWeight: FontWeight.w900,
                  height: 1,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _BadgeRing extends StatelessWidget {
  final Color color;
  final Color fillColor;
  final IconData icon;
  final double iconSize;

  const _BadgeRing({
    required this.color,
    required this.fillColor,
    required this.icon,
    required this.iconSize,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: fillColor,
        shape: BoxShape.circle,
        border: Border.all(color: color, width: 1.5),
      ),
      child: Icon(icon, size: iconSize, color: color),
    );
  }
}

class LocalExpertBadgeOverflowPill extends StatelessWidget {
  final int hiddenCount;

  const LocalExpertBadgeOverflowPill({super.key, required this.hiddenCount});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 24,
      padding: const EdgeInsets.symmetric(horizontal: 7),
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: BiteRaterTheme.ocean.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: BiteRaterTheme.ocean.withValues(alpha: 0.16)),
      ),
      child: Text(
        '+$hiddenCount',
        style: const TextStyle(
          color: BiteRaterTheme.ocean,
          fontSize: 11,
          fontWeight: FontWeight.w900,
          height: 1,
        ),
      ),
    );
  }
}

class LocalExpertBadgeReviewNavigationRequest {
  final String reviewerUserId;
  final String reviewerDisplayName;
  final String expertTypeId;
  final String expertDisplayName;

  const LocalExpertBadgeReviewNavigationRequest({
    required this.reviewerUserId,
    required this.reviewerDisplayName,
    required this.expertTypeId,
    required this.expertDisplayName,
  });

  static LocalExpertBadgeReviewNavigationRequest? tryCreate({
    required LocalExpertBadge badge,
    required String? reviewerUserId,
    required String? reviewerDisplayName,
  }) {
    final trimmedReviewerUserId = reviewerUserId?.trim();
    if (trimmedReviewerUserId == null || trimmedReviewerUserId.isEmpty) {
      return null;
    }

    return LocalExpertBadgeReviewNavigationRequest(
      reviewerUserId: trimmedReviewerUserId,
      reviewerDisplayName: reviewerDisplayName?.trim().isNotEmpty == true
          ? reviewerDisplayName!.trim()
          : 'Reviewer',
      expertTypeId: badge.expertTypeId,
      expertDisplayName: badge.displayName,
    );
  }
}

Future<void> showLocalExpertBadgeDetails(
  BuildContext context,
  LocalExpertBadge badge, {
  String? reviewerUserId,
  String? reviewerDisplayName,
}) {
  final parentContext = context;
  final reviewNavigationRequest =
      LocalExpertBadgeReviewNavigationRequest.tryCreate(
        badge: badge,
        reviewerUserId: reviewerUserId,
        reviewerDisplayName: reviewerDisplayName,
      );

  return showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    isScrollControlled: true,
    builder: (context) {
      return SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  LocalExpertBadgeWidget(badge: badge),
                  const Spacer(),
                  IconButton(
                    tooltip: MaterialLocalizations.of(
                      context,
                    ).closeButtonTooltip,
                    onPressed: () => Navigator.of(context).maybePop(),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
              if (reviewNavigationRequest != null) ...[
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: () {
                      Navigator.of(context).maybePop();
                      Navigator.of(parentContext).push(
                        MaterialPageRoute(
                          builder: (_) => LocalExpertReviewsScreen(
                            reviewerUserId:
                                reviewNavigationRequest.reviewerUserId,
                            reviewerDisplayName:
                                reviewNavigationRequest.reviewerDisplayName,
                            expertTypeId: reviewNavigationRequest.expertTypeId,
                            expertDisplayName:
                                reviewNavigationRequest.expertDisplayName,
                          ),
                        ),
                      );
                    },
                    icon: const Icon(Icons.rate_review_outlined),
                    label: Text('View ${badge.displayName} Reviews'),
                  ),
                ),
              ],
              const SizedBox(height: 16),
              _buildDetailLine(
                '${badge.totalRestaurantCount} qualifying restaurants',
              ),
              if (badge.localClusterRestaurantCount > 0)
                _buildDetailLine(
                  '${badge.localClusterRestaurantCount} restaurants in the best local cluster',
                ),
              _buildDetailLine(_qualificationText(badge)),
            ],
          ),
        ),
      );
    },
  );
}

Widget _buildDetailLine(String text) {
  return Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(
          padding: EdgeInsets.only(top: 2),
          child: Icon(
            Icons.check_circle_outline,
            size: 16,
            color: BiteRaterTheme.ocean,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(child: Text(text, style: const TextStyle(height: 1.3))),
      ],
    ),
  );
}

String _qualificationText(LocalExpertBadge badge) {
  return switch (badge.qualificationMethod) {
    LocalExpertQualificationMethod.localCluster =>
      'Earned through local 30-mile-area qualification.',
    LocalExpertQualificationMethod.overall =>
      'Earned through overall qualifying restaurant count.',
    LocalExpertQualificationMethod.both =>
      'Earned through both local and overall qualification.',
    LocalExpertQualificationMethod.none =>
      'Earned from qualifying written BiteScore reviews.',
  };
}
