import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../models/admin_restaurant_link_record.dart';
import '../models/coupon.dart';
import '../models/restaurant.dart';
import '../services/admin_link_generation_service.dart';
import '../services/app_error_text.dart';
import '../services/restaurant_account_service.dart';
import '../services/restaurant_invite_service.dart';
import '../utils/phone_number_formatter.dart';
import '../widgets/clickable_phone_text.dart';
import '../widgets/restaurant_invite_admin_panel.dart';

typedef AdminCouponRestaurantSearchCallback =
    Future<AdminRestaurantLinkSearchResult> Function({
      required String locationQuery,
      required int radiusMiles,
      required String? restaurantName,
      required Set<AdminRestaurantLinkSource> sources,
    });

typedef AdminCouponAccountLoader =
    Future<Map<String, dynamic>?> Function(String documentId);
typedef AdminCouponAccountAction = Future<void> Function(String documentId);
typedef AdminCouponLoader = Future<List<Coupon>> Function(String documentId);
typedef AdminCouponDeleteAction =
    Future<void> Function({
      required String documentId,
      required String couponId,
    });
typedef AdminCouponEditAction =
    Future<bool?> Function({
      required BuildContext context,
      required String documentId,
      required Map<String, dynamic> data,
    });
typedef AdminCouponInviteAction =
    Future<RestaurantInviteCreationResult> Function({
      required String restaurantId,
      required String restaurantName,
      required String streetAddress,
      required String city,
      required String state,
      required String zipCode,
      required String phone,
      required String website,
      required double? latitude,
      required double? longitude,
    });

@immutable
class AdminCouponAccountRecord {
  final String documentId;
  final Map<String, dynamic> data;

  const AdminCouponAccountRecord({
    required this.documentId,
    required this.data,
  });
}

class AdminReviewScreen extends StatefulWidget {
  final Stream<List<AdminCouponAccountRecord>>? pendingAccountsStream;
  final Stream<QuerySnapshot<Map<String, dynamic>>>? nameChangeRequestsStream;
  final Stream<QuerySnapshot<Map<String, dynamic>>>? reportsStream;
  final AdminCouponRestaurantSearchCallback? searchRestaurants;
  final AdminCouponAccountLoader? loadAccount;
  final AdminCouponAccountAction? approveAccount;
  final AdminCouponAccountAction? rejectAccount;
  final AdminCouponAccountAction? deleteAccount;
  final AdminCouponLoader? loadCoupons;
  final AdminCouponDeleteAction? deleteCoupon;
  final AdminCouponEditAction? editAccount;
  final AdminCouponInviteAction? createCouponInvite;

  const AdminReviewScreen({
    super.key,
    @visibleForTesting this.pendingAccountsStream,
    @visibleForTesting this.nameChangeRequestsStream,
    @visibleForTesting this.reportsStream,
    @visibleForTesting this.searchRestaurants,
    @visibleForTesting this.loadAccount,
    @visibleForTesting this.approveAccount,
    @visibleForTesting this.rejectAccount,
    @visibleForTesting this.deleteAccount,
    @visibleForTesting this.loadCoupons,
    @visibleForTesting this.deleteCoupon,
    @visibleForTesting this.editAccount,
    @visibleForTesting this.createCouponInvite,
  });

  @override
  State<AdminReviewScreen> createState() => _AdminReviewScreenState();
}

class _AdminReviewScreenState extends State<AdminReviewScreen> {
  static const int _resultPageSize = 25;
  static const String _truncatedResultsMessage =
      'Results were limited. Narrow the radius or add a restaurant name to '
      'refine the search.';

  final GlobalKey<FormState> _restaurantSearchFormKey = GlobalKey<FormState>();
  final TextEditingController _locationController = TextEditingController();
  final TextEditingController _restaurantNameController =
      TextEditingController();
  final AdminLinkGenerationService _restaurantSearchService =
      AdminLinkGenerationService();
  final Map<String, Future<List<Coupon>>> _couponFutures =
      <String, Future<List<Coupon>>>{};
  final Set<String> _expandedCouponAccounts = <String>{};
  final Set<String> _busyActions = <String>{};

  late final Stream<List<AdminCouponAccountRecord>> _pendingAccountsStream;
  late final Stream<QuerySnapshot<Map<String, dynamic>>>
  _nameChangeRequestsStream;
  late final Stream<QuerySnapshot<Map<String, dynamic>>> _reportsStream;
  int _radiusMiles = AdminLinkGenerationService.defaultRadiusMiles;
  int _visibleResultCount = _resultPageSize;
  bool _isSearching = false;
  bool _hasSubmittedSearch = false;
  AdminRestaurantLinkSearchResult? _restaurantSearchResult;
  String? _restaurantSearchError;

  @override
  void initState() {
    super.initState();
    _pendingAccountsStream =
        widget.pendingAccountsStream ??
        RestaurantAccountService.pendingAccountsStream().map(
          (snapshot) => snapshot.docs
              .map(
                (doc) => AdminCouponAccountRecord(
                  documentId: doc.id,
                  data: doc.data(),
                ),
              )
              .toList(growable: false),
        );
    _nameChangeRequestsStream =
        widget.nameChangeRequestsStream ??
        RestaurantAccountService.pendingRestaurantNameChangeRequestsStream();
    _reportsStream =
        widget.reportsStream ??
        FirebaseFirestore.instance
            .collection('bitesaver_reports')
            .where('status', isEqualTo: 'open')
            .snapshots();
  }

  @override
  void dispose() {
    _locationController.dispose();
    _restaurantNameController.dispose();
    super.dispose();
  }

  Color statusColor(String status) {
    switch (status) {
      case 'approved':
        return Colors.green;
      case 'rejected':
        return Colors.red;
      case 'pending':
        return Colors.orange;
      default:
        return Colors.grey;
    }
  }

  String labelForStatus(String status) {
    switch (status) {
      case 'approved':
        return 'Approved';
      case 'rejected':
        return 'Rejected';
      case 'pending':
        return 'Pending';
      default:
        return 'Unknown';
    }
  }

  String _readString(Map<String, dynamic> data, String key) {
    final value = data[key];
    if (value is String && value.trim().isNotEmpty) {
      return value.trim();
    }
    return '';
  }

  double? _readDouble(Map<String, dynamic> data, String key) {
    final value = data[key];
    if (value is num) {
      return value.toDouble();
    }
    if (value is String) {
      return double.tryParse(value.trim());
    }
    return null;
  }

  DateTime? _readDateTime(Map<String, dynamic> data, String key) {
    final value = data[key];
    if (value is Timestamp) {
      return value.toDate();
    }
    if (value is DateTime) {
      return value;
    }
    return null;
  }

  String _dateLabel(DateTime? value) {
    if (value == null) {
      return 'Recent';
    }

    final local = value.toLocal();
    return '${local.month}/${local.day}/${local.year}';
  }

  int _statusSortPriority(String status) {
    switch (status.trim().toLowerCase()) {
      case 'pending':
        return 0;
      case 'approved':
        return 1;
      case 'rejected':
        return 2;
      default:
        return 3;
    }
  }

  String? get _normalizedOptionalRestaurantName {
    final value = _restaurantNameController.text.trim();
    return value.isEmpty ? null : value;
  }

  Future<void> _submitRestaurantSearch() async {
    if (_isSearching) {
      return;
    }
    final isValid = _restaurantSearchFormKey.currentState?.validate() ?? false;
    if (!isValid) {
      setState(() {
        _hasSubmittedSearch = true;
      });
      return;
    }

    FocusScope.of(context).unfocus();
    setState(() {
      _hasSubmittedSearch = true;
      _isSearching = true;
      _restaurantSearchResult = null;
      _restaurantSearchError = null;
      _visibleResultCount = _resultPageSize;
    });

    try {
      final search = widget.searchRestaurants;
      final result = search != null
          ? await search(
              locationQuery: _locationController.text,
              radiusMiles: _radiusMiles,
              restaurantName: _normalizedOptionalRestaurantName,
              sources: const <AdminRestaurantLinkSource>{
                AdminRestaurantLinkSource.biteSaver,
              },
            )
          : await _restaurantSearchService.search(
              locationQuery: _locationController.text,
              radiusMiles: _radiusMiles,
              restaurantName: _normalizedOptionalRestaurantName,
              sources: const <AdminRestaurantLinkSource>{
                AdminRestaurantLinkSource.biteSaver,
              },
            );
      if (!mounted) {
        return;
      }

      final biteSaverResults = result.results
          .where((record) => record.isBiteSaver)
          .toList(growable: false);
      setState(() {
        _restaurantSearchResult = AdminRestaurantLinkSearchResult(
          searchCenter: result.searchCenter,
          radiusMiles: result.radiusMiles,
          results: biteSaverResults,
          resultsMayBeTruncated: result.resultsMayBeTruncated,
          returnedCount: biteSaverResults.length,
          queriedSources: const <AdminRestaurantLinkSource>[
            AdminRestaurantLinkSource.biteSaver,
          ],
        );
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _restaurantSearchError = error is AdminLinkGenerationException
            ? error.message
            : 'Could not search restaurants right now. Please try again.';
      });
    } finally {
      if (mounted) {
        setState(() {
          _isSearching = false;
        });
      }
    }
  }

  String _actionKey(String recordKey, String action) => '$recordKey:$action';

  bool _isActionBusy(String recordKey, String action) {
    return _busyActions.contains(_actionKey(recordKey, action));
  }

  Future<void> _runBusyAction(
    String recordKey,
    String action,
    Future<void> Function() callback,
  ) async {
    final key = _actionKey(recordKey, action);
    if (_busyActions.contains(key)) {
      return;
    }
    setState(() {
      _busyActions.add(key);
    });
    try {
      await callback();
    } finally {
      if (mounted) {
        setState(() {
          _busyActions.remove(key);
        });
      }
    }
  }

  void _updateSearchApprovalStatus(String documentId, String status) {
    final result = _restaurantSearchResult;
    if (result == null) {
      return;
    }
    final updated = result.results
        .map((record) {
          if (record.documentId != documentId) {
            return record;
          }
          return AdminRestaurantLinkRecord(
            source: record.source,
            documentId: record.documentId,
            actionId: record.actionId,
            restaurantName: record.restaurantName,
            streetAddress: record.streetAddress,
            city: record.city,
            state: record.state,
            zipCode: record.zipCode,
            phone: record.phone,
            website: record.website,
            latitude: record.latitude,
            longitude: record.longitude,
            distanceMiles: record.distanceMiles,
            approvalStatus: status,
            couponApplicationSubmitted: record.couponApplicationSubmitted,
            uid: record.uid,
            linkedBiteScoreRestaurantId: record.linkedBiteScoreRestaurantId,
          );
        })
        .toList(growable: false);
    setState(() {
      _restaurantSearchResult = AdminRestaurantLinkSearchResult(
        searchCenter: result.searchCenter,
        radiusMiles: result.radiusMiles,
        results: updated,
        resultsMayBeTruncated: result.resultsMayBeTruncated,
        returnedCount: updated.length,
        queriedSources: result.queriedSources,
      );
    });
  }

  void _removeSearchResult(String documentId) {
    final result = _restaurantSearchResult;
    if (result == null) {
      return;
    }
    final remaining = result.results
        .where((record) => record.documentId != documentId)
        .toList(growable: false);
    setState(() {
      _restaurantSearchResult = AdminRestaurantLinkSearchResult(
        searchCenter: result.searchCenter,
        radiusMiles: result.radiusMiles,
        results: remaining,
        resultsMayBeTruncated: result.resultsMayBeTruncated,
        returnedCount: remaining.length,
        queriedSources: result.queriedSources,
      );
      _couponFutures.remove(documentId);
      _expandedCouponAccounts.remove(documentId);
    });
  }

  Future<bool> _confirmDelete(
    BuildContext context, {
    required String title,
    required String message,
  }) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: Text(title),
          content: Text(message),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Delete'),
            ),
          ],
        );
      },
    );

    return confirmed == true;
  }

  Future<bool> _deleteRestaurant(
    BuildContext context,
    String documentId,
  ) async {
    final scaffoldMessenger = ScaffoldMessenger.of(context);
    final confirmed = await _confirmDelete(
      context,
      title: 'Delete Restaurant',
      message:
          'Delete this restaurant account and all of its coupons from BiteSaver?',
    );
    if (!confirmed || !context.mounted) {
      return false;
    }

    try {
      final delete = widget.deleteAccount;
      if (delete != null) {
        await delete(documentId);
      } else {
        await RestaurantAccountService.deleteRestaurantAccount(documentId);
      }
      scaffoldMessenger.showSnackBar(
        const SnackBar(content: Text('Restaurant account deleted.')),
      );
      return true;
    } catch (error) {
      scaffoldMessenger.showSnackBar(
        SnackBar(
          content: Text(
            AppErrorText.friendly(
              error,
              fallback: 'Could not delete the restaurant account right now.',
            ),
          ),
        ),
      );
      return false;
    }
  }

  Future<void> _deleteCoupon(
    BuildContext context, {
    required String documentId,
    required String couponId,
  }) async {
    final scaffoldMessenger = ScaffoldMessenger.of(context);
    final confirmed = await _confirmDelete(
      context,
      title: 'Delete Coupon',
      message: 'Delete this coupon?',
    );
    if (!confirmed || !context.mounted) {
      return;
    }

    try {
      final delete = widget.deleteCoupon;
      if (delete != null) {
        await delete(documentId: documentId, couponId: couponId);
      } else {
        await RestaurantAccountService.deleteCoupon(
          uid: documentId,
          couponId: couponId,
        );
      }
      if (mounted) {
        setState(() {
          _couponFutures[documentId] = _loadCoupons(documentId);
        });
      }
      scaffoldMessenger.showSnackBar(
        const SnackBar(content: Text('Coupon deleted.')),
      );
    } catch (error) {
      scaffoldMessenger.showSnackBar(
        SnackBar(
          content: Text(
            AppErrorText.friendly(
              error,
              fallback: 'Could not delete the coupon right now.',
            ),
          ),
        ),
      );
    }
  }

  Future<void> _editRestaurant(
    BuildContext context, {
    required String documentId,
    required Map<String, dynamic> data,
  }) async {
    final edit = widget.editAccount;
    final saved = edit != null
        ? await edit(context: context, documentId: documentId, data: data)
        : await showDialog<bool>(
            context: context,
            builder: (context) {
              return _CouponRestaurantEditDialog(uid: documentId, data: data);
            },
          );

    if (saved == true && context.mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Restaurant updated.')));
    }
  }

  Future<Map<String, dynamic>?> _loadAccount(String documentId) {
    final load = widget.loadAccount;
    if (load != null) {
      return load(documentId);
    }
    return RestaurantAccountService.loadAccountByDocumentId(documentId);
  }

  Future<void> _editSearchRestaurant(
    BuildContext context,
    AdminRestaurantLinkRecord record,
  ) async {
    await _runBusyAction(record.recordKey, 'edit', () async {
      try {
        final data = await _loadAccount(record.documentId);
        if (!context.mounted) {
          return;
        }
        if (data == null) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Restaurant account was not found.')),
          );
          return;
        }
        await _editRestaurant(
          context,
          documentId: record.documentId,
          data: data,
        );
      } catch (_) {
        if (!context.mounted) {
          return;
        }
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Could not load the restaurant account right now.'),
          ),
        );
      }
    });
  }

  Future<void> _updateApprovalStatus(
    BuildContext context, {
    required String documentId,
    required bool approved,
    bool updateSearchResult = false,
  }) async {
    final scaffoldMessenger = ScaffoldMessenger.of(context);

    try {
      if (approved) {
        final approve = widget.approveAccount;
        if (approve != null) {
          await approve(documentId);
        } else {
          await RestaurantAccountService.approveAccount(documentId);
        }
      } else {
        final reject = widget.rejectAccount;
        if (reject != null) {
          await reject(documentId);
        } else {
          await RestaurantAccountService.rejectAccount(documentId);
        }
      }
      if (updateSearchResult && mounted) {
        _updateSearchApprovalStatus(
          documentId,
          approved ? 'approved' : 'rejected',
        );
      }

      scaffoldMessenger.showSnackBar(
        SnackBar(
          content: Text(
            approved ? 'Restaurant approved.' : 'Restaurant rejected.',
          ),
        ),
      );
    } catch (error) {
      scaffoldMessenger.showSnackBar(
        SnackBar(
          content: Text(
            AppErrorText.friendly(
              error,
              fallback: 'Could not update the approval status right now.',
            ),
          ),
        ),
      );
    }
  }

  Future<void> _showGeneratedInviteLink(
    BuildContext context,
    RestaurantInviteCreationResult result,
  ) async {
    await showDialog<void>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('Coupon Invite Created'),
          content: SizedBox(
            width: 460,
            child: SelectableText(result.inviteUrl),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Close'),
            ),
            FilledButton.icon(
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: result.inviteUrl));
                if (!context.mounted) {
                  return;
                }
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Invite link copied.')),
                );
              },
              icon: const Icon(Icons.copy),
              label: const Text('Copy Link'),
            ),
          ],
        );
      },
    );
  }

  Future<void> _createCouponInviteFromAccount(
    BuildContext context, {
    required String actionId,
    required Map<String, dynamic> data,
  }) async {
    final restaurantName = _readString(data, Restaurant.fieldName);
    if (restaurantName.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Restaurant name is required before creating invite.'),
        ),
      );
      return;
    }

    try {
      final createInvite = widget.createCouponInvite;
      final result = createInvite != null
          ? await createInvite(
              restaurantId: actionId,
              restaurantName: restaurantName,
              streetAddress: _readString(data, Restaurant.fieldStreetAddress),
              city: _readString(data, Restaurant.fieldCity),
              state: _readString(data, Restaurant.fieldState),
              zipCode: _readString(data, Restaurant.fieldZipCode),
              phone: _readString(data, Restaurant.fieldPhone),
              website: _readString(data, Restaurant.fieldWebsite),
              latitude: _readDouble(data, Restaurant.fieldLatitude),
              longitude: _readDouble(data, Restaurant.fieldLongitude),
            )
          : await RestaurantInviteService.createCouponInvite(
              restaurantId: actionId,
              restaurantName: restaurantName,
              streetAddress: _readString(data, Restaurant.fieldStreetAddress),
              city: _readString(data, Restaurant.fieldCity),
              state: _readString(data, Restaurant.fieldState),
              zipCode: _readString(data, Restaurant.fieldZipCode),
              phone: _readString(data, Restaurant.fieldPhone),
              website: _readString(data, Restaurant.fieldWebsite),
              latitude: _readDouble(data, Restaurant.fieldLatitude),
              longitude: _readDouble(data, Restaurant.fieldLongitude),
            );
      if (!context.mounted) {
        return;
      }
      await _showGeneratedInviteLink(context, result);
    } catch (error) {
      if (!context.mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            AppErrorText.friendly(
              error,
              fallback: 'Could not create the coupon invite right now.',
            ),
          ),
        ),
      );
    }
  }

  Future<void> _createManualCouponInvite(BuildContext context) async {
    final result = await showDialog<RestaurantInviteCreationResult>(
      context: context,
      builder: (context) => const _CouponInvitePrefillDialog(),
    );
    if (result != null && context.mounted) {
      await _showGeneratedInviteLink(context, result);
    }
  }

  Future<void> _showCouponInviteManager(BuildContext context) async {
    await showDialog<void>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('Coupon Invites'),
          content: const SizedBox(
            width: 560,
            height: 520,
            child: RestaurantInviteAdminPanel(side: 'coupon'),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Close'),
            ),
          ],
        );
      },
    );
  }

  Future<void> _approveRestaurantNameChangeRequest(
    BuildContext context, {
    required String requestId,
    required String uid,
    required String requestedRestaurantName,
  }) async {
    final scaffoldMessenger = ScaffoldMessenger.of(context);

    try {
      await RestaurantAccountService.approveRestaurantNameChangeRequest(
        requestId: requestId,
        uid: uid,
        requestedRestaurantName: requestedRestaurantName,
      );
      scaffoldMessenger.showSnackBar(
        const SnackBar(content: Text('Restaurant name change approved.')),
      );
    } catch (error) {
      scaffoldMessenger.showSnackBar(
        SnackBar(
          content: Text(
            AppErrorText.friendly(
              error,
              fallback:
                  'Could not approve the restaurant name change right now.',
            ),
          ),
        ),
      );
    }
  }

  Future<void> _rejectRestaurantNameChangeRequest(
    BuildContext context, {
    required String requestId,
  }) async {
    final scaffoldMessenger = ScaffoldMessenger.of(context);

    try {
      await RestaurantAccountService.rejectRestaurantNameChangeRequest(
        requestId,
      );
      scaffoldMessenger.showSnackBar(
        const SnackBar(content: Text('Restaurant name change rejected.')),
      );
    } catch (error) {
      scaffoldMessenger.showSnackBar(
        SnackBar(
          content: Text(
            AppErrorText.friendly(
              error,
              fallback:
                  'Could not reject the restaurant name change right now.',
            ),
          ),
        ),
      );
    }
  }

  Future<void> _updateReportStatus(
    BuildContext context, {
    required String reportId,
    required String status,
  }) async {
    final scaffoldMessenger = ScaffoldMessenger.of(context);
    try {
      await FirebaseFirestore.instance
          .collection('bitesaver_reports')
          .doc(reportId)
          .set({
            'status': status,
            'updatedAt': FieldValue.serverTimestamp(),
          }, SetOptions(merge: true));
      scaffoldMessenger.showSnackBar(
        SnackBar(content: Text('Report marked $status.')),
      );
    } catch (error) {
      if (!context.mounted) return;
      scaffoldMessenger.showSnackBar(
        SnackBar(
          content: Text(
            AppErrorText.friendly(
              error,
              fallback: 'Could not update this report right now.',
            ),
          ),
        ),
      );
    }
  }

  Widget _buildAdminHeaderCard({
    required String title,
    required String description,
  }) {
    return Card(
      margin: const EdgeInsets.only(bottom: 14),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            Text(description, style: const TextStyle(color: Colors.black54)),
          ],
        ),
      ),
    );
  }

  Widget _buildNameChangesTab() {
    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: _nameChangeRequestsStream,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }

        if (snapshot.hasError) {
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _buildAdminHeaderCard(
                title: 'Pending Restaurant Name Changes',
                description:
                    'Review requested coupon-side restaurant name updates.',
              ),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(
                    AppErrorText.load('restaurant name change requests'),
                    style: const TextStyle(color: Colors.red),
                  ),
                ),
              ),
            ],
          );
        }

        final docs =
            snapshot.data?.docs ??
            const <QueryDocumentSnapshot<Map<String, dynamic>>>[];
        final sortedDocs =
            List<QueryDocumentSnapshot<Map<String, dynamic>>>.from(
              docs,
              growable: true,
            )..sort((a, b) {
              final aDate =
                  _readDateTime(a.data(), 'createdAt') ??
                  DateTime.fromMillisecondsSinceEpoch(0);
              final bDate =
                  _readDateTime(b.data(), 'createdAt') ??
                  DateTime.fromMillisecondsSinceEpoch(0);
              return bDate.compareTo(aDate);
            });

        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _buildAdminHeaderCard(
              title: 'Pending Restaurant Name Changes',
              description:
                  'Review requested coupon-side restaurant name updates.',
            ),
            if (sortedDocs.isEmpty)
              const Card(
                child: Padding(
                  padding: EdgeInsets.all(16),
                  child: Text(
                    'No pending restaurant name change requests right now.',
                    style: TextStyle(fontSize: 16),
                  ),
                ),
              )
            else
              ...sortedDocs.map((doc) {
                final data = doc.data();
                final uid = _readString(data, 'userId');
                final currentRestaurantName =
                    _readString(data, 'currentRestaurantName').isEmpty
                    ? 'Unnamed Restaurant'
                    : _readString(data, 'currentRestaurantName');
                final requestedRestaurantName = _readString(
                  data,
                  'requestedRestaurantName',
                );
                final createdAt = _readDateTime(data, 'createdAt');

                return Card(
                  margin: const EdgeInsets.only(bottom: 14),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          currentRestaurantName,
                          style: const TextStyle(
                            fontSize: 17,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text('Requested: $requestedRestaurantName'),
                        if (uid.isNotEmpty) ...[
                          const SizedBox(height: 4),
                          Text('User ID: $uid'),
                        ],
                        const SizedBox(height: 4),
                        Text('Submitted: ${_dateLabel(createdAt)}'),
                        const SizedBox(height: 12),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            ElevatedButton(
                              onPressed:
                                  uid.isEmpty || requestedRestaurantName.isEmpty
                                  ? null
                                  : () {
                                      _approveRestaurantNameChangeRequest(
                                        context,
                                        requestId: doc.id,
                                        uid: uid,
                                        requestedRestaurantName:
                                            requestedRestaurantName,
                                      );
                                    },
                              child: const Text('Approve'),
                            ),
                            OutlinedButton(
                              onPressed: () {
                                _rejectRestaurantNameChangeRequest(
                                  context,
                                  requestId: doc.id,
                                );
                              },
                              child: const Text('Reject'),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                );
              }),
          ],
        );
      },
    );
  }

  Widget _buildReportsTab() {
    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: _reportsStream,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }

        if (snapshot.hasError) {
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _buildAdminHeaderCard(
                title: 'BiteSaver Reports',
                description:
                    'Review restaurant and coupon reports submitted by users.',
              ),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(
                    AppErrorText.load('BiteSaver reports'),
                    style: const TextStyle(color: Colors.red),
                  ),
                ),
              ),
            ],
          );
        }

        final docs =
            snapshot.data?.docs ??
            const <QueryDocumentSnapshot<Map<String, dynamic>>>[];
        final sortedDocs =
            List<QueryDocumentSnapshot<Map<String, dynamic>>>.from(
              docs,
              growable: true,
            )..sort((a, b) {
              final aDate =
                  _readDateTime(a.data(), 'createdAt') ??
                  DateTime.fromMillisecondsSinceEpoch(0);
              final bDate =
                  _readDateTime(b.data(), 'createdAt') ??
                  DateTime.fromMillisecondsSinceEpoch(0);
              return bDate.compareTo(aDate);
            });

        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _buildAdminHeaderCard(
              title: 'BiteSaver Reports',
              description:
                  'Review restaurant and coupon reports submitted by users.',
            ),
            if (sortedDocs.isEmpty)
              const Card(
                child: Padding(
                  padding: EdgeInsets.all(16),
                  child: Text(
                    'No BiteSaver reports right now.',
                    style: TextStyle(fontSize: 16),
                  ),
                ),
              )
            else
              ...sortedDocs.map((doc) {
                final data = doc.data();
                final reportType = _readString(data, 'reportType').isEmpty
                    ? 'Report'
                    : _readString(data, 'reportType');
                final restaurantName = _readString(data, 'restaurantName');
                final couponTitle = _readString(data, 'couponTitle');
                final restaurantId = _readString(data, 'restaurantId');
                final couponId = _readString(data, 'couponId');
                final reason = _readString(data, 'reason');
                final note = _readString(data, 'note');
                final reporterUid = _readString(data, 'reporterUid');
                final status = _readString(data, 'status').isEmpty
                    ? 'open'
                    : _readString(data, 'status');
                final createdAt = _readDateTime(data, 'createdAt');

                return Card(
                  margin: const EdgeInsets.only(bottom: 14),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          reportType,
                          style: const TextStyle(
                            fontSize: 17,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 8),
                        if (restaurantName.isNotEmpty)
                          Text('Restaurant: $restaurantName'),
                        if (couponTitle.isNotEmpty)
                          Text('Coupon: $couponTitle'),
                        if (restaurantName.isEmpty && restaurantId.isNotEmpty)
                          Text('Restaurant ID: $restaurantId'),
                        if (couponTitle.isEmpty && couponId.isNotEmpty)
                          Text('Coupon ID: $couponId'),
                        Text('Reason: ${reason.isEmpty ? 'Unknown' : reason}'),
                        if (note.isNotEmpty) Text('Note: $note'),
                        if (reporterUid.isNotEmpty)
                          Text('Reporter: $reporterUid'),
                        Text('Submitted: ${_dateLabel(createdAt)}'),
                        Text('Status: $status'),
                        const SizedBox(height: 12),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            ElevatedButton(
                              onPressed: status == 'reviewed'
                                  ? null
                                  : () => _updateReportStatus(
                                      context,
                                      reportId: doc.id,
                                      status: 'reviewed',
                                    ),
                              child: const Text('Mark reviewed'),
                            ),
                            OutlinedButton(
                              onPressed: status == 'dismissed'
                                  ? null
                                  : () => _updateReportStatus(
                                      context,
                                      reportId: doc.id,
                                      status: 'dismissed',
                                    ),
                              child: const Text('Dismiss'),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                );
              }),
          ],
        );
      },
    );
  }

  Widget _buildRestaurantsTab() {
    return StreamBuilder<List<AdminCouponAccountRecord>>(
      stream: _pendingAccountsStream,
      builder: (context, snapshot) {
        final pendingAccounts =
            List<AdminCouponAccountRecord>.from(
              snapshot.data ?? const <AdminCouponAccountRecord>[],
              growable: true,
            )..sort((a, b) {
              final byStatus =
                  _statusSortPriority(
                    _readString(a.data, Restaurant.fieldApprovalStatus),
                  ).compareTo(
                    _statusSortPriority(
                      _readString(b.data, Restaurant.fieldApprovalStatus),
                    ),
                  );
              if (byStatus != 0) {
                return byStatus;
              }
              final aDate =
                  _readDateTime(a.data, Restaurant.fieldUpdatedAt) ??
                  _readDateTime(a.data, Restaurant.fieldCreatedAt) ??
                  DateTime.fromMillisecondsSinceEpoch(0);
              final bDate =
                  _readDateTime(b.data, Restaurant.fieldUpdatedAt) ??
                  _readDateTime(b.data, Restaurant.fieldCreatedAt) ??
                  DateTime.fromMillisecondsSinceEpoch(0);
              return bDate.compareTo(aDate);
            });
        final pendingDocumentIds = pendingAccounts
            .map((record) => record.documentId)
            .toSet();

        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Align(
              alignment: Alignment.centerRight,
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  FilledButton.icon(
                    onPressed: () => _createManualCouponInvite(context),
                    icon: const Icon(Icons.add_link),
                    label: const Text('Create Coupon Invite'),
                  ),
                  OutlinedButton.icon(
                    onPressed: () => _showCouponInviteManager(context),
                    icon: const Icon(Icons.manage_search),
                    label: const Text('Manage Invites'),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            _buildAdminHeaderCard(
              title: 'Pending Applications',
              description:
                  'Review coupon-side applications without requiring location '
                  'search data.',
            ),
            if (snapshot.connectionState == ConnectionState.waiting)
              const Card(
                child: Padding(
                  padding: EdgeInsets.all(20),
                  child: Center(child: CircularProgressIndicator()),
                ),
              )
            else if (snapshot.hasError)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(
                    AppErrorText.load('pending restaurant applications'),
                    style: const TextStyle(color: Colors.red),
                  ),
                ),
              )
            else if (pendingAccounts.isEmpty)
              const Card(
                child: Padding(
                  padding: EdgeInsets.all(16),
                  child: Text('No pending restaurant approvals found.'),
                ),
              )
            else
              ...pendingAccounts.map(_buildPendingAccountCard),
            const SizedBox(height: 18),
            _buildAdminHeaderCard(
              title: 'Find Restaurants',
              description:
                  'Enter a ZIP code or City, ST to find coupon-side restaurant '
                  'accounts.',
            ),
            _buildRestaurantSearchControls(),
            const SizedBox(height: 14),
            _buildRestaurantSearchState(pendingDocumentIds),
          ],
        );
      },
    );
  }

  Widget _buildRestaurantSearchControls() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _restaurantSearchFormKey,
          child: LayoutBuilder(
            builder: (context, constraints) {
              final isNarrow = constraints.maxWidth < 680;
              final wideFieldWidth = (constraints.maxWidth - 12) / 2;
              final fieldWidth = isNarrow
                  ? constraints.maxWidth
                  : wideFieldWidth;

              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Wrap(
                    spacing: 12,
                    runSpacing: 12,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      SizedBox(
                        width: fieldWidth,
                        child: TextFormField(
                          key: const ValueKey('coupon-admin-location-field'),
                          controller: _locationController,
                          enabled: !_isSearching,
                          textInputAction: TextInputAction.search,
                          onFieldSubmitted: (_) => _submitRestaurantSearch(),
                          validator: (value) =>
                              AdminLinkGenerationService.locationValidationError(
                                value ?? '',
                              ),
                          decoration: InputDecoration(
                            labelText: 'Location',
                            hintText: 'ZIP code or City, ST',
                            prefixIcon: isNarrow
                                ? null
                                : const Icon(Icons.location_on_outlined),
                            border: const OutlineInputBorder(),
                          ),
                        ),
                      ),
                      SizedBox(
                        width: fieldWidth,
                        child: TextFormField(
                          key: const ValueKey(
                            'coupon-admin-restaurant-name-field',
                          ),
                          controller: _restaurantNameController,
                          enabled: !_isSearching,
                          textInputAction: TextInputAction.search,
                          onFieldSubmitted: (_) => _submitRestaurantSearch(),
                          validator: (value) {
                            if ((value ?? '').trim().length > 100) {
                              return 'Restaurant name must be no more than 100 '
                                  'characters.';
                            }
                            return null;
                          },
                          decoration: InputDecoration(
                            labelText: 'Restaurant name',
                            hintText: 'Optional',
                            prefixIcon: isNarrow
                                ? null
                                : const Icon(Icons.storefront_outlined),
                            border: const OutlineInputBorder(),
                          ),
                        ),
                      ),
                      ConstrainedBox(
                        constraints: BoxConstraints(
                          minWidth: isNarrow ? constraints.maxWidth : 180,
                          maxWidth: isNarrow ? constraints.maxWidth : 240,
                        ),
                        child: DropdownButtonFormField<int>(
                          key: const ValueKey('coupon-admin-radius-field'),
                          initialValue: _radiusMiles,
                          isExpanded: true,
                          decoration: const InputDecoration(
                            labelText: 'Radius',
                            border: OutlineInputBorder(),
                          ),
                          items: AdminLinkGenerationService.radiusOptionsMiles
                              .map(
                                (radius) => DropdownMenuItem<int>(
                                  value: radius,
                                  child: Text(
                                    '$radius ${radius == 1 ? 'mile' : 'miles'}',
                                  ),
                                ),
                              )
                              .toList(growable: false),
                          onChanged: _isSearching
                              ? null
                              : (value) {
                                  if (value != null) {
                                    setState(() {
                                      _radiusMiles = value;
                                    });
                                  }
                                },
                        ),
                      ),
                      FilledButton.icon(
                        key: const ValueKey('coupon-admin-search-button'),
                        onPressed: _isSearching
                            ? null
                            : _submitRestaurantSearch,
                        icon: _isSearching
                            ? const SizedBox.square(
                                dimension: 18,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Icon(Icons.search),
                        label: Text(_isSearching ? 'Searching...' : 'Search'),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  const Text(
                    'Only accounts with valid location data appear in '
                    'geographic search.',
                    style: TextStyle(color: Colors.black54),
                  ),
                ],
              );
            },
          ),
        ),
      ),
    );
  }

  Widget _buildRestaurantSearchState(Set<String> pendingDocumentIds) {
    if (!_hasSubmittedSearch) {
      return const Card(
        child: Padding(
          padding: EdgeInsets.all(16),
          child: Text(
            'Enter a ZIP code or City, ST to find coupon-side restaurant '
            'accounts.',
          ),
        ),
      );
    }
    if (_isSearching) {
      return const Card(
        child: Padding(
          padding: EdgeInsets.all(20),
          child: Center(child: CircularProgressIndicator()),
        ),
      );
    }
    if (_restaurantSearchError != null) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Text(
            _restaurantSearchError!,
            style: const TextStyle(color: Colors.red),
          ),
        ),
      );
    }

    final result = _restaurantSearchResult;
    if (result == null) {
      return const SizedBox.shrink();
    }
    final availableResults = result.results
        .where((record) => !pendingDocumentIds.contains(record.documentId))
        .toList(growable: false);
    if (availableResults.isEmpty) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (result.resultsMayBeTruncated) _buildTruncationNotice(),
          const Card(
            child: Padding(
              padding: EdgeInsets.all(16),
              child: Text(
                'No matching coupon-side restaurants were found within this '
                'search area.',
              ),
            ),
          ),
        ],
      );
    }

    final visibleResults = availableResults
        .take(_visibleResultCount)
        .toList(growable: false);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (result.resultsMayBeTruncated) _buildTruncationNotice(),
        Text(
          'Showing ${visibleResults.length} of ${availableResults.length} '
          'returned restaurants.',
          style: const TextStyle(color: Colors.black54),
        ),
        const SizedBox(height: 10),
        ...visibleResults.map(_buildSearchResultCard),
        if (visibleResults.length < availableResults.length)
          Align(
            alignment: Alignment.center,
            child: OutlinedButton.icon(
              key: const ValueKey('coupon-admin-show-more-button'),
              onPressed: () {
                setState(() {
                  _visibleResultCount += _resultPageSize;
                });
              },
              icon: const Icon(Icons.expand_more),
              label: const Text('Show 25 More'),
            ),
          ),
      ],
    );
  }

  Widget _buildTruncationNotice() {
    return Card(
      color: Colors.amber.shade50,
      child: const Padding(
        padding: EdgeInsets.all(16),
        child: Text(_truncatedResultsMessage),
      ),
    );
  }

  Widget _buildPendingAccountCard(AdminCouponAccountRecord account) {
    final data = account.data;
    final documentId = account.documentId;
    final actionId = _readString(data, Restaurant.fieldUid).isEmpty
        ? documentId
        : _readString(data, Restaurant.fieldUid);
    final recordKey = 'pending:$documentId';
    final restaurantName = _readString(data, Restaurant.fieldName).isEmpty
        ? 'Unnamed Restaurant'
        : _readString(data, Restaurant.fieldName);
    final email = _readString(data, Restaurant.fieldEmail).isEmpty
        ? 'No email'
        : _readString(data, Restaurant.fieldEmail);
    final phoneNumber = _readString(data, 'phoneNumber');
    final applicantPhone = _readString(data, Restaurant.fieldPhone);
    final contactPhone = phoneNumber.isNotEmpty ? phoneNumber : applicantPhone;
    final streetAddress = _readString(data, Restaurant.fieldStreetAddress);
    final city = _readString(data, Restaurant.fieldCity);
    final state = _readString(data, Restaurant.fieldState);
    final zipCode = _readString(data, Restaurant.fieldZipCode);
    final location = [
      city,
      state,
      zipCode,
    ].where((part) => part.isNotEmpty).join(', ');
    final website = _readString(data, Restaurant.fieldWebsite);
    final approvalStatus =
        _readString(data, Restaurant.fieldApprovalStatus).isEmpty
        ? 'pending'
        : _readString(data, Restaurant.fieldApprovalStatus);

    return Card(
      key: ValueKey(recordKey),
      margin: const EdgeInsets.only(bottom: 14),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              restaurantName,
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 6),
            if (email == 'No email' && contactPhone.isNotEmpty)
              ClickablePhoneText(phone: contactPhone, prefix: 'Phone: ')
            else
              Text(email),
            if (email != 'No email' && contactPhone.isNotEmpty)
              ClickablePhoneText(phone: contactPhone, prefix: 'Phone: '),
            if (applicantPhone.isNotEmpty &&
                phoneNumber.isNotEmpty &&
                applicantPhone != phoneNumber)
              ClickablePhoneText(
                phone: applicantPhone,
                prefix: 'Applicant phone: ',
              ),
            if (streetAddress.isNotEmpty) Text('Street: $streetAddress'),
            if (location.isNotEmpty) Text('Location: $location'),
            if (website.isNotEmpty) Text('Website: $website'),
            const SizedBox(height: 10),
            _buildStatusChip(approvalStatus),
            const SizedBox(height: 12),
            _buildRestaurantActions(
              recordKey: recordKey,
              documentId: documentId,
              actionId: actionId,
              data: data,
              isSearchResult: false,
            ),
            _buildCouponExpansion(
              sectionKey: recordKey,
              documentId: documentId,
              restaurantName: restaurantName,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSearchResultCard(AdminRestaurantLinkRecord record) {
    final recordKey = record.recordKey;
    final approvalStatus = record.approvalStatus?.trim().toLowerCase() ?? '';
    final locality = [
      record.city,
      record.state,
      record.zipCode,
    ].where((part) => part.trim().isNotEmpty).join(', ');
    final data = <String, dynamic>{
      Restaurant.fieldUid: record.uid ?? record.actionId,
      Restaurant.fieldName: record.restaurantName,
      Restaurant.fieldStreetAddress: record.streetAddress,
      Restaurant.fieldCity: record.city,
      Restaurant.fieldState: record.state,
      Restaurant.fieldZipCode: record.zipCode,
      Restaurant.fieldPhone: record.phone,
      Restaurant.fieldWebsite: record.website,
      Restaurant.fieldLatitude: record.latitude,
      Restaurant.fieldLongitude: record.longitude,
      Restaurant.fieldApprovalStatus: approvalStatus,
      'couponApplicationSubmitted': record.couponApplicationSubmitted,
    };

    return Card(
      key: ValueKey(recordKey),
      margin: const EdgeInsets.only(bottom: 14),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: 8,
              runSpacing: 6,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(
                  record.restaurantName,
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.secondaryContainer,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: const Text('BiteSaver / Coupon Side'),
                ),
              ],
            ),
            const SizedBox(height: 6),
            if (record.streetAddress.isNotEmpty) Text(record.streetAddress),
            if (locality.isNotEmpty) Text(locality),
            Text('${record.distanceMiles.toStringAsFixed(1)} miles away'),
            if (record.phone.isNotEmpty)
              ClickablePhoneText(phone: record.phone, prefix: 'Phone: '),
            if (record.website.isNotEmpty) Text('Website: ${record.website}'),
            const SizedBox(height: 10),
            Wrap(
              spacing: 12,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                _buildStatusChip(approvalStatus),
                Text(
                  'Application submitted: '
                  '${record.couponApplicationSubmitted == true ? 'Yes' : 'No'}',
                ),
              ],
            ),
            const SizedBox(height: 12),
            _buildRestaurantActions(
              recordKey: recordKey,
              documentId: record.documentId,
              actionId: record.actionId,
              data: data,
              isSearchResult: true,
              searchRecord: record,
            ),
            _buildCouponExpansion(
              sectionKey: recordKey,
              documentId: record.documentId,
              restaurantName: record.restaurantName,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStatusChip(String status) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Text('Status: '),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
          decoration: BoxDecoration(
            color: statusColor(status).withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(999),
          ),
          child: Text(
            labelForStatus(status),
            style: TextStyle(
              color: statusColor(status),
              fontWeight: FontWeight.bold,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildRestaurantActions({
    required String recordKey,
    required String documentId,
    required String actionId,
    required Map<String, dynamic> data,
    required bool isSearchResult,
    AdminRestaurantLinkRecord? searchRecord,
  }) {
    final approving = _isActionBusy(recordKey, 'approve');
    final rejecting = _isActionBusy(recordKey, 'reject');
    final editing = _isActionBusy(recordKey, 'edit');
    final inviting = _isActionBusy(recordKey, 'invite');
    final deleting = _isActionBusy(recordKey, 'delete');

    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        ElevatedButton(
          key: ValueKey('$recordKey:approve'),
          onPressed: approving
              ? null
              : () => _runBusyAction(recordKey, 'approve', () async {
                  await _updateApprovalStatus(
                    context,
                    documentId: documentId,
                    approved: true,
                    updateSearchResult: isSearchResult,
                  );
                }),
          child: Text(approving ? 'Approving...' : 'Approve'),
        ),
        OutlinedButton(
          key: ValueKey('$recordKey:reject'),
          onPressed: rejecting
              ? null
              : () => _runBusyAction(recordKey, 'reject', () async {
                  await _updateApprovalStatus(
                    context,
                    documentId: documentId,
                    approved: false,
                    updateSearchResult: isSearchResult,
                  );
                }),
          child: Text(rejecting ? 'Rejecting...' : 'Reject'),
        ),
        OutlinedButton.icon(
          key: ValueKey('$recordKey:edit'),
          onPressed: editing
              ? null
              : () {
                  if (isSearchResult && searchRecord != null) {
                    _editSearchRestaurant(context, searchRecord);
                    return;
                  }
                  _runBusyAction(recordKey, 'edit', () async {
                    await _editRestaurant(
                      context,
                      documentId: documentId,
                      data: data,
                    );
                  });
                },
          icon: editing
              ? const SizedBox.square(
                  dimension: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.edit_outlined),
          label: Text(editing ? 'Loading...' : 'Edit Restaurant'),
        ),
        OutlinedButton.icon(
          key: ValueKey('$recordKey:invite'),
          onPressed: inviting
              ? null
              : () => _runBusyAction(recordKey, 'invite', () async {
                  await _createCouponInviteFromAccount(
                    context,
                    actionId: actionId,
                    data: data,
                  );
                }),
          icon: const Icon(Icons.add_link),
          label: Text(inviting ? 'Creating...' : 'Create Invite'),
        ),
        TextButton.icon(
          key: ValueKey('$recordKey:delete'),
          onPressed: deleting
              ? null
              : () => _runBusyAction(recordKey, 'delete', () async {
                  final deleted = await _deleteRestaurant(context, documentId);
                  if (deleted && isSearchResult) {
                    _removeSearchResult(documentId);
                  }
                }),
          icon: const Icon(Icons.delete_outline),
          label: Text(deleting ? 'Deleting...' : 'Delete Restaurant'),
        ),
      ],
    );
  }

  Future<List<Coupon>> _loadCoupons(String documentId) {
    final load = widget.loadCoupons;
    if (load != null) {
      return load(documentId);
    }
    return RestaurantAccountService.loadCoupons(documentId);
  }

  void _handleCouponExpansion(String documentId, bool expanded) {
    setState(() {
      if (expanded) {
        _expandedCouponAccounts.add(documentId);
      } else {
        _expandedCouponAccounts.remove(documentId);
      }
    });
  }

  Widget _buildCouponExpansion({
    required String sectionKey,
    required String documentId,
    required String restaurantName,
  }) {
    final isExpanded = _expandedCouponAccounts.contains(documentId);
    final couponsFuture = isExpanded
        ? _couponFutures.putIfAbsent(documentId, () => _loadCoupons(documentId))
        : null;
    return ExpansionTile(
      key: PageStorageKey<String>('coupons:$sectionKey'),
      tilePadding: EdgeInsets.zero,
      childrenPadding: EdgeInsets.zero,
      onExpansionChanged: (expanded) {
        _handleCouponExpansion(documentId, expanded);
      },
      title: const Text(
        'Coupons',
        style: TextStyle(fontWeight: FontWeight.w600),
      ),
      subtitle: const Text('View or delete restaurant coupons'),
      children: [
        if (isExpanded)
          _buildCouponSection(
            context,
            documentId: documentId,
            restaurantName: restaurantName,
            couponsFuture: couponsFuture!,
          ),
      ],
    );
  }

  Widget _buildCouponSection(
    BuildContext context, {
    required String documentId,
    required String restaurantName,
    required Future<List<Coupon>> couponsFuture,
  }) {
    return FutureBuilder<List<Coupon>>(
      future: couponsFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Padding(
            padding: EdgeInsets.symmetric(vertical: 12),
            child: Center(child: CircularProgressIndicator()),
          );
        }

        if (snapshot.hasError) {
          return Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              AppErrorText.load('coupons'),
              style: const TextStyle(color: Colors.red),
            ),
          );
        }

        final coupons = snapshot.data ?? const <Coupon>[];

        if (coupons.isEmpty) {
          return Container(
            width: double.infinity,
            margin: const EdgeInsets.only(top: 8),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.grey.shade100,
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Text('No coupons found for this restaurant.'),
          );
        }

        return Column(
          children: coupons.map((coupon) {
            final scheduleText = coupon.endsLabel ?? coupon.expires;

            return Card(
              margin: const EdgeInsets.only(top: 10),
              color: Colors.grey.shade50,
              child: ListTile(
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 4,
                ),
                title: Text(
                  coupon.title,
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
                subtitle: Text(
                  '$restaurantName\n$scheduleText - ${coupon.usageRule}',
                ),
                isThreeLine: true,
                trailing: IconButton(
                  tooltip: 'Delete coupon',
                  onPressed: () {
                    _deleteCoupon(
                      context,
                      documentId: documentId,
                      couponId: coupon.id,
                    );
                  },
                  icon: const Icon(Icons.delete_outline),
                ),
              ),
            );
          }).toList(),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 3,
      child: Column(
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: TabBar(
              isScrollable: true,
              tabAlignment: TabAlignment.start,
              tabs: [
                Tab(text: 'Restaurants'),
                Tab(text: 'Name Changes'),
                Tab(text: 'Reports'),
              ],
            ),
          ),
          Expanded(
            child: TabBarView(
              children: [
                _buildRestaurantsTab(),
                _buildNameChangesTab(),
                _buildReportsTab(),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _AdminTextField extends StatelessWidget {
  final TextEditingController controller;
  final String label;
  final String? hint;
  final int maxLines;
  final TextInputType? keyboardType;
  final List<TextInputFormatter>? inputFormatters;

  const _AdminTextField({
    required this.controller,
    required this.label,
    this.hint,
    this.maxLines = 1,
    this.keyboardType,
    this.inputFormatters,
  });

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      maxLines: maxLines,
      keyboardType: keyboardType,
      inputFormatters: inputFormatters,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
      ),
    );
  }
}

class _CouponInvitePrefillDialog extends StatefulWidget {
  const _CouponInvitePrefillDialog();

  @override
  State<_CouponInvitePrefillDialog> createState() =>
      _CouponInvitePrefillDialogState();
}

class _CouponInvitePrefillDialogState
    extends State<_CouponInvitePrefillDialog> {
  final TextEditingController _restaurantIdController = TextEditingController();
  final TextEditingController _nameController = TextEditingController();
  final TextEditingController _addressController = TextEditingController();
  final TextEditingController _cityController = TextEditingController();
  final TextEditingController _stateController = TextEditingController();
  final TextEditingController _zipController = TextEditingController();
  final TextEditingController _phoneController = TextEditingController();
  final TextEditingController _websiteController = TextEditingController();
  final TextEditingController _latitudeController = TextEditingController();
  final TextEditingController _longitudeController = TextEditingController();
  bool _isSaving = false;

  @override
  void dispose() {
    _restaurantIdController.dispose();
    _nameController.dispose();
    _addressController.dispose();
    _cityController.dispose();
    _stateController.dispose();
    _zipController.dispose();
    _phoneController.dispose();
    _websiteController.dispose();
    _latitudeController.dispose();
    _longitudeController.dispose();
    super.dispose();
  }

  Future<void> _createInvite() async {
    if (_nameController.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Restaurant name is required.')),
      );
      return;
    }

    setState(() {
      _isSaving = true;
    });

    try {
      final result = await RestaurantInviteService.createCouponInvite(
        restaurantId: _restaurantIdController.text,
        restaurantName: _nameController.text,
        streetAddress: _addressController.text,
        city: _cityController.text,
        state: _stateController.text,
        zipCode: _zipController.text,
        phone: _phoneController.text,
        website: _websiteController.text,
        latitude: double.tryParse(_latitudeController.text.trim()),
        longitude: double.tryParse(_longitudeController.text.trim()),
      );
      if (!mounted) {
        return;
      }
      Navigator.of(context).pop(result);
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            AppErrorText.friendly(
              error,
              fallback: 'Could not create the coupon invite right now.',
            ),
          ),
        ),
      );
      setState(() {
        _isSaving = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Create Coupon Invite'),
      content: SizedBox(
        width: 460,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _AdminTextField(
                controller: _restaurantIdController,
                label: 'Restaurant ID / key',
                hint: 'Optional; leave blank for a new restaurant',
              ),
              const SizedBox(height: 12),
              _AdminTextField(
                controller: _nameController,
                label: 'Restaurant name',
              ),
              const SizedBox(height: 12),
              _AdminTextField(
                controller: _addressController,
                label: 'Street address',
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: _AdminTextField(
                      controller: _cityController,
                      label: 'City',
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _AdminTextField(
                      controller: _stateController,
                      label: 'State',
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _AdminTextField(
                      controller: _zipController,
                      label: 'ZIP',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              _AdminTextField(
                controller: _phoneController,
                label: 'Phone',
                keyboardType: TextInputType.phone,
                inputFormatters: usPhoneNumberInputFormatters,
              ),
              const SizedBox(height: 12),
              _AdminTextField(controller: _websiteController, label: 'Website'),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: _AdminTextField(
                      controller: _latitudeController,
                      label: 'Latitude',
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _AdminTextField(
                      controller: _longitudeController,
                      label: 'Longitude',
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isSaving ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton.icon(
          onPressed: _isSaving ? null : _createInvite,
          icon: const Icon(Icons.add_link),
          label: Text(_isSaving ? 'Creating...' : 'Create Invite'),
        ),
      ],
    );
  }
}

class _CouponRestaurantEditDialog extends StatefulWidget {
  final String uid;
  final Map<String, dynamic> data;

  const _CouponRestaurantEditDialog({required this.uid, required this.data});

  @override
  State<_CouponRestaurantEditDialog> createState() =>
      _CouponRestaurantEditDialogState();
}

class _CouponRestaurantEditDialogState
    extends State<_CouponRestaurantEditDialog> {
  late final TextEditingController _nameController;
  late final TextEditingController _cityController;
  late final TextEditingController _stateController;
  late final TextEditingController _zipController;
  late final TextEditingController _emailController;
  late final TextEditingController _phoneController;
  late final TextEditingController _addressController;
  late final TextEditingController _websiteController;
  late final TextEditingController _bioController;
  late final TextEditingController _latitudeController;
  late final TextEditingController _longitudeController;
  bool _isSaving = false;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(
      text: _readString(widget.data, Restaurant.fieldName),
    );
    _cityController = TextEditingController(
      text: _readString(widget.data, Restaurant.fieldCity),
    );
    _stateController = TextEditingController(
      text: _readString(widget.data, Restaurant.fieldState),
    );
    _zipController = TextEditingController(
      text: _readString(widget.data, Restaurant.fieldZipCode),
    );
    _emailController = TextEditingController(
      text: _readString(widget.data, Restaurant.fieldEmail),
    );
    _phoneController = TextEditingController(
      text: formatPhoneNumberForDisplay(
        _readString(widget.data, Restaurant.fieldPhone),
      ),
    );
    _addressController = TextEditingController(
      text: _readString(widget.data, Restaurant.fieldStreetAddress),
    );
    _websiteController = TextEditingController(
      text: _readString(widget.data, Restaurant.fieldWebsite),
    );
    _bioController = TextEditingController(
      text: _readString(widget.data, Restaurant.fieldBio),
    );
    _latitudeController = TextEditingController(
      text:
          _readDouble(widget.data, Restaurant.fieldLatitude)?.toString() ?? '',
    );
    _longitudeController = TextEditingController(
      text:
          _readDouble(widget.data, Restaurant.fieldLongitude)?.toString() ?? '',
    );
  }

  @override
  void dispose() {
    _nameController.dispose();
    _cityController.dispose();
    _stateController.dispose();
    _zipController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    _addressController.dispose();
    _websiteController.dispose();
    _bioController.dispose();
    _latitudeController.dispose();
    _longitudeController.dispose();
    super.dispose();
  }

  String _readString(Map<String, dynamic> data, String key) {
    final value = data[key];
    if (value is String && value.trim().isNotEmpty) {
      return value.trim();
    }
    return '';
  }

  double? _readDouble(Map<String, dynamic> data, String key) {
    final value = data[key];
    if (value is num) {
      return value.toDouble();
    }
    if (value is String) {
      return double.tryParse(value.trim());
    }
    return null;
  }

  Future<void> _save() async {
    setState(() {
      _isSaving = true;
    });

    try {
      await RestaurantAccountService.saveRestaurantProfile(
        uid: widget.uid,
        name: _nameController.text,
        city: _cityController.text,
        state: _stateController.text,
        zipCode: _zipController.text,
        email: _emailController.text,
        phone: _phoneController.text,
        streetAddress: _addressController.text,
        website: _websiteController.text,
        bio: _bioController.text,
        businessHours: RestaurantBusinessHours.listFromFirestore(
          widget.data[Restaurant.fieldBusinessHours],
        ),
        latitude: double.tryParse(_latitudeController.text.trim()),
        longitude: double.tryParse(_longitudeController.text.trim()),
      );
      if (!mounted) {
        return;
      }
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            AppErrorText.friendly(
              error,
              fallback: 'Could not update the restaurant right now.',
            ),
          ),
        ),
      );
      setState(() {
        _isSaving = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Edit Restaurant'),
      content: SizedBox(
        width: 440,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _AdminTextField(
                controller: _nameController,
                label: 'Restaurant name',
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: _AdminTextField(
                      controller: _cityController,
                      label: 'City',
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _AdminTextField(
                      controller: _stateController,
                      label: 'State',
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _AdminTextField(
                      controller: _zipController,
                      label: 'ZIP code',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              _AdminTextField(controller: _emailController, label: 'Email'),
              const SizedBox(height: 12),
              _AdminTextField(
                controller: _phoneController,
                label: 'Phone',
                keyboardType: TextInputType.phone,
                inputFormatters: usPhoneNumberInputFormatters,
              ),
              const SizedBox(height: 12),
              _AdminTextField(
                controller: _addressController,
                label: 'Street address',
              ),
              const SizedBox(height: 12),
              _AdminTextField(controller: _websiteController, label: 'Website'),
              const SizedBox(height: 12),
              _AdminTextField(
                controller: _bioController,
                label: 'Bio',
                maxLines: 3,
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: _AdminTextField(
                      controller: _latitudeController,
                      label: 'Latitude',
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _AdminTextField(
                      controller: _longitudeController,
                      label: 'Longitude',
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isSaving ? null : () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _isSaving ? null : _save,
          child: Text(_isSaving ? 'Saving...' : 'Save'),
        ),
      ],
    );
  }
}
