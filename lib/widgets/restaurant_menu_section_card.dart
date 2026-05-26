import 'package:flutter/material.dart';

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
          color: const Color(0xFFFFFEFB),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: const Color(0xFFE8D8C8)),
          boxShadow: const [
            BoxShadow(
              color: Color.fromRGBO(64, 42, 22, 0.06),
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
                  color: Color(0xFF2B1D14),
                  fontSize: 18,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                body,
                style: const TextStyle(
                  color: Color(0xFF514235),
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
