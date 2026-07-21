import 'dart:async';
import 'dart:convert';

import 'package:coupon_app/models/admin_restaurant_link_record.dart';
import 'package:coupon_app/screens/admin_link_generation_screen.dart';
import 'package:coupon_app/services/admin_link_generation_service.dart';
import 'package:coupon_app/services/restaurant_invite_service.dart';
import 'package:coupon_app/services/restaurant_qr_export.dart';
import 'package:coupon_app/services/restaurant_qr_image_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('initial state gives instructions and performs no search', (
    tester,
  ) async {
    var calls = 0;
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async {
            calls += 1;
            return _result();
          },
    );

    expect(
      find.text('Enter a ZIP code or City, ST to find restaurants.'),
      findsOneWidget,
    );
    expect(calls, 0);
  });

  testWidgets('invalid location is rejected before search', (tester) async {
    var calls = 0;
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async {
            calls += 1;
            return _result();
          },
    );

    await _submitSearch(tester, location: 'Crystal River');

    expect(
      find.text('Enter a five-digit ZIP code or City, ST.'),
      findsOneWidget,
    );
    expect(calls, 0);
  });

  testWidgets('keyboard search action submits a valid ZIP', (tester) async {
    var calls = 0;
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async {
            calls += 1;
            return _result();
          },
    );

    await tester.enterText(
      find.byKey(const ValueKey('admin-link-location-field')),
      '34428',
    );
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();

    expect(calls, 1);
  });

  testWidgets('submits City, ST, radius, optional name, and selected source', (
    tester,
  ) async {
    String? capturedLocation;
    String? capturedName;
    int? capturedRadius;
    Set<AdminRestaurantLinkSource>? capturedSources;
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async {
            capturedLocation = locationQuery;
            capturedName = restaurantName;
            capturedRadius = radiusMiles;
            capturedSources = sources;
            return _result();
          },
    );

    await tester.enterText(
      find.byKey(const ValueKey('admin-link-location-field')),
      'Crystal River, FL',
    );
    await tester.enterText(
      find.byKey(const ValueKey('admin-link-restaurant-name-field')),
      'River Grill',
    );
    await tester.tap(find.byKey(const ValueKey('admin-link-radius-field')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('20 miles').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('admin-link-source-biteSaver')));
    await tester.tap(find.byKey(const ValueKey('admin-link-search-button')));
    await tester.pumpAndSettle();

    expect(capturedLocation, 'Crystal River, FL');
    expect(capturedName, 'River Grill');
    expect(capturedRadius, 20);
    expect(capturedSources, {AdminRestaurantLinkSource.biteScore});
  });

  testWidgets('source controls always retain at least one selected source', (
    tester,
  ) async {
    await _pumpScreen(tester, search: _emptySearch);

    await tester.tap(find.byKey(const ValueKey('admin-link-source-biteScore')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('admin-link-source-biteSaver')));
    await tester.pump();

    final biteSaverChip = tester.widget<FilterChip>(
      find.byKey(const ValueKey('admin-link-source-biteSaver')),
    );
    expect(biteSaverChip.selected, isTrue);
    expect(find.text('Select at least one restaurant source.'), findsOneWidget);
  });

  testWidgets('loading state prevents duplicate submissions', (tester) async {
    final completer = Completer<AdminRestaurantLinkSearchResult>();
    var calls = 0;
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) {
            calls += 1;
            return completer.future;
          },
    );

    await tester.enterText(
      find.byKey(const ValueKey('admin-link-location-field')),
      '34428',
    );
    await tester.tap(find.byKey(const ValueKey('admin-link-search-button')));
    await tester.pump();

    expect(
      find.byKey(const ValueKey('admin-link-loading-state')),
      findsOneWidget,
    );
    final button = tester.widget<FilledButton>(
      find.byKey(const ValueKey('admin-link-search-button')),
    );
    expect(button.onPressed, isNull);
    expect(calls, 1);

    completer.complete(_result());
    await tester.pumpAndSettle();
    expect(calls, 1);
  });

  testWidgets('shows no-results, backend-error, and truncation states', (
    tester,
  ) async {
    await _pumpScreen(tester, search: _emptySearch);
    await _submitSearch(tester);
    expect(
      find.text('No matching restaurants were found within this search area.'),
      findsOneWidget,
    );

    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async => throw const AdminLinkGenerationException(
            'Restaurant search is temporarily unavailable.',
          ),
    );
    await _submitSearch(tester);
    expect(
      find.text('Restaurant search is temporarily unavailable.'),
      findsOneWidget,
    );

    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async => _result(
            records: [_biteScoreRecord(documentId: 'limited')],
            truncated: true,
          ),
    );
    await _submitSearch(tester);
    expect(
      find.text(
        'Results were limited. Narrow the radius or add a restaurant name to refine the search.',
      ),
      findsOneWidget,
    );
  });

  testWidgets('same-name BiteScore and BiteSaver records remain separate', (
    tester,
  ) async {
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async => _result(
            records: [
              _biteScoreRecord(documentId: 'score-doc'),
              _biteSaverRecord(
                documentId: 'saver-doc',
                actionId: 'account-uid',
              ),
            ],
          ),
    );

    await _submitSearch(tester);

    expect(find.text('River Grill'), findsNWidgets(2));
    expect(
      find.byKey(const ValueKey('admin-link-record-biteScore:score-doc')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('admin-link-record-biteSaver:saver-doc')),
      findsOneWidget,
    );
    expect(find.text('1 Main Street'), findsNWidgets(2));
    expect(find.text('1.3 miles away'), findsOneWidget);
    expect(find.text('1.5 miles away'), findsOneWidget);
  });

  testWidgets('responsive controls and actions do not overflow', (
    tester,
  ) async {
    final sizes = <Size>[
      const Size(320, 700),
      const Size(800, 360),
      const Size(1400, 900),
    ];
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    for (var index = 0; index < sizes.length; index += 1) {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = sizes[index];
      await _pumpScreen(
        tester,
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
            }) async => _result(
              records: [_biteScoreRecord(documentId: 'responsive-$index')],
            ),
        textScale: index == 0 ? 2 : 1,
        configureView: false,
      );
      await _submitSearch(tester);
      expect(tester.takeException(), isNull, reason: '${sizes[index]}');
    }
  });

  testWidgets('BiteScore actions use safe prefill and actual document ID', (
    tester,
  ) async {
    Map<String, Object?>? couponArguments;
    String? claimRestaurantId;
    final copiedLinks = <String>[];
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async => _result(
            records: [_biteScoreRecord(documentId: 'actual-score-doc')],
          ),
      createCouponInvite:
          ({
            required restaurantName,
            required restaurantId,
            required streetAddress,
            required city,
            required state,
            required zipCode,
            required phone,
            required website,
            required latitude,
            required longitude,
          }) async {
            couponArguments = {
              'restaurantName': restaurantName,
              'restaurantId': restaurantId,
              'streetAddress': streetAddress,
              'city': city,
              'state': state,
              'zipCode': zipCode,
              'phone': phone,
              'website': website,
              'latitude': latitude,
              'longitude': longitude,
            };
            return _invite(
              'https://go.bitestar.app/invite/coupon/secure-token',
            );
          },
      createClaimInvite: ({required restaurantId}) async {
        claimRestaurantId = restaurantId;
        return _invite('https://go.bitestar.app/invite/bitescore/claim-token');
      },
      writeClipboard: (value) async => copiedLinks.add(value),
    );
    await _submitSearch(tester);

    final couponButton = find.byKey(
      const ValueKey('biteScore:actual-score-doc:coupon-invite'),
    );
    await tester.ensureVisible(couponButton);
    await tester.tap(couponButton);
    await _pumpOpenDialog(tester);

    expect(couponArguments?['restaurantId'], isNull);
    expect(couponArguments?['restaurantName'], 'River Grill');
    expect(couponArguments?['streetAddress'], '1 Main Street');
    expect(
      find.byKey(const ValueKey('admin-secure-invite-url')),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const ValueKey('copy-secure-invite-link')));
    await tester.pump();
    expect(copiedLinks, ['https://go.bitestar.app/invite/coupon/secure-token']);
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('admin-secure-invite-url')), findsNothing);

    final claimButton = find.byKey(
      const ValueKey('biteScore:actual-score-doc:claim-invite'),
    );
    await tester.ensureVisible(claimButton);
    await tester.tap(claimButton);
    await _pumpOpenDialog(tester);
    expect(claimRestaurantId, 'actual-score-doc');
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();
  });

  testWidgets('claimed BiteScore record cannot generate a claim invite', (
    tester,
  ) async {
    var claimCalls = 0;
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async => _result(
            records: [
              _biteScoreRecord(documentId: 'claimed-doc', isClaimed: true),
            ],
          ),
      createClaimInvite: ({required restaurantId}) async {
        claimCalls += 1;
        return _invite('https://go.bitestar.app/invite/bitescore/token');
      },
    );

    await _submitSearch(tester);

    expect(find.text('Already claimed'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('biteScore:claimed-doc:claim-invite')),
      findsNothing,
    );
    expect(claimCalls, 0);
  });

  testWidgets('customer links use source-specific existing URL helpers', (
    tester,
  ) async {
    final copied = <String>[];
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async => _result(
            records: [
              _biteScoreRecord(documentId: 'score-link-doc'),
              _biteSaverRecord(
                documentId: 'saver-link-doc',
                actionId: 'canonical-account-uid',
                approvalStatus: 'approved',
              ),
              _biteSaverRecord(
                documentId: 'pending-doc',
                actionId: 'pending-uid',
                approvalStatus: 'pending',
              ),
            ],
          ),
      writeClipboard: (value) async => copied.add(value),
    );
    await _submitSearch(tester);

    final biteScoreCopy = find.byKey(
      const ValueKey('biteScore:score-link-doc:customer-link'),
    );
    await tester.ensureVisible(biteScoreCopy);
    await tester.tap(biteScoreCopy);
    await tester.pump();

    final biteSaverCopy = find.byKey(
      const ValueKey('biteSaver:saver-link-doc:customer-link'),
    );
    await tester.ensureVisible(biteSaverCopy);
    await tester.tap(biteSaverCopy);
    await tester.pump();

    expect(copied, [
      'https://go.bitestar.app/r/bitescore/score-link-doc',
      'https://go.bitestar.app/r/coupons/canonical-account-uid',
    ]);
    final pendingButton = tester.widget<OutlinedButton>(
      find.byKey(const ValueKey('biteSaver:pending-doc:customer-link')),
    );
    expect(pendingButton.onPressed, isNull);

    final saverCard = find.byKey(
      const ValueKey('admin-link-record-biteSaver:saver-link-doc'),
    );
    expect(
      find.descendant(
        of: saverCard,
        matching: find.text('Generate BiteScore Claim Invite'),
      ),
      findsNothing,
    );
    expect(
      find.descendant(
        of: saverCard,
        matching: find.text('Copy Customer BiteScore Link'),
      ),
      findsNothing,
    );
  });

  testWidgets('BiteSaver coupon invite uses canonical action ID', (
    tester,
  ) async {
    String? capturedRestaurantId;
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async => _result(
            records: [
              _biteSaverRecord(
                documentId: 'account-document',
                actionId: 'canonical-account-uid',
                approvalStatus: 'approved',
              ),
            ],
          ),
      createCouponInvite:
          ({
            required restaurantName,
            required restaurantId,
            required streetAddress,
            required city,
            required state,
            required zipCode,
            required phone,
            required website,
            required latitude,
            required longitude,
          }) async {
            capturedRestaurantId = restaurantId;
            return _invite('https://go.bitestar.app/invite/coupon/token');
          },
    );

    await _submitSearch(tester);
    final button = find.byKey(
      const ValueKey('biteSaver:account-document:coupon-invite'),
    );
    await tester.ensureVisible(button);
    await tester.tap(button);
    await _pumpOpenDialog(tester);

    expect(capturedRestaurantId, 'canonical-account-uid');
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();
  });

  testWidgets(
    'clipboard failures show controlled feedback for both link types',
    (tester) async {
      await _pumpScreen(
        tester,
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
            }) async => _result(
              records: [_biteScoreRecord(documentId: 'clipboard-doc')],
            ),
        createCouponInvite:
            ({
              required restaurantName,
              required restaurantId,
              required streetAddress,
              required city,
              required state,
              required zipCode,
              required phone,
              required website,
              required latitude,
              required longitude,
            }) async => _invite('https://go.bitestar.app/invite/coupon/token'),
        writeClipboard: (_) async => throw StateError('clipboard denied'),
      );
      await _submitSearch(tester);

      final customerCopy = find.byKey(
        const ValueKey('biteScore:clipboard-doc:customer-link'),
      );
      await tester.ensureVisible(customerCopy);
      await tester.tap(customerCopy);
      await tester.pump();
      expect(find.text('Could not copy the customer link.'), findsOneWidget);

      final inviteButton = find.byKey(
        const ValueKey('biteScore:clipboard-doc:coupon-invite'),
      );
      await tester.ensureVisible(inviteButton);
      await tester.tap(inviteButton);
      await _pumpOpenDialog(tester);
      await tester.tap(find.byKey(const ValueKey('copy-secure-invite-link')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 600));
      expect(find.text('Could not copy the invite link.'), findsOneWidget);
      await tester.tap(find.text('Close'));
      await tester.pumpAndSettle();
    },
  );

  testWidgets(
    'customer QR actions use existing helper URLs and approval eligibility',
    (tester) async {
      final rendered =
          <
            ({String restaurantName, String url, RestaurantQrLinkType linkType})
          >[];
      await _pumpScreen(
        tester,
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
            }) async => _result(
              records: [
                _biteScoreRecord(
                  documentId: 'score-qr-doc',
                  name: 'Score Place',
                ),
                _biteSaverRecord(
                  documentId: 'saver-qr-doc',
                  actionId: 'approved-account-uid',
                  approvalStatus: 'approved',
                ),
                _biteSaverRecord(
                  documentId: 'pending-qr-doc',
                  actionId: 'pending-account-uid',
                ),
              ],
            ),
        renderQrImage:
            ({required restaurantName, required url, required linkType}) async {
              rendered.add((
                restaurantName: restaurantName,
                url: url,
                linkType: linkType,
              ));
              return _qrImage(restaurantName, linkType);
            },
      );
      await _submitSearch(tester);

      final scoreQr = find.byKey(
        const ValueKey('biteScore:score-qr-doc:customer-qr'),
      );
      await tester.ensureVisible(scoreQr);
      await tester.tap(scoreQr);
      await _pumpOpenDialog(tester);
      expect(
        find.byKey(const ValueKey('restaurant-qr-preview-dialog')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('restaurant-qr-sensitive-warning')),
        findsNothing,
      );
      await tester.tap(
        find.byKey(const ValueKey('restaurant-qr-preview-close')),
      );
      await tester.pumpAndSettle();

      final saverQr = find.byKey(
        const ValueKey('biteSaver:saver-qr-doc:customer-qr'),
      );
      await tester.ensureVisible(saverQr);
      await tester.tap(saverQr);
      await _pumpOpenDialog(tester);
      await tester.tap(
        find.byKey(const ValueKey('restaurant-qr-preview-close')),
      );
      await tester.pumpAndSettle();

      expect(
        find.byKey(const ValueKey('biteSaver:pending-qr-doc:customer-qr')),
        findsNothing,
      );
      expect(rendered, [
        (
          restaurantName: 'Score Place',
          url: 'https://go.bitestar.app/r/bitescore/score-qr-doc',
          linkType: RestaurantQrLinkType.customerBiteScore,
        ),
        (
          restaurantName: 'River Grill',
          url: 'https://go.bitestar.app/r/coupons/approved-account-uid',
          linkType: RestaurantQrLinkType.customerBiteSaver,
        ),
      ]);
    },
  );

  testWidgets('secure invite QR reuses each invitation URL exactly once', (
    tester,
  ) async {
    var couponCalls = 0;
    var claimCalls = 0;
    final rendered =
        <
          ({String restaurantName, String url, RestaurantQrLinkType linkType})
        >[];
    await _pumpScreen(
      tester,
      search:
          ({
            required locationQuery,
            required radiusMiles,
            required restaurantName,
            required sources,
          }) async => _result(
            records: [
              _biteScoreRecord(
                documentId: 'secure-qr-doc',
                name: 'Secure River Grill',
              ),
            ],
          ),
      createCouponInvite:
          ({
            required restaurantName,
            required restaurantId,
            required streetAddress,
            required city,
            required state,
            required zipCode,
            required phone,
            required website,
            required latitude,
            required longitude,
          }) async {
            couponCalls += 1;
            return _invite(
              'https://go.bitestar.app/invite/coupon/fake-secure-token',
            );
          },
      createClaimInvite: ({required restaurantId}) async {
        claimCalls += 1;
        return _invite(
          'https://go.bitestar.app/invite/bitescore/fake-claim-token',
        );
      },
      renderQrImage:
          ({required restaurantName, required url, required linkType}) async {
            rendered.add((
              restaurantName: restaurantName,
              url: url,
              linkType: linkType,
            ));
            return _qrImage(restaurantName, linkType);
          },
    );
    await _submitSearch(tester);

    final couponInvite = find.byKey(
      const ValueKey('biteScore:secure-qr-doc:coupon-invite'),
    );
    await tester.ensureVisible(couponInvite);
    await tester.tap(couponInvite);
    await _pumpOpenDialog(tester);
    expect(couponCalls, 1);
    await tester.tap(find.byKey(const ValueKey('create-secure-invite-qr')));
    await _pumpOpenDialog(tester);
    expect(
      find.byKey(const ValueKey('restaurant-qr-sensitive-warning')),
      findsOneWidget,
    );
    expect(find.textContaining('fake-secure-token'), findsNothing);
    await tester.tap(find.byKey(const ValueKey('restaurant-qr-preview-back')));
    await _pumpOpenDialog(tester);
    expect(couponCalls, 1);
    expect(
      find.byKey(const ValueKey('admin-secure-invite-url')),
      findsOneWidget,
    );
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();

    final claimInvite = find.byKey(
      const ValueKey('biteScore:secure-qr-doc:claim-invite'),
    );
    await tester.ensureVisible(claimInvite);
    await tester.tap(claimInvite);
    await _pumpOpenDialog(tester);
    expect(claimCalls, 1);
    await tester.tap(find.byKey(const ValueKey('create-secure-invite-qr')));
    await _pumpOpenDialog(tester);
    await tester.tap(find.byKey(const ValueKey('restaurant-qr-preview-close')));
    await tester.pumpAndSettle();

    expect(couponCalls, 1);
    expect(claimCalls, 1);
    expect(rendered, [
      (
        restaurantName: 'Secure River Grill',
        url: 'https://go.bitestar.app/invite/coupon/fake-secure-token',
        linkType: RestaurantQrLinkType.couponInvite,
      ),
      (
        restaurantName: 'Secure River Grill',
        url: 'https://go.bitestar.app/invite/bitescore/fake-claim-token',
        linkType: RestaurantQrLinkType.biteScoreClaimInvite,
      ),
    ]);
  });

  testWidgets(
    'per-record QR busy state prevents duplicates without blocking peers',
    (tester) async {
      final completer = Completer<RestaurantQrImageResult>();
      var firstCalls = 0;
      await _pumpScreen(
        tester,
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
            }) async => _result(
              records: [
                _biteScoreRecord(documentId: 'qr-busy-one', name: 'Busy One'),
                _biteScoreRecord(documentId: 'qr-busy-two', name: 'Busy Two'),
              ],
            ),
        renderQrImage:
            ({required restaurantName, required url, required linkType}) {
              if (restaurantName == 'Busy One') {
                firstCalls += 1;
                return completer.future;
              }
              return Future.value(_qrImage(restaurantName, linkType));
            },
      );
      await _submitSearch(tester);

      final first = find.byKey(
        const ValueKey('biteScore:qr-busy-one:customer-qr'),
      );
      final second = find.byKey(
        const ValueKey('biteScore:qr-busy-two:customer-qr'),
      );
      await tester.ensureVisible(first);
      await tester.tap(first);
      await tester.pump();

      expect(tester.widget<OutlinedButton>(first).onPressed, isNull);
      expect(tester.widget<OutlinedButton>(second).onPressed, isNotNull);
      expect(firstCalls, 1);
      await tester.tap(first, warnIfMissed: false);
      await tester.pump();
      expect(firstCalls, 1);

      completer.complete(
        _qrImage('Busy One', RestaurantQrLinkType.customerBiteScore),
      );
      await _pumpOpenDialog(tester);
      await tester.tap(
        find.byKey(const ValueKey('restaurant-qr-preview-close')),
      );
      await tester.pumpAndSettle();
      expect(firstCalls, 1);
    },
  );

  testWidgets(
    'per-record busy state prevents duplicates without blocking peers',
    (tester) async {
      final completer = Completer<RestaurantInviteCreationResult>();
      var firstCalls = 0;
      await _pumpScreen(
        tester,
        search:
            ({
              required locationQuery,
              required radiusMiles,
              required restaurantName,
              required sources,
            }) async => _result(
              records: [
                _biteScoreRecord(documentId: 'busy-one', name: 'Busy One'),
                _biteScoreRecord(documentId: 'busy-two', name: 'Busy Two'),
              ],
            ),
        createCouponInvite:
            ({
              required restaurantName,
              required restaurantId,
              required streetAddress,
              required city,
              required state,
              required zipCode,
              required phone,
              required website,
              required latitude,
              required longitude,
            }) {
              if (restaurantName == 'Busy One') {
                firstCalls += 1;
                return completer.future;
              }
              return Future.value(
                _invite('https://go.bitestar.app/invite/coupon/other'),
              );
            },
      );
      await _submitSearch(tester);

      final first = find.byKey(
        const ValueKey('biteScore:busy-one:coupon-invite'),
      );
      final second = find.byKey(
        const ValueKey('biteScore:busy-two:coupon-invite'),
      );
      await tester.ensureVisible(first);
      await tester.tap(first);
      await tester.pump();

      expect(tester.widget<FilledButton>(first).onPressed, isNull);
      expect(tester.widget<FilledButton>(second).onPressed, isNotNull);
      expect(firstCalls, 1);
      await tester.tap(first, warnIfMissed: false);
      await tester.pump();
      expect(firstCalls, 1);

      completer.complete(
        _invite('https://go.bitestar.app/invite/coupon/busy-token'),
      );
      await _pumpOpenDialog(tester);
      await tester.tap(find.text('Close'));
      await tester.pumpAndSettle();
      expect(firstCalls, 1);
    },
  );
}

Future<AdminRestaurantLinkSearchResult> _emptySearch({
  required String locationQuery,
  required int radiusMiles,
  required String? restaurantName,
  required Set<AdminRestaurantLinkSource> sources,
}) async {
  return _result();
}

Future<void> _pumpScreen(
  WidgetTester tester, {
  required AdminRestaurantSearchCallback search,
  AdminCouponInviteCallback? createCouponInvite,
  AdminBiteScoreClaimInviteCallback? createClaimInvite,
  AdminClipboardWriteCallback? writeClipboard,
  AdminQrImageRenderCallback? renderQrImage,
  RestaurantQrExporter? qrExporter,
  double textScale = 1,
  bool configureView = true,
}) async {
  if (configureView) {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(900, 900);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
  }
  await tester.pumpWidget(
    MaterialApp(
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(textScale)),
        child: child!,
      ),
      home: Scaffold(
        body: AdminLinkGenerationScreen(
          searchRestaurants: search,
          createCouponInvite: createCouponInvite,
          createBiteScoreClaimInvite: createClaimInvite,
          writeClipboard: writeClipboard,
          renderQrImage: renderQrImage,
          qrExporter: qrExporter ?? _unsupportedQrExporter(),
        ),
      ),
    ),
  );
  await tester.pump();
}

Future<void> _submitSearch(
  WidgetTester tester, {
  String location = '34428',
}) async {
  await tester.enterText(
    find.byKey(const ValueKey('admin-link-location-field')),
    location,
  );
  final button = find.byKey(const ValueKey('admin-link-search-button'));
  await tester.ensureVisible(button);
  await tester.tap(button);
  await tester.pumpAndSettle();
}

Future<void> _pumpOpenDialog(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 350));
}

AdminRestaurantLinkSearchResult _result({
  List<AdminRestaurantLinkRecord> records = const [],
  bool truncated = false,
}) {
  return AdminRestaurantLinkSearchResult(
    searchCenter: const AdminRestaurantSearchCenter(
      latitude: 28.8517,
      longitude: -82.487,
      displayName: 'Crystal River, FL',
    ),
    radiusMiles: 10,
    results: records,
    resultsMayBeTruncated: truncated,
    returnedCount: records.length,
    queriedSources: AdminRestaurantLinkSource.values,
  );
}

AdminRestaurantLinkRecord _biteScoreRecord({
  required String documentId,
  String name = 'River Grill',
  bool isClaimed = false,
}) {
  return AdminRestaurantLinkRecord(
    source: AdminRestaurantLinkSource.biteScore,
    documentId: documentId,
    actionId: documentId,
    restaurantName: name,
    streetAddress: '1 Main Street',
    city: 'Crystal River',
    state: 'FL',
    zipCode: '34428',
    phone: '555-0100',
    website: 'https://example.com',
    latitude: 28.8517,
    longitude: -82.487,
    distanceMiles: 1.25,
    isActive: true,
    isClaimed: isClaimed,
  );
}

AdminRestaurantLinkRecord _biteSaverRecord({
  required String documentId,
  required String actionId,
  String approvalStatus = 'pending',
}) {
  return AdminRestaurantLinkRecord(
    source: AdminRestaurantLinkSource.biteSaver,
    documentId: documentId,
    actionId: actionId,
    restaurantName: 'River Grill',
    streetAddress: '1 Main Street',
    city: 'Crystal River',
    state: 'FL',
    zipCode: '34428',
    phone: '555-0100',
    website: 'https://example.com',
    latitude: 28.8517,
    longitude: -82.487,
    distanceMiles: 1.5,
    approvalStatus: approvalStatus,
    couponApplicationSubmitted: true,
    uid: actionId,
  );
}

RestaurantQrImageResult _qrImage(
  String restaurantName,
  RestaurantQrLinkType linkType,
) {
  return RestaurantQrImageResult(
    pngBytes: base64Decode(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8'
      '/x8AAusB9Y9Zl1EAAAAASUVORK5CYII=',
    ),
    width: 1200,
    height: 1306,
    qrWidth: 1200,
    moduleCount: 41,
    modulePixels: 24,
    headerHeight: 106,
    titleLineCount: 1,
    safeFilename: RestaurantQrImageService.safeFilename(
      restaurantName: restaurantName,
      linkType: linkType,
    ),
  );
}

RestaurantQrExporter _unsupportedQrExporter() {
  return RestaurantQrExporter(
    capabilities: const RestaurantQrExportCapabilities(
      canCopyImage: false,
      canDownloadPng: false,
    ),
    copyPng: (_) async {},
    downloadPng: (_, _) async {},
  );
}

RestaurantInviteCreationResult _invite(String url) {
  return RestaurantInviteCreationResult(
    inviteId: 'invite-id',
    token: 'not-persisted',
    inviteUrl: url,
    expiresAt: null,
  );
}
