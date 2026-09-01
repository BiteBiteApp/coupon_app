import 'dart:async';

import 'package:coupon_app/services/restaurant_qr_pdf_export.dart';
import 'package:coupon_app/services/restaurant_qr_pdf_export_lifecycle.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('reports injected export capabilities and PDF MIME type', () {
    final exporter = RestaurantQrPdfExporter(
      capabilities: const RestaurantQrPdfExportCapabilities(
        canDownloadPdf: false,
        downloadUnavailableReason: 'Download unavailable.',
      ),
      downloadPdf: (_, _) async {},
    );

    expect(exporter.capabilities.canDownloadPdf, isFalse);
    expect(
      exporter.capabilities.downloadUnavailableReason,
      'Download unavailable.',
    );
    expect(RestaurantQrPdfExporter.pdfMimeType, 'application/pdf');
  });

  test(
    'success waits for initiation and delegates the same artifact exactly once',
    () async {
      final pdf = _pdfBytes();
      const filename = 'bitestar-qr-labels-20260829-205400.pdf';
      final initiation = Completer<void>();
      var calls = 0;
      Uint8List? receivedBytes;
      String? receivedFilename;
      final exporter = RestaurantQrPdfExporter(
        capabilities: const RestaurantQrPdfExportCapabilities(
          canDownloadPdf: true,
        ),
        downloadPdf: (bytes, value) {
          calls += 1;
          receivedBytes = bytes;
          receivedFilename = value;
          return initiation.future;
        },
      );

      var completed = false;
      final pending = exporter.downloadPdf(pdf, filename)
        ..then((_) {
          completed = true;
        });
      await Future<void>.delayed(Duration.zero);

      expect(calls, 1);
      expect(completed, isFalse);
      expect(receivedBytes, same(pdf));
      expect(receivedFilename, filename);

      initiation.complete();
      final result = await pending;

      expect(result.initiated, isTrue);
      expect(result.failure, isNull);
      expect(result.message, 'PDF download initiated.');
    },
  );

  test(
    're-download delegates the same bytes and filename without mutation',
    () async {
      final pdf = _pdfBytes();
      const filename = 'bitestar-qr-labels-20260829-205400.pdf';
      final receivedBytes = <Uint8List>[];
      final receivedFilenames = <String>[];
      final exporter = RestaurantQrPdfExporter(
        capabilities: const RestaurantQrPdfExportCapabilities(
          canDownloadPdf: true,
        ),
        downloadPdf: (bytes, value) async {
          receivedBytes.add(bytes);
          receivedFilenames.add(value);
        },
      );

      final first = await exporter.downloadPdf(pdf, filename);
      final second = await exporter.downloadPdf(pdf, filename);

      expect(first.initiated, isTrue);
      expect(second.initiated, isTrue);
      expect(receivedBytes, hasLength(2));
      expect(receivedBytes.every((bytes) => identical(bytes, pdf)), isTrue);
      expect(receivedFilenames, <String>[filename, filename]);
    },
  );

  test(
    'unsupported platform returns a controlled result without delegation',
    () async {
      var calls = 0;
      final exporter = RestaurantQrPdfExporter(
        capabilities: const RestaurantQrPdfExportCapabilities(
          canDownloadPdf: false,
          downloadUnavailableReason: 'Use the web admin workspace.',
        ),
        downloadPdf: (_, _) async {
          calls += 1;
        },
      );

      final result = await exporter.downloadPdf(
        _pdfBytes(),
        'bitestar-qr-labels-20260829-205400.pdf',
      );

      expect(result.initiated, isFalse);
      expect(result.failure, RestaurantQrPdfExportFailure.unsupported);
      expect(result.message, 'Use the web admin workspace.');
      expect(calls, 0);
    },
  );

  test(
    'invalid artifacts and non-generic filenames never reach the adapter',
    () async {
      var calls = 0;
      final exporter = RestaurantQrPdfExporter(
        capabilities: const RestaurantQrPdfExportCapabilities(
          canDownloadPdf: true,
        ),
        downloadPdf: (_, _) async {
          calls += 1;
        },
      );

      final invalidPdf = await exporter.downloadPdf(
        Uint8List.fromList(<int>[1, 2, 3]),
        'bitestar-qr-labels-20260829-205400.pdf',
      );
      final unsafeFilename = await exporter.downloadPdf(
        _pdfBytes(),
        '../restaurant-token.pdf',
      );
      final restaurantFilename = await exporter.downloadPdf(
        _pdfBytes(),
        'river-grill-qr-labels.pdf',
      );

      expect(invalidPdf.initiated, isFalse);
      expect(invalidPdf.failure, RestaurantQrPdfExportFailure.invalidPdf);
      expect(unsafeFilename.initiated, isFalse);
      expect(
        unsafeFilename.failure,
        RestaurantQrPdfExportFailure.invalidFilename,
      );
      expect(restaurantFilename.initiated, isFalse);
      expect(
        restaurantFilename.failure,
        RestaurantQrPdfExportFailure.invalidFilename,
      );
      expect(calls, 0);
    },
  );

  test(
    'adapter errors become controlled failures without leaking details',
    () async {
      const fakeSecureUrl =
          'https://go.bitestar.app/invite/coupon/fake-test-token';
      final exporter = RestaurantQrPdfExporter(
        capabilities: const RestaurantQrPdfExportCapabilities(
          canDownloadPdf: true,
        ),
        downloadPdf: (_, _) async => throw StateError(fakeSecureUrl),
      );

      final result = await exporter.downloadPdf(
        _pdfBytes(),
        'bitestar-qr-labels-20260829-205400.pdf',
      );

      expect(result.initiated, isFalse);
      expect(result.failure, RestaurantQrPdfExportFailure.initiationFailed);
      expect(result.message, 'Could not initiate the PDF download.');
      expect(result.message, isNot(contains(fakeSecureUrl)));
    },
  );

  test(
    'production adapter selects web or unsupported platform safely',
    () async {
      final exporter = RestaurantQrPdfExporter();

      if (kIsWeb) {
        expect(exporter.capabilities.canDownloadPdf, isTrue);
      } else {
        expect(exporter.capabilities.canDownloadPdf, isFalse);
        final result = await exporter.downloadPdf(
          _pdfBytes(),
          'bitestar-qr-labels-20260829-205400.pdf',
        );
        expect(result.initiated, isFalse);
        expect(result.failure, RestaurantQrPdfExportFailure.unsupported);
      }
    },
  );

  test(
    'browser lifecycle uses PDF MIME, clicks once, then removes and revokes',
    () async {
      final pdf = _pdfBytes();
      const filename = 'bitestar-qr-labels-20260829-205400.pdf';
      final eventTurn = Completer<void>();
      final events = <String>[];
      final anchor = Object();

      final pending = runRestaurantQrPdfDownloadLifecycle<Object>(
        bytes: pdf,
        filename: filename,
        mimeType: RestaurantQrPdfExporter.pdfMimeType,
        createObjectUrl: (bytes, mimeType) {
          expect(bytes, same(pdf));
          expect(mimeType, 'application/pdf');
          events.add('create-object-url');
          return 'blob:synthetic-pdf';
        },
        createAnchor: (objectUrl, value) {
          expect(objectUrl, 'blob:synthetic-pdf');
          expect(value, filename);
          events.add('create-anchor');
          return anchor;
        },
        appendAnchor: (value) {
          expect(value, same(anchor));
          events.add('append-anchor');
        },
        clickAnchor: (value) {
          expect(value, same(anchor));
          events.add('click-anchor');
        },
        waitForInitiationTurn: () {
          events.add('wait-event-turn');
          return eventTurn.future;
        },
        removeAnchor: (value) {
          expect(value, same(anchor));
          events.add('remove-anchor');
        },
        revokeObjectUrl: (objectUrl) {
          expect(objectUrl, 'blob:synthetic-pdf');
          events.add('revoke-object-url');
        },
      );
      await Future<void>.delayed(Duration.zero);

      expect(events, <String>[
        'create-object-url',
        'create-anchor',
        'append-anchor',
        'click-anchor',
        'wait-event-turn',
      ]);

      eventTurn.complete();
      await pending;
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
    'removal failure keeps success and still revokes exactly once',
    () async {
      final events = <String>[];

      await runRestaurantQrPdfDownloadLifecycle<Object>(
        bytes: _pdfBytes(),
        filename: 'bitestar-qr-labels-20260829-205400.pdf',
        mimeType: RestaurantQrPdfExporter.pdfMimeType,
        createObjectUrl: (_, _) => 'blob:synthetic-pdf',
        createAnchor: (_, _) => Object(),
        appendAnchor: (_) => events.add('append-anchor'),
        clickAnchor: (_) => events.add('click-anchor'),
        waitForInitiationTurn: () async => events.add('wait-event-turn'),
        removeAnchor: (_) {
          events.add('remove-anchor');
          throw StateError('Synthetic removal failure.');
        },
        revokeObjectUrl: (_) => events.add('revoke-object-url'),
      );

      expect(events, <String>[
        'append-anchor',
        'click-anchor',
        'wait-event-turn',
        'remove-anchor',
        'revoke-object-url',
      ]);
      expect(events.where((event) => event == 'remove-anchor'), hasLength(1));
      expect(
        events.where((event) => event == 'revoke-object-url'),
        hasLength(1),
      );
    },
  );

  test('revocation failure keeps success after successful removal', () async {
    final events = <String>[];

    await runRestaurantQrPdfDownloadLifecycle<Object>(
      bytes: _pdfBytes(),
      filename: 'bitestar-qr-labels-20260829-205400.pdf',
      mimeType: RestaurantQrPdfExporter.pdfMimeType,
      createObjectUrl: (_, _) => 'blob:synthetic-pdf',
      createAnchor: (_, _) => Object(),
      appendAnchor: (_) => events.add('append-anchor'),
      clickAnchor: (_) => events.add('click-anchor'),
      waitForInitiationTurn: () async => events.add('wait-event-turn'),
      removeAnchor: (_) => events.add('remove-anchor'),
      revokeObjectUrl: (_) {
        events.add('revoke-object-url');
        throw StateError('Synthetic revocation failure.');
      },
    );

    expect(events, <String>[
      'append-anchor',
      'click-anchor',
      'wait-event-turn',
      'remove-anchor',
      'revoke-object-url',
    ]);
  });

  test(
    'click failure remains exact primary failure after successful cleanup',
    () async {
      final primaryError = StateError('Synthetic primary click failure.');
      final events = <String>[];
      Object? caughtError;

      try {
        await runRestaurantQrPdfDownloadLifecycle<Object>(
          bytes: _pdfBytes(),
          filename: 'bitestar-qr-labels-20260829-205400.pdf',
          mimeType: RestaurantQrPdfExporter.pdfMimeType,
          createObjectUrl: (_, _) => 'blob:synthetic-pdf',
          createAnchor: (_, _) => Object(),
          appendAnchor: (_) => events.add('append-anchor'),
          clickAnchor: (_) {
            events.add('click-anchor');
            throw primaryError;
          },
          waitForInitiationTurn: () async => events.add('wait-event-turn'),
          removeAnchor: (_) => events.add('remove-anchor'),
          revokeObjectUrl: (_) => events.add('revoke-object-url'),
        );
      } catch (error) {
        caughtError = error;
      }

      expect(caughtError, same(primaryError));
      expect(events, <String>[
        'append-anchor',
        'click-anchor',
        'remove-anchor',
        'revoke-object-url',
      ]);
    },
  );

  for (final primaryFailurePhase in <String>[
    'create-object-url',
    'create-anchor',
    'append-anchor',
    'click-anchor',
    'wait-event-turn',
  ]) {
    test(
      '$primaryFailurePhase failure wins over combined cleanup failures',
      () async {
        final primaryError = StateError(
          'Synthetic $primaryFailurePhase failure.',
        );
        final events = <String>[];
        final anchor = Object();
        Object? caughtError;

        try {
          await runRestaurantQrPdfDownloadLifecycle<Object>(
            bytes: _pdfBytes(),
            filename: 'bitestar-qr-labels-20260829-205400.pdf',
            mimeType: RestaurantQrPdfExporter.pdfMimeType,
            createObjectUrl: (_, _) {
              events.add('create-object-url');
              if (primaryFailurePhase == 'create-object-url') {
                throw primaryError;
              }
              return 'blob:synthetic-pdf';
            },
            createAnchor: (_, _) {
              events.add('create-anchor');
              if (primaryFailurePhase == 'create-anchor') throw primaryError;
              return anchor;
            },
            appendAnchor: (_) {
              events.add('append-anchor');
              if (primaryFailurePhase == 'append-anchor') throw primaryError;
            },
            clickAnchor: (_) {
              events.add('click-anchor');
              if (primaryFailurePhase == 'click-anchor') throw primaryError;
            },
            waitForInitiationTurn: () async {
              events.add('wait-event-turn');
              if (primaryFailurePhase == 'wait-event-turn') throw primaryError;
            },
            removeAnchor: (_) {
              events.add('remove-anchor');
              throw StateError('Synthetic removal failure.');
            },
            revokeObjectUrl: (_) {
              events.add('revoke-object-url');
              throw StateError('Synthetic revocation failure.');
            },
          );
        } catch (error) {
          caughtError = error;
        }

        expect(caughtError, same(primaryError));
        final primaryIndex = <String>[
          'create-object-url',
          'create-anchor',
          'append-anchor',
          'click-anchor',
          'wait-event-turn',
        ].indexOf(primaryFailurePhase);
        final expectedEvents = <String>[
          'create-object-url',
          'create-anchor',
          'append-anchor',
          'click-anchor',
          'wait-event-turn',
        ].take(primaryIndex + 1).toList();
        if (primaryIndex >= 2) expectedEvents.add('remove-anchor');
        if (primaryIndex >= 1) expectedEvents.add('revoke-object-url');
        expect(events, expectedEvents);
        expect(
          events.where((event) => event == 'remove-anchor'),
          hasLength(primaryIndex >= 2 ? 1 : 0),
        );
        expect(
          events.where((event) => event == 'revoke-object-url'),
          hasLength(primaryIndex >= 1 ? 1 : 0),
        );
      },
    );
  }

  test(
    'cleanup failures are best effort and preserve lifecycle success',
    () async {
      final events = <String>[];

      await runRestaurantQrPdfDownloadLifecycle<Object>(
        bytes: _pdfBytes(),
        filename: 'bitestar-qr-labels-20260829-205400.pdf',
        mimeType: RestaurantQrPdfExporter.pdfMimeType,
        createObjectUrl: (_, _) {
          events.add('create-object-url');
          return 'blob:synthetic-pdf';
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
          throw StateError('Synthetic removal failure.');
        },
        revokeObjectUrl: (_) {
          events.add('revoke-object-url');
          throw StateError('Synthetic revocation failure.');
        },
      );

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

  test('cleanup-only failures preserve exporter initiation success', () async {
    var adapterCalls = 0;
    final exporter = RestaurantQrPdfExporter(
      capabilities: const RestaurantQrPdfExportCapabilities(
        canDownloadPdf: true,
      ),
      downloadPdf: (bytes, filename) async {
        adapterCalls += 1;
        await runRestaurantQrPdfDownloadLifecycle<Object>(
          bytes: bytes,
          filename: filename,
          mimeType: RestaurantQrPdfExporter.pdfMimeType,
          createObjectUrl: (_, _) => 'blob:synthetic-pdf',
          createAnchor: (_, _) => Object(),
          appendAnchor: (_) {},
          clickAnchor: (_) {},
          waitForInitiationTurn: () async {},
          removeAnchor: (_) => throw StateError('Synthetic removal failure.'),
          revokeObjectUrl: (_) =>
              throw StateError('Synthetic revocation failure.'),
        );
      },
    );

    final result = await exporter.downloadPdf(
      _pdfBytes(),
      'bitestar-qr-labels-20260829-205400.pdf',
    );

    expect(adapterCalls, 1);
    expect(result.initiated, isTrue);
    expect(result.failure, isNull);
    expect(result.message, 'PDF download initiated.');
  });
}

Uint8List _pdfBytes() {
  return Uint8List.fromList(<int>[
    37,
    80,
    68,
    70,
    45,
    49,
    46,
    55,
    10,
    37,
    69,
    79,
    70,
  ]);
}
