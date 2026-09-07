import 'dart:async';

import 'package:coupon_app/services/restaurant_mailing_label_pdf_export.dart';
import 'package:coupon_app/services/restaurant_qr_pdf_export_lifecycle.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('reports PDF MIME type and controlled native support', () async {
    final exporter = RestaurantMailingLabelPdfExporter(
      capabilities: const RestaurantMailingLabelPdfExportCapabilities(
        canDownloadPdf: false,
        downloadUnavailableReason: 'Use the web admin workspace.',
      ),
      downloadPdf: (_, _) async => fail('must not delegate'),
    );

    expect(RestaurantMailingLabelPdfExporter.pdfMimeType, 'application/pdf');
    final result = await exporter.downloadPdf(
      _pdfBytes(),
      'bitestar-mailing-labels-20260907-101112.pdf',
    );
    expect(result.initiated, isFalse);
    expect(result.failure, RestaurantMailingLabelPdfExportFailure.unsupported);
    expect(result.message, 'Use the web admin workspace.');
  });

  test(
    'initiates once with exact bytes, filename, and truthful wording',
    () async {
      final bytes = _pdfBytes();
      final initiation = Completer<void>();
      var calls = 0;
      Uint8List? receivedBytes;
      String? receivedFilename;
      final exporter = RestaurantMailingLabelPdfExporter(
        capabilities: const RestaurantMailingLabelPdfExportCapabilities(
          canDownloadPdf: true,
        ),
        downloadPdf: (value, filename) {
          calls += 1;
          receivedBytes = value;
          receivedFilename = filename;
          return initiation.future;
        },
      );

      final pending = exporter.downloadPdf(
        bytes,
        'bitestar-mailing-labels-20260907-101112.pdf',
      );
      await Future<void>.delayed(Duration.zero);
      expect(calls, 1);
      expect(receivedBytes, same(bytes));
      expect(receivedFilename, 'bitestar-mailing-labels-20260907-101112.pdf');
      initiation.complete();
      final result = await pending;
      expect(result.initiated, isTrue);
      expect(result.failure, isNull);
      expect(result.message, 'Mailing-label PDF download initiated.');
      expect(result.message, isNot(contains('completed')));
      expect(result.message, isNot(contains('saved')));
      expect(result.message, isNot(contains('printed')));
    },
  );

  test('strictly rejects invalid PDF and every non-mailing filename', () async {
    var calls = 0;
    final exporter = RestaurantMailingLabelPdfExporter(
      capabilities: const RestaurantMailingLabelPdfExportCapabilities(
        canDownloadPdf: true,
      ),
      downloadPdf: (_, _) async => calls += 1,
    );

    final invalidPdf = await exporter.downloadPdf(
      Uint8List.fromList(<int>[1, 2, 3]),
      'bitestar-mailing-labels-20260907-101112.pdf',
    );
    expect(
      invalidPdf.failure,
      RestaurantMailingLabelPdfExportFailure.invalidPdf,
    );
    for (final filename in <String>[
      'bitestar-qr-labels-20260907-101112.pdf',
      'bitestar-mailing-labels-20260907-10111.pdf',
      '../bitestar-mailing-labels-20260907-101112.pdf',
      'restaurant-a-mailing-labels-20260907-101112.pdf',
      'bitestar-mailing-labels-20260907-101112.PDF',
    ]) {
      final result = await exporter.downloadPdf(_pdfBytes(), filename);
      expect(
        result.failure,
        RestaurantMailingLabelPdfExportFailure.invalidFilename,
        reason: filename,
      );
    }
    expect(calls, 0);
  });

  test('re-download reuses content and performs no hidden work', () async {
    final bytes = _pdfBytes();
    final received = <Uint8List>[];
    final exporter = RestaurantMailingLabelPdfExporter(
      capabilities: const RestaurantMailingLabelPdfExportCapabilities(
        canDownloadPdf: true,
      ),
      downloadPdf: (value, _) async => received.add(value),
    );

    final first = await exporter.downloadPdf(
      bytes,
      'bitestar-mailing-labels-20260907-101112.pdf',
    );
    final second = await exporter.downloadPdf(
      bytes,
      'bitestar-mailing-labels-20260907-101112.pdf',
    );
    expect(first.initiated, isTrue);
    expect(second.initiated, isTrue);
    expect(received, hasLength(2));
    expect(received.every((value) => identical(value, bytes)), isTrue);
  });

  test('adapter errors are sanitized controlled failures', () async {
    const privateValue =
        'https://go.bitestar.app/invite/coupon/synthetic-secret';
    final exporter = RestaurantMailingLabelPdfExporter(
      capabilities: const RestaurantMailingLabelPdfExportCapabilities(
        canDownloadPdf: true,
      ),
      downloadPdf: (_, _) async => throw StateError(privateValue),
    );

    final result = await exporter.downloadPdf(
      _pdfBytes(),
      'bitestar-mailing-labels-20260907-101112.pdf',
    );
    expect(result.initiated, isFalse);
    expect(
      result.failure,
      RestaurantMailingLabelPdfExportFailure.initiationFailed,
    );
    expect(
      result.message,
      'Could not initiate the mailing-label PDF download.',
    );
    expect(result.message, isNot(contains(privateValue)));
  });

  test(
    'browser lifecycle clicks once and cleanup-only failures preserve success',
    () async {
      final events = <String>[];
      final exporter = RestaurantMailingLabelPdfExporter(
        capabilities: const RestaurantMailingLabelPdfExportCapabilities(
          canDownloadPdf: true,
        ),
        downloadPdf: (bytes, filename) =>
            runRestaurantQrPdfDownloadLifecycle<Object>(
              bytes: bytes,
              filename: filename,
              mimeType: RestaurantMailingLabelPdfExporter.pdfMimeType,
              createObjectUrl: (_, mimeType) {
                expect(mimeType, 'application/pdf');
                events.add('create-object-url');
                return 'blob:mailing-pdf';
              },
              createAnchor: (_, _) {
                events.add('create-anchor');
                return Object();
              },
              appendAnchor: (_) => events.add('append-anchor'),
              clickAnchor: (_) => events.add('click-anchor'),
              waitForInitiationTurn: () async => events.add('wait-event-turn'),
              removeAnchor: (_) {
                events.add('remove-anchor');
                throw StateError('cleanup only');
              },
              revokeObjectUrl: (_) {
                events.add('revoke-object-url');
                throw StateError('cleanup only');
              },
            ),
      );

      final result = await exporter.downloadPdf(
        _pdfBytes(),
        'bitestar-mailing-labels-20260907-101112.pdf',
      );
      expect(result.initiated, isTrue);
      expect(events.where((event) => event == 'click-anchor'), hasLength(1));
      expect(events, <String>[
        'create-object-url',
        'create-anchor',
        'append-anchor',
        'click-anchor',
        'wait-event-turn',
        'remove-anchor',
        'revoke-object-url',
      ]);
    },
  );

  test(
    'primary lifecycle failure wins while cleanup remains best effort',
    () async {
      final events = <String>[];
      final exporter = RestaurantMailingLabelPdfExporter(
        capabilities: const RestaurantMailingLabelPdfExportCapabilities(
          canDownloadPdf: true,
        ),
        downloadPdf: (bytes, filename) =>
            runRestaurantQrPdfDownloadLifecycle<Object>(
              bytes: bytes,
              filename: filename,
              mimeType: 'application/pdf',
              createObjectUrl: (_, _) => 'blob:mailing-pdf',
              createAnchor: (_, _) => Object(),
              appendAnchor: (_) {},
              clickAnchor: (_) {
                events.add('click');
                throw StateError('primary');
              },
              waitForInitiationTurn: () async {},
              removeAnchor: (_) {
                events.add('remove');
                throw StateError('cleanup');
              },
              revokeObjectUrl: (_) {
                events.add('revoke');
                throw StateError('cleanup');
              },
            ),
      );

      final result = await exporter.downloadPdf(
        _pdfBytes(),
        'bitestar-mailing-labels-20260907-101112.pdf',
      );
      expect(
        result.failure,
        RestaurantMailingLabelPdfExportFailure.initiationFailed,
      );
      expect(events, <String>['click', 'remove', 'revoke']);
    },
  );

  test('production capability matches the current platform', () {
    final exporter = RestaurantMailingLabelPdfExporter();
    expect(exporter.capabilities.canDownloadPdf, kIsWeb);
  });
}

Uint8List _pdfBytes() => Uint8List.fromList('%PDF-synthetic'.codeUnits);
