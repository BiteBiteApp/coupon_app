import 'dart:async';
import 'dart:math';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';

import 'contribution_points_service.dart';

typedef ContributionPointCelebrationMarker =
    Future<ContributionPointCelebrationMarkResult> Function({
      required String userId,
      required Iterable<String> ledgerEntryIds,
    });

class ContributionPointsCelebrationService {
  static const Duration displayDuration = Duration(milliseconds: 4100);
  static const String popSoundAsset = 'sounds/contribution_pop.wav';

  static Completer<void>? _activeCelebration;
  static bool _soundPlaying = false;
  static final Set<String> _shownLedgerEntryIdsThisSession = <String>{};

  const ContributionPointsCelebrationService._();

  static String pointMessage(int points) {
    final pointWord = points == 1 ? 'point' : 'points';
    return 'You just earned $points $pointWord!';
  }

  static Future<bool> show(BuildContext context, {required int points}) async {
    if (points <= 0) {
      return false;
    }

    while (_activeCelebration != null) {
      await _activeCelebration!.future;
    }

    if (!context.mounted) {
      return false;
    }
    final overlay = Overlay.maybeOf(context, rootOverlay: true);
    if (overlay == null) {
      return false;
    }

    final completer = Completer<void>();
    _activeCelebration = completer;
    late final OverlayEntry entry;
    var dismissed = false;

    void dismiss() {
      if (dismissed) {
        return;
      }
      dismissed = true;
      entry.remove();
      _activeCelebration = null;
      if (!completer.isCompleted) {
        completer.complete();
      }
    }

    entry = OverlayEntry(
      builder: (context) {
        return _ContributionPointsCelebrationOverlay(
          points: points,
          onDismiss: dismiss,
        );
      },
    );

    overlay.insert(entry);
    unawaited(_playPopSound());
    await completer.future;
    return true;
  }

  static Future<bool> showAwardResult(
    BuildContext context, {
    required String userId,
    required ContributionPointAwardResult award,
    String debugSource = 'contribution_points_award',
    ContributionPointCelebrationMarker? markCelebrated,
  }) async {
    final ledgerIds = unshownLedgerEntryIdsThisSession(
      award.newlyCreatedLedgerEntryIds,
    );
    final ledgerIdSet = ledgerIds.toSet();
    final points = award.entries.fold<int>(
      0,
      (total, entry) =>
          entry.wasCreated &&
              entry.points > 0 &&
              ledgerIdSet.contains(entry.ledgerEntryId)
          ? total + entry.points
          : total,
    );
    if (points <= 0 || ledgerIds.isEmpty) {
      return false;
    }

    try {
      final shown = await show(context, points: points);
      if (shown) {
        rememberLedgerEntriesShownThisSession(ledgerIds);
        try {
          final result =
              await (markCelebrated ??
                  ContributionPointsService.markCelebratedLedgerEntries)(
                userId: userId,
                ledgerEntryIds: ledgerIds,
              );
          if (result.hasProblems) {
            logCelebrationMarkResult(source: debugSource, result: result);
          }
        } catch (error, stackTrace) {
          logPostSaveAwardResultFailure(
            source: debugSource,
            ledgerEntryIds: ledgerIds,
            error: error,
            stackTrace: stackTrace,
          );
        }
      }
      return shown;
    } catch (error, stackTrace) {
      logPostSaveAwardResultFailure(
        source: debugSource,
        ledgerEntryIds: ledgerIds,
        error: error,
        stackTrace: stackTrace,
      );
      return false;
    }
  }

  static List<String> unshownLedgerEntryIdsThisSession(Iterable<String> ids) {
    return ids
        .map((id) => id.trim())
        .where(
          (id) =>
              id.isNotEmpty && !_shownLedgerEntryIdsThisSession.contains(id),
        )
        .toSet()
        .toList(growable: false);
  }

  static void rememberLedgerEntriesShownThisSession(Iterable<String> ids) {
    _shownLedgerEntryIdsThisSession.addAll(
      ids.map((id) => id.trim()).where((id) => id.isNotEmpty),
    );
  }

  static void logPostSaveAwardResultFailure({
    required String source,
    required Iterable<String> ledgerEntryIds,
    required Object error,
    required StackTrace stackTrace,
  }) {
    debugPrint(
      'Contribution point celebration bookkeeping failed after the main '
      'BiteScore save already succeeded. source=$source '
      'ledgerEntryIds=${ledgerEntryIds.toList()} '
      'The user may see this contribution celebration again later if the '
      'ledger entries remain pending. error=$error',
    );
    debugPrintStack(stackTrace: stackTrace);
  }

  static void logCelebrationMarkResult({
    required String source,
    required ContributionPointCelebrationMarkResult result,
  }) {
    debugPrint(
      'Contribution point celebration bookkeeping completed with nonfatal '
      'ledger states after save succeeded. source=$source '
      'attempted=${result.attemptedEntryIds.toList()} '
      'marked=${result.markedEntryIds.toList()} '
      'alreadyCelebrated=${result.alreadyCelebratedEntryIds.toList()} '
      'missing=${result.missingEntryIds.toList()} '
      'ignored=${result.ignoredEntryIds.toList()}',
    );
  }

  @visibleForTesting
  static void resetShownLedgerEntriesForTesting() {
    _shownLedgerEntryIdsThisSession.clear();
  }

  static Future<void> _playPopSound() async {
    if (_soundPlaying) {
      return;
    }
    _soundPlaying = true;
    final player = AudioPlayer();
    try {
      await player.setVolume(0.35);
      await player.play(AssetSource(popSoundAsset));
      await Future<void>.delayed(const Duration(milliseconds: 650));
    } catch (_) {
    } finally {
      await player.dispose();
      _soundPlaying = false;
    }
  }
}

class _ContributionPointsCelebrationOverlay extends StatefulWidget {
  final int points;
  final VoidCallback onDismiss;

  const _ContributionPointsCelebrationOverlay({
    required this.points,
    required this.onDismiss,
  });

  @override
  State<_ContributionPointsCelebrationOverlay> createState() =>
      _ContributionPointsCelebrationOverlayState();
}

class _ContributionPointsCelebrationOverlayState
    extends State<_ContributionPointsCelebrationOverlay>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Timer _dismissTimer;
  late final List<_ConfettiParticle> _particles;

  @override
  void initState() {
    super.initState();
    _particles = _ConfettiParticle.createBurst();
    _controller = AnimationController(
      vsync: this,
      duration: ContributionPointsCelebrationService.displayDuration,
    )..forward();
    _dismissTimer = Timer(
      ContributionPointsCelebrationService.displayDuration,
      widget.onDismiss,
    );
  }

  @override
  void dispose() {
    _dismissTimer.cancel();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cardAnimation = CurvedAnimation(
      parent: _controller,
      curve: const Interval(0, 0.34, curve: Curves.easeOutBack),
    );
    final fadeAnimation = CurvedAnimation(
      parent: _controller,
      curve: const Interval(0, 0.18, curve: Curves.easeOut),
      reverseCurve: Curves.easeIn,
    );

    return Material(
      color: Colors.transparent,
      child: SafeArea(
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: widget.onDismiss,
          child: Stack(
            children: [
              AnimatedBuilder(
                animation: _controller,
                builder: (context, child) {
                  return CustomPaint(
                    painter: _ContributionConfettiPainter(
                      progress: _controller.value,
                      particles: _particles,
                    ),
                    size: Size.infinite,
                  );
                },
              ),
              Center(
                child: FadeTransition(
                  opacity: fadeAnimation,
                  child: ScaleTransition(
                    scale: Tween<double>(
                      begin: 0.82,
                      end: 1,
                    ).animate(cardAnimation),
                    child: GestureDetector(
                      onTap: () {},
                      child: _ContributionPointsCelebrationCard(
                        points: widget.points,
                        onDismiss: widget.onDismiss,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ContributionPointsCelebrationCard extends StatelessWidget {
  final int points;
  final VoidCallback onDismiss;

  const _ContributionPointsCelebrationCard({
    required this.points,
    required this.onDismiss,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: min(MediaQuery.sizeOf(context).width - 48, 340),
      padding: const EdgeInsets.fromLTRB(24, 22, 14, 24),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFFD9E4FF)),
        boxShadow: const [
          BoxShadow(
            color: Color(0x33000000),
            blurRadius: 28,
            offset: Offset(0, 16),
          ),
        ],
      ),
      child: Stack(
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 8, right: 18),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 52,
                  height: 52,
                  decoration: const BoxDecoration(
                    shape: BoxShape.circle,
                    color: Color(0xFFE9F0FF),
                  ),
                  child: const Icon(
                    Icons.workspace_premium_rounded,
                    color: Color(0xFF2F5BFF),
                    size: 30,
                  ),
                ),
                const SizedBox(height: 14),
                const Text(
                  'Congratulations!',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: Color(0xFF111111),
                    fontSize: 26,
                    fontWeight: FontWeight.w900,
                    height: 1.05,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  ContributionPointsCelebrationService.pointMessage(points),
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: Color(0xFF3F464F),
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    height: 1.25,
                  ),
                ),
              ],
            ),
          ),
          Positioned(
            top: 0,
            right: 0,
            child: IconButton(
              tooltip: 'Close',
              onPressed: onDismiss,
              icon: const Icon(Icons.close_rounded),
              color: const Color(0xFF5C6470),
            ),
          ),
        ],
      ),
    );
  }
}

class _ContributionConfettiPainter extends CustomPainter {
  final double progress;
  final List<_ConfettiParticle> particles;

  const _ContributionConfettiPainter({
    required this.progress,
    required this.particles,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height * 0.42);
    final paint = Paint()..style = PaintingStyle.fill;
    final settle = Curves.easeOutCubic.transform(progress.clamp(0, 1));
    final fade = progress < 0.74 ? 1.0 : (1 - progress) / 0.26;

    for (final particle in particles) {
      final distance = particle.distance * settle;
      final gravity = Offset(0, 110 * progress * progress);
      final position =
          center +
          Offset(cos(particle.angle), sin(particle.angle)) * distance +
          gravity;
      paint.color = particle.color.withValues(alpha: fade.clamp(0, 1));
      canvas.save();
      canvas.translate(position.dx, position.dy);
      canvas.rotate(particle.rotation + progress * particle.spin);
      final rect = Rect.fromCenter(
        center: Offset.zero,
        width: particle.width,
        height: particle.height,
      );
      canvas.drawRRect(
        RRect.fromRectAndRadius(rect, Radius.circular(particle.height / 2)),
        paint,
      );
      canvas.restore();
    }
  }

  @override
  bool shouldRepaint(covariant _ContributionConfettiPainter oldDelegate) {
    return progress != oldDelegate.progress ||
        particles != oldDelegate.particles;
  }
}

class _ConfettiParticle {
  static const List<Color> _colors = <Color>[
    Color(0xFF2F5BFF),
    Color(0xFFE85D75),
    Color(0xFF79A7FF),
    Color(0xFFFF8EA0),
  ];

  final double angle;
  final double distance;
  final double rotation;
  final double spin;
  final double width;
  final double height;
  final Color color;

  const _ConfettiParticle({
    required this.angle,
    required this.distance,
    required this.rotation,
    required this.spin,
    required this.width,
    required this.height,
    required this.color,
  });

  static List<_ConfettiParticle> createBurst() {
    final random = Random(64);
    return List<_ConfettiParticle>.generate(46, (index) {
      final angle = -pi + random.nextDouble() * pi * 2;
      return _ConfettiParticle(
        angle: angle,
        distance: 110 + random.nextDouble() * 260,
        rotation: random.nextDouble() * pi,
        spin: (random.nextBool() ? 1 : -1) * (1.8 + random.nextDouble() * 4),
        width: 6 + random.nextDouble() * 8,
        height: 4 + random.nextDouble() * 5,
        color: _colors[index % _colors.length],
      );
    });
  }
}
