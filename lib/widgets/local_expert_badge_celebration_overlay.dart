import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../models/local_expert_badge_celebration.dart';
import 'biterater_theme.dart';
import 'local_expert_badge_widget.dart';

class LocalExpertBadgeCelebrationOverlay extends StatefulWidget {
  @visibleForTesting
  static const double originalMotionTimelineMs = 3400;

  final LocalExpertBadgeCelebration celebration;
  final Duration displayDuration;
  final VoidCallback onDismiss;
  final VoidCallback? onLanded;

  const LocalExpertBadgeCelebrationOverlay({
    super.key,
    required this.celebration,
    required this.displayDuration,
    required this.onDismiss,
    this.onLanded,
  });

  @override
  State<LocalExpertBadgeCelebrationOverlay> createState() =>
      _LocalExpertBadgeCelebrationOverlayState();
}

class _LocalExpertBadgeCelebrationOverlayState
    extends State<LocalExpertBadgeCelebrationOverlay>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Timer _dismissTimer;
  bool _landed = false;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: widget.displayDuration,
    )..addListener(_handleLanding);
    _controller.forward();
    _dismissTimer = Timer(widget.displayDuration, widget.onDismiss);
  }

  @override
  void dispose() {
    _dismissTimer.cancel();
    _controller.removeListener(_handleLanding);
    _controller.dispose();
    super.dispose();
  }

  void _handleLanding() {
    if (!_landed && _badgeMotionProgress(_controller.value) >= 0.42) {
      _landed = true;
      widget.onLanded?.call();
    }
  }

  double _badgeMotionProgress(double progress) {
    final displayMs = widget.displayDuration.inMilliseconds;
    if (displayMs <= 0) {
      return 1;
    }
    final motionScale = math.max(
      1.0,
      displayMs / LocalExpertBadgeCelebrationOverlay.originalMotionTimelineMs,
    );
    return (progress * motionScale).clamp(0, 1).toDouble();
  }

  @override
  Widget build(BuildContext context) {
    final mediaQuery = MediaQuery.of(context);
    final reducedMotion =
        mediaQuery.disableAnimations || mediaQuery.accessibleNavigation;

    return Material(
      color: Colors.transparent,
      child: SafeArea(
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: widget.onDismiss,
          child: Stack(
            children: [
              Positioned.fill(
                child: AnimatedBuilder(
                  animation: _controller,
                  builder: (context, child) {
                    return LocalExpertBadgeFireworks(
                      progress: _controller.value,
                      reducedMotion: reducedMotion,
                    );
                  },
                ),
              ),
              Center(
                child: AnimatedBuilder(
                  animation: _controller,
                  builder: (context, child) {
                    final progress = _badgeMotionProgress(_controller.value);
                    final opacity = reducedMotion
                        ? Curves.easeOut.transform(
                            (progress / 0.18).clamp(0, 1),
                          )
                        : Curves.easeOut.transform(
                            (progress / 0.12).clamp(0, 1),
                          );
                    final textOpacity = Curves.easeOut.transform(
                      ((progress - 0.44) / 0.2).clamp(0, 1),
                    );
                    final scale = reducedMotion
                        ? Tween<double>(begin: 0.88, end: 1).transform(
                            Curves.easeOutBack.transform(
                              (progress / 0.42).clamp(0, 1),
                            ),
                          )
                        : 1.0;

                    return Opacity(
                      opacity: opacity.toDouble(),
                      child: Transform.translate(
                        offset: reducedMotion
                            ? Offset.zero
                            : Offset(
                                0,
                                _fallingBadgeOffset(
                                  progress,
                                  mediaQuery.size.height,
                                ),
                              ),
                        child: Transform.scale(
                          scale: scale,
                          child: _LocalExpertBadgeCelebrationCard(
                            celebration: widget.celebration,
                            textOpacity: textOpacity.toDouble(),
                            onDismiss: widget.onDismiss,
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  double _fallingBadgeOffset(double progress, double screenHeight) {
    if (progress < 0.42) {
      final t = Curves.easeIn.transform(progress / 0.42);
      return -math.max(screenHeight * 0.55, 320) * (1 - t);
    }
    if (progress < 0.58) {
      final t = Curves.easeOut.transform((progress - 0.42) / 0.16);
      return 34 * math.sin(t * math.pi);
    }
    if (progress < 0.72) {
      final t = Curves.easeOut.transform((progress - 0.58) / 0.14);
      return -15 * math.sin(t * math.pi);
    }
    return 0;
  }
}

class LocalExpertBadgeFireworks extends StatelessWidget {
  final double progress;
  final bool reducedMotion;

  const LocalExpertBadgeFireworks({
    super.key,
    required this.progress,
    required this.reducedMotion,
  });

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: CustomPaint(
        painter: _LocalExpertBadgeFireworksPainter(
          progress: progress,
          reducedMotion: reducedMotion,
        ),
        size: Size.infinite,
      ),
    );
  }
}

class _LocalExpertBadgeFireworksPainter extends CustomPainter {
  static const List<_FireworkBurst> _bursts = [
    _FireworkBurst(
      origin: Offset(0.30, 0.34),
      start: 0.20,
      radius: 92,
      color: Color(0xFFFFC857),
    ),
    _FireworkBurst(
      origin: Offset(0.70, 0.36),
      start: 0.27,
      radius: 86,
      color: Color(0xFF47C2FF),
    ),
    _FireworkBurst(
      origin: Offset(0.50, 0.28),
      start: 0.34,
      radius: 104,
      color: Color(0xFFFF6B9A),
    ),
    _FireworkBurst(
      origin: Offset(0.38, 0.57),
      start: 0.44,
      radius: 72,
      color: Color(0xFF8FE388),
    ),
    _FireworkBurst(
      origin: Offset(0.64, 0.58),
      start: 0.50,
      radius: 76,
      color: Color(0xFF9B7BFF),
    ),
  ];

  final double progress;
  final bool reducedMotion;

  const _LocalExpertBadgeFireworksPainter({
    required this.progress,
    required this.reducedMotion,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke;

    if (reducedMotion) {
      _paintReducedMotionSparkles(canvas, size, paint);
      return;
    }

    for (final burst in _bursts) {
      final localProgress = ((progress - burst.start) / 0.34).clamp(0, 1);
      if (localProgress <= 0 || localProgress >= 1) {
        continue;
      }
      final eased = Curves.easeOutCubic.transform(localProgress.toDouble());
      final fade = math.sin(localProgress * math.pi).clamp(0, 1).toDouble();
      final center = Offset(
        size.width * burst.origin.dx,
        size.height * burst.origin.dy,
      );
      final radius = burst.radius * eased;

      for (var index = 0; index < 14; index += 1) {
        final angle = (math.pi * 2 / 14) * index + burst.start * math.pi;
        final start = center + Offset(math.cos(angle), math.sin(angle)) * 18;
        final end = center + Offset(math.cos(angle), math.sin(angle)) * radius;
        paint
          ..color = burst.color.withValues(alpha: 0.54 * fade)
          ..strokeWidth = 2.4 - localProgress;
        canvas.drawLine(start, end, paint);
      }

      paint
        ..style = PaintingStyle.fill
        ..color = burst.color.withValues(alpha: 0.22 * fade);
      for (var index = 0; index < 7; index += 1) {
        final angle = (math.pi * 2 / 7) * index + math.pi / 9;
        final point =
            center + Offset(math.cos(angle), math.sin(angle)) * radius * 0.72;
        canvas.drawCircle(point, 3.8 * (1 - localProgress) + 1.4, paint);
      }
      paint.style = PaintingStyle.stroke;
    }
  }

  void _paintReducedMotionSparkles(Canvas canvas, Size size, Paint paint) {
    final fadeIn = Curves.easeOut.transform((progress / 0.22).clamp(0, 1));
    final alpha = (0.34 * fadeIn).toDouble();
    paint
      ..style = PaintingStyle.fill
      ..color = const Color(0xFFFFC857).withValues(alpha: alpha);

    const sparkles = [
      Offset(0.32, 0.34),
      Offset(0.68, 0.35),
      Offset(0.42, 0.58),
      Offset(0.60, 0.57),
      Offset(0.50, 0.28),
    ];
    for (final sparkle in sparkles) {
      final center = Offset(size.width * sparkle.dx, size.height * sparkle.dy);
      canvas.drawCircle(center, 5, paint);
      paint
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.8;
      canvas.drawLine(center.translate(-8, 0), center.translate(8, 0), paint);
      canvas.drawLine(center.translate(0, -8), center.translate(0, 8), paint);
      paint.style = PaintingStyle.fill;
    }
  }

  @override
  bool shouldRepaint(covariant _LocalExpertBadgeFireworksPainter oldDelegate) {
    return progress != oldDelegate.progress ||
        reducedMotion != oldDelegate.reducedMotion;
  }
}

class _FireworkBurst {
  final Offset origin;
  final double start;
  final double radius;
  final Color color;

  const _FireworkBurst({
    required this.origin,
    required this.start,
    required this.radius,
    required this.color,
  });
}

class _LocalExpertBadgeCelebrationCard extends StatelessWidget {
  final LocalExpertBadgeCelebration celebration;
  final double textOpacity;
  final VoidCallback onDismiss;

  const _LocalExpertBadgeCelebrationCard({
    required this.celebration,
    required this.textOpacity,
    required this.onDismiss,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () {},
      child: Container(
        constraints: const BoxConstraints(maxWidth: 330),
        margin: const EdgeInsets.symmetric(horizontal: 24),
        padding: const EdgeInsets.fromLTRB(22, 22, 22, 18),
        decoration: BoxDecoration(
          color: const Color(0xFFFDFDFC),
          borderRadius: BorderRadius.circular(22),
          border: Border.all(color: const Color(0xFFD7D7D1)),
          boxShadow: const [
            BoxShadow(
              color: Color(0x33000000),
              blurRadius: 26,
              offset: Offset(0, 14),
            ),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Semantics(
              label: '${celebration.displayName} Expert Badge',
              child: Transform.scale(
                scale: 1.9,
                child: LocalExpertBadgeWidget(
                  badge: celebration.badge,
                  mode: LocalExpertBadgeDisplayMode.compact,
                ),
              ),
            ),
            const SizedBox(height: 30),
            Opacity(
              opacity: textOpacity,
              child: Column(
                children: [
                  Text(
                    celebration.headline,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: BiteRaterTheme.ink,
                      fontSize: 23,
                      fontWeight: FontWeight.w900,
                      height: 1.05,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    celebration.message,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: BiteRaterTheme.mutedInk,
                      fontSize: 15,
                      fontWeight: FontWeight.w800,
                      height: 1.25,
                    ),
                  ),
                  const SizedBox(height: 16),
                  IconButton(
                    tooltip: 'Close',
                    onPressed: onDismiss,
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
