import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/services/bitescore_owner_queries.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'owner dashboard and menu lookup query only their claimed restaurants',
    () {
      final query =
          BiteScoreOwnerQueries.restaurants(
                _FixtureQuery([
                  {'id': 'owned', 'ownerUserId': 'owner', 'isClaimed': true},
                  {
                    'id': 'unclaimed',
                    'ownerUserId': 'owner',
                    'isClaimed': false,
                  },
                  {'id': 'missing-claimed', 'ownerUserId': 'owner'},
                  {
                    'id': 'other-owner',
                    'ownerUserId': 'other',
                    'isClaimed': true,
                  },
                ]),
                userId: 'owner',
              )
              as _FixtureQuery;
      expect(query.rows.map((row) => row['id']), ['owned']);
      expect(query.filters, {'ownerUserId': 'owner', 'isClaimed': true});
    },
  );

  test(
    'restaurant entry aggregate hydration never reads another restaurant',
    () {
      final query =
          BiteScoreOwnerQueries.aggregates(
                _FixtureQuery([
                  {'dishId': 'own-dish-1', 'restaurantId': 'owned'},
                  {'dishId': 'own-dish-2', 'restaurantId': 'owned'},
                  {'dishId': 'other-dish', 'restaurantId': 'other'},
                  {'dishId': 'missing-parent'},
                ]),
                restaurantId: 'owned',
              )
              as _FixtureQuery;
      expect(query.rows.map((row) => row['dishId']), [
        'own-dish-1',
        'own-dish-2',
      ]);
      expect(query.filters, {'restaurantId': 'owned'});
    },
  );
}

// Only the public query-building boundary is simulated; Rules authorization is
// checked against Firestore separately.
// ignore: subtype_of_sealed_class
class _FixtureQuery implements Query<Map<String, dynamic>> {
  final List<Map<String, dynamic>> rows;
  final Map<String, Object?> filters;
  _FixtureQuery(this.rows, [this.filters = const {}]);

  @override
  dynamic noSuchMethod(Invocation invocation) {
    if (invocation.memberName == #where) {
      final field = invocation.positionalArguments.single as String;
      final expected = invocation.namedArguments[#isEqualTo];
      return _FixtureQuery(
        rows.where((row) => row[field] == expected).toList(),
        {...filters, field: expected},
      );
    }
    return super.noSuchMethod(invocation);
  }
}
