import 'package:coupon_app/widgets/bitescore_category_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('Section A Pizza selects directly without subcategory dropdown', (
    tester,
  ) async {
    var selection = const BitescoreCategorySelection();

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: StatefulBuilder(
            builder: (context, setState) {
              return BitescoreCategoryPicker(
                selection: selection,
                onChanged: (nextSelection) {
                  setState(() {
                    selection = nextSelection;
                  });
                },
              );
            },
          ),
        ),
      ),
    );

    await tester.tap(find.text('Choose a category'));
    await tester.pumpAndSettle();

    expect(find.text('Pizza'), findsOneWidget);
    expect(find.text('Calzone'), findsNothing);
    expect(find.text('Stromboli'), findsNothing);

    await tester.tap(find.text('Pizza'));
    await tester.pumpAndSettle();

    expect(selection.category?.id, 'pizza');
    expect(selection.subcategory, isNull);
    expect(find.text('Pizza'), findsOneWidget);
    expect(find.text('Calzone'), findsNothing);
    expect(find.text('Stromboli'), findsNothing);
  });
}
