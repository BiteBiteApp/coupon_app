import 'package:flutter/material.dart';

import '../services/restaurant_qr_export.dart';
import '../services/restaurant_qr_image_service.dart';

enum RestaurantQrPreviewExit { close, back }

Future<RestaurantQrPreviewExit?> showRestaurantQrPreviewDialog({
  required BuildContext context,
  required RestaurantQrImageResult image,
  required bool isSensitive,
  bool showBack = false,
  RestaurantQrExporter? exporter,
}) {
  return showDialog<RestaurantQrPreviewExit>(
    context: context,
    builder: (_) => RestaurantQrPreviewDialog(
      image: image,
      isSensitive: isSensitive,
      showBack: showBack,
      exporter: exporter,
    ),
  );
}

class RestaurantQrPreviewDialog extends StatefulWidget {
  static const String sensitiveWarning =
      'This QR grants access to the invitation. Share it only with the '
      'intended restaurant. Copied or downloaded images may remain on this '
      'device or clipboard until removed.';

  final RestaurantQrImageResult image;
  final bool isSensitive;
  final bool showBack;
  final RestaurantQrExporter? exporter;

  const RestaurantQrPreviewDialog({
    super.key,
    required this.image,
    required this.isSensitive,
    this.showBack = false,
    this.exporter,
  });

  @override
  State<RestaurantQrPreviewDialog> createState() =>
      _RestaurantQrPreviewDialogState();
}

class _RestaurantQrPreviewDialogState extends State<RestaurantQrPreviewDialog> {
  late RestaurantQrExporter _exporter;
  bool _isCopying = false;
  bool _isDownloading = false;
  String? _statusMessage;

  @override
  void initState() {
    super.initState();
    _exporter = widget.exporter ?? RestaurantQrExporter();
  }

  @override
  void didUpdateWidget(RestaurantQrPreviewDialog oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.exporter != widget.exporter) {
      _exporter = widget.exporter ?? RestaurantQrExporter();
    }
  }

  Future<void> _copyImage() async {
    if (_isCopying) {
      return;
    }
    setState(() {
      _isCopying = true;
      _statusMessage = null;
    });
    try {
      await _exporter.copyPng(widget.image.pngBytes);
      if (mounted) {
        setState(() {
          _statusMessage = 'QR image copied.';
        });
      }
    } on RestaurantQrExportException catch (error) {
      if (mounted) {
        setState(() {
          _statusMessage = error.message;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _statusMessage = 'Could not copy the QR image.';
        });
      }
    } finally {
      if (mounted) {
        setState(() {
          _isCopying = false;
        });
      }
    }
  }

  Future<void> _downloadImage() async {
    if (_isDownloading) {
      return;
    }
    setState(() {
      _isDownloading = true;
      _statusMessage = null;
    });
    try {
      await _exporter.downloadPng(
        widget.image.pngBytes,
        widget.image.safeFilename,
      );
      if (mounted) {
        setState(() {
          _statusMessage = 'QR image download started.';
        });
      }
    } on RestaurantQrExportException catch (error) {
      if (mounted) {
        setState(() {
          _statusMessage = error.message;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _statusMessage = 'Could not download the QR image.';
        });
      }
    } finally {
      if (mounted) {
        setState(() {
          _isDownloading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final capabilities = _exporter.capabilities;
    final unavailableMessage =
        !capabilities.canCopyImage && !capabilities.canDownloadPng
        ? 'Image export is available in a supported secure web browser.'
        : !capabilities.canCopyImage
        ? capabilities.copyUnavailableReason
        : null;

    return AlertDialog(
      key: const ValueKey('restaurant-qr-preview-dialog'),
      scrollable: true,
      insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
      title: const Text('QR Image Preview'),
      content: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 600),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(
              label: 'Print-ready restaurant QR image preview',
              image: true,
              child: Image.memory(
                widget.image.pngBytes,
                key: const ValueKey('restaurant-qr-preview-image'),
                fit: BoxFit.contain,
                gaplessPlayback: true,
                filterQuality: FilterQuality.none,
              ),
            ),
            if (widget.isSensitive) ...[
              const SizedBox(height: 16),
              Container(
                key: const ValueKey('restaurant-qr-sensitive-warning'),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.errorContainer,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  RestaurantQrPreviewDialog.sensitiveWarning,
                  style: TextStyle(
                    color: Theme.of(context).colorScheme.onErrorContainer,
                  ),
                ),
              ),
            ],
            if (unavailableMessage != null) ...[
              const SizedBox(height: 12),
              Text(
                unavailableMessage,
                key: const ValueKey('restaurant-qr-export-unavailable'),
              ),
            ],
            if (_statusMessage != null) ...[
              const SizedBox(height: 12),
              Text(
                _statusMessage!,
                key: const ValueKey('restaurant-qr-export-status'),
              ),
            ],
          ],
        ),
      ),
      actions: [
        if (widget.showBack)
          TextButton.icon(
            key: const ValueKey('restaurant-qr-preview-back'),
            onPressed: () =>
                Navigator.of(context).pop(RestaurantQrPreviewExit.back),
            icon: const Icon(Icons.arrow_back),
            label: const Text('Back'),
          ),
        TextButton(
          key: const ValueKey('restaurant-qr-preview-close'),
          onPressed: () =>
              Navigator.of(context).pop(RestaurantQrPreviewExit.close),
          child: const Text('Close'),
        ),
        if (capabilities.canCopyImage)
          OutlinedButton.icon(
            key: const ValueKey('restaurant-qr-copy-image'),
            onPressed: _isCopying ? null : _copyImage,
            icon: _isCopying
                ? const SizedBox.square(
                    dimension: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.copy_all_outlined),
            label: Text(_isCopying ? 'Copying...' : 'Copy Image'),
          ),
        if (capabilities.canDownloadPng)
          FilledButton.icon(
            key: const ValueKey('restaurant-qr-download-png'),
            onPressed: _isDownloading ? null : _downloadImage,
            icon: _isDownloading
                ? const SizedBox.square(
                    dimension: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.download_outlined),
            label: Text(_isDownloading ? 'Downloading...' : 'Download PNG'),
          ),
      ],
    );
  }
}
