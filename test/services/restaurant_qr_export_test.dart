import 'package:coupon_app/services/restaurant_qr_export.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('reports injected export capabilities', () {
    final exporter = RestaurantQrExporter(
      capabilities: const RestaurantQrExportCapabilities(
        canCopyImage: true,
        canDownloadPng: false,
        downloadUnavailableReason: 'Download unavailable.',
      ),
      copyPng: (_) async {},
      downloadPng: (_, _) async {},
    );

    expect(exporter.capabilities.canCopyImage, isTrue);
    expect(exporter.capabilities.canDownloadPng, isFalse);
    expect(RestaurantQrExporter.pngMimeType, 'image/png');
  });

  test(
    'copy and download pass PNG bytes and safe filename exactly once',
    () async {
      final png = _pngBytes();
      var copyCalls = 0;
      var downloadCalls = 0;
      Uint8List? copiedBytes;
      Uint8List? downloadedBytes;
      String? downloadedFilename;
      final exporter = RestaurantQrExporter(
        capabilities: const RestaurantQrExportCapabilities(
          canCopyImage: true,
          canDownloadPng: true,
        ),
        copyPng: (bytes) async {
          copyCalls += 1;
          copiedBytes = bytes;
        },
        downloadPng: (bytes, filename) async {
          downloadCalls += 1;
          downloadedBytes = bytes;
          downloadedFilename = filename;
        },
      );

      await exporter.copyPng(png);
      await exporter.downloadPng(png, 'river-grill-customer-bitescore-qr.png');

      expect(copyCalls, 1);
      expect(downloadCalls, 1);
      expect(copiedBytes, same(png));
      expect(downloadedBytes, same(png));
      expect(downloadedFilename, 'river-grill-customer-bitescore-qr.png');
    },
  );

  test('unsupported adapter returns controlled failures', () async {
    final exporter = RestaurantQrExporter(
      capabilities: const RestaurantQrExportCapabilities(
        canCopyImage: false,
        canDownloadPng: false,
        copyUnavailableReason: 'Copy is unavailable.',
        downloadUnavailableReason: 'Download is unavailable.',
      ),
      copyPng: (_) async => fail('Copy callback should not run.'),
      downloadPng: (_, _) async => fail('Download callback should not run.'),
    );

    await expectLater(
      exporter.copyPng(_pngBytes()),
      throwsA(
        isA<RestaurantQrExportException>().having(
          (error) => error.message,
          'message',
          'Copy is unavailable.',
        ),
      ),
    );
    await expectLater(
      exporter.downloadPng(_pngBytes(), 'restaurant-coupon-invite-qr.png'),
      throwsA(
        isA<RestaurantQrExportException>().having(
          (error) => error.message,
          'message',
          'Download is unavailable.',
        ),
      ),
    );
  });

  test('adapter errors never expose secure source URLs', () async {
    const fakeSecureUrl =
        'https://go.bitestar.app/invite/coupon/fake-test-token';
    final exporter = RestaurantQrExporter(
      capabilities: const RestaurantQrExportCapabilities(
        canCopyImage: true,
        canDownloadPng: true,
      ),
      copyPng: (_) async => throw StateError(fakeSecureUrl),
      downloadPng: (_, _) async => throw StateError(fakeSecureUrl),
    );

    for (final operation in <Future<void>>[
      exporter.copyPng(_pngBytes()),
      exporter.downloadPng(_pngBytes(), 'restaurant-coupon-invite-qr.png'),
    ]) {
      await expectLater(
        operation,
        throwsA(
          isA<RestaurantQrExportException>().having(
            (error) => error.message,
            'safe message',
            isNot(contains(fakeSecureUrl)),
          ),
        ),
      );
    }
  });

  test(
    'invalid PNG data and unsafe filenames are rejected before export',
    () async {
      var calls = 0;
      final exporter = RestaurantQrExporter(
        capabilities: const RestaurantQrExportCapabilities(
          canCopyImage: true,
          canDownloadPng: true,
        ),
        copyPng: (_) async {
          calls += 1;
        },
        downloadPng: (_, _) async {
          calls += 1;
        },
      );

      await expectLater(
        exporter.copyPng(Uint8List.fromList(<int>[1, 2, 3])),
        throwsA(isA<RestaurantQrExportException>()),
      );
      await expectLater(
        exporter.downloadPng(_pngBytes(), '../secure-token.png'),
        throwsA(isA<RestaurantQrExportException>()),
      );
      expect(calls, 0);
    },
  );

  test('production adapter selects web or unsupported platform safely', () {
    final exporter = RestaurantQrExporter();

    if (kIsWeb) {
      expect(exporter.capabilities.canDownloadPng, isTrue);
    } else {
      expect(exporter.capabilities.canCopyImage, isFalse);
      expect(exporter.capabilities.canDownloadPng, isFalse);
    }
  });
}

Uint8List _pngBytes() {
  return Uint8List.fromList(<int>[137, 80, 78, 71, 13, 10, 26, 10, 0]);
}
