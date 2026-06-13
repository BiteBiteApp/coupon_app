import 'package:flutter/material.dart';

class ContributionPointsCard extends StatelessWidget {
  final int points;

  const ContributionPointsCard({super.key, required this.points});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Container(
        constraints: const BoxConstraints(minHeight: 104),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          gradient: LinearGradient(
            colors: [Colors.blue.shade50, Colors.white],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          border: Border.all(color: Colors.blue.shade100),
        ),
        child: Stack(
          children: [
            const Positioned(
              right: 18,
              top: 16,
              child: _ContributionConfettiDot(color: Color(0xFFE85D75)),
            ),
            const Positioned(
              right: 52,
              bottom: 18,
              child: _ContributionConfettiBar(color: Color(0xFF2F80ED)),
            ),
            const Positioned(
              right: 88,
              top: 28,
              child: _ContributionConfettiDot(color: Color(0xFF2F80ED)),
            ),
            Padding(
              padding: const EdgeInsets.all(18),
              child: Row(
                children: [
                  Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(
                      color: Colors.blue.shade700,
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.auto_awesome,
                      color: Colors.white,
                      size: 24,
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Text(
                          'Contribution Points',
                          style: TextStyle(
                            color: Colors.black87,
                            fontSize: 14,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          points.toString(),
                          style: TextStyle(
                            color: Colors.blue.shade900,
                            fontSize: 34,
                            fontWeight: FontWeight.w900,
                            height: 1,
                          ),
                        ),
                      ],
                    ),
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

class _ContributionConfettiDot extends StatelessWidget {
  final Color color;

  const _ContributionConfettiDot({required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 9,
      height: 9,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }
}

class _ContributionConfettiBar extends StatelessWidget {
  final Color color;

  const _ContributionConfettiBar({required this.color});

  @override
  Widget build(BuildContext context) {
    return Transform.rotate(
      angle: -0.45,
      child: Container(
        width: 20,
        height: 5,
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(999),
        ),
      ),
    );
  }
}
