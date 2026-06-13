import 'package:flutter/material.dart';

import '../models/local_expert_badge.dart';
import 'local_expert_badge_widget.dart';
import 'reviewer_activity_pill.dart';

class ReviewerIdentityBadgeRow extends StatelessWidget {
  final Widget reviewerName;
  final int reviewCount;
  final List<LocalExpertBadge> visibleBadges;
  final int hiddenBadgeCount;
  final ValueChanged<LocalExpertBadge> onBadgeTap;
  final VoidCallback? onOverflowTap;

  const ReviewerIdentityBadgeRow({
    super.key,
    required this.reviewerName,
    required this.reviewCount,
    required this.visibleBadges,
    required this.hiddenBadgeCount,
    required this.onBadgeTap,
    this.onOverflowTap,
  });

  bool get _hasExpertBadges => visibleBadges.isNotEmpty || hiddenBadgeCount > 0;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 4,
      runSpacing: 3,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        reviewerName,
        ReviewerActivityPill(reviewCount: reviewCount),
        if (_hasExpertBadges)
          const _ReviewerExpertBadgeSeparator(
            key: ValueKey('reviewer-expert-badge-separator'),
          ),
        for (final badge in visibleBadges)
          InkWell(
            key: ValueKey('reviewer-local-expert-badge-${badge.expertTypeId}'),
            borderRadius: BorderRadius.circular(999),
            onTap: () => onBadgeTap(badge),
            child: LocalExpertBadgeWidget(
              badge: badge,
              mode: LocalExpertBadgeDisplayMode.compact,
            ),
          ),
        if (hiddenBadgeCount > 0)
          InkWell(
            key: const ValueKey('reviewer-local-expert-badge-overflow'),
            borderRadius: BorderRadius.circular(999),
            onTap: onOverflowTap,
            child: LocalExpertBadgeOverflowPill(hiddenCount: hiddenBadgeCount),
          ),
      ],
    );
  }
}

class _ReviewerExpertBadgeSeparator extends StatelessWidget {
  const _ReviewerExpertBadgeSeparator({super.key});

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(horizontal: 2),
      child: Text(
        '·',
        style: TextStyle(
          color: Color(0xFF8B96A3),
          fontSize: 16,
          fontWeight: FontWeight.w900,
          height: 1,
        ),
      ),
    );
  }
}
