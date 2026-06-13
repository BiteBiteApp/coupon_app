import 'package:flutter/material.dart';

import 'bitesaver_colors.dart';

class RestaurantMenuSectionCard extends StatelessWidget {
  final String title;
  final String body;
  final EdgeInsetsGeometry margin;

  const RestaurantMenuSectionCard({
    super.key,
    required this.title,
    required this.body,
    this.margin = EdgeInsets.zero,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: margin,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: BiteSaverColors.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: BiteSaverColors.border),
          boxShadow: const [
            BoxShadow(
              color: Color.fromRGBO(15, 23, 42, 0.06),
              blurRadius: 10,
              offset: Offset(0, 4),
            ),
          ],
        ),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: const TextStyle(
                  color: BiteSaverColors.ink,
                  fontSize: 18,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                body,
                style: const TextStyle(
                  color: BiteSaverColors.valueInk,
                  height: 1.35,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
