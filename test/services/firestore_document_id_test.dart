import 'package:coupon_app/services/firestore_document_id.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('explicitly rejects U+17B4 and U+17B5 in exact identities', () {
    for (final value in <String>[
      '\u17b4',
      '\u17b5',
      'restaurant-\u17b4-id',
      'restaurant-\u17b5-id',
    ]) {
      expect(exactFirestoreDocumentId(value), isNull, reason: value);
    }
  });

  test('preserves accepted ASCII, supplementary, and visible Khmer IDs', () {
    for (final value in <String>[
      'restaurant-ascii',
      'restaurant-😀',
      'restaurant-ក-id',
      'restaurant\u17b3id',
      'restaurant\u17b6id',
    ]) {
      expect(exactFirestoreDocumentId(value), value);
    }
  });
}
