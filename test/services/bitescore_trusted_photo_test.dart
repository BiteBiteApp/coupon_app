import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/models/bitescore_dish_image.dart';
import 'package:coupon_app/services/bitescore_service.dart';
import 'package:flutter_test/flutter_test.dart';

const imageUrl =
    'https://firebasestorage.googleapis.com/v0/b/demo.firebasestorage.app/o/bitescore_dishes%2Fdish%2Fimages%2F1.jpg?alt=media&token=public';
const image = BiteScoreDishImage(
  id: 'image',
  dishId: 'dish',
  restaurantId: 'restaurant',
  uploadedByUserId: '',
  imageUrl: imageUrl,
  storagePath: '',
);
Map<String, Object?> response({String? voteType}) => {
  'schemaVersion': 1,
  'currentUserVoteType': voteType,
  'image': {
    'id': 'image',
    'dishId': 'dish',
    'restaurantId': 'restaurant',
    'reviewId': null,
    'imageUrl': imageUrl,
    'sortOrder': 0,
    'helpfulCount': 4,
    'notHelpfulCount': 2,
    'createdAtMs': 1000,
    'uploadedByUserId': 'private foreign uploader',
    'storagePath': 'private internal path',
  },
};
void main() {
  test(
    'trusted photo metadata sends only target inputs and keeps caller-owned upload attribution',
    () async {
      final actual = await BiteScoreService.createPhotoWithTrustedMetadata(
        imageId: 'image',
        dishId: 'dish',
        restaurantId: 'restaurant',
        uploadedByUserId: 'user',
        imageUrl: imageUrl,
        storagePath: 'bitescore_dishes/dish/images/1.jpg',
        mode: 'gallery',
        transport: (name, request) async {
          expect(name, 'createCustomerBiteScorePhoto');
          expect(request.keys.toSet(), {
            'schemaVersion',
            'expectedUserId',
            'imageId',
            'dishId',
            'restaurantId',
            'reviewId',
            'imageUrl',
            'storagePath',
            'mode',
          });
          expect(request['expectedUserId'], 'user');
          expect(request.containsKey('uploadedByUserId'), false);
          expect(request.containsKey('helpfulCount'), false);
          return response();
        },
      );
      expect(actual.uploadedByUserId, 'user');
      expect(actual.storagePath, 'bitescore_dishes/dish/images/1.jpg');
      expect(actual.id, 'image');
    },
  );
  test(
    'trusted photo vote consumes public target result without uploader/storage disclosure',
    () async {
      final result = await BiteScoreService.voteForPhotoWithTrustedMetadata(
        expectedUserId: 'user',
        image: image,
        voteType: 'helpful',
        transport: (name, request) async {
          expect(name, 'toggleCustomerBiteScorePhotoVote');
          expect(request, {
            'schemaVersion': 1,
            'expectedUserId': 'user',
            'imageId': 'image',
            'dishId': 'dish',
            'restaurantId': 'restaurant',
            'voteType': 'helpful',
          });
          return response(voteType: 'helpful');
        },
      );
      expect(result.image.helpfulCount, 4);
      expect(result.currentUserVoteType, 'helpful');
      expect(result.image.uploadedByUserId, isEmpty);
      expect(result.image.storagePath, isEmpty);
    },
  );
  test(
    'trusted photo responses reject cross-parent identities and invalid counts',
    () async {
      for (final change in [
        {'dishId': 'other'},
        {'restaurantId': 'other'},
        {'id': 'image '},
        {'helpfulCount': -1},
        {'createdAtMs': '1000'},
      ]) {
        final raw = response(voteType: 'helpful');
        (raw['image']! as Map).addAll(change);
        await expectLater(
          BiteScoreService.voteForPhotoWithTrustedMetadata(
            expectedUserId: 'user',
            image: image,
            voteType: 'helpful',
            transport: (_, _) async => raw,
          ),
          throwsFormatException,
        );
      }
      final raw = response();
      (raw['image']! as Map)['reviewId'] = 'foreign';
      await expectLater(
        BiteScoreService.createPhotoWithTrustedMetadata(
          imageId: 'image',
          dishId: 'dish',
          restaurantId: 'restaurant',
          uploadedByUserId: 'user',
          imageUrl: imageUrl,
          storagePath: 'path',
          mode: 'gallery',
          transport: (_, _) async => raw,
        ),
        throwsFormatException,
      );
    },
  );
  test(
    'trusted photo failure propagates without a raw-image fallback',
    () async {
      var calls = 0;
      await expectLater(
        BiteScoreService.voteForPhotoWithTrustedMetadata(
          expectedUserId: 'user',
          image: image,
          voteType: 'helpful',
          transport: (_, _) async {
            calls++;
            throw StateError('denied');
          },
        ),
        throwsStateError,
      );
      expect(calls, 1);
    },
  );
  test(
    'photo own-vote query scopes complete canonical ID set and user before limit',
    () {
      final query = _Query();
      final result = BiteScoreService.currentUserPhotoVoteQuery(
        query,
        userId: 'user',
        voteDocumentIds: ['present_user', 'missing_user'],
      );
      expect(identical(query, result), true);
      expect(query.filters, [
        [
          FieldPath.documentId,
          ['present_user', 'missing_user'],
        ],
        ['userId', 'user'],
      ]);
      expect(query.maximum, 25);
      expect(
        () => BiteScoreService.currentUserPhotoVoteQuery(
          query,
          userId: 'user',
          voteDocumentIds: [],
        ),
        throwsArgumentError,
      );
      expect(
        () => BiteScoreService.currentUserPhotoVoteQuery(
          query,
          userId: 'user',
          voteDocumentIds: List.filled(26, 'image_user'),
        ),
        throwsArgumentError,
      );
    },
  );
}

// A query-plan spy records the exact bounded Firestore API contract without IO.
// ignore: subtype_of_sealed_class
class _Query extends Fake implements Query<Map<String, dynamic>> {
  final filters = <List<Object?>>[];
  final limits = <int>[];
  int? get maximum => limits.isEmpty ? null : limits.last;
  @override
  Query<Map<String, dynamic>> where(
    Object field, {
    Object? isEqualTo,
    Object? isNotEqualTo,
    Object? isLessThan,
    Object? isLessThanOrEqualTo,
    Object? isGreaterThan,
    Object? isGreaterThanOrEqualTo,
    Object? arrayContains,
    Iterable<Object?>? arrayContainsAny,
    Iterable<Object?>? whereIn,
    Iterable<Object?>? whereNotIn,
    bool? isNull,
  }) {
    filters.add([field, whereIn?.toList() ?? isEqualTo]);
    return this;
  }

  @override
  Query<Map<String, dynamic>> limit(int limit) {
    limits.add(limit);
    return this;
  }
}
