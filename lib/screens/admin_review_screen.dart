import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../models/coupon.dart';
import '../models/restaurant.dart';
import '../services/app_error_text.dart';
import '../services/restaurant_account_service.dart';

class AdminReviewScreen extends StatefulWidget {
  const AdminReviewScreen({super.key});

  @override
  State<AdminReviewScreen> createState() => _AdminReviewScreenState();
}

class _AdminReviewScreenState extends State<AdminReviewScreen> {
  final TextEditingController _searchController = TextEditingController();
  late final Stream<QuerySnapshot<Map<String, dynamic>>> _accountsStream;
  late final Stream<QuerySnapshot<Map<String, dynamic>>>
      _nameChangeRequestsStream;
  List<QueryDocumentSnapshot<Map<String, dynamic>>> _fullRestaurantList =
      const <QueryDocumentSnapshot<Map<String, dynamic>>>[];
  List<QueryDocumentSnapshot<Map<String, dynamic>>> _filteredRestaurantList =
      const <QueryDocumentSnapshot<Map<String, dynamic>>>[];

  @override
  void initState() {
    super.initState();
    _accountsStream = RestaurantAccountService.allAccountsStream();
    _nameChangeRequestsStream =
        RestaurantAccountService.pendingRestaurantNameChangeRequestsStream();
    _searchController.addListener(_handleSearchChanged);
  }

  @override
  void dispose() {
    _searchController.removeListener(_handleSearchChanged);
    _searchController.dispose();
    super.dispose();
  }

  void _handleSearchChanged() {
    setState(() {
      _filteredRestaurantList = _buildFilteredRestaurantList(
        _fullRestaurantList,
        _searchController.text,
      );
    });
  }

  Color statusColor(String status) {
    switch (status) {
      case 'approved':
        return Colors.green;
      case 'rejected':
        return Colors.red;
      default:
        return Colors.orange;
    }
  }

  String labelForStatus(String status) {
    switch (status) {
      case 'approved':
        return 'Approved';
      case 'rejected':
        return 'Rejected';
      default:
        return 'Pending';
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

  List<QueryDocumentSnapshot<Map<String, dynamic>>> _buildFilteredRestaurantList(
    List<QueryDocumentSnapshot<Map<String, dynamic>>> restaurants,
    String query,
  ) {
    final normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery.isEmpty) {
      return List<QueryDocumentSnapshot<Map<String, dynamic>>>.from(
        restaurants,
        growable: false,
      );
    }

    return restaurants.where((doc) {
      final data = doc.data();
      final restaurantName = _readString(
        data,
        Restaurant.fieldName,
      ).toLowerCase();
      final email = _readString(data, Restaurant.fieldEmail).toLowerCase();
      final city = _readString(data, Restaurant.fieldCity).toLowerCase();

      return restaurantName.contains(normalizedQuery) ||
          email.contains(normalizedQuery) ||
          city.contains(normalizedQuery);
    }).toList(growable: false);
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

  Future<void> _deleteRestaurant(BuildContext context, String uid) async {
    final scaffoldMessenger = ScaffoldMessenger.of(context);
    final confirmed = await _confirmDelete(
      context,
      title: 'Delete Restaurant',
      message:
          'Delete this restaurant account and all of its coupons from BiteSaver?',
    );
    if (!confirmed || !context.mounted) {
      return;
    }

    try {
      await RestaurantAccountService.deleteRestaurantAccount(uid);
      scaffoldMessenger.showSnackBar(
        const SnackBar(content: Text('Restaurant account deleted.')),
      );
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
    }
  }

  Future<void> _deleteCoupon(
    BuildContext context, {
    required String uid,
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
      await RestaurantAccountService.deleteCoupon(uid: uid, couponId: couponId);
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
    required String uid,
    required Map<String, dynamic> data,
  }) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) {
        return _CouponRestaurantEditDialog(
          uid: uid,
          data: data,
        );
      },
    );

    if (saved == true && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Restaurant updated.')),
      );
    }
  }

  Future<void> _updateApprovalStatus(
    BuildContext context, {
    required String uid,
    required bool approved,
  }) async {
    final scaffoldMessenger = ScaffoldMessenger.of(context);

    try {
      if (approved) {
        await RestaurantAccountService.approveAccount(uid);
      } else {
        await RestaurantAccountService.rejectAccount(uid);
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
              fallback: 'Could not approve the restaurant name change right now.',
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
              fallback: 'Could not reject the restaurant name change right now.',
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
              style: const TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              description,
              style: const TextStyle(color: Colors.black54),
            ),
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
          return const Center(
            child: CircularProgressIndicator(),
          );
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
        final sortedDocs = List<QueryDocumentSnapshot<Map<String, dynamic>>>.from(
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
                final requestedRestaurantName =
                    _readString(data, 'requestedRestaurantName');
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

  Widget _buildRestaurantsTab() {
    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: _accountsStream,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(
            child: CircularProgressIndicator(),
          );
        }

        if (snapshot.hasError) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Text(
                AppErrorText.load('restaurants'),
                textAlign: TextAlign.center,
              ),
            ),
          );
        }

        final docs =
            snapshot.data?.docs ??
            const <QueryDocumentSnapshot<Map<String, dynamic>>>[];
        final sortedDocs = List<QueryDocumentSnapshot<Map<String, dynamic>>>.from(
          docs,
          growable: true,
        )..sort((a, b) {
            final aData = a.data();
            final bData = b.data();
            final byStatus = _statusSortPriority(
              _readString(aData, Restaurant.fieldApprovalStatus),
            ).compareTo(
              _statusSortPriority(
                _readString(bData, Restaurant.fieldApprovalStatus),
              ),
            );
            if (byStatus != 0) {
              return byStatus;
            }

            final aTimestamp =
                _readDateTime(aData, Restaurant.fieldUpdatedAt) ??
                _readDateTime(aData, Restaurant.fieldCreatedAt) ??
                DateTime.fromMillisecondsSinceEpoch(0);
            final bTimestamp =
                _readDateTime(bData, Restaurant.fieldUpdatedAt) ??
                _readDateTime(bData, Restaurant.fieldCreatedAt) ??
                DateTime.fromMillisecondsSinceEpoch(0);
            return bTimestamp.compareTo(aTimestamp);
          });
        _fullRestaurantList = List<QueryDocumentSnapshot<Map<String, dynamic>>>.from(
          sortedDocs,
          growable: false,
        );
        _filteredRestaurantList = _buildFilteredRestaurantList(
          _fullRestaurantList,
          _searchController.text,
        );

        return Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
              child: Column(
                children: [
                  _buildAdminHeaderCard(
                    title: 'Coupon Side Admin',
                    description:
                        'Approve or reject restaurant applications, edit restaurant information, and delete coupons or restaurant accounts from one shared admin area.',
                  ),
                  TextField(
                    controller: _searchController,
                    decoration: InputDecoration(
                      hintText: 'Search restaurants',
                      prefixIcon: const Icon(Icons.search),
                      suffixIcon: _searchController.text.trim().isEmpty
                          ? null
                          : IconButton(
                              tooltip: 'Clear search',
                              onPressed: () {
                                _searchController.clear();
                              },
                              icon: const Icon(Icons.clear),
                            ),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                ],
              ),
            ),
            Expanded(
              child: _filteredRestaurantList.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Text(
                          _searchController.text.trim().isEmpty
                              ? 'No restaurants found.'
                              : 'No restaurants match your search.',
                          textAlign: TextAlign.center,
                          style: const TextStyle(fontSize: 16),
                        ),
                      ),
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                      itemCount: _filteredRestaurantList.length,
                      itemBuilder: (context, index) {
                        final doc = _filteredRestaurantList[index];
                        final data = doc.data();

                        final uid = _readString(data, Restaurant.fieldUid).isEmpty
                            ? doc.id
                            : _readString(data, Restaurant.fieldUid);
                        final restaurantName =
                            _readString(data, Restaurant.fieldName).isEmpty
                            ? 'Unnamed Restaurant'
                            : _readString(data, Restaurant.fieldName);
                        final email =
                            _readString(data, Restaurant.fieldEmail).isEmpty
                            ? 'No email'
                            : _readString(data, Restaurant.fieldEmail);
                        final city = _readString(data, Restaurant.fieldCity);
                        final zipCode = _readString(data, Restaurant.fieldZipCode);
                        final approvalStatus =
                            _readString(data, Restaurant.fieldApprovalStatus)
                                    .isEmpty
                            ? 'pending'
                            : _readString(data, Restaurant.fieldApprovalStatus);

                        return Card(
                          margin: const EdgeInsets.only(bottom: 14),
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  restaurantName,
                                  style: const TextStyle(
                                    fontSize: 18,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                                const SizedBox(height: 6),
                                Text(email),
                                if (city.isNotEmpty || zipCode.isNotEmpty) ...[
                                  const SizedBox(height: 4),
                                  Text(
                                    city.isEmpty
                                        ? zipCode
                                        : '$city${zipCode.isEmpty ? '' : ', $zipCode'}',
                                  ),
                                ],
                                const SizedBox(height: 10),
                                Row(
                                  children: [
                                    const Text('Status: '),
                                    Container(
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 10,
                                        vertical: 4,
                                      ),
                                      decoration: BoxDecoration(
                                        color: statusColor(
                                          approvalStatus,
                                        ).withOpacity(0.12),
                                        borderRadius: BorderRadius.circular(999),
                                      ),
                                      child: Text(
                                        labelForStatus(approvalStatus),
                                        style: TextStyle(
                                          color: statusColor(approvalStatus),
                                          fontWeight: FontWeight.bold,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 12),
                                Wrap(
                                  spacing: 8,
                                  runSpacing: 8,
                                  children: [
                                    ElevatedButton(
                                      onPressed: uid.isEmpty
                                          ? null
                                          : () {
                                              _updateApprovalStatus(
                                                context,
                                                uid: uid,
                                                approved: true,
                                              );
                                            },
                                      child: const Text('Approve'),
                                    ),
                                    OutlinedButton(
                                      onPressed: uid.isEmpty
                                          ? null
                                          : () {
                                              _updateApprovalStatus(
                                                context,
                                                uid: uid,
                                                approved: false,
                                              );
                                            },
                                      child: const Text('Reject'),
                                    ),
                                    OutlinedButton.icon(
                                      onPressed: uid.isEmpty
                                          ? null
                                          : () {
                                              _editRestaurant(
                                                context,
                                                uid: uid,
                                                data: data,
                                              );
                                            },
                                      icon: const Icon(Icons.edit_outlined),
                                      label: const Text('Edit Restaurant'),
                                    ),
                                    TextButton.icon(
                                      onPressed: uid.isEmpty
                                          ? null
                                          : () {
                                              _deleteRestaurant(context, uid);
                                            },
                                      icon: const Icon(Icons.delete_outline),
                                      label: const Text('Delete Restaurant'),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 8),
                                ExpansionTile(
                                  tilePadding: EdgeInsets.zero,
                                  childrenPadding: EdgeInsets.zero,
                                  title: const Text(
                                    'Coupons',
                                    style: TextStyle(
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                  subtitle: const Text(
                                    'View or delete restaurant coupons',
                                  ),
                                  children: [
                                    _buildCouponSection(
                                      context,
                                      uid: uid,
                                      restaurantName: restaurantName,
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        );
                      },
                    ),
            ),
          ],
        );
      },
    );
  }

  Widget _buildCouponSection(
    BuildContext context, {
    required String uid,
    required String restaurantName,
  }) {
    return FutureBuilder<List<Coupon>>(
      future: RestaurantAccountService.loadCoupons(uid),
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
                      uid: uid,
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
      length: 2,
      child: Column(
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: TabBar(
              tabs: [
                Tab(text: 'Restaurants'),
                Tab(text: 'Name Changes'),
              ],
            ),
          ),
          Expanded(
            child: TabBarView(
              children: [
                _buildRestaurantsTab(),
                _buildNameChangesTab(),
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

  const _AdminTextField({
    required this.controller,
    required this.label,
    this.hint,
    this.maxLines = 1,
  });

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      maxLines: maxLines,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
        ),
      ),
    );
  }
}

class _CouponRestaurantEditDialog extends StatefulWidget {
  final String uid;
  final Map<String, dynamic> data;

  const _CouponRestaurantEditDialog({
    required this.uid,
    required this.data,
  });

  @override
  State<_CouponRestaurantEditDialog> createState() =>
      _CouponRestaurantEditDialogState();
}

class _CouponRestaurantEditDialogState
    extends State<_CouponRestaurantEditDialog> {
  late final TextEditingController _nameController;
  late final TextEditingController _cityController;
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
    _zipController = TextEditingController(
      text: _readString(widget.data, Restaurant.fieldZipCode),
    );
    _emailController = TextEditingController(
      text: _readString(widget.data, Restaurant.fieldEmail),
    );
    _phoneController = TextEditingController(
      text: _readString(widget.data, Restaurant.fieldPhone),
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
      text: _readDouble(widget.data, Restaurant.fieldLatitude)?.toString() ?? '',
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
                      controller: _zipController,
                      label: 'ZIP code',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              _AdminTextField(
                controller: _emailController,
                label: 'Email',
              ),
              const SizedBox(height: 12),
              _AdminTextField(
                controller: _phoneController,
                label: 'Phone',
              ),
              const SizedBox(height: 12),
              _AdminTextField(
                controller: _addressController,
                label: 'Street address',
              ),
              const SizedBox(height: 12),
              _AdminTextField(
                controller: _websiteController,
                label: 'Website',
              ),
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
