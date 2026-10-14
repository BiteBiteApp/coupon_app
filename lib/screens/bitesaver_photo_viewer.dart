import 'dart:convert';

import 'package:flutter/material.dart';
import '../widgets/bitesaver_colors.dart';
import '../widgets/bitesaver_restaurant_images.dart';

/// Read-only photograph viewer. The caller supplies photos for one restaurant.
/// Single-photo callers retain the existing zoom view.
class BiteSaverPhotoViewer extends StatelessWidget {
  final String title;
  final String imageUrl;
  final List<String> additionalImageUrls;
  const BiteSaverPhotoViewer({
    super.key,
    required this.title,
    required this.imageUrl,
    this.additionalImageUrls = const [],
  });

  @override
  Widget build(BuildContext context) {
    final images = <String>{
      for (final url in [imageUrl, ...additionalImageUrls])
        if (url.trim().isNotEmpty) url.trim(),
    }.toList(growable: false);
    return Scaffold(
      backgroundColor: BiteSaverColors.pageBackground,
      appBar: AppBar(
        title: Text(title),
        backgroundColor: BiteSaverColors.pageBackground,
        surfaceTintColor: BiteSaverColors.pageBackground,
      ),
      body: SafeArea(
        child: _PhotoPages(
          // Reset page and zoom state when the restaurant or its photos change.
          key: ValueKey(jsonEncode([title, images])),
          title: title,
          images: images,
        ),
      ),
    );
  }
}

class _PhotoPages extends StatefulWidget {
  final String title;
  final List<String> images;
  const _PhotoPages({super.key, required this.title, required this.images});

  @override
  State<_PhotoPages> createState() => _PhotoPagesState();
}

class _PhotoPagesState extends State<_PhotoPages> {
  final _controller = PageController();
  int _index = 0;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Widget _photo(int index) => Padding(
    padding: const EdgeInsets.all(16),
    child: Center(
      child: InteractiveViewer(
        key: ValueKey('photo-zoom-$index'),
        minScale: 1,
        maxScale: 4,
        child: BiteSaverRestaurantImage(
          imageUrl: widget.images[index],
          fit: BoxFit.contain,
          semanticLabel: '${widget.title}, photo ${index + 1}',
          loadingBuilder: (_) => const CircularProgressIndicator(),
          errorBuilder: (_) => const Text('Image unavailable'),
        ),
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    if (widget.images.isEmpty) {
      return const Center(child: Text('Image unavailable'));
    }
    if (widget.images.length == 1) return _photo(0);
    return Column(
      children: [
        Expanded(
          child: PageView.builder(
            controller: _controller,
            itemCount: widget.images.length,
            onPageChanged: (index) => setState(() => _index = index),
            itemBuilder: (_, index) => _photo(index),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
          child: Wrap(
            alignment: WrapAlignment.center,
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 12,
            runSpacing: 8,
            children: [
              OutlinedButton.icon(
                onPressed: _index == 0
                    ? null
                    : () => _controller.jumpToPage(_index - 1),
                icon: const Icon(Icons.chevron_left),
                label: const Text('Previous'),
              ),
              Semantics(
                liveRegion: true,
                child: Text('${_index + 1} / ${widget.images.length}'),
              ),
              OutlinedButton.icon(
                onPressed: _index == widget.images.length - 1
                    ? null
                    : () => _controller.jumpToPage(_index + 1),
                icon: const Icon(Icons.chevron_right),
                label: const Text('Next'),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
