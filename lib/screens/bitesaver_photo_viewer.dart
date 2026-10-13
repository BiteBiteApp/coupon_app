import 'package:flutter/material.dart';
import '../widgets/bitesaver_colors.dart';
import '../widgets/bitesaver_restaurant_images.dart';

/// The existing menu viewer's single-image zoom pattern, for profile photographs.
class BiteSaverPhotoViewer extends StatelessWidget {
  final String title;
  final String imageUrl;
  const BiteSaverPhotoViewer({
    super.key,
    required this.title,
    required this.imageUrl,
  });

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: BiteSaverColors.pageBackground,
    appBar: AppBar(
      title: Text(title),
      backgroundColor: BiteSaverColors.pageBackground,
      surfaceTintColor: BiteSaverColors.pageBackground,
    ),
    body: Padding(
      padding: const EdgeInsets.all(16),
      child: Center(
        child: InteractiveViewer(
          minScale: 1,
          maxScale: 4,
          child: BiteSaverRestaurantImage(
            imageUrl: imageUrl,
            fit: BoxFit.contain,
            semanticLabel: title,
            loadingBuilder: (_) => const CircularProgressIndicator(),
            errorBuilder: (_) => const Text('Image unavailable'),
          ),
        ),
      ),
    ),
  );
}
