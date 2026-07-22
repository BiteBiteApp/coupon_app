import 'dart:ui' as ui;

import 'package:coupon_app/services/restaurant_qr_image_service.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:qr/qr.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const service = RestaurantQrImageService();
  const customerUrl =
      'https://go.bitestar.app/r/bitescore/restaurant-document-id';

  test('validates restaurant names and secure absolute URLs', () async {
    await expectLater(
      service.render(
        restaurantName: '   ',
        url: customerUrl,
        linkType: RestaurantQrLinkType.customerBiteScore,
      ),
      throwsA(isA<RestaurantQrImageException>()),
    );

    for (final invalidUrl in <String>[
      '',
      'http://go.bitestar.app/r/bitescore/id',
      '/r/bitescore/id',
      ' https://go.bitestar.app/r/bitescore/id',
      'https://go.bitestar.app/r/bitescore/id with spaces',
    ]) {
      await expectLater(
        service.render(
          restaurantName: 'River Grill',
          url: invalidUrl,
          linkType: RestaurantQrLinkType.customerBiteScore,
        ),
        throwsA(isA<RestaurantQrImageException>()),
      );
    }
  });

  test('creates safe filenames without identifiers or links', () {
    expect(
      RestaurantQrImageService.safeFilename(
        restaurantName: '  Chez Élan & Sons  ',
        linkType: RestaurantQrLinkType.customerBiteSaver,
      ),
      'chez-lan-sons-customer-bitesaver-qr.png',
    );
    expect(
      RestaurantQrImageService.safeFilename(
        restaurantName: '食べる',
        linkType: RestaurantQrLinkType.couponInvite,
      ),
      'restaurant-coupon-invite-qr.png',
    );
    final longFilename = RestaurantQrImageService.safeFilename(
      restaurantName: List.filled(100, 'A').join(),
      linkType: RestaurantQrLinkType.biteScoreClaimInvite,
    );
    expect(longFilename, endsWith('-bitescore-claim-invite-qr.png'));
    expect(longFilename.split('-bitescore-claim-invite').first.length, 60);
    expect(longFilename, isNot(contains('https')));
  });

  test(
    'renders I C SA and SC markers without changing the QR region',
    () async {
      final expectedMarkers = <RestaurantQrLinkType, String>{
        RestaurantQrLinkType.couponInvite: 'I',
        RestaurantQrLinkType.biteScoreClaimInvite: 'C',
        RestaurantQrLinkType.customerBiteSaver: 'SA',
        RestaurantQrLinkType.customerBiteScore: 'SC',
      };
      Uint8List? referenceQrRegion;
      RestaurantQrImageResult? referenceResult;

      for (final entry in expectedMarkers.entries) {
        final result = await service.render(
          restaurantName: 'River Grill',
          url: customerUrl,
          linkType: entry.key,
        );
        final decoded = await _decodePng(result.pngBytes);

        expect(entry.key.typeMarker, entry.value);
        expect(result.typeMarker, entry.value);
        expect(result.markerBounds.left, greaterThanOrEqualTo(0));
        expect(result.markerBounds.top, greaterThanOrEqualTo(0));
        expect(result.markerBounds.right, lessThan(result.titleBounds.left));
        expect(
          result.markerBounds.bottom,
          lessThanOrEqualTo(result.headerHeight),
        );
        expect(result.markerBounds.center.dx, lessThan(result.width / 4));
        expect(
          result.markerBounds.center.dy,
          greaterThan(result.headerHeight / 2),
        );
        expect(result.titleBounds.center.dx, closeTo(result.width / 2, 0.01));
        expect(
          result.titleBounds.bottom,
          lessThanOrEqualTo(result.headerHeight),
        );
        expect(_containsDarkPixel(decoded, result.markerBounds), isTrue);

        final qrRegion = Uint8List.sublistView(
          decoded.rgba,
          result.headerHeight * result.width * 4,
        );
        if (referenceQrRegion == null) {
          referenceQrRegion = Uint8List.fromList(qrRegion);
          referenceResult = result;
        } else {
          expect(listEquals(qrRegion, referenceQrRegion), isTrue);
          expect(result.qrWidth, referenceResult!.qrWidth);
          expect(result.moduleCount, referenceResult.moduleCount);
          expect(result.modulePixels, referenceResult.modulePixels);
          expect(result.headerHeight, referenceResult.headerHeight);
        }
      }
    },
  );

  test('uses deterministic integer high-resolution layout metadata', () async {
    final first = await service.render(
      restaurantName: 'River Grill',
      url: customerUrl,
      linkType: RestaurantQrLinkType.customerBiteScore,
    );
    final second = await service.render(
      restaurantName: 'River Grill',
      url: customerUrl,
      linkType: RestaurantQrLinkType.customerBiteScore,
    );

    expect(
      RestaurantQrImageService.errorCorrectLevel,
      QrErrorCorrectLevel.quartile,
    );
    expect(first.modulePixels, greaterThanOrEqualTo(8));
    expect(first.qrWidth, (first.moduleCount + 8) * first.modulePixels);
    expect(first.width, first.qrWidth);
    expect(first.height, first.headerHeight + first.qrWidth);
    expect(first.width, greaterThanOrEqualTo(1000));
    expect(first.titleLineCount, 1);
    expect(
      (
        first.width,
        first.height,
        first.qrWidth,
        first.moduleCount,
        first.modulePixels,
        first.headerHeight,
        first.titleLineCount,
        first.safeFilename,
        first.typeMarker,
        first.markerBounds,
        first.titleBounds,
      ),
      (
        second.width,
        second.height,
        second.qrWidth,
        second.moduleCount,
        second.modulePixels,
        second.headerHeight,
        second.titleLineCount,
        second.safeFilename,
        second.typeMarker,
        second.markerBounds,
        second.titleBounds,
      ),
    );
  });

  test('header uses one line, then at most two safe lines', () async {
    final ordinary = await service.render(
      restaurantName: 'River Grill',
      url: customerUrl,
      linkType: RestaurantQrLinkType.customerBiteScore,
    );
    final wrapped = await service.render(
      restaurantName:
          'The Extraordinary Riverfront Dining Restaurant and Market',
      url: customerUrl,
      linkType: RestaurantQrLinkType.customerBiteScore,
    );
    final unbroken = await service.render(
      restaurantName: List.filled(300, 'A').join(),
      url: customerUrl,
      linkType: RestaurantQrLinkType.customerBiteScore,
    );

    expect(ordinary.titleLineCount, 1);
    expect(wrapped.titleLineCount, 2);
    expect(wrapped.headerHeight, greaterThan(ordinary.headerHeight));
    expect(unbroken.titleLineCount, inInclusiveRange(1, 2));
    expect(unbroken.headerHeight, lessThanOrEqualTo(wrapped.headerHeight));
    for (final result in <RestaurantQrImageResult>[
      ordinary,
      wrapped,
      unbroken,
    ]) {
      expect(result.markerBounds.right, lessThan(result.titleBounds.left));
      expect(result.titleBounds.center.dx, closeTo(result.width / 2, 0.01));
      expect(
        result.markerBounds.bottom,
        lessThanOrEqualTo(result.headerHeight),
      );
      expect(result.titleLineCount, lessThanOrEqualTo(2));
    }
    expect(ordinary.headerHeight, lessThan(160));
    expect(wrapped.headerHeight, lessThan(260));
  });

  test('PNG has exact quiet zone and matrix-aligned black modules', () async {
    final result = await service.render(
      restaurantName: 'River Grill',
      url: customerUrl,
      linkType: RestaurantQrLinkType.customerBiteScore,
    );
    expect(result.pngBytes.take(8), <int>[137, 80, 78, 71, 13, 10, 26, 10]);

    final decoded = await _decodePng(result.pngBytes);
    expect(decoded.width, result.width);
    expect(decoded.height, result.height);
    expect(_pixel(decoded, 0, 0), const _Rgba(255, 255, 255, 255));

    final matrix = QrImage(
      QrCode(
        payload: QrPayload.fromString(customerUrl),
        errorCorrectLevel: QrErrorCorrectLevel.quartile,
      ),
    );
    expect(matrix.moduleCount, result.moduleCount);
    final moduleCenter = result.modulePixels ~/ 2;
    for (var row = 0; row < matrix.moduleCount; row += 1) {
      for (var column = 0; column < matrix.moduleCount; column += 1) {
        final x =
            ((column + RestaurantQrImageService.quietZoneModules) *
                result.modulePixels) +
            moduleCenter;
        final y =
            result.headerHeight +
            ((row + RestaurantQrImageService.quietZoneModules) *
                result.modulePixels) +
            moduleCenter;
        expect(
          _pixel(decoded, x, y),
          matrix.isDark(row, column)
              ? const _Rgba(0, 0, 0, 255)
              : const _Rgba(255, 255, 255, 255),
          reason: 'Unexpected raster module at row $row, column $column.',
        );
      }
    }

    final firstModuleStart =
        RestaurantQrImageService.quietZoneModules * result.modulePixels;
    final firstModuleY = result.headerHeight + firstModuleStart + moduleCenter;
    expect(
      _pixel(decoded, firstModuleStart - 1, firstModuleY),
      const _Rgba(255, 255, 255, 255),
    );
    expect(
      _pixel(decoded, firstModuleStart, firstModuleY),
      const _Rgba(0, 0, 0, 255),
    );
    expect(
      _pixel(decoded, result.width - 1, result.height - 1),
      const _Rgba(255, 255, 255, 255),
    );
  });

  test('long exact HTTPS URLs retain safe whole-module sizing', () async {
    final longUrl =
        'https://go.bitestar.app/invite/coupon/'
        '${List.filled(70, 'token-segment-').join()}';
    final result = await service.render(
      restaurantName: 'Long Link Restaurant',
      url: longUrl,
      linkType: RestaurantQrLinkType.couponInvite,
    );

    expect(result.pngBytes, isNotEmpty);
    expect(result.modulePixels, greaterThanOrEqualTo(8));
    expect(result.qrWidth % (result.moduleCount + 8), 0);
    expect(result.height, result.headerHeight + result.qrWidth);
  });
}

Future<_DecodedPng> _decodePng(Uint8List bytes) async {
  final codec = await ui.instantiateImageCodec(bytes);
  try {
    final frame = await codec.getNextFrame();
    try {
      final data = await frame.image.toByteData(
        format: ui.ImageByteFormat.rawRgba,
      );
      if (data == null) {
        throw StateError('PNG did not decode to RGBA bytes.');
      }
      return _DecodedPng(
        width: frame.image.width,
        height: frame.image.height,
        rgba: Uint8List.fromList(
          data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes),
        ),
      );
    } finally {
      frame.image.dispose();
    }
  } finally {
    codec.dispose();
  }
}

_Rgba _pixel(_DecodedPng image, int x, int y) {
  final offset = ((y * image.width) + x) * 4;
  return _Rgba(
    image.rgba[offset],
    image.rgba[offset + 1],
    image.rgba[offset + 2],
    image.rgba[offset + 3],
  );
}

bool _containsDarkPixel(_DecodedPng image, ui.Rect bounds) {
  final left = bounds.left.floor().clamp(0, image.width - 1);
  final top = bounds.top.floor().clamp(0, image.height - 1);
  final right = bounds.right.ceil().clamp(left + 1, image.width);
  final bottom = bounds.bottom.ceil().clamp(top + 1, image.height);
  for (var y = top; y < bottom; y += 1) {
    for (var x = left; x < right; x += 1) {
      final pixel = _pixel(image, x, y);
      if (pixel.alpha == 255 &&
          (pixel.red < 240 || pixel.green < 240 || pixel.blue < 240)) {
        return true;
      }
    }
  }
  return false;
}

class _DecodedPng {
  final int width;
  final int height;
  final Uint8List rgba;

  const _DecodedPng({
    required this.width,
    required this.height,
    required this.rgba,
  });
}

class _Rgba {
  final int red;
  final int green;
  final int blue;
  final int alpha;

  const _Rgba(this.red, this.green, this.blue, this.alpha);

  @override
  bool operator ==(Object other) {
    return other is _Rgba &&
        red == other.red &&
        green == other.green &&
        blue == other.blue &&
        alpha == other.alpha;
  }

  @override
  int get hashCode => Object.hash(red, green, blue, alpha);

  @override
  String toString() => 'rgba($red, $green, $blue, $alpha)';
}
