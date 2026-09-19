import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:coupon_app/models/dish_edit_proposal.dart';
import 'package:coupon_app/services/dish_edit_proposal_duplicate_lookup.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('complete proposal existence lookup', () {
    test('rename finds a match after more than 100 unrelated proposals', () {
      final rows = [
        ...List.generate(150, (i) => _rename(source: 'other-$i')),
        _rename(name: '  New NAME  '),
      ];
      final result = _renameQuery(rows);
      expect(result.rows, hasLength(1));
      expect(result.rows.single['canonicalSourceDishId'], 'source');
      expect(result.maximum, 1);
      expect(result.filteredFields, {
        'userId',
        'status',
        'type',
        'restaurantId',
        'canonicalSourceDishId',
        'normalizedProposedName',
      });
    });

    for (final duplicateEncoding in [false, true]) {
      test(
        'merge finds a match beyond 100 with '
        '${duplicateEncoding ? 'duplicate' : 'standard'} target encoding',
        () {
          final rows = [
            ...List.generate(151, (i) => _merge(destination: 'other-$i')),
            _merge(duplicateEncoding: duplicateEncoding),
          ];
          final result = _mergeQuery(rows);
          expect(result.rows, hasLength(1));
          expect(result.rows.single['canonicalSourceDishId'], 'source');
          expect(result.maximum, 1);
          expect(result.filteredFields, {
            'userId',
            'status',
            'type',
            'restaurantId',
            'canonicalSourceDishId',
            'mergeTargetDishId',
          });
        },
      );
    }

    test('more than 100 nonmatches do not block rename or merge', () {
      final rename = _renameQuery([
        ...List.generate(101, (i) => _rename(name: 'Different $i')),
        {..._rename(), 'userId': 'someone-else'},
        {..._rename(), 'status': 'approved'},
        {..._rename(), 'type': 'merge'},
        {..._rename(), 'restaurantId': 'other-restaurant'},
        _rename(source: 'different-source'),
      ]);
      final merge = _mergeQuery([
        ...List.generate(101, (i) => _merge(destination: 'different-$i')),
        {..._merge(), 'userId': 'someone-else'},
        {..._merge(), 'status': 'rejected'},
        {..._merge(), 'type': 'rename'},
        {..._merge(), 'restaurantId': 'other-restaurant'},
        _merge(source: 'different-source'),
      ]);
      expect(rename.rows, isEmpty);
      expect(merge.rows, isEmpty);
    });

    test(
      'same-name distinct dish identities and merge directions stay distinct',
      () {
        expect(
          _renameQuery([_rename(source: 'same-name-other-id')]).rows,
          isEmpty,
        );
        expect(
          _mergeQuery([
            _merge(source: 'same-name-other-id'),
            _merge(destination: 'same-name-other-destination'),
            _merge(source: 'destination', destination: 'source'),
          ]).rows,
          isEmpty,
        );
      },
    );

    test(
      'rename normalization preserves existing internal whitespace semantics',
      () {
        expect(_renameQuery([_rename(name: 'NEW NAME')]).rows, hasLength(1));
        expect(_renameQuery([_rename(name: 'New  Name')]).rows, isEmpty);
      },
    );

    test(
      'limit follows the complete predicate even with multiple true matches',
      () {
        expect(_renameQuery([_rename(), _rename()]).rows, hasLength(1));
        expect(_mergeQuery([_merge(), _merge()]).rows, hasLength(1));
      },
    );
  });

  test(
    'long UTF-8 rename finds a full-name match after 100 scoped rows',
    () async {
      final prefix = List.filled(800, 'é').join();
      final requests = <int>[];
      final rows = [
        for (var i = 0; i < 126; i++)
          {
            ..._rename(name: '$prefix other-$i'),
            'id': 'p${i.toString().padLeft(3, '0')}',
          },
        {..._rename(name: '$prefix exact'), 'id': 'p999'},
      ];
      expect(
        await DishEditProposalDuplicateLookup.renameExists(
          _FixtureQuery(rows, requests: requests),
          userId: 'user',
          restaurantId: 'restaurant',
          sourceDishId: 'source',
          proposedName: '$prefix exact',
        ),
        isTrue,
      );
      expect(requests, [25, 25, 25, 25, 25, 2]);
    },
  );

  test(
    'long rename exhausts pages without a false truncated-prefix match',
    () async {
      final prefix = List.filled(1501, 'a').join();
      final requests = <int>[];
      expect(
        await DishEditProposalDuplicateLookup.renameExists(
          _FixtureQuery([
            for (var i = 0; i < 125; i++)
              {
                ..._rename(name: '$prefix other-$i'),
                'id': 'p${i.toString().padLeft(3, '0')}',
              },
            {
              ..._rename(source: 'distinct-source', name: '$prefix exact'),
              'id': 'other',
            },
          ], requests: requests),
          userId: 'user',
          restaurantId: 'restaurant',
          sourceDishId: 'source',
          proposedName: '$prefix exact',
        ),
        isFalse,
      );
      expect(requests, [25, 25, 25, 25, 25, 0]);
    },
  );

  test(
    'normal rename existence returns at most one fully filtered row',
    () async {
      final requests = <int>[];
      expect(
        await DishEditProposalDuplicateLookup.renameExists(
          _FixtureQuery([
            ...List.generate(151, (i) => _rename(source: 'other-$i')),
            _rename(),
            _rename(),
          ], requests: requests),
          userId: 'user',
          restaurantId: 'restaurant',
          sourceDishId: 'source',
          proposedName: 'New Name',
        ),
        isTrue,
      );
      expect(requests, [1]);
    },
  );

  for (final hasExactMatch in [false, true]) {
    test(
      'exact 1500-byte rename ignores longer same-prefix names '
      'and ${hasExactMatch ? 'finds the complete match' : 'exhausts safely'}',
      () async {
        final prefix = List.filled(1500, 'a').join();
        final requests = <int>[];
        expect(
          await DishEditProposalDuplicateLookup.renameExists(
            _FixtureQuery([
              for (var i = 0; i < 126; i++)
                {
                  ..._rename(name: '$prefix suffix-$i'),
                  'id': 'p${i.toString().padLeft(3, '0')}',
                },
              if (hasExactMatch) {..._rename(name: prefix), 'id': 'p999'},
            ], requests: requests),
            userId: 'user',
            restaurantId: 'restaurant',
            sourceDishId: 'source',
            proposedName: prefix,
          ),
          hasExactMatch,
        );
        expect(requests, [25, 25, 25, 25, 25, hasExactMatch ? 2 : 1]);
      },
    );
  }

  test('modern proposal metadata preserves canonical resolver inputs', () {
    final rename = _rename(name: '  New Name  ');
    expect(rename['proposedName'], 'New Name');
    expect(rename['normalizedProposedName'], 'new name');
    expect(rename['canonicalSourceDishId'], rename['targetDishId']);

    final standard = _merge();
    final duplicate = _merge(duplicateEncoding: true);
    expect(standard['targetDishId'], 'source');
    expect(standard.containsKey('sourceDishId'), isFalse);
    expect(duplicate['targetDishId'], 'destination');
    expect(duplicate['sourceDishId'], 'source');
    for (final data in [standard, duplicate]) {
      final parsed = DishEditProposal.tryFromFirestore(data, fallbackId: 'p')!;
      expect(parsed.targetDishId, 'source');
      expect(parsed.mergeTargetDishId, 'destination');
      expect(data['canonicalSourceDishId'], parsed.targetDishId);
    }
  });
}

Map<String, dynamic> _rename({
  String source = 'source',
  String name = 'New Name',
}) => DishEditProposal(
  id: 'proposal',
  type: DishEditProposal.typeRename,
  restaurantId: 'restaurant',
  targetDishId: source,
  proposedName: name,
  userId: 'user',
).toFirestoreMap();

Map<String, dynamic> _merge({
  String source = 'source',
  String destination = 'destination',
  bool duplicateEncoding = false,
}) => {
  ...DishEditProposal(
    id: 'proposal',
    type: DishEditProposal.typeMerge,
    restaurantId: 'restaurant',
    targetDishId: source,
    mergeTargetDishId: destination,
    userId: 'user',
  ).toFirestoreMap(),
  if (duplicateEncoding) ...{
    'sourceDishId': source,
    'targetDishId': destination,
    'reason': 'duplicate',
  },
};

_FixtureQuery _renameQuery(List<Map<String, dynamic>> rows) =>
    DishEditProposalDuplicateLookup.rename(
          _FixtureQuery(rows),
          userId: 'user',
          restaurantId: 'restaurant',
          sourceDishId: 'source',
          proposedName: '  NEW NAME  ',
        )
        as _FixtureQuery;

_FixtureQuery _mergeQuery(List<Map<String, dynamic>> rows) =>
    DishEditProposalDuplicateLookup.merge(
          _FixtureQuery(rows),
          userId: 'user',
          restaurantId: 'restaurant',
          sourceDishId: 'source',
          mergeTargetDishId: 'destination',
        )
        as _FixtureQuery;

// A query-boundary fixture applies each actual production filter and limit in
// order. Firestore authorization is exercised separately by the Rules emulator.
// ignore: subtype_of_sealed_class
class _FixtureQuery implements Query<Map<String, dynamic>> {
  final List<Map<String, dynamic>> _rows;
  final Set<String> filteredFields;
  final int? maximum;
  final List<int> requests;

  List<Map<String, dynamic>> get rows =>
      maximum == null ? _rows : _rows.take(maximum!).toList();

  _FixtureQuery(
    this._rows, {
    this.filteredFields = const {},
    this.maximum,
    List<int>? requests,
  }) : requests = requests ?? [];

  @override
  dynamic noSuchMethod(Invocation invocation) {
    if (invocation.memberName == #where) {
      expect(
        maximum,
        isNull,
        reason: 'filtering must precede the result limit',
      );
      final field = invocation.positionalArguments.single as String;
      final expected = invocation.namedArguments[#isEqualTo];
      return _FixtureQuery(
        _rows.where((row) => row[field] == expected).toList(),
        filteredFields: {...filteredFields, field},
        requests: requests,
      );
    }
    if (invocation.memberName == #limit) {
      final limit = invocation.positionalArguments.single as int;
      return _FixtureQuery(
        _rows,
        filteredFields: filteredFields,
        maximum: limit,
        requests: requests,
      );
    }
    if (invocation.memberName == #orderBy) {
      expect(invocation.positionalArguments.single, FieldPath.documentId);
      final sorted = [..._rows]
        ..sort((a, b) => (a['id'] as String).compareTo(b['id'] as String));
      return _FixtureQuery(
        sorted,
        filteredFields: filteredFields,
        maximum: maximum,
        requests: requests,
      );
    }
    if (invocation.memberName == #startAfterDocument) {
      final cursor =
          invocation.positionalArguments.single
              as QueryDocumentSnapshot<Map<String, dynamic>>;
      return _FixtureQuery(
        _rows
            .where((row) => (row['id'] as String).compareTo(cursor.id) > 0)
            .toList(),
        filteredFields: filteredFields,
        maximum: maximum,
        requests: requests,
      );
    }
    if (invocation.memberName == #get) {
      expect(maximum, anyOf(1, 25));
      requests.add(rows.length);
      return Future<QuerySnapshot<Map<String, dynamic>>>.value(
        _FixtureSnapshot(rows.map(_FixtureDocument.new).toList()),
      );
    }
    return super.noSuchMethod(invocation);
  }
}

// ignore: subtype_of_sealed_class
class _FixtureSnapshot extends Fake
    implements QuerySnapshot<Map<String, dynamic>> {
  @override
  final List<QueryDocumentSnapshot<Map<String, dynamic>>> docs;
  _FixtureSnapshot(this.docs);
}

// ignore: subtype_of_sealed_class
class _FixtureDocument extends Fake
    implements QueryDocumentSnapshot<Map<String, dynamic>> {
  final Map<String, dynamic> _data;
  _FixtureDocument(this._data);
  @override
  String get id => _data['id'] as String;
  @override
  Map<String, dynamic> data() => _data;
}
