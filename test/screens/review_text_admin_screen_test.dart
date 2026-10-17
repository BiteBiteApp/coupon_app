import 'dart:async';
import 'package:coupon_app/screens/review_text_admin_screen.dart';
import 'package:coupon_app/services/review_text_moderation_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
final item = {'createdAtMillis': DateTime.now().subtract(const Duration(days: 2)).millisecondsSinceEpoch, 'expiresAtMillis': DateTime.now().add(const Duration(days: 28)).millisecondsSinceEpoch, 'reviewId': 'review', 'dishId': 'dish', 'restaurantId': 'restaurant', 'userId': 'writer', 'version': 'exact-version', 'status': 'pending', 'headline': 'Proposed headline', 'notes': 'Private proposed notes', 'signal': null, 'policyVersion': 'openai-clean-or-human-v1'};
void main() {
  testWidgets('shows original age/deadline and clears expired raw words without another query', (tester) async {
    var now=DateTime(2026,10,16,12);var calls=0;
    final expiring={...item,'createdAtMillis':now.subtract(const Duration(days:30)).add(const Duration(seconds:2)).millisecondsSinceEpoch,'expiresAtMillis':now.add(const Duration(seconds:2)).millisecondsSinceEpoch};
    final service=ReviewTextModerationService(currentUserId:()=> 'admin',transport:(_,__)async{calls++;return {'schemaVersion':1,'items':[expiring],'nextCursor':null};});
    await tester.pumpWidget(MaterialApp(home:ReviewTextAdminScreen(service:service,expectedUid:'admin',authChanges:const Stream.empty(),now:()=>now)));
    await tester.pumpAndSettle();expect(find.textContaining('Submitted:'),findsOneWidget);expect(find.textContaining('Age: 29 days'),findsOneWidget);expect(find.textContaining('Expires:'),findsOneWidget);
    now=now.add(const Duration(seconds:2));await tester.pump(const Duration(seconds:2));
    expect(find.textContaining('Private proposed notes'),findsNothing);expect(find.text('Approve words'),findsNothing);expect(calls,1);
  });

  for (final action in ['approve', 'reject']) testWidgets('$action sends exact version; pagination replaces bounded page', (tester) async {
    final requests = <Map<String, Object?>>[];
    final service = ReviewTextModerationService(currentUserId: () => 'admin', transport: (name, data) async {
      requests.add(data);
      if (name == 'listBiteScoreReviewText') return {'schemaVersion':1,'items':data['cursor'] == null ? [item] : [],'nextCursor':data['cursor'] == null ? 'page-2' : null};
      expect(data['version'],'exact-version');expect(data['action'],action);return {'schemaVersion':1,'status':action=='approve'?'published':'rejected'};
    });
    await tester.pumpWidget(MaterialApp(home: ReviewTextAdminScreen(service:service,expectedUid:'admin',authChanges:const Stream.empty())));await tester.pumpAndSettle();
    expect(find.textContaining('Private proposed notes'),findsOneWidget);
    final button=find.text(action=='approve'?'Approve words':'Reject words');await tester.ensureVisible(button);await tester.tap(button);await tester.pumpAndSettle();expect(find.textContaining('Rating unchanged.'),findsOneWidget);
    await tester.ensureVisible(find.text('Next page'));await tester.tap(find.text('Next page'));await tester.pumpAndSettle();expect(find.textContaining('Private proposed notes'),findsNothing);expect(requests.last['cursor'],'page-2');
  });
  testWidgets('account change clears rendered private words and ignores late queue result', (tester) async {
    var uid='admin';final changes=StreamController<String?>.broadcast(sync:true);addTearDown(changes.close);final pending=Completer<Object?>();var calls=0;
    final service=ReviewTextModerationService(currentUserId:()=>uid,transport:(_,__)async{calls++;return calls==1?{'schemaVersion':1,'items':[item],'nextCursor':null}:pending.future;});
    await tester.pumpWidget(MaterialApp(home:ReviewTextAdminScreen(service:service,expectedUid:'admin',authChanges:changes.stream)));await tester.pumpAndSettle();expect(find.textContaining('Private proposed notes'),findsOneWidget);
    await tester.ensureVisible(find.text('Refresh'));await tester.tap(find.text('Refresh'));await tester.pump();uid='other';changes.add(uid);pending.complete({'schemaVersion':1,'items':[item],'nextCursor':null});await tester.pumpAndSettle();expect(find.textContaining('Private proposed notes'),findsNothing);expect(find.text('Approve words'),findsNothing);
  });
  testWidgets('stale decision displays actionable error', (tester) async {
    final service=ReviewTextModerationService(currentUserId:()=> 'admin',transport:(name,_)async{if(name=='listBiteScoreReviewText')return {'schemaVersion':1,'items':[item],'nextCursor':null};throw StateError('stale');});
    await tester.pumpWidget(MaterialApp(home:ReviewTextAdminScreen(service:service,expectedUid:'admin',authChanges:const Stream.empty())));await tester.pumpAndSettle();await tester.ensureVisible(find.text('Approve words'));await tester.tap(find.text('Approve words'));await tester.pumpAndSettle();expect(find.byKey(const Key('text-moderation-error')),findsOneWidget);
  });
}
