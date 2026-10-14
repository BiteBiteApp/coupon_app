import 'dart:convert';
import 'dart:io';
import 'package:coupon_app/models/bitesaver_cuisine.dart';
import 'package:coupon_app/models/restaurant.dart';
import 'package:coupon_app/services/bitesaver_restaurant_lifecycle_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('comma parsing trims whitespace and case duplicates, empty clears', () {
    expect(
      BiteSaverCuisine.parse(' Barbecue , American,  Southern , american,, '),
      ['Barbecue', 'American', 'Southern'],
    );
    expect(BiteSaverCuisine.parse(' , , '), isEmpty);
    expect(BiteSaverCuisine.parse('New   American'), ['New American']);
  });
  test('bounded input rejects malformed, long and over-count cuisines', () {
    for (final input in [
      'x' * 101,
      'Thai\nfood',
      'Thai\u0000',
      '\uD800Thai',
      '123',
      '!!!',
      List.filled(33, 'Thai').join(','),
      'x' * 3265,
    ]) {
      expect(
        () => BiteSaverCuisine.parse(input),
        throwsFormatException,
        reason: input,
      );
    }
    expect(BiteSaverCuisine.parse('x' * 100).single.length, 100);
  });
  test(
    'older and malformed stored labels stay safe; model keeps exact account identity',
    () {
      expect(BiteSaverCuisine.fromStored(null), isEmpty);
      expect(BiteSaverCuisine.fromStored(['Thai', 2]), isEmpty);
      final r = Restaurant.fromFirestore(
        {
          'uid': 'owner',
          'cuisineTags': ['BBQ'],
        },
        documentId: 'owner-account',
        coupons: [],
      );
      expect(r.cuisineTags, ['BBQ']);
      expect(r.accountDocumentId, 'owner-account');
      expect(Restaurant.fromFirestore({}, coupons: []).cuisineTags, isEmpty);
    },
  );
  test(
    'optional callable field preserves omission and distinguishes clear',
    () {
      BiteSaverBasicInformationProfileInput input(List<String>? cuisines) =>
          BiteSaverBasicInformationProfileInput(
            streetAddress: '1 Main',
            city: 'Ocala',
            state: 'FL',
            zipCode: '34470',
            phone: '3525550100',
            website: '',
            bio: '',
            cuisineTags: cuisines,
          );
      expect(input(null).toCallableProfile(), isNot(contains('cuisineTags')));
      expect(input([]).toCallableProfile()['cuisineTags'], []);
      expect(input([' BBQ ', 'bbq']).toCallableProfile()['cuisineTags'], [
        'BBQ',
      ]);
    },
  );
  final cases =
      jsonDecode(
            File(
              'test/fixtures/bitesaver_cuisine_cases.json',
            ).readAsStringSync(),
          )
          as List;
  for (var i = 0; i < cases.length; i++) {
    final c = cases[i] as Map<String, dynamic>;
    test('shared cuisine matching case $i', () {
      expect(
        BiteSaverCuisine.matches(
          (c['cuisines'] as List).cast<String>(),
          c['query'] as String,
        ),
        c['expected'],
      );
    });
  }
}
