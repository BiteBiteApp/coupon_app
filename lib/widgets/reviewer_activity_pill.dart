import 'package:flutter/material.dart';

import 'biterater_theme.dart';

enum ReviewerActivityTier { beginner, intermediate, advanced, ace }

class ReviewerActivityVisuals {
  final String label;
  final Color foregroundColor;
  final Color backgroundColor;
  final Color borderColor;

  const ReviewerActivityVisuals({
    required this.label,
    required this.foregroundColor,
    required this.backgroundColor,
    required this.borderColor,
  });
}

class ReviewerActivityPresenter {
  static ReviewerActivityTier tierForPublicReviewCount(int reviewCount) {
    if (reviewCount >= 25) {
      return ReviewerActivityTier.ace;
    }
    if (reviewCount >= 10) {
      return ReviewerActivityTier.advanced;
    }
    if (reviewCount >= 3) {
      return ReviewerActivityTier.intermediate;
    }
    return ReviewerActivityTier.beginner;
  }

  static ReviewerActivityVisuals visualsForReviewCount(int reviewCount) {
    return visualsForTier(tierForPublicReviewCount(reviewCount));
  }

  static ReviewerActivityVisuals visualsForTier(ReviewerActivityTier tier) {
    return switch (tier) {
      ReviewerActivityTier.beginner => ReviewerActivityVisuals(
        label: 'Beginner',
        foregroundColor: const Color(0xFF52677E),
        backgroundColor: const Color(0xFFEFF5FA),
        borderColor: const Color(0xFFD7E4EF),
      ),
      ReviewerActivityTier.intermediate => ReviewerActivityVisuals(
        label: 'Intermediate',
        foregroundColor: BiteRaterTheme.ocean,
        backgroundColor: const Color(0xFFE9F5FF),
        borderColor: const Color(0xFFCBE8FF),
      ),
      ReviewerActivityTier.advanced => ReviewerActivityVisuals(
        label: 'Advanced',
        foregroundColor: BiteRaterTheme.grape,
        backgroundColor: const Color(0xFFF0EAFE),
        borderColor: const Color(0xFFDACCF8),
      ),
      ReviewerActivityTier.ace => ReviewerActivityVisuals(
        label: '♠ Ace ♠',
        foregroundColor: const Color(0xFF94610B),
        backgroundColor: const Color(0xFFFFF3D5),
        borderColor: const Color(0xFFF2C86C),
      ),
    };
  }
}

class ReviewerActivityPill extends StatelessWidget {
  final int reviewCount;

  const ReviewerActivityPill({super.key, required this.reviewCount});

  @override
  Widget build(BuildContext context) {
    final visuals = ReviewerActivityPresenter.visualsForReviewCount(
      reviewCount,
    );

    return Material(
      color: Colors.transparent,
      child: InkWell(
        key: const ValueKey('reviewer-activity-pill'),
        borderRadius: BorderRadius.circular(999),
        onTap: () => showReviewerActivityExplanation(context),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
          decoration: BoxDecoration(
            color: visuals.backgroundColor,
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: visuals.borderColor),
          ),
          child: Text(
            visuals.label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: visuals.foregroundColor,
              fontSize: 11,
              fontWeight: FontWeight.w900,
              height: 1,
            ),
          ),
        ),
      ),
    );
  }
}

Future<void> showReviewerActivityExplanation(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (context) {
      return SafeArea(
        child: SingleChildScrollView(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: const [
                Text(
                  'Reviewer Activity',
                  style: TextStyle(
                    color: BiteRaterTheme.ink,
                    fontSize: 20,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                SizedBox(height: 14),
                _ReviewerActivityExplanationLine(
                  title: 'Beginner',
                  body: 'New to reviewing.',
                ),
                _ReviewerActivityExplanationLine(
                  title: 'Intermediate',
                  body: 'Has started contributing regular dish ratings.',
                ),
                _ReviewerActivityExplanationLine(
                  title: 'Advanced',
                  body: 'An active reviewer with a stronger review history.',
                ),
                _ReviewerActivityExplanationLine(
                  title: '♠ Ace ♠',
                  body: 'One of the most active BiteScore reviewers.',
                ),
              ],
            ),
          ),
        ),
      );
    },
  );
}

class _ReviewerActivityExplanationLine extends StatelessWidget {
  final String title;
  final String body;

  const _ReviewerActivityExplanationLine({
    required this.title,
    required this.body,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              color: BiteRaterTheme.ink,
              fontSize: 14,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            body,
            style: const TextStyle(
              color: BiteRaterTheme.mutedInk,
              fontSize: 13,
              fontWeight: FontWeight.w600,
              height: 1.25,
            ),
          ),
        ],
      ),
    );
  }
}
