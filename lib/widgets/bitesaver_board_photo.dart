import 'package:flutter/material.dart';
import 'bitesaver_restaurant_images.dart';

class BiteSaverBoardPhoto extends StatelessWidget {
  final String imageUrl;
  final VoidCallback onTap;
  const BiteSaverBoardPhoto({
    super.key,
    required this.imageUrl,
    required this.onTap,
  });
  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: 'Enlarge Daily Specials board photo',
    child: InkWell(
      key: const ValueKey('daily-specials-board-photo'),
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          LayoutBuilder(
            builder: (_, constraints) => SizedBox(
              height: (constraints.maxWidth * 0.9).clamp(200.0, 420.0),
              child: BiteSaverRestaurantImage(
                imageUrl: imageUrl,
                fit: BoxFit.contain,
              ),
            ),
          ),
          const Padding(
            padding: EdgeInsets.only(top: 8),
            child: Text('Tap to enlarge', textAlign: TextAlign.center),
          ),
        ],
      ),
    ),
  );
}
