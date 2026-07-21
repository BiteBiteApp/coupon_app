import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:qr/qr.dart';

enum RestaurantQrLinkType {
  customerBiteScore('customer-bitescore'),
  customerBiteSaver('customer-bitesaver'),
  couponInvite('coupon-invite'),
  biteScoreClaimInvite('bitescore-claim-invite');

  final String filenameSlug;

  const RestaurantQrLinkType(this.filenameSlug);
}

class RestaurantQrImageException implements Exception {
  final String message;

  const RestaurantQrImageException(this.message);

  @override
  String toString() => message;
}

class RestaurantQrImageResult {
  final Uint8List pngBytes;
  final int width;
  final int height;
  final int qrWidth;
  final int moduleCount;
  final int modulePixels;
  final int headerHeight;
  final int titleLineCount;
  final String safeFilename;

  const RestaurantQrImageResult({
    required this.pngBytes,
    required this.width,
    required this.height,
    required this.qrWidth,
    required this.moduleCount,
    required this.modulePixels,
    required this.headerHeight,
    required this.titleLineCount,
    required this.safeFilename,
  });
}

class RestaurantQrImageService {
  static const int targetQrWidth = 1200;
  static const int minimumModulePixels = 8;
  static const int quietZoneModules = 4;
  static const double preferredTitleFontSize = 64;
  static const double minimumTitleFontSize = 48;
  static const double titleFontStep = 2;
  static const double titleVerticalPadding = 18;
  static const QrErrorCorrectLevel errorCorrectLevel =
      QrErrorCorrectLevel.quartile;

  const RestaurantQrImageService();

  Future<RestaurantQrImageResult> render({
    required String restaurantName,
    required String url,
    required RestaurantQrLinkType linkType,
  }) async {
    final normalizedName = _normalizedRestaurantName(restaurantName);
    _validateUrl(url);

    final QrImage qrImage;
    try {
      qrImage = QrImage(
        QrCode(
          payload: QrPayload.fromString(url),
          errorCorrectLevel: errorCorrectLevel,
        ),
      );
    } on InputTooLongException {
      throw const RestaurantQrImageException(
        'This link is too long to create a QR image.',
      );
    } catch (_) {
      throw const RestaurantQrImageException('Could not create the QR image.');
    }

    final totalModules = qrImage.moduleCount + (quietZoneModules * 2);
    final modulePixels = math.max(
      minimumModulePixels,
      targetQrWidth ~/ totalModules,
    );
    final qrWidth = totalModules * modulePixels;
    final titleLayout = _layoutTitle(
      normalizedName,
      qrWidth: qrWidth,
      modulePixels: modulePixels,
    );
    final headerHeight =
        (titleLayout.painter.height + (titleVerticalPadding * 2)).ceil();
    final imageHeight = headerHeight + qrWidth;

    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);
    final whitePaint = Paint()
      ..color = Colors.white
      ..isAntiAlias = false;
    final blackPaint = Paint()
      ..color = Colors.black
      ..isAntiAlias = false;

    canvas.drawRect(
      Rect.fromLTWH(0, 0, qrWidth.toDouble(), imageHeight.toDouble()),
      whitePaint,
    );
    titleLayout.painter.paint(
      canvas,
      Offset(titleLayout.horizontalInset, titleVerticalPadding),
    );

    for (var row = 0; row < qrImage.moduleCount; row += 1) {
      for (var column = 0; column < qrImage.moduleCount; column += 1) {
        if (!qrImage.isDark(row, column)) {
          continue;
        }
        final left = (column + quietZoneModules) * modulePixels;
        final top = headerHeight + ((row + quietZoneModules) * modulePixels);
        canvas.drawRect(
          Rect.fromLTWH(
            left.toDouble(),
            top.toDouble(),
            modulePixels.toDouble(),
            modulePixels.toDouble(),
          ),
          blackPaint,
        );
      }
    }

    final picture = recorder.endRecording();
    ui.Image? renderedImage;
    try {
      renderedImage = await picture.toImage(qrWidth, imageHeight);
      final byteData = await renderedImage.toByteData(
        format: ui.ImageByteFormat.png,
      );
      if (byteData == null) {
        throw const RestaurantQrImageException(
          'Could not encode the QR image.',
        );
      }
      final pngBytes = Uint8List.fromList(
        byteData.buffer.asUint8List(
          byteData.offsetInBytes,
          byteData.lengthInBytes,
        ),
      );
      return RestaurantQrImageResult(
        pngBytes: pngBytes,
        width: qrWidth,
        height: imageHeight,
        qrWidth: qrWidth,
        moduleCount: qrImage.moduleCount,
        modulePixels: modulePixels,
        headerHeight: headerHeight,
        titleLineCount: titleLayout.lineCount,
        safeFilename: safeFilename(
          restaurantName: normalizedName,
          linkType: linkType,
        ),
      );
    } on RestaurantQrImageException {
      rethrow;
    } catch (_) {
      throw const RestaurantQrImageException('Could not encode the QR image.');
    } finally {
      renderedImage?.dispose();
      picture.dispose();
    }
  }

  static String safeFilename({
    required String restaurantName,
    required RestaurantQrLinkType linkType,
  }) {
    var slug = restaurantName
        .trim()
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
        .replaceAll(RegExp(r'^-+|-+$'), '');
    if (slug.length > 60) {
      slug = slug.substring(0, 60).replaceFirst(RegExp(r'-+$'), '');
    }
    if (slug.isEmpty) {
      slug = 'restaurant';
    }
    return '$slug-${linkType.filenameSlug}-qr.png';
  }

  static String _normalizedRestaurantName(String value) {
    final normalized = value.trim().replaceAll(RegExp(r'\s+'), ' ');
    if (normalized.isEmpty) {
      throw const RestaurantQrImageException(
        'Restaurant name is required to create a QR image.',
      );
    }
    return normalized;
  }

  static void _validateUrl(String value) {
    final uri = Uri.tryParse(value);
    if (value.isEmpty ||
        value != value.trim() ||
        RegExp(r'\s').hasMatch(value) ||
        uri == null ||
        !uri.isAbsolute ||
        uri.scheme.toLowerCase() != 'https' ||
        uri.host.isEmpty) {
      throw const RestaurantQrImageException(
        'A valid secure link is required to create a QR image.',
      );
    }
  }

  static _RestaurantTitleLayout _layoutTitle(
    String title, {
    required int qrWidth,
    required int modulePixels,
  }) {
    final horizontalInset = math.max(24.0, modulePixels * 2.0);
    final availableWidth = qrWidth - (horizontalInset * 2);

    final oneLine = _titlePainter(
      title,
      fontSize: preferredTitleFontSize,
      maxLines: 1,
      availableWidth: availableWidth,
    );
    if (!oneLine.didExceedMaxLines) {
      return _RestaurantTitleLayout(
        painter: oneLine,
        horizontalInset: horizontalInset,
        lineCount: 1,
      );
    }

    var fontSize = preferredTitleFontSize;
    TextPainter painter;
    do {
      painter = _titlePainter(
        title,
        fontSize: fontSize,
        maxLines: 2,
        availableWidth: availableWidth,
      );
      if (!painter.didExceedMaxLines || fontSize <= minimumTitleFontSize) {
        break;
      }
      fontSize = math.max(minimumTitleFontSize, fontSize - titleFontStep);
    } while (true);

    final lineCount = painter.computeLineMetrics().length.clamp(1, 2);
    return _RestaurantTitleLayout(
      painter: painter,
      horizontalInset: horizontalInset,
      lineCount: lineCount,
    );
  }

  static TextPainter _titlePainter(
    String title, {
    required double fontSize,
    required int maxLines,
    required double availableWidth,
  }) {
    return TextPainter(
      text: TextSpan(
        text: title,
        style: TextStyle(
          color: Colors.black,
          fontSize: fontSize,
          fontWeight: FontWeight.w600,
          height: 1.1,
        ),
      ),
      textAlign: TextAlign.center,
      textDirection: TextDirection.ltr,
      textScaler: TextScaler.noScaling,
      maxLines: maxLines,
      ellipsis: '…',
      textWidthBasis: TextWidthBasis.parent,
    )..layout(maxWidth: availableWidth);
  }
}

class _RestaurantTitleLayout {
  final TextPainter painter;
  final double horizontalInset;
  final int lineCount;

  const _RestaurantTitleLayout({
    required this.painter,
    required this.horizontalInset,
    required this.lineCount,
  });
}
