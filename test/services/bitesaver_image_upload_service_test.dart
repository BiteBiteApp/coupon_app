import 'dart:async';
import 'dart:typed_data';

import 'package:coupon_app/services/bitesaver_image_upload_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('guarded coupon image upload', () {
    test('stale before picker does not start any image work', () async {
      var pickerCalls = 0;
      var uploadCalls = 0;

      final result = await BiteSaverImageUploadService.pickAndUploadCouponImage(
        uid: 'owner-a',
        couponKey: 'coupon-a',
        isCurrent: () => false,
        dependencies: BiteSaverCouponImageUploadDependencies(
          pickImage: () async {
            pickerCalls += 1;
            return _source();
          },
          uploadImage:
              ({
                required objectPath,
                required bytes,
                required contentType,
              }) async {
                uploadCalls += 1;
                return _receipt();
              },
        ),
      );

      expect(result, isA<BiteSaverCouponImageUploadStale>());
      expect(pickerCalls, 0);
      expect(uploadCalls, 0);
    });

    test('transition before picker returns prevents byte read', () async {
      var isCurrent = true;
      var pickerCalls = 0;
      var readCalls = 0;
      var uploadCalls = 0;
      final pickerResult = Completer<BiteSaverCouponImageSource?>();

      final resultFuture = BiteSaverImageUploadService.pickAndUploadCouponImage(
        uid: 'owner-a',
        couponKey: 'coupon-a',
        isCurrent: () => isCurrent,
        dependencies: BiteSaverCouponImageUploadDependencies(
          pickImage: () {
            pickerCalls += 1;
            return pickerResult.future;
          },
          uploadImage:
              ({
                required objectPath,
                required bytes,
                required contentType,
              }) async {
                uploadCalls += 1;
                return _receipt();
              },
        ),
      );

      await _waitUntil(() => pickerCalls == 1);
      isCurrent = false;
      pickerResult.complete(
        _source(
          readAsBytes: () async {
            readCalls += 1;
            return _bytes;
          },
        ),
      );

      expect(await resultFuture, isA<BiteSaverCouponImageUploadStale>());
      expect(readCalls, 0);
      expect(uploadCalls, 0);
    });

    test('transition during byte read prevents upload', () async {
      var isCurrent = true;
      var readCalls = 0;
      var uploadCalls = 0;
      final readResult = Completer<Uint8List>();

      final resultFuture = BiteSaverImageUploadService.pickAndUploadCouponImage(
        uid: 'owner-a',
        couponKey: 'coupon-a',
        isCurrent: () => isCurrent,
        dependencies: BiteSaverCouponImageUploadDependencies(
          pickImage: () async => _source(
            readAsBytes: () {
              readCalls += 1;
              return readResult.future;
            },
          ),
          uploadImage:
              ({
                required objectPath,
                required bytes,
                required contentType,
              }) async {
                uploadCalls += 1;
                return _receipt();
              },
        ),
      );

      await _waitUntil(() => readCalls == 1);
      isCurrent = false;
      readResult.complete(_bytes);

      expect(await resultFuture, isA<BiteSaverCouponImageUploadStale>());
      expect(uploadCalls, 0);
    });

    for (final checkpoint in <BiteSaverCouponImageCheckpoint>[
      BiteSaverCouponImageCheckpoint.beforeProcessing,
      BiteSaverCouponImageCheckpoint.afterProcessing,
      BiteSaverCouponImageCheckpoint.beforeUpload,
    ]) {
      test('transition at $checkpoint prevents upload', () async {
        var isCurrent = true;
        var uploadCalls = 0;
        var reachedCheckpoint = false;
        final releaseCheckpoint = Completer<void>();

        final resultFuture =
            BiteSaverImageUploadService.pickAndUploadCouponImage(
              uid: 'owner-a',
              couponKey: 'coupon-a',
              isCurrent: () => isCurrent,
              dependencies: BiteSaverCouponImageUploadDependencies(
                pickImage: () async => _source(),
                uploadImage:
                    ({
                      required objectPath,
                      required bytes,
                      required contentType,
                    }) async {
                      uploadCalls += 1;
                      return _receipt();
                    },
                waitAtCheckpoint: (currentCheckpoint) {
                  if (currentCheckpoint == checkpoint) {
                    reachedCheckpoint = true;
                    return releaseCheckpoint.future;
                  }
                  return Future<void>.value();
                },
              ),
            );

        await _waitUntil(() => reachedCheckpoint);
        isCurrent = false;
        releaseCheckpoint.complete();

        expect(await resultFuture, isA<BiteSaverCouponImageUploadStale>());
        expect(uploadCalls, 0);
      });
    }

    test('transition during upload skips download URL retrieval', () async {
      var isCurrent = true;
      var uploadCalls = 0;
      var retrievalCalls = 0;
      final uploadResult = Completer<BiteSaverCouponImageUploadReceipt>();

      final resultFuture = BiteSaverImageUploadService.pickAndUploadCouponImage(
        uid: 'owner-a',
        couponKey: 'coupon-a',
        isCurrent: () => isCurrent,
        dependencies: BiteSaverCouponImageUploadDependencies(
          pickImage: () async => _source(),
          uploadImage:
              ({required objectPath, required bytes, required contentType}) {
                uploadCalls += 1;
                return uploadResult.future;
              },
        ),
      );

      await _waitUntil(() => uploadCalls == 1);
      isCurrent = false;
      uploadResult.complete(
        _receipt(
          retrieveDownloadUrl: () async {
            retrievalCalls += 1;
            return _urlA;
          },
        ),
      );

      expect(await resultFuture, isA<BiteSaverCouponImageUploadStale>());
      expect(retrievalCalls, 0);
    });

    test(
      'transition after upload but before URL retrieval skips retrieval',
      () async {
        var isCurrent = true;
        var retrievalCalls = 0;
        var reachedPreRetrieval = false;
        final releasePreRetrieval = Completer<void>();

        final resultFuture =
            BiteSaverImageUploadService.pickAndUploadCouponImage(
              uid: 'owner-a',
              couponKey: 'coupon-a',
              isCurrent: () => isCurrent,
              dependencies: BiteSaverCouponImageUploadDependencies(
                pickImage: () async => _source(),
                uploadImage:
                    ({
                      required objectPath,
                      required bytes,
                      required contentType,
                    }) async => _receipt(
                      retrieveDownloadUrl: () async {
                        retrievalCalls += 1;
                        return _urlA;
                      },
                    ),
                waitAtCheckpoint: (checkpoint) {
                  if (checkpoint ==
                      BiteSaverCouponImageCheckpoint
                          .beforeDownloadUrlRetrieval) {
                    reachedPreRetrieval = true;
                    return releasePreRetrieval.future;
                  }
                  return Future<void>.value();
                },
              ),
            );

        await _waitUntil(() => reachedPreRetrieval);
        isCurrent = false;
        releasePreRetrieval.complete();

        expect(await resultFuture, isA<BiteSaverCouponImageUploadStale>());
        expect(retrievalCalls, 0);
      },
    );

    test('transition during URL retrieval discards returned URL', () async {
      var isCurrent = true;
      var retrievalCalls = 0;
      final retrievalResult = Completer<String>();

      final resultFuture = BiteSaverImageUploadService.pickAndUploadCouponImage(
        uid: 'owner-a',
        couponKey: 'coupon-a',
        isCurrent: () => isCurrent,
        dependencies: BiteSaverCouponImageUploadDependencies(
          pickImage: () async => _source(),
          uploadImage:
              ({
                required objectPath,
                required bytes,
                required contentType,
              }) async => _receipt(
                retrieveDownloadUrl: () {
                  retrievalCalls += 1;
                  return retrievalResult.future;
                },
              ),
        ),
      );

      await _waitUntil(() => retrievalCalls == 1);
      isCurrent = false;
      retrievalResult.complete(_urlA);

      expect(await resultFuture, isA<BiteSaverCouponImageUploadStale>());
    });

    test('transition immediately before return hides completed URL', () async {
      var isCurrent = true;
      var reachedFinalReturn = false;
      final releaseFinalReturn = Completer<void>();

      final resultFuture = BiteSaverImageUploadService.pickAndUploadCouponImage(
        uid: 'owner-a',
        couponKey: 'coupon-a',
        isCurrent: () => isCurrent,
        dependencies: BiteSaverCouponImageUploadDependencies(
          pickImage: () async => _source(),
          uploadImage:
              ({
                required objectPath,
                required bytes,
                required contentType,
              }) async => _receipt(),
          waitAtCheckpoint: (checkpoint) {
            if (checkpoint ==
                BiteSaverCouponImageCheckpoint.beforeSuccessReturn) {
              reachedFinalReturn = true;
              return releaseFinalReturn.future;
            }
            return Future<void>.value();
          },
        ),
      );

      await _waitUntil(() => reachedFinalReturn);
      isCurrent = false;
      releaseFinalReturn.complete();

      expect(await resultFuture, isA<BiteSaverCouponImageUploadStale>());
    });

    test('current operation performs each boundary exactly once', () async {
      var guardCalls = 0;
      var pickerCalls = 0;
      var readCalls = 0;
      var uploadCalls = 0;
      var retrievalCalls = 0;
      String? uploadedPath;
      Uint8List? uploadedBytes;
      String? uploadedContentType;
      final checkpoints = <BiteSaverCouponImageCheckpoint>[];

      final result = await BiteSaverImageUploadService.pickAndUploadCouponImage(
        uid: ' owner/alpha ',
        couponKey: ' coupon key ',
        isCurrent: () {
          guardCalls += 1;
          return true;
        },
        dependencies: BiteSaverCouponImageUploadDependencies(
          pickImage: () async {
            pickerCalls += 1;
            return _source(
              fileName: 'synthetic.webp',
              readAsBytes: () async {
                readCalls += 1;
                return _bytes;
              },
            );
          },
          uploadImage:
              ({
                required objectPath,
                required bytes,
                required contentType,
              }) async {
                uploadCalls += 1;
                uploadedPath = objectPath;
                uploadedBytes = bytes;
                uploadedContentType = contentType;
                return _receipt(
                  retrieveDownloadUrl: () async {
                    retrievalCalls += 1;
                    return _urlB;
                  },
                );
              },
          waitAtCheckpoint: (checkpoint) async {
            checkpoints.add(checkpoint);
          },
        ),
      );

      expect(result, isA<BiteSaverCouponImageUploadCompleted>());
      expect((result as BiteSaverCouponImageUploadCompleted).imageUrl, _urlB);
      expect(pickerCalls, 1);
      expect(readCalls, 1);
      expect(uploadCalls, 1);
      expect(retrievalCalls, 1);
      expect(guardCalls, BiteSaverCouponImageCheckpoint.values.length);
      expect(checkpoints, BiteSaverCouponImageCheckpoint.values);
      expect(
        uploadedPath,
        matches(
          RegExp(
            r'^bitesaver_restaurants/owner_alpha/coupon_images/'
            r'coupon_key_[0-9]+\.webp$',
          ),
        ),
      );
      expect(uploadedBytes, same(_bytes));
      expect(uploadedContentType, 'image/webp');
    });

    test('picker cancellation is a typed no-op', () async {
      var uploadCalls = 0;
      final checkpoints = <BiteSaverCouponImageCheckpoint>[];

      final result = await BiteSaverImageUploadService.pickAndUploadCouponImage(
        uid: 'owner-a',
        couponKey: 'coupon-a',
        isCurrent: () => true,
        dependencies: BiteSaverCouponImageUploadDependencies(
          pickImage: () async => null,
          uploadImage:
              ({
                required objectPath,
                required bytes,
                required contentType,
              }) async {
                uploadCalls += 1;
                return _receipt();
              },
          waitAtCheckpoint: (checkpoint) async {
            checkpoints.add(checkpoint);
          },
        ),
      );

      expect(result, isA<BiteSaverCouponImageUploadCancelled>());
      expect(uploadCalls, 0);
      expect(checkpoints, <BiteSaverCouponImageCheckpoint>[
        BiteSaverCouponImageCheckpoint.beforePicker,
        BiteSaverCouponImageCheckpoint.afterPicker,
      ]);
    });

    test('guard exceptions fail closed at every checkpoint', () async {
      for (final throwingCheckpoint in BiteSaverCouponImageCheckpoint.values) {
        BiteSaverCouponImageCheckpoint? currentCheckpoint;
        var pickerCalls = 0;
        var readCalls = 0;
        var uploadCalls = 0;
        var retrievalCalls = 0;

        final result =
            await BiteSaverImageUploadService.pickAndUploadCouponImage(
              uid: 'owner-a',
              couponKey: 'coupon-a',
              isCurrent: () {
                if (currentCheckpoint == throwingCheckpoint) {
                  throw StateError('synthetic guard failure');
                }
                return true;
              },
              dependencies: BiteSaverCouponImageUploadDependencies(
                pickImage: () async {
                  pickerCalls += 1;
                  return _source(
                    readAsBytes: () async {
                      readCalls += 1;
                      return _bytes;
                    },
                  );
                },
                uploadImage:
                    ({
                      required objectPath,
                      required bytes,
                      required contentType,
                    }) async {
                      uploadCalls += 1;
                      return _receipt(
                        retrieveDownloadUrl: () async {
                          retrievalCalls += 1;
                          return _urlA;
                        },
                      );
                    },
                waitAtCheckpoint: (checkpoint) async {
                  currentCheckpoint = checkpoint;
                },
              ),
            );

        expect(
          result,
          isA<BiteSaverCouponImageUploadStale>(),
          reason: 'guard exception at $throwingCheckpoint must be stale',
        );
        expect(
          pickerCalls,
          throwingCheckpoint == BiteSaverCouponImageCheckpoint.beforePicker
              ? 0
              : 1,
        );
        expect(readCalls, _isBeforeByteRead(throwingCheckpoint) ? 0 : 1);
        expect(uploadCalls, _isBeforeUpload(throwingCheckpoint) ? 0 : 1);
        expect(
          retrievalCalls,
          _isBeforeUrlRetrieval(throwingCheckpoint) ? 0 : 1,
        );
      }
    });

    for (final boundary in _AwaitFailureBoundary.values) {
      test(
        'stale ${boundary.name} error after await is converted to stale',
        () async {
          var isCurrent = true;
          final pipeline = _AwaitFailurePipeline(boundary);
          final failure = _SyntheticFailure('stale $boundary');

          final resultFuture =
              BiteSaverImageUploadService.pickAndUploadCouponImage(
                uid: 'owner-a',
                couponKey: 'coupon-a',
                isCurrent: () => isCurrent,
                dependencies: pipeline.dependencies,
              );

          await pipeline.started.future;
          isCurrent = false;
          pipeline.completeError(failure);

          expect(await resultFuture, isA<BiteSaverCouponImageUploadStale>());
        },
      );

      test('current ${boundary.name} error is rethrown unchanged', () async {
        final pipeline = _AwaitFailurePipeline(boundary);
        final failure = _SyntheticFailure('current $boundary');

        final resultFuture =
            BiteSaverImageUploadService.pickAndUploadCouponImage(
              uid: 'owner-a',
              couponKey: 'coupon-a',
              isCurrent: () => true,
              dependencies: pipeline.dependencies,
            );

        await pipeline.started.future;
        pipeline.completeError(failure);

        await expectLater(resultFuture, throwsA(same(failure)));
      });
    }

    test('current B completes while stale A upload remains pending', () async {
      var ownerACurrent = true;
      var ownerAUploadCalls = 0;
      var ownerARetrievalCalls = 0;
      final ownerAUpload = Completer<BiteSaverCouponImageUploadReceipt>();

      final ownerAResultFuture =
          BiteSaverImageUploadService.pickAndUploadCouponImage(
            uid: 'owner-a',
            couponKey: 'coupon-a',
            isCurrent: () => ownerACurrent,
            dependencies: BiteSaverCouponImageUploadDependencies(
              pickImage: () async => _source(fileName: 'owner-a.jpg'),
              uploadImage:
                  ({
                    required objectPath,
                    required bytes,
                    required contentType,
                  }) {
                    ownerAUploadCalls += 1;
                    return ownerAUpload.future;
                  },
            ),
          );

      await _waitUntil(() => ownerAUploadCalls == 1);

      var ownerBRetrievalCalls = 0;
      final ownerBResult =
          await BiteSaverImageUploadService.pickAndUploadCouponImage(
            uid: 'owner-b',
            couponKey: 'coupon-b',
            isCurrent: () => true,
            dependencies: BiteSaverCouponImageUploadDependencies(
              pickImage: () async => _source(fileName: 'owner-b.png'),
              uploadImage:
                  ({
                    required objectPath,
                    required bytes,
                    required contentType,
                  }) async => _receipt(
                    retrieveDownloadUrl: () async {
                      ownerBRetrievalCalls += 1;
                      return _urlB;
                    },
                  ),
            ),
          );

      expect(ownerBResult, isA<BiteSaverCouponImageUploadCompleted>());
      expect(
        (ownerBResult as BiteSaverCouponImageUploadCompleted).imageUrl,
        _urlB,
      );
      expect(ownerBRetrievalCalls, 1);

      ownerACurrent = false;
      ownerAUpload.complete(
        _receipt(
          retrieveDownloadUrl: () async {
            ownerARetrievalCalls += 1;
            return _urlA;
          },
        ),
      );

      expect(await ownerAResultFuture, isA<BiteSaverCouponImageUploadStale>());
      expect(ownerARetrievalCalls, 0);
    });
  });
}

final Uint8List _bytes = Uint8List.fromList(<int>[1, 3, 5, 7]);

const String _urlA =
    'https://synthetic.invalid/owner-a.jpg?token=owner-a-canary';
const String _urlB =
    'https://synthetic.invalid/owner-b.jpg?token=owner-b-canary';

BiteSaverCouponImageSource _source({
  String fileName = 'synthetic.jpg',
  Future<Uint8List> Function()? readAsBytes,
}) {
  return BiteSaverCouponImageSource(
    fileName: fileName,
    readAsBytes: readAsBytes ?? () async => _bytes,
  );
}

BiteSaverCouponImageUploadReceipt _receipt({
  Future<String> Function()? retrieveDownloadUrl,
}) {
  return BiteSaverCouponImageUploadReceipt(
    retrieveDownloadUrl: retrieveDownloadUrl ?? () async => _urlA,
  );
}

bool _isBeforeByteRead(BiteSaverCouponImageCheckpoint checkpoint) {
  return switch (checkpoint) {
    BiteSaverCouponImageCheckpoint.beforePicker ||
    BiteSaverCouponImageCheckpoint.afterPicker ||
    BiteSaverCouponImageCheckpoint.beforeByteRead => true,
    _ => false,
  };
}

bool _isBeforeUpload(BiteSaverCouponImageCheckpoint checkpoint) {
  return switch (checkpoint) {
    BiteSaverCouponImageCheckpoint.beforePicker ||
    BiteSaverCouponImageCheckpoint.afterPicker ||
    BiteSaverCouponImageCheckpoint.beforeByteRead ||
    BiteSaverCouponImageCheckpoint.afterByteRead ||
    BiteSaverCouponImageCheckpoint.beforeProcessing ||
    BiteSaverCouponImageCheckpoint.afterProcessing ||
    BiteSaverCouponImageCheckpoint.beforeUpload => true,
    _ => false,
  };
}

bool _isBeforeUrlRetrieval(BiteSaverCouponImageCheckpoint checkpoint) {
  return switch (checkpoint) {
    BiteSaverCouponImageCheckpoint.beforePicker ||
    BiteSaverCouponImageCheckpoint.afterPicker ||
    BiteSaverCouponImageCheckpoint.beforeByteRead ||
    BiteSaverCouponImageCheckpoint.afterByteRead ||
    BiteSaverCouponImageCheckpoint.beforeProcessing ||
    BiteSaverCouponImageCheckpoint.afterProcessing ||
    BiteSaverCouponImageCheckpoint.beforeUpload ||
    BiteSaverCouponImageCheckpoint.afterUpload ||
    BiteSaverCouponImageCheckpoint.beforeDownloadUrlRetrieval => true,
    _ => false,
  };
}

Future<void> _waitUntil(bool Function() condition) async {
  for (var attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) {
      return;
    }
    await Future<void>.delayed(Duration.zero);
  }
  fail('Timed out waiting for synthetic async boundary.');
}

enum _AwaitFailureBoundary { picker, byteRead, upload, downloadUrl }

final class _AwaitFailurePipeline {
  final _AwaitFailureBoundary boundary;
  final Completer<void> started = Completer<void>();
  final Completer<BiteSaverCouponImageSource?> _pickerResult =
      Completer<BiteSaverCouponImageSource?>();
  final Completer<Uint8List> _byteReadResult = Completer<Uint8List>();
  final Completer<BiteSaverCouponImageUploadReceipt> _uploadResult =
      Completer<BiteSaverCouponImageUploadReceipt>();
  final Completer<String> _downloadUrlResult = Completer<String>();

  _AwaitFailurePipeline(this.boundary);

  BiteSaverCouponImageUploadDependencies get dependencies =>
      BiteSaverCouponImageUploadDependencies(
        pickImage: () {
          if (boundary == _AwaitFailureBoundary.picker) {
            started.complete();
            return _pickerResult.future;
          }
          return Future<BiteSaverCouponImageSource?>.value(
            _source(
              readAsBytes: () {
                if (boundary == _AwaitFailureBoundary.byteRead) {
                  started.complete();
                  return _byteReadResult.future;
                }
                return Future<Uint8List>.value(_bytes);
              },
            ),
          );
        },
        uploadImage:
            ({required objectPath, required bytes, required contentType}) {
              if (boundary == _AwaitFailureBoundary.upload) {
                started.complete();
                return _uploadResult.future;
              }
              return Future<BiteSaverCouponImageUploadReceipt>.value(
                _receipt(
                  retrieveDownloadUrl: () {
                    if (boundary == _AwaitFailureBoundary.downloadUrl) {
                      started.complete();
                      return _downloadUrlResult.future;
                    }
                    return Future<String>.value(_urlA);
                  },
                ),
              );
            },
      );

  void completeError(Object error) {
    switch (boundary) {
      case _AwaitFailureBoundary.picker:
        _pickerResult.completeError(error);
      case _AwaitFailureBoundary.byteRead:
        _byteReadResult.completeError(error);
      case _AwaitFailureBoundary.upload:
        _uploadResult.completeError(error);
      case _AwaitFailureBoundary.downloadUrl:
        _downloadUrlResult.completeError(error);
    }
  }
}

final class _SyntheticFailure implements Exception {
  final String message;

  const _SyntheticFailure(this.message);
}
