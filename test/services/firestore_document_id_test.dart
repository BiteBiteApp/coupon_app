import 'package:coupon_app/services/firestore_document_id.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('rejects Khmer Unicode format controls in Firestore identities', () {
    expect(exactFirestoreDocumentId('restaurant\u17b4id'), isNull);
    expect(exactFirestoreDocumentId('restaurant\u17b5id'), isNull);
  });

  test('preserves neighboring valid Khmer code points exactly', () {
    expect(
      exactFirestoreDocumentId('restaurant\u17b3id'),
      'restaurant\u17b3id',
    );
    expect(
      exactFirestoreDocumentId('restaurant\u17b6id'),
      'restaurant\u17b6id',
    );
  });
}
