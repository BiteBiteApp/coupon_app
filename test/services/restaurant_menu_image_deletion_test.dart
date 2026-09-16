import 'package:coupon_app/services/restaurant_account_service.dart';
import 'package:coupon_app/services/restaurant_menu_service.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('menu image deletion', () {
    for (final testCase
        in <
          ({
            String name,
            RestaurantMenuSource source,
            String expectedRecordPath,
            String expectedParentPath,
          })
        >[
          (
            name: 'own menu',
            source: RestaurantMenuSource.legacyBiteSaver('owner-a'),
            expectedRecordPath:
                'restaurant_accounts/owner-a/menu_images/image-a',
            expectedParentPath: 'restaurant_accounts/owner-a',
          ),
          (
            name: 'shared menu',
            source: RestaurantMenuSource.sharedMenu('shared-a'),
            expectedRecordPath: 'restaurant_menus/shared-a/menu_images/image-a',
            expectedParentPath: 'restaurant_menus/shared-a',
          ),
        ]) {
      test(
        '${testCase.name} deletes the exact stored object and record',
        () async {
          final image = _image('A');
          final state = _DeletionState(image: image, objectExists: true);

          await RestaurantMenuService.deleteMenuImage(
            source: testCase.source,
            imageId: image.id,
            expectedImage: image,
            dependencies: state.dependencies,
          );

          expect(state.authorizedLocations, hasLength(1));
          expect(
            state.authorizedLocations.single.recordPath,
            testCase.expectedRecordPath,
          );
          expect(
            state.authorizedLocations.single.parentPath,
            testCase.expectedParentPath,
          );
          expect(state.deletedStoragePaths, <String>[image.storagePath!]);
          expect(state.objectExists, isFalse);
          expect(state.image, isNull);
        },
      );
    }

    test(
      'Storage failure leaves the exact record and object retryable',
      () async {
        final image = _image('B');
        final state = _DeletionState(image: image, objectExists: true)
          ..failStorage = true;

        await expectLater(
          RestaurantMenuService.deleteMenuImage(
            source: RestaurantMenuSource.sharedMenu('shared-b'),
            imageId: image.id,
            expectedImage: image,
            dependencies: state.dependencies,
          ),
          throwsStateError,
        );
        expect(state.image, same(image));
        expect(state.objectExists, isTrue);
        expect(state.recordDeletionCalls, 0);

        state.failStorage = false;
        await RestaurantMenuService.deleteMenuImage(
          source: RestaurantMenuSource.sharedMenu('shared-b'),
          imageId: image.id,
          expectedImage: image,
          dependencies: state.dependencies,
        );
        expect(state.image, isNull);
        expect(state.objectExists, isFalse);
      },
    );

    test(
      'record failure after object removal completes on a safe retry',
      () async {
        final image = _image('C');
        final state = _DeletionState(image: image, objectExists: true)
          ..failNextRecordDeletion = true;

        await expectLater(
          RestaurantMenuService.deleteMenuImage(
            source: RestaurantMenuSource.legacyBiteSaver('owner-c'),
            imageId: image.id,
            expectedImage: image,
            dependencies: state.dependencies,
          ),
          throwsStateError,
        );
        expect(state.objectExists, isFalse);
        expect(state.image, same(image));

        await RestaurantMenuService.deleteMenuImage(
          source: RestaurantMenuSource.legacyBiteSaver('owner-c'),
          imageId: image.id,
          expectedImage: image,
          dependencies: state.dependencies,
        );
        expect(state.deletedStoragePaths, <String>[
          image.storagePath!,
          image.storagePath!,
        ]);
        expect(state.image, isNull);
      },
    );

    test('an already-missing object permits record completion', () async {
      final image = _image('D');
      final state = _DeletionState(image: image, objectExists: false);

      await RestaurantMenuService.deleteMenuImage(
        source: RestaurantMenuSource.sharedMenu('shared-d'),
        imageId: image.id,
        expectedImage: image,
        dependencies: state.dependencies,
      );

      expect(state.deletedStoragePaths, <String>[image.storagePath!]);
      expect(state.image, isNull);
    });

    test(
      'a replaced record cannot redirect deletion or a later retry',
      () async {
        final original = _image('E');
        final replacement = _image('F', imageId: original.id);
        final state = _DeletionState(image: original, objectExists: true)
          ..replacementDuringStorageDelete = replacement;

        await expectLater(
          RestaurantMenuService.deleteMenuImage(
            source: RestaurantMenuSource.sharedMenu('shared-e'),
            imageId: original.id,
            expectedImage: original,
            dependencies: state.dependencies,
          ),
          throwsA(isA<RestaurantMenuImageChangedException>()),
        );
        expect(state.image, same(replacement));
        expect(state.replacementObjectExists, isTrue);
        expect(state.deletedStoragePaths, <String>[original.storagePath!]);

        await expectLater(
          RestaurantMenuService.deleteMenuImage(
            source: RestaurantMenuSource.sharedMenu('shared-e'),
            imageId: original.id,
            expectedImage: original,
            dependencies: state.dependencies,
          ),
          throwsA(isA<RestaurantMenuImageChangedException>()),
        );
        expect(state.deletedStoragePaths, <String>[original.storagePath!]);
        expect(state.image, same(replacement));
        expect(state.replacementObjectExists, isTrue);
      },
    );

    test(
      'legacy image records retain their existing record-only behavior',
      () async {
        const image = RestaurantMenuImage(
          id: 'legacy-image',
          imageUrl: 'https://synthetic.invalid/legacy.jpg',
          storagePath:
              'bitesaver_restaurants/owner/menu_images/legacy-image.jpg',
          sortOrder: 1,
        );
        final state = _DeletionState(image: image, objectExists: true);

        await RestaurantMenuService.deleteMenuImage(
          source: RestaurantMenuSource.legacyBiteSaver('owner-legacy'),
          imageId: image.id,
          expectedImage: image,
          dependencies: state.dependencies,
        );

        expect(state.deletedStoragePaths, isEmpty);
        expect(state.image, isNull);
      },
    );

    test('a malformed public path is not treated as an object target', () async {
      const image = RestaurantMenuImage(
        id: 'malformed-public-image',
        imageUrl: 'https://synthetic.invalid/malformed.jpg',
        storagePath:
            ' public_menu_images/bsmia_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/image.jpg',
        sortOrder: 1,
      );
      final state = _DeletionState(image: image, objectExists: true);

      await expectLater(
        RestaurantMenuService.deleteMenuImage(
          source: RestaurantMenuSource.sharedMenu('shared-malformed'),
          imageId: image.id,
          expectedImage: image,
          dependencies: state.dependencies,
        ),
        throwsFormatException,
      );

      expect(state.deletedStoragePaths, isEmpty);
      expect(state.image, same(image));
      expect(state.objectExists, isTrue);
    });
  });
}

RestaurantMenuImage _image(String seed, {String? imageId}) {
  final authorizationId = 'bsmia_${List<String>.filled(43, seed).join()}';
  return RestaurantMenuImage(
    id: imageId ?? 'image-${seed.toLowerCase()}',
    imageUrl: 'https://synthetic.invalid/$seed.jpg',
    storagePath: 'public_menu_images/$authorizationId/image.jpg',
    sortOrder: seed.codeUnitAt(0),
  );
}

class _DeletionState {
  RestaurantMenuImage? image;
  bool objectExists;
  bool failStorage = false;
  bool failNextRecordDeletion = false;
  RestaurantMenuImage? replacementDuringStorageDelete;
  bool replacementObjectExists = false;
  int recordDeletionCalls = 0;
  final List<RestaurantMenuImageDeletionLocation> authorizedLocations = [];
  final List<String> deletedStoragePaths = [];

  _DeletionState({required this.image, required this.objectExists});

  late final RestaurantMenuImageDeletionDependencies dependencies =
      RestaurantMenuImageDeletionDependencies(
        authorize: (location) async {
          authorizedLocations.add(location);
        },
        loadRecord: (location) async => image,
        deleteStorageObject: (objectPath) async {
          deletedStoragePaths.add(objectPath);
          if (failStorage) {
            throw StateError('synthetic Storage failure');
          }
          if (!objectExists) {
            throw FirebaseException(
              plugin: 'firebase_storage',
              code: 'object-not-found',
            );
          }
          objectExists = false;
          final replacement = replacementDuringStorageDelete;
          if (replacement != null) {
            image = replacement;
            replacementObjectExists = true;
            replacementDuringStorageDelete = null;
          }
        },
        deleteRecordIfUnchanged: (location, expectedImage) async {
          recordDeletionCalls += 1;
          if (failNextRecordDeletion) {
            failNextRecordDeletion = false;
            throw StateError('synthetic record failure');
          }
          final current = image;
          if (current == null) {
            return RestaurantMenuImageRecordDeletionResult.missing;
          }
          if (!_sameImage(current, expectedImage)) {
            return RestaurantMenuImageRecordDeletionResult.changed;
          }
          image = null;
          return RestaurantMenuImageRecordDeletionResult.deleted;
        },
      );
}

bool _sameImage(RestaurantMenuImage first, RestaurantMenuImage second) {
  return first.id == second.id &&
      first.imageUrl == second.imageUrl &&
      first.storagePath == second.storagePath &&
      first.sortOrder == second.sortOrder;
}
