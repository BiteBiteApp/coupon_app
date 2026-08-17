import 'dart:async';
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
    var preparationCalls = 0;
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
    await _pumpDialog(
      tester,
      isSensitive: false,
      exporter: exporter,
      onExportSucceeded: () async {
        preparationCalls += 1;
      },
    );

    await tester.tap(find.byKey(const ValueKey('restaurant-qr-copy-image')));
    await tester.pump();
    expect(copyCalls, 1);
    expect(preparationCalls, 1);
    expect(find.text('QR image copied.'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('restaurant-qr-download-png')));
    await tester.pump();
    expect(downloadCalls, 1);
    expect(preparationCalls, 2);
    expect(filename, 'river-grill-customer-bitescore-qr.png');
    expect(find.text('QR image download started.'), findsOneWidget);
  });

  testWidgets('copy and download failures remain controlled', (tester) async {
    var preparationCalls = 0;
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
    await _pumpDialog(
      tester,
      isSensitive: true,
      exporter: exporter,
      onExportSucceeded: () async {
        preparationCalls += 1;
      },
    );

    await tester.tap(find.byKey(const ValueKey('restaurant-qr-copy-image')));
    await tester.pump();
    expect(
      find.text('Could not copy the QR image. Download the PNG instead.'),
      findsOneWidget,
    );
    expect(find.textContaining('fake-test-token'), findsNothing);
    expect(preparationCalls, 0);

    await tester.tap(find.byKey(const ValueKey('restaurant-qr-download-png')));
    await tester.pump();
    expect(find.text('Could not download the QR image.'), findsOneWidget);
    expect(find.textContaining('fake-test-token'), findsNothing);
    expect(preparationCalls, 0);
  });

  testWidgets(
    'tracking failure preserves export success with distinct feedback',
    (tester) async {
      var copyCalls = 0;
      final exporter = RestaurantQrExporter(
        capabilities: const RestaurantQrExportCapabilities(
          canCopyImage: true,
          canDownloadPng: true,
        ),
        copyPng: (_) async {
          copyCalls += 1;
        },
        downloadPng: (_, _) async {},
      );
      await _pumpDialog(
        tester,
        isSensitive: false,
        exporter: exporter,
        onExportSucceeded: () async => throw StateError('tracking unavailable'),
      );

      await tester.tap(find.byKey(const ValueKey('restaurant-qr-copy-image')));
      await tester.pump();

      expect(copyCalls, 1);
      expect(
        find.text(
          'QR image copied, but preparation status could not be saved.',
        ),
        findsOneWidget,
      );
    },
  );

  testWidgets('export and tracking share one non-dismissible operation lock', (
    tester,
  ) async {
    final export = Completer<void>();
    final tracking = Completer<void>();
    var copyCalls = 0;
    var downloadCalls = 0;
    var trackingCalls = 0;
    RestaurantQrPreviewExit? result;
    final exporter = RestaurantQrExporter(
      capabilities: const RestaurantQrExportCapabilities(
        canCopyImage: true,
        canDownloadPng: true,
      ),
      copyPng: (_) {
        copyCalls += 1;
        return export.future;
      },
      downloadPng: (_, _) async {
        downloadCalls += 1;
      },
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => FilledButton(
              onPressed: () async {
                result = await showRestaurantQrPreviewDialog(
                  context: context,
                  image: _imageResult(),
                  isSensitive: false,
                  showBack: true,
                  exporter: exporter,
                  onExportSucceeded: () {
                    trackingCalls += 1;
                    return tracking.future;
                  },
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
    await tester.tap(find.byKey(const ValueKey('restaurant-qr-copy-image')));
    await tester.pump();

    expect(copyCalls, 1);
    expect(downloadCalls, 0);
    expect(
      tester
          .widget<FilledButton>(
            find.byKey(const ValueKey('restaurant-qr-download-png')),
          )
          .onPressed,
      isNull,
    );
    expect(
      tester
          .widget<TextButton>(
            find.byKey(const ValueKey('restaurant-qr-preview-close')),
          )
          .onPressed,
      isNull,
    );
    expect(
      tester
          .widget<TextButton>(
            find.byKey(const ValueKey('restaurant-qr-preview-back')),
          )
          .onPressed,
      isNull,
    );
    await tester.tapAt(const Offset(2, 2));
    await tester.pump();
    await tester.binding.handlePopRoute();
    await tester.pump();
    expect(
      find.byKey(const ValueKey('restaurant-qr-preview-dialog')),
      findsOneWidget,
    );
    expect(result, isNull);

    export.complete();
    await tester.pump();
    expect(trackingCalls, 1);
    expect(
      tester
          .widget<OutlinedButton>(
            find.byKey(const ValueKey('restaurant-qr-copy-image')),
          )
          .onPressed,
      isNull,
    );
    tracking.completeError(StateError('tracking unavailable'));
    await tester.pumpAndSettle();

    expect(copyCalls, 1);
    expect(downloadCalls, 0);
    expect(
      find.text('QR image copied, but preparation status could not be saved.'),
      findsOneWidget,
    );
    expect(
      tester
          .widget<FilledButton>(
            find.byKey(const ValueKey('restaurant-qr-download-png')),
          )
          .onPressed,
      isNotNull,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('completion after disposal skips tracking and disposed context', (
    tester,
  ) async {
    final export = Completer<void>();
    var trackingCalls = 0;
    await _pumpDialog(
      tester,
      isSensitive: false,
      exporter: RestaurantQrExporter(
        capabilities: const RestaurantQrExportCapabilities(
          canCopyImage: true,
          canDownloadPng: false,
        ),
        copyPng: (_) => export.future,
        downloadPng: (_, _) async {},
      ),
      onExportSucceeded: () async {
        trackingCalls += 1;
      },
    );
    await tester.tap(find.byKey(const ValueKey('restaurant-qr-copy-image')));
    await tester.pump();
    await tester.pumpWidget(const SizedBox.shrink());
    export.complete();
    await tester.pump();
    await tester.pump();

    expect(trackingCalls, 0);
    expect(tester.takeException(), isNull);
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
  RestaurantQrExportSucceededCallback? onExportSucceeded,
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
          onExportSucceeded: onExportSucceeded,
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
