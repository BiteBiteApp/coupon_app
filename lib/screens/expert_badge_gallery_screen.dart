import 'package:flutter/material.dart';

import '../models/local_expert.dart';
import '../models/local_expert_badge.dart';
import '../models/local_expert_badge_celebration.dart';
import '../models/local_expert_badge_calculator.dart';
import '../services/contribution_points_celebration_service.dart';
import '../services/local_expert_badge_celebration_service.dart';
import '../widgets/biterater_theme.dart';
import '../widgets/local_expert_badge_widget.dart';

typedef ExpertBadgePreviewCallback =
    Future<void> Function(BuildContext context, LocalExpertType type);
typedef PointCelebrationPreviewCallback =
    Future<void> Function(BuildContext context);

bool expertBadgeGalleryPreviewControlsVisible({
  required bool isAdmin,
  required bool isDebug,
}) {
  return isAdmin || isDebug;
}

class ExpertBadgeGalleryScreen extends StatelessWidget {
  final bool showPreviewControls;
  final ExpertBadgePreviewCallback? onPreviewBadge;
  final PointCelebrationPreviewCallback? onPreviewPoint;

  const ExpertBadgeGalleryScreen({
    super.key,
    this.showPreviewControls = false,
    this.onPreviewBadge,
    this.onPreviewPoint,
  });

  @override
  Widget build(BuildContext context) {
    final galleryGrid = GridView.builder(
      key: const ValueKey('expert-badge-gallery-grid'),
      padding: EdgeInsets.fromLTRB(16, showPreviewControls ? 8 : 14, 16, 28),
      gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
        maxCrossAxisExtent: 260,
        mainAxisExtent: 206,
        mainAxisSpacing: 12,
        crossAxisSpacing: 12,
      ),
      itemCount: LocalExperts.all.length,
      itemBuilder: (context, index) {
        return _ExpertBadgeGalleryCard(type: LocalExperts.all[index]);
      },
    );

    if (!showPreviewControls) {
      return galleryGrid;
    }

    return Column(
      children: [
        ExpertBadgeGalleryPreviewPanel(
          onPreviewBadge: onPreviewBadge,
          onPreviewPoint: onPreviewPoint,
        ),
        Expanded(child: galleryGrid),
      ],
    );
  }
}

class ExpertBadgeGalleryPreviewPanel extends StatefulWidget {
  final ExpertBadgePreviewCallback? onPreviewBadge;
  final PointCelebrationPreviewCallback? onPreviewPoint;

  const ExpertBadgeGalleryPreviewPanel({
    super.key,
    this.onPreviewBadge,
    this.onPreviewPoint,
  });

  @override
  State<ExpertBadgeGalleryPreviewPanel> createState() =>
      _ExpertBadgeGalleryPreviewPanelState();
}

class _ExpertBadgeGalleryPreviewPanelState
    extends State<ExpertBadgeGalleryPreviewPanel> {
  late LocalExpertType _selectedBadge = _defaultPreviewBadge();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 6),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: BiteRaterTheme.grape.withValues(alpha: 0.16),
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
          child: Wrap(
            spacing: 12,
            runSpacing: 10,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              const Text(
                'Preview',
                style: TextStyle(
                  color: BiteRaterTheme.ink,
                  fontSize: 16,
                  fontWeight: FontWeight.w900,
                ),
              ),
              DropdownButton<LocalExpertType>(
                value: _selectedBadge,
                onChanged: (value) {
                  if (value == null) {
                    return;
                  }
                  setState(() => _selectedBadge = value);
                },
                items: LocalExperts.all
                    .map((type) {
                      return DropdownMenuItem<LocalExpertType>(
                        value: type,
                        child: Text(type.displayName),
                      );
                    })
                    .toList(growable: false),
              ),
              FilledButton.icon(
                key: const ValueKey('preview-local-expert-celebration-button'),
                onPressed: () => _previewBadge(context),
                icon: const Icon(Icons.workspace_premium_rounded),
                label: const Text('Local Expert'),
              ),
              OutlinedButton.icon(
                key: const ValueKey('preview-point-celebration-button'),
                onPressed: () => _previewPoint(context),
                icon: const Icon(Icons.add_circle_outline_rounded),
                label: const Text('+1 point'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _previewBadge(BuildContext context) async {
    final callback = widget.onPreviewBadge ?? _showBadgePreview;
    await callback(context, _selectedBadge);
  }

  Future<void> _previewPoint(BuildContext context) async {
    final callback = widget.onPreviewPoint ?? _showPointPreview;
    await callback(context);
  }

  static LocalExpertType _defaultPreviewBadge() {
    return LocalExperts.all.firstWhere(
      (type) => type.id == 'bbq',
      orElse: () => LocalExperts.all.first,
    );
  }

  static Future<void> _showBadgePreview(
    BuildContext context,
    LocalExpertType type,
  ) {
    return LocalExpertBadgeCelebrationService.show(
      context,
      celebration: LocalExpertBadgeCelebration(
        eventKey: 'preview_${type.id}_${DateTime.now().microsecondsSinceEpoch}',
        expertTypeId: type.id,
        displayName: type.displayName,
        level: LocalExpertBadgeLevel.level1,
        kind: LocalExpertBadgeCelebrationKind.earned,
      ),
    );
  }

  static Future<void> _showPointPreview(BuildContext context) {
    return ContributionPointsCelebrationService.show(context, points: 1);
  }
}

class _ExpertBadgeGalleryCard extends StatelessWidget {
  final LocalExpertType type;

  const _ExpertBadgeGalleryCard({required this.type});

  @override
  Widget build(BuildContext context) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                for (final level in LocalExpertBadgeLevel.values) ...[
                  LocalExpertBadgeWidget(
                    badge: _badgeForLevel(level),
                    mode: LocalExpertBadgeDisplayMode.compact,
                  ),
                  if (level != LocalExpertBadgeLevel.values.last)
                    const SizedBox(width: 8),
                ],
              ],
            ),
            const Spacer(),
            Text(
              type.displayName,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: BiteRaterTheme.ink,
                fontSize: 16,
                fontWeight: FontWeight.w900,
                height: 1.1,
              ),
            ),
            const SizedBox(height: 8),
            _BadgeGalleryMetadataRow(label: 'ID', value: type.id),
            const SizedBox(height: 4),
            _BadgeGalleryMetadataRow(label: 'Icon', value: type.iconName),
          ],
        ),
      ),
    );
  }

  LocalExpertBadge _badgeForLevel(LocalExpertBadgeLevel level) {
    return LocalExpertBadge(
      expertTypeId: type.id,
      displayName: type.displayName,
      level: level,
      totalRestaurantCount: 0,
      localClusterRestaurantCount: 0,
      qualificationMethod: LocalExpertQualificationMethod.none,
    );
  }
}

class _BadgeGalleryMetadataRow extends StatelessWidget {
  final String label;
  final String value;

  const _BadgeGalleryMetadataRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        SizedBox(
          width: 36,
          child: Text(
            label,
            style: const TextStyle(
              color: BiteRaterTheme.mutedInk,
              fontSize: 11,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
        Expanded(
          child: SelectableText(
            value,
            maxLines: 1,
            style: const TextStyle(
              color: BiteRaterTheme.ink,
              fontSize: 12,
              fontWeight: FontWeight.w700,
              height: 1.1,
            ),
          ),
        ),
      ],
    );
  }
}
