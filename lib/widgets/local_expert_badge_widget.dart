import 'package:flutter/material.dart';

import '../models/local_expert.dart';
import '../models/local_expert_badge.dart';
import '../models/local_expert_badge_calculator.dart';
import '../screens/local_expert_reviews_screen.dart';
import 'biterater_theme.dart';

enum LocalExpertBadgeDisplayMode { compact, full }

class LocalExpertBadgeVisualMetadata {
  final LocalExpertBadgeLevel level;
  final Color ringColor;
  final Color fillColor;
  final Color highlightColor;
  final Color edgeColor;
  final Color innerRimColor;
  final Color iconColor;
  final Color levelTextColor;
  final double borderWidth;
  final double outerRingWidth;
  final double innerRimWidth;
  final double shadowBlur;
  final double shadowAlpha;
  final double haloAlpha;
  final bool hasGlint;
  final int ringCount;
  final IconData icon;
  final String? abbreviation;
  final String? customArtwork;
  final bool usesCrown;

  const LocalExpertBadgeVisualMetadata({
    required this.level,
    required this.ringColor,
    required this.fillColor,
    required this.highlightColor,
    required this.edgeColor,
    required this.innerRimColor,
    required this.iconColor,
    required this.levelTextColor,
    required this.borderWidth,
    required this.outerRingWidth,
    required this.innerRimWidth,
    required this.shadowBlur,
    required this.shadowAlpha,
    required this.haloAlpha,
    required this.hasGlint,
    required this.ringCount,
    required this.icon,
    this.abbreviation,
    this.customArtwork,
    this.usesCrown = false,
  });

  bool get isPlain => level == LocalExpertBadgeLevel.level1;
  bool get isSilverMedal => level == LocalExpertBadgeLevel.level2;
  bool get isGoldPremium => level == LocalExpertBadgeLevel.level3;
}

class LocalExpertBadgeVisuals {
  static LocalExpertBadgeVisualMetadata metadataFor({
    required String expertTypeId,
    required LocalExpertBadgeLevel level,
  }) {
    final iconName = LocalExperts.byId(expertTypeId)?.iconName;
    return LocalExpertBadgeVisualMetadata(
      level: level,
      ringColor: switch (level) {
        LocalExpertBadgeLevel.level1 => const Color(0xFFA8AFB7),
        LocalExpertBadgeLevel.level2 => const Color(0xFFC8D0D8),
        LocalExpertBadgeLevel.level3 => const Color(0xFFE6B43A),
      },
      fillColor: switch (level) {
        LocalExpertBadgeLevel.level1 => const Color(0xFFF8FAFC),
        LocalExpertBadgeLevel.level2 => const Color(0xFFF4F7FA),
        LocalExpertBadgeLevel.level3 => const Color(0xFFFFF3C8),
      },
      highlightColor: switch (level) {
        LocalExpertBadgeLevel.level1 => Colors.white,
        LocalExpertBadgeLevel.level2 => const Color(0xFFFFFFFF),
        LocalExpertBadgeLevel.level3 => const Color(0xFFFFF8DF),
      },
      edgeColor: switch (level) {
        LocalExpertBadgeLevel.level1 => const Color(0xFF7E8791),
        LocalExpertBadgeLevel.level2 => const Color(0xFF707A86),
        LocalExpertBadgeLevel.level3 => const Color(0xFF9B6500),
      },
      innerRimColor: switch (level) {
        LocalExpertBadgeLevel.level1 => Colors.transparent,
        LocalExpertBadgeLevel.level2 => const Color(0xFF8E98A4),
        LocalExpertBadgeLevel.level3 => const Color(0xFFB37A05),
      },
      iconColor: const Color(0xFF15191F),
      levelTextColor: switch (level) {
        LocalExpertBadgeLevel.level1 => const Color(0xFF3D4651),
        LocalExpertBadgeLevel.level2 => const Color(0xFF3F4A56),
        LocalExpertBadgeLevel.level3 => const Color(0xFF684300),
      },
      borderWidth: switch (level) {
        LocalExpertBadgeLevel.level1 => 1.35,
        LocalExpertBadgeLevel.level2 => 1.35,
        LocalExpertBadgeLevel.level3 => 1.45,
      },
      outerRingWidth: switch (level) {
        LocalExpertBadgeLevel.level1 => 1.4,
        LocalExpertBadgeLevel.level2 => 4.2,
        LocalExpertBadgeLevel.level3 => 4.6,
      },
      innerRimWidth: switch (level) {
        LocalExpertBadgeLevel.level1 => 0,
        LocalExpertBadgeLevel.level2 => 1.1,
        LocalExpertBadgeLevel.level3 => 1.2,
      },
      shadowBlur: switch (level) {
        LocalExpertBadgeLevel.level1 => 0,
        LocalExpertBadgeLevel.level2 => 7,
        LocalExpertBadgeLevel.level3 => 11,
      },
      shadowAlpha: switch (level) {
        LocalExpertBadgeLevel.level1 => 0,
        LocalExpertBadgeLevel.level2 => 0.2,
        LocalExpertBadgeLevel.level3 => 0.28,
      },
      haloAlpha: switch (level) {
        LocalExpertBadgeLevel.level1 => 0,
        LocalExpertBadgeLevel.level2 => 0,
        LocalExpertBadgeLevel.level3 => 0.2,
      },
      hasGlint: switch (level) {
        LocalExpertBadgeLevel.level1 => false,
        LocalExpertBadgeLevel.level2 => true,
        LocalExpertBadgeLevel.level3 => true,
      },
      ringCount: switch (level) {
        LocalExpertBadgeLevel.level1 => 1,
        LocalExpertBadgeLevel.level2 => 2,
        LocalExpertBadgeLevel.level3 => 3,
      },
      icon: iconForName(iconName),
      abbreviation: abbreviationForName(iconName),
      customArtwork: customArtworkForName(iconName),
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
      'set_meal' => Icons.set_meal,
      'sports_bar' => Icons.sports_bar,
      _ => Icons.restaurant_menu,
    };
  }

  static String? abbreviationForName(String? iconName) {
    final trimmed = iconName?.trim();
    if (trimmed == null || trimmed.isEmpty) {
      return null;
    }
    return switch (trimmed) {
      'bakery_dining' ||
      'dinner_dining' ||
      'donut_large' ||
      'fastfood' ||
      'local_pizza' ||
      'lunch_dining' ||
      'outdoor_grill' ||
      'ramen_dining' ||
      'set_meal' ||
      'sports_bar' => null,
      'restaurant' || 'restaurant_menu' => null,
      _ => trimmed.length <= 4 ? trimmed : null,
    };
  }

  static String? customArtworkForName(String? iconName) {
    return switch (iconName?.trim()) {
      'chicken_wing' => 'chicken_wing',
      'donut_ring' => 'donut_ring',
      _ => null,
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
      child: _BadgeMedallion(metadata: metadata, size: 28, iconSize: 20),
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
          _BadgeMedallion(metadata: metadata, size: 42, iconSize: 30),
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
                    color: metadata.levelTextColor,
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

  const _BadgeMedallion({
    required this.metadata,
    required this.size,
    required this.iconSize,
  });

  @override
  Widget build(BuildContext context) {
    final ring = _BadgeRing(metadata: metadata, iconSize: iconSize);

    return SizedBox(width: size, height: size, child: ring);
  }
}

class _BadgeRing extends StatelessWidget {
  final LocalExpertBadgeVisualMetadata metadata;
  final double iconSize;

  const _BadgeRing({required this.metadata, required this.iconSize});

  @override
  Widget build(BuildContext context) {
    final outerDecoration = metadata.isPlain
        ? BoxDecoration(
            color: metadata.fillColor,
            shape: BoxShape.circle,
            border: Border.all(
              color: metadata.edgeColor,
              width: metadata.borderWidth,
            ),
          )
        : BoxDecoration(
            shape: BoxShape.circle,
            gradient: SweepGradient(
              startAngle: -0.9,
              endAngle: 5.4,
              colors: metadata.isSilverMedal
                  ? const [
                      Color(0xFFFFFFFF),
                      Color(0xFFBFC8D1),
                      Color(0xFF6F7883),
                      Color(0xFFE9EDF1),
                      Color(0xFFFFFFFF),
                    ]
                  : const [
                      Color(0xFFFFF5C8),
                      Color(0xFFE6B43A),
                      Color(0xFF9B6500),
                      Color(0xFFFFD978),
                      Color(0xFFFFF5C8),
                    ],
            ),
            border: Border.all(
              color: metadata.edgeColor,
              width: metadata.borderWidth,
            ),
            boxShadow: [
              if (metadata.haloAlpha > 0)
                BoxShadow(
                  color: metadata.ringColor.withValues(
                    alpha: metadata.haloAlpha,
                  ),
                  blurRadius: metadata.shadowBlur + 4,
                  spreadRadius: 1,
                ),
              BoxShadow(
                color: metadata.edgeColor.withValues(
                  alpha: metadata.shadowAlpha,
                ),
                blurRadius: metadata.shadowBlur,
                offset: const Offset(0, 2),
              ),
            ],
          );

    return Stack(
      alignment: Alignment.center,
      clipBehavior: Clip.none,
      children: [
        Positioned.fill(child: DecoratedBox(decoration: outerDecoration)),
        Positioned.fill(
          child: Padding(
            padding: EdgeInsets.all(metadata.outerRingWidth),
            child: DecoratedBox(
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: metadata.isPlain
                    ? null
                    : LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [
                          metadata.highlightColor,
                          metadata.fillColor,
                          metadata.ringColor.withValues(alpha: 0.46),
                        ],
                        stops: const [0.0, 0.62, 1.0],
                      ),
                color: metadata.isPlain ? metadata.fillColor : null,
                border: metadata.innerRimWidth <= 0
                    ? null
                    : Border.all(
                        color: metadata.innerRimColor.withValues(alpha: 0.78),
                        width: metadata.innerRimWidth,
                      ),
              ),
            ),
          ),
        ),
        if (metadata.hasGlint)
          Positioned(
            top: 4,
            right: 3,
            child: Transform.rotate(
              angle: -0.72,
              child: Container(
                key: const ValueKey('local-expert-badge-glint'),
                width: 13,
                height: 4,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.78),
                  borderRadius: BorderRadius.circular(999),
                ),
              ),
            ),
          ),
        if (metadata.customArtwork != null)
          _CustomBadgeArtwork(
            artwork: metadata.customArtwork!,
            color: metadata.iconColor,
            size: iconSize,
          )
        else if (metadata.abbreviation == null)
          Icon(metadata.icon, size: iconSize, color: metadata.iconColor)
        else
          Text(
            metadata.abbreviation!,
            textAlign: TextAlign.center,
            maxLines: 1,
            style: TextStyle(
              color: metadata.iconColor,
              fontSize:
                  iconSize * _abbreviationFontScale(metadata.abbreviation!),
              fontWeight: FontWeight.w900,
              height: 1,
              letterSpacing: 0,
            ),
          ),
      ],
    );
  }

  double _abbreviationFontScale(String abbreviation) {
    return switch (abbreviation.length) {
      <= 2 => 0.58,
      3 => 0.48,
      _ => 0.38,
    };
  }
}

class _CustomBadgeArtwork extends StatelessWidget {
  final String artwork;
  final Color color;
  final double size;

  const _CustomBadgeArtwork({
    required this.artwork,
    required this.color,
    required this.size,
  });

  @override
  Widget build(BuildContext context) {
    final painter = switch (artwork) {
      'chicken_wing' => _ChickenWingPainter(color),
      'donut_ring' => _DonutRingPainter(color),
      _ => null,
    };
    if (painter == null) {
      return Icon(Icons.restaurant_menu, size: size, color: color);
    }
    return CustomPaint(
      key: ValueKey('local-expert-badge-artwork-$artwork'),
      size: Size.square(size),
      painter: painter,
    );
  }
}

class _ChickenWingPainter extends CustomPainter {
  final Color color;

  const _ChickenWingPainter(this.color);

  @override
  void paint(Canvas canvas, Size size) {
    final scale = size.shortestSide;
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.fill
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    final strokePaint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = scale * 0.08
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    final wing = Path()
      ..moveTo(scale * 0.2, scale * 0.64)
      ..cubicTo(
        scale * 0.16,
        scale * 0.42,
        scale * 0.34,
        scale * 0.18,
        scale * 0.58,
        scale * 0.16,
      )
      ..cubicTo(
        scale * 0.78,
        scale * 0.14,
        scale * 0.91,
        scale * 0.29,
        scale * 0.88,
        scale * 0.47,
      )
      ..cubicTo(
        scale * 0.84,
        scale * 0.71,
        scale * 0.56,
        scale * 0.86,
        scale * 0.34,
        scale * 0.77,
      )
      ..cubicTo(
        scale * 0.27,
        scale * 0.74,
        scale * 0.22,
        scale * 0.69,
        scale * 0.2,
        scale * 0.64,
      )
      ..close();
    canvas.drawPath(wing, paint);

    final bone = Path()
      ..moveTo(scale * 0.27, scale * 0.69)
      ..lineTo(scale * 0.12, scale * 0.83);
    canvas.drawPath(bone, strokePaint);
    canvas.drawCircle(Offset(scale * 0.09, scale * 0.85), scale * 0.075, paint);
    canvas.drawCircle(Offset(scale * 0.18, scale * 0.9), scale * 0.065, paint);

    final highlight = Paint()
      ..color = Colors.white.withValues(alpha: 0.34)
      ..style = PaintingStyle.stroke
      ..strokeWidth = scale * 0.06
      ..strokeCap = StrokeCap.round;
    canvas.drawArc(
      Rect.fromLTWH(scale * 0.38, scale * 0.28, scale * 0.34, scale * 0.28),
      -2.7,
      1.6,
      false,
      highlight,
    );
  }

  @override
  bool shouldRepaint(covariant _ChickenWingPainter oldDelegate) {
    return oldDelegate.color != color;
  }
}

class _DonutRingPainter extends CustomPainter {
  final Color color;

  const _DonutRingPainter(this.color);

  @override
  void paint(Canvas canvas, Size size) {
    final scale = size.shortestSide;
    final center = Offset(scale / 2, scale / 2);
    final ringPaint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = scale * 0.2
      ..strokeCap = StrokeCap.round;
    canvas.drawCircle(center, scale * 0.31, ringPaint);

    final sprinklePaint = Paint()
      ..color = Colors.white.withValues(alpha: 0.76)
      ..style = PaintingStyle.stroke
      ..strokeWidth = scale * 0.045
      ..strokeCap = StrokeCap.round;
    canvas.drawLine(
      Offset(scale * 0.42, scale * 0.28),
      Offset(scale * 0.5, scale * 0.23),
      sprinklePaint,
    );
    canvas.drawLine(
      Offset(scale * 0.66, scale * 0.43),
      Offset(scale * 0.75, scale * 0.47),
      sprinklePaint,
    );
    canvas.drawLine(
      Offset(scale * 0.35, scale * 0.65),
      Offset(scale * 0.43, scale * 0.72),
      sprinklePaint,
    );
  }

  @override
  bool shouldRepaint(covariant _DonutRingPainter oldDelegate) {
    return oldDelegate.color != color;
  }
}

class LocalExpertBadgeOverflowPill extends StatelessWidget {
  final int hiddenCount;

  const LocalExpertBadgeOverflowPill({super.key, required this.hiddenCount});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 20,
      constraints: const BoxConstraints(minWidth: 22),
      padding: const EdgeInsets.symmetric(horizontal: 5),
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: BiteRaterTheme.ocean.withValues(alpha: 0.07),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: BiteRaterTheme.ocean.withValues(alpha: 0.14)),
      ),
      child: Text(
        '+$hiddenCount',
        style: const TextStyle(
          color: BiteRaterTheme.ocean,
          fontSize: 9.5,
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

class LocalExpertBadgeNextLevelProgress {
  final LocalExpertBadgeLevel? nextLevel;
  final int? localClusterCurrent;
  final int? localClusterTarget;
  final int overallCurrent;
  final int overallTarget;

  const LocalExpertBadgeNextLevelProgress({
    required this.nextLevel,
    this.localClusterCurrent,
    this.localClusterTarget,
    required this.overallCurrent,
    required this.overallTarget,
  });

  bool get isHighestLevel => nextLevel == null;

  String get nextLevelLabel {
    return switch (nextLevel) {
      LocalExpertBadgeLevel.level1 => 'Level 1',
      LocalExpertBadgeLevel.level2 => 'Level 2',
      LocalExpertBadgeLevel.level3 => 'Level 3',
      null => '',
    };
  }

  static LocalExpertBadgeNextLevelProgress forBadge(LocalExpertBadge badge) {
    final nextLevel = switch (badge.level) {
      LocalExpertBadgeLevel.level1 => LocalExpertBadgeLevel.level2,
      LocalExpertBadgeLevel.level2 => LocalExpertBadgeLevel.level3,
      LocalExpertBadgeLevel.level3 => null,
    };

    if (nextLevel == null) {
      return LocalExpertBadgeNextLevelProgress(
        nextLevel: null,
        overallCurrent: badge.totalRestaurantCount,
        overallTarget: badge.totalRestaurantCount,
      );
    }

    final threshold = LocalExpertBadgeThresholds.forLevel(nextLevel);
    return LocalExpertBadgeNextLevelProgress(
      nextLevel: nextLevel,
      localClusterCurrent: threshold.distinctRestaurantsInCluster == null
          ? null
          : badge.localClusterRestaurantCount,
      localClusterTarget: threshold.distinctRestaurantsInCluster,
      overallCurrent: badge.totalRestaurantCount,
      overallTarget: threshold.distinctRestaurantsOverall,
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
        child: SingleChildScrollView(
          padding: EdgeInsets.only(
            bottom: MediaQuery.viewInsetsOf(context).bottom,
          ),
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
                              expertTypeId:
                                  reviewNavigationRequest.expertTypeId,
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
                const SizedBox(height: 8),
                _buildNextLevelProgress(
                  LocalExpertBadgeNextLevelProgress.forBadge(badge),
                ),
              ],
            ),
          ),
        ),
      );
    },
  );
}

Widget _buildNextLevelProgress(LocalExpertBadgeNextLevelProgress progress) {
  if (progress.isHighestLevel) {
    return const Text(
      'Highest expert level reached',
      style: TextStyle(
        color: BiteRaterTheme.ink,
        fontSize: 14,
        fontWeight: FontWeight.w900,
      ),
    );
  }

  return Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        'Progress toward ${progress.nextLevelLabel}',
        style: const TextStyle(
          color: BiteRaterTheme.ink,
          fontSize: 14,
          fontWeight: FontWeight.w900,
        ),
      ),
      const SizedBox(height: 8),
      _buildProgressLine(
        current: progress.overallCurrent,
        target: progress.overallTarget,
      ),
    ],
  );
}

Widget _buildProgressLine({required int current, required int target}) {
  final safeTarget = target <= 0 ? 1 : target;
  final clampedCurrent = current.clamp(0, safeTarget).toInt();
  return Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: ClipRRect(
      borderRadius: BorderRadius.circular(999),
      child: LinearProgressIndicator(
        value: clampedCurrent / safeTarget,
        minHeight: 5,
        backgroundColor: BiteRaterTheme.lineBlue.withValues(alpha: 0.55),
        valueColor: const AlwaysStoppedAnimation<Color>(BiteRaterTheme.ocean),
      ),
    ),
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
