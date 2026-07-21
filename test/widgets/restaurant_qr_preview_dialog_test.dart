import 'dart:convert';
import 'dart:typed_data';

import 'package:coupon_app/services/restaurant_qr_export.dart';
import 'package:coupon_app/services/restaurant_qr_image_service.dart';
import 'package:coupon_app/widgets/restaurant_qr_preview_dialog.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('shows image preview without customer security warning', (
    tester,
  ) async {
    await _pumpDialog(
      tester,
      isSensitive: false,
      exporter: _unsupportedExporter(),
    );

    expect(
      find.byKey(const ValueKey('restaurant-qr-preview-image')),
      findsOneWidget,
    );
    final image = tester.widget<Image>(
      find.byKey(const ValueKey('restaurant-qr-preview-image')),
    );
    expect(image.fit, BoxFit.contain);
    expect(image.filterQuality, FilterQuality.none);
    expect(
      find.byKey(const ValueKey('restaurant-qr-sensitive-warning')),
      findsNothing,
    );
    expect(
      find.byKey(const ValueKey('restaurant-qr-export-unavailable')),
      findsOneWidget,
    );
  });

  testWidgets('secure invite preview shows the sensitive warning only there', (
    tester,
  ) async {
    await _pumpDialog(
      tester,
      isSensitive: true,
      exporter: _unsupportedExporter(),
    );

    expect(
      find.text(RestaurantQrPreviewDialog.sensitiveWarning),
      findsOneWidget,
    );
    expect(find.textContaining('fake-test-token'), findsNothing);
  });

  testWidgets('supported copy and download actions report success', (
    tester,
  ) async {
    var copyCalls = 0;
    var downloadCalls = 0;
    String? filename;
    final exporter = RestaurantQrExporter(
      capabilities: const RestaurantQrExportCapabilities(
        canCopyImage: true,
        canDownloadPng: true,
      ),
      copyPng: (_) async {
        copyCalls += 1;
      },
      downloadPng: (_, value) async {
        downloadCalls += 1;
        filename = value;
      },
    );
    await _pumpDialog(tester, isSensitive: false, exporter: exporter);

    await tester.tap(find.byKey(const ValueKey('restaurant-qr-copy-image')));
    await tester.pump();
    expect(copyCalls, 1);
    expect(find.text('QR image copied.'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('restaurant-qr-download-png')));
    await tester.pump();
    expect(downloadCalls, 1);
    expect(filename, 'river-grill-customer-bitescore-qr.png');
    expect(find.text('QR image download started.'), findsOneWidget);
  });

  testWidgets('copy and download failures remain controlled', (tester) async {
    final exporter = RestaurantQrExporter(
      capabilities: const RestaurantQrExportCapabilities(
        canCopyImage: true,
        canDownloadPng: true,
      ),
      copyPng: (_) async => throw StateError(
        'https://go.bitestar.app/invite/coupon/fake-test-token',
      ),
      downloadPng: (_, _) async => throw StateError(
        'https://go.bitestar.app/invite/coupon/fake-test-token',
      ),
    );
    await _pumpDialog(tester, isSensitive: true, exporter: exporter);

    await tester.tap(find.byKey(const ValueKey('restaurant-qr-copy-image')));
    await tester.pump();
    expect(
      find.text('Could not copy the QR image. Download the PNG instead.'),
      findsOneWidget,
    );
    expect(find.textContaining('fake-test-token'), findsNothing);

    await tester.tap(find.byKey(const ValueKey('restaurant-qr-download-png')));
    await tester.pump();
    expect(find.text('Could not download the QR image.'), findsOneWidget);
    expect(find.textContaining('fake-test-token'), findsNothing);
  });

  testWidgets('back and close return distinct dialog results', (tester) async {
    RestaurantQrPreviewExit? result;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => FilledButton(
              onPressed: () async {
                result = await showRestaurantQrPreviewDialog(
                  context: context,
                  image: _imageResult(),
                  isSensitive: true,
                  showBack: true,
                  exporter: _unsupportedExporter(),
                );
              },
              child: const Text('Open'),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('restaurant-qr-preview-back')));
    await tester.pumpAndSettle();
    expect(result, RestaurantQrPreviewExit.back);

    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('restaurant-qr-preview-close')));
    await tester.pumpAndSettle();
    expect(result, RestaurantQrPreviewExit.close);
  });

  testWidgets(
    'preview remains responsive on phone landscape desktop and large text',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      for (final configuration in <(Size, double)>[
        (const Size(320, 640), 1),
        (const Size(700, 360), 1),
        (const Size(1200, 900), 1),
        (const Size(360, 640), 2),
      ]) {
        tester.view.physicalSize = configuration.$1;
        await _pumpDialog(
          tester,
          isSensitive: true,
          exporter: RestaurantQrExporter(
            capabilities: const RestaurantQrExportCapabilities(
              canCopyImage: true,
              canDownloadPng: true,
            ),
            copyPng: (_) async {},
            downloadPng: (_, _) async {},
          ),
          textScale: configuration.$2,
          configureView: false,
        );
        expect(tester.takeException(), isNull);
        expect(
          find.byKey(const ValueKey('restaurant-qr-preview-dialog')),
          findsOneWidget,
        );
      }
    },
  );
}

Future<void> _pumpDialog(
  WidgetTester tester, {
  required bool isSensitive,
  required RestaurantQrExporter exporter,
  double textScale = 1,
  bool configureView = true,
}) async {
  if (configureView) {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(900, 900);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
  }
  await tester.pumpWidget(
    MaterialApp(
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(textScale)),
        child: child!,
      ),
      home: Scaffold(
        body: RestaurantQrPreviewDialog(
          image: _imageResult(),
          isSensitive: isSensitive,
          showBack: true,
          exporter: exporter,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

RestaurantQrExporter _unsupportedExporter() {
  return RestaurantQrExporter(
    capabilities: const RestaurantQrExportCapabilities(
      canCopyImage: false,
      canDownloadPng: false,
    ),
    copyPng: (_) async {},
    downloadPng: (_, _) async {},
  );
}

RestaurantQrImageResult _imageResult() {
  return RestaurantQrImageResult(
    pngBytes: _onePixelPng(),
    width: 1200,
    height: 1306,
    qrWidth: 1200,
    moduleCount: 41,
    modulePixels: 24,
    headerHeight: 106,
    titleLineCount: 1,
    safeFilename: 'river-grill-customer-bitescore-qr.png',
  );
}

Uint8List _onePixelPng() {
  return base64Decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8'
    '/x8AAusB9Y9Zl1EAAAAASUVORK5CYII=',
  );
}
