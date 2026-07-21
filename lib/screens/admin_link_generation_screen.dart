import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../models/admin_restaurant_link_record.dart';
import '../services/admin_link_generation_service.dart';
import '../services/app_error_text.dart';
import '../services/restaurant_customer_link_service.dart';
import '../services/restaurant_invite_service.dart';
import '../services/restaurant_qr_export.dart';
import '../services/restaurant_qr_image_service.dart';
import '../widgets/restaurant_qr_preview_dialog.dart';

typedef AdminRestaurantSearchCallback =
    Future<AdminRestaurantLinkSearchResult> Function({
      required String locationQuery,
      required int radiusMiles,
      required String? restaurantName,
      required Set<AdminRestaurantLinkSource> sources,
    });

typedef AdminCouponInviteCallback =
    Future<RestaurantInviteCreationResult> Function({
      required String restaurantName,
      required String? restaurantId,
      required String streetAddress,
      required String city,
      required String state,
      required String zipCode,
      required String phone,
      required String website,
      required double latitude,
      required double longitude,
    });

typedef AdminBiteScoreClaimInviteCallback =
    Future<RestaurantInviteCreationResult> Function({
      required String restaurantId,
    });

typedef AdminClipboardWriteCallback = Future<void> Function(String text);
typedef AdminQrImageRenderCallback =
    Future<RestaurantQrImageResult> Function({
      required String restaurantName,
      required String url,
      required RestaurantQrLinkType linkType,
    });

class AdminLinkGenerationScreen extends StatefulWidget {
  final AdminRestaurantSearchCallback? searchRestaurants;
  final AdminCouponInviteCallback? createCouponInvite;
  final AdminBiteScoreClaimInviteCallback? createBiteScoreClaimInvite;
  final AdminClipboardWriteCallback? writeClipboard;
  final AdminQrImageRenderCallback? renderQrImage;
  final RestaurantQrExporter? qrExporter;

  const AdminLinkGenerationScreen({
    super.key,
    @visibleForTesting this.searchRestaurants,
    @visibleForTesting this.createCouponInvite,
    @visibleForTesting this.createBiteScoreClaimInvite,
    @visibleForTesting this.writeClipboard,
    @visibleForTesting this.renderQrImage,
    @visibleForTesting this.qrExporter,
  });

  @override
  State<AdminLinkGenerationScreen> createState() =>
      _AdminLinkGenerationScreenState();
}

class _AdminLinkGenerationScreenState extends State<AdminLinkGenerationScreen> {
  final _formKey = GlobalKey<FormState>();
  final _locationController = TextEditingController();
  final _restaurantNameController = TextEditingController();
  final _searchService = AdminLinkGenerationService();
  final Set<AdminRestaurantLinkSource> _selectedSources = {
    AdminRestaurantLinkSource.biteScore,
    AdminRestaurantLinkSource.biteSaver,
  };
  final Set<String> _busyActions = <String>{};

  int _radiusMiles = AdminLinkGenerationService.defaultRadiusMiles;
  bool _isSearching = false;
  bool _hasSubmitted = false;
  AdminRestaurantLinkSearchResult? _searchResult;
  String? _searchError;

  @override
  void dispose() {
    _locationController.dispose();
    _restaurantNameController.dispose();
    super.dispose();
  }

  Future<void> _submitSearch() async {
    if (_isSearching) {
      return;
    }
    final formIsValid = _formKey.currentState?.validate() ?? false;
    if (!formIsValid || _selectedSources.isEmpty) {
      setState(() {
        _hasSubmitted = true;
        _searchError = _selectedSources.isEmpty
            ? 'Select at least one restaurant source.'
            : null;
      });
      return;
    }

    FocusScope.of(context).unfocus();
    setState(() {
      _hasSubmitted = true;
      _isSearching = true;
      _searchResult = null;
      _searchError = null;
    });

    try {
      final search = widget.searchRestaurants;
      final result = search != null
          ? await search(
              locationQuery: _locationController.text,
              radiusMiles: _radiusMiles,
              restaurantName: _normalizedOptionalName,
              sources: Set.unmodifiable(_selectedSources),
            )
          : await _searchService.search(
              locationQuery: _locationController.text,
              radiusMiles: _radiusMiles,
              restaurantName: _normalizedOptionalName,
              sources: Set.unmodifiable(_selectedSources),
            );
      if (!mounted) {
        return;
      }
      setState(() {
        _searchResult = result;
        _searchError = null;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _searchResult = null;
        _searchError = error is AdminLinkGenerationException
            ? error.message
            : AppErrorText.friendly(
                error,
                fallback: 'Could not search restaurants right now.',
              );
      });
    } finally {
      if (mounted) {
        setState(() {
          _isSearching = false;
        });
      }
    }
  }

  String? get _normalizedOptionalName {
    final value = _restaurantNameController.text.trim();
    return value.isEmpty ? null : value;
  }

  void _toggleSource(AdminRestaurantLinkSource source, bool selected) {
    if (!selected && _selectedSources.length == 1) {
      _showSnackBar('Select at least one restaurant source.');
      return;
    }
    setState(() {
      if (selected) {
        _selectedSources.add(source);
      } else {
        _selectedSources.remove(source);
      }
      _searchError = null;
    });
  }

  String _actionKey(AdminRestaurantLinkRecord record, String action) {
    return '${record.recordKey}:$action';
  }

  bool _isActionBusy(AdminRestaurantLinkRecord record, String action) {
    return _busyActions.contains(_actionKey(record, action));
  }

  Future<void> _runBusyAction(
    AdminRestaurantLinkRecord record,
    String action,
    Future<void> Function() callback,
  ) async {
    final key = _actionKey(record, action);
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

  Future<RestaurantQrImageResult> _renderQrImage({
    required String restaurantName,
    required String url,
    required RestaurantQrLinkType linkType,
  }) {
    final render = widget.renderQrImage;
    if (render != null) {
      return render(
        restaurantName: restaurantName,
        url: url,
        linkType: linkType,
      );
    }
    return const RestaurantQrImageService().render(
      restaurantName: restaurantName,
      url: url,
      linkType: linkType,
    );
  }

  Future<void> _generateCouponInvite(AdminRestaurantLinkRecord record) async {
    await _runBusyAction(record, 'coupon-invite', () async {
      try {
        final createInvite = widget.createCouponInvite;
        final result = createInvite != null
            ? await createInvite(
                restaurantName: record.restaurantName,
                restaurantId: record.isBiteSaver ? record.actionId : null,
                streetAddress: record.streetAddress,
                city: record.city,
                state: record.state,
                zipCode: record.zipCode,
                phone: record.phone,
                website: record.website,
                latitude: record.latitude,
                longitude: record.longitude,
              )
            : await RestaurantInviteService.createCouponInvite(
                restaurantName: record.restaurantName,
                restaurantId: record.isBiteSaver ? record.actionId : null,
                streetAddress: record.streetAddress,
                city: record.city,
                state: record.state,
                zipCode: record.zipCode,
                phone: record.phone,
                website: record.website,
                latitude: record.latitude,
                longitude: record.longitude,
              );
        if (!mounted) {
          return;
        }
        await _showInviteDialog(
          title: 'Coupon Invite Created',
          inviteUrl: result.inviteUrl,
          restaurantName: record.restaurantName,
          linkType: RestaurantQrLinkType.couponInvite,
        );
      } catch (error) {
        if (!mounted) {
          return;
        }
        _showSnackBar(
          AppErrorText.friendly(
            error,
            fallback: 'Could not create the coupon invite right now.',
          ),
        );
      }
    });
  }

  Future<void> _generateBiteScoreClaimInvite(
    AdminRestaurantLinkRecord record,
  ) async {
    if (record.isClaimed == true) {
      return;
    }
    await _runBusyAction(record, 'claim-invite', () async {
      try {
        final createInvite = widget.createBiteScoreClaimInvite;
        final result = createInvite != null
            ? await createInvite(restaurantId: record.documentId)
            : await RestaurantInviteService.createBiteScoreClaimInvite(
                restaurantId: record.documentId,
              );
        if (!mounted) {
          return;
        }
        await _showInviteDialog(
          title: 'BiteScore Claim Invite Created',
          inviteUrl: result.inviteUrl,
          restaurantName: record.restaurantName,
          linkType: RestaurantQrLinkType.biteScoreClaimInvite,
        );
      } catch (error) {
        if (!mounted) {
          return;
        }
        _showSnackBar(
          AppErrorText.friendly(
            error,
            fallback: 'Could not create the BiteScore claim invite right now.',
          ),
        );
      }
    });
  }

  Future<void> _copyCustomerLink(AdminRestaurantLinkRecord record) async {
    await _runBusyAction(record, 'customer-link', () async {
      try {
        final link = record.isBiteScore
            ? RestaurantCustomerLinkService.biteScoreRestaurantUrl(
                record.documentId,
              )
            : RestaurantCustomerLinkService.couponRestaurantUrl(
                record.actionId,
              );
        await _writeClipboard(link);
        if (mounted) {
          _showSnackBar('Customer link copied.');
        }
      } catch (_) {
        if (mounted) {
          _showSnackBar('Could not copy the customer link.');
        }
      }
    });
  }

  Future<void> _createCustomerQr(AdminRestaurantLinkRecord record) async {
    await _runBusyAction(record, 'customer-qr', () async {
      try {
        final link = record.isBiteScore
            ? RestaurantCustomerLinkService.biteScoreRestaurantUrl(
                record.documentId,
              )
            : RestaurantCustomerLinkService.couponRestaurantUrl(
                record.actionId,
              );
        final image = await _renderQrImage(
          restaurantName: record.restaurantName,
          url: link,
          linkType: record.isBiteScore
              ? RestaurantQrLinkType.customerBiteScore
              : RestaurantQrLinkType.customerBiteSaver,
        );
        if (!mounted) {
          return;
        }
        await showRestaurantQrPreviewDialog(
          context: context,
          image: image,
          isSensitive: false,
          exporter: widget.qrExporter,
        );
      } catch (error) {
        if (mounted) {
          _showSnackBar(
            error is RestaurantQrImageException
                ? error.message
                : 'Could not create the customer QR image.',
          );
        }
      }
    });
  }

  Future<void> _writeClipboard(String text) async {
    final writeClipboard = widget.writeClipboard;
    if (writeClipboard != null) {
      await writeClipboard(text);
      return;
    }
    await Clipboard.setData(ClipboardData(text: text));
  }

  Future<void> _showInviteDialog({
    required String title,
    required String inviteUrl,
    required String restaurantName,
    required RestaurantQrLinkType linkType,
  }) async {
    while (mounted) {
      final image = await showDialog<RestaurantQrImageResult>(
        context: context,
        builder: (dialogContext) {
          var isCopying = false;
          var isCreatingQr = false;
          return StatefulBuilder(
            builder: (context, setDialogState) {
              return AlertDialog(
                title: Text(title),
                content: SingleChildScrollView(
                  child: SelectableText(
                    inviteUrl,
                    key: const ValueKey('admin-secure-invite-url'),
                  ),
                ),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.of(dialogContext).pop(),
                    child: const Text('Close'),
                  ),
                  OutlinedButton.icon(
                    key: const ValueKey('create-secure-invite-qr'),
                    onPressed: isCreatingQr
                        ? null
                        : () async {
                            setDialogState(() {
                              isCreatingQr = true;
                            });
                            try {
                              final generatedImage = await _renderQrImage(
                                restaurantName: restaurantName,
                                url: inviteUrl,
                                linkType: linkType,
                              );
                              if (dialogContext.mounted) {
                                Navigator.of(dialogContext).pop(generatedImage);
                              }
                            } catch (error) {
                              if (mounted) {
                                _showSnackBar(
                                  error is RestaurantQrImageException
                                      ? error.message
                                      : 'Could not create the invitation QR image.',
                                );
                              }
                              if (dialogContext.mounted) {
                                setDialogState(() {
                                  isCreatingQr = false;
                                });
                              }
                            }
                          },
                    icon: isCreatingQr
                        ? const SizedBox.square(
                            dimension: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.qr_code_2),
                    label: Text(
                      isCreatingQr ? 'Creating...' : 'Create QR Image',
                    ),
                  ),
                  FilledButton.icon(
                    key: const ValueKey('copy-secure-invite-link'),
                    onPressed: isCopying
                        ? null
                        : () async {
                            setDialogState(() {
                              isCopying = true;
                            });
                            try {
                              await _writeClipboard(inviteUrl);
                              if (mounted) {
                                _showSnackBar('Invite link copied.');
                              }
                            } catch (_) {
                              if (mounted) {
                                _showSnackBar(
                                  'Could not copy the invite link.',
                                );
                              }
                            } finally {
                              if (dialogContext.mounted) {
                                setDialogState(() {
                                  isCopying = false;
                                });
                              }
                            }
                          },
                    icon: isCopying
                        ? const SizedBox.square(
                            dimension: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.copy),
                    label: Text(isCopying ? 'Copying...' : 'Copy Link'),
                  ),
                ],
              );
            },
          );
        },
      );
      if (!mounted || image == null) {
        return;
      }
      final exit = await showRestaurantQrPreviewDialog(
        context: context,
        image: image,
        isSensitive: true,
        showBack: true,
        exporter: widget.qrExporter,
      );
      if (!mounted || exit != RestaurantQrPreviewExit.back) {
        return;
      }
    }
  }

  void _showSnackBar(String message) {
    if (!mounted) {
      return;
    }
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(content: Text(message), duration: const Duration(seconds: 3)),
      );
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        return SingleChildScrollView(
          key: const ValueKey('admin-link-generation-scroll-view'),
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
          child: Align(
            alignment: Alignment.topCenter,
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 1120),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _buildSearchCard(),
                  const SizedBox(height: 16),
                  _buildSearchState(),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _buildSearchCard() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Find restaurants',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 6),
              const Text(
                'Search the bounded BiteScore and BiteSaver catalogs before generating or copying a link.',
              ),
              const SizedBox(height: 16),
              LayoutBuilder(
                builder: (context, constraints) {
                  final wide = constraints.maxWidth >= 760;
                  final fieldWidth = wide
                      ? (constraints.maxWidth - 24) / 3
                      : constraints.maxWidth;
                  return Wrap(
                    spacing: 12,
                    runSpacing: 12,
                    children: [
                      SizedBox(
                        width: fieldWidth,
                        child: TextFormField(
                          key: const ValueKey('admin-link-location-field'),
                          controller: _locationController,
                          decoration: const InputDecoration(
                            labelText: 'ZIP code or City, ST',
                            hintText: '34428 or Crystal River, FL',
                            border: OutlineInputBorder(),
                          ),
                          textInputAction: TextInputAction.search,
                          validator: (value) =>
                              AdminLinkGenerationService.locationValidationError(
                                value ?? '',
                              ),
                          onFieldSubmitted: (_) => _submitSearch(),
                        ),
                      ),
                      SizedBox(
                        width: fieldWidth,
                        child: TextFormField(
                          key: const ValueKey(
                            'admin-link-restaurant-name-field',
                          ),
                          controller: _restaurantNameController,
                          decoration: const InputDecoration(
                            labelText: 'Restaurant name (optional)',
                            border: OutlineInputBorder(),
                          ),
                          textInputAction: TextInputAction.search,
                          validator: (value) =>
                              (value ?? '').trim().length > 100
                              ? 'Use no more than 100 characters.'
                              : null,
                          onFieldSubmitted: (_) => _submitSearch(),
                        ),
                      ),
                      SizedBox(
                        width: fieldWidth,
                        child: DropdownButtonFormField<int>(
                          key: const ValueKey('admin-link-radius-field'),
                          isExpanded: true,
                          initialValue: _radiusMiles,
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
                    ],
                  );
                },
              ),
              const SizedBox(height: 16),
              Text('Sources', style: Theme.of(context).textTheme.titleSmall),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: AdminRestaurantLinkSource.values
                    .map((source) {
                      return FilterChip(
                        key: ValueKey(
                          'admin-link-source-${source.callableValue}',
                        ),
                        label: Text(source.label),
                        selected: _selectedSources.contains(source),
                        onSelected: _isSearching
                            ? null
                            : (selected) => _toggleSource(source, selected),
                      );
                    })
                    .toList(growable: false),
              ),
              const SizedBox(height: 16),
              Wrap(
                crossAxisAlignment: WrapCrossAlignment.center,
                spacing: 12,
                runSpacing: 8,
                children: [
                  FilledButton.icon(
                    key: const ValueKey('admin-link-search-button'),
                    onPressed: _isSearching ? null : _submitSearch,
                    icon: _isSearching
                        ? const SizedBox.square(
                            dimension: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.search),
                    label: Text(_isSearching ? 'Searching...' : 'Search'),
                  ),
                  const Text('Maximum radius: 50 miles'),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSearchState() {
    if (_isSearching) {
      return const Center(
        key: ValueKey('admin-link-loading-state'),
        child: Padding(
          padding: EdgeInsets.all(24),
          child: CircularProgressIndicator(),
        ),
      );
    }
    if (_searchError != null) {
      return Card(
        key: const ValueKey('admin-link-error-state'),
        color: Theme.of(context).colorScheme.errorContainer,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Text(_searchError!),
        ),
      );
    }
    if (!_hasSubmitted) {
      return const Card(
        key: ValueKey('admin-link-initial-state'),
        child: Padding(
          padding: EdgeInsets.all(20),
          child: Text('Enter a ZIP code or City, ST to find restaurants.'),
        ),
      );
    }

    final result = _searchResult;
    if (result == null || result.results.isEmpty) {
      return const Card(
        key: ValueKey('admin-link-no-results-state'),
        child: Padding(
          padding: EdgeInsets.all(20),
          child: Text(
            'No matching restaurants were found within this search area.',
          ),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          '${result.results.length} restaurant ${result.results.length == 1 ? 'record' : 'records'} near ${result.searchCenter.displayName}',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        if (result.resultsMayBeTruncated) ...[
          const SizedBox(height: 12),
          Card(
            key: const ValueKey('admin-link-truncated-state'),
            color: Theme.of(context).colorScheme.tertiaryContainer,
            child: const Padding(
              padding: EdgeInsets.all(16),
              child: Text(
                'Results were limited. Narrow the radius or add a restaurant name to refine the search.',
              ),
            ),
          ),
        ],
        const SizedBox(height: 12),
        ...result.results.map(_buildResultCard),
      ],
    );
  }

  Widget _buildResultCard(AdminRestaurantLinkRecord record) {
    final stateAndZip = [
      record.state,
      record.zipCode,
    ].where((value) => value.isNotEmpty).join(' ');
    final locality = [
      record.city,
      stateAndZip,
    ].where((value) => value.isNotEmpty).join(', ');
    final isCouponInviteBusy = _isActionBusy(record, 'coupon-invite');
    final isClaimInviteBusy = _isActionBusy(record, 'claim-invite');
    final isCustomerLinkBusy = _isActionBusy(record, 'customer-link');
    final isCustomerQrBusy = _isActionBusy(record, 'customer-qr');

    return Card(
      key: ValueKey('admin-link-record-${record.recordKey}'),
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: 10,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(
                  record.restaurantName,
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Chip(
                  key: ValueKey('admin-link-source-label-${record.recordKey}'),
                  label: Text(record.source.label),
                ),
              ],
            ),
            const SizedBox(height: 8),
            if (record.streetAddress.isNotEmpty) Text(record.streetAddress),
            if (locality.isNotEmpty) Text(locality),
            const SizedBox(height: 6),
            Text('${record.distanceMiles.toStringAsFixed(1)} miles away'),
            if (record.phone.isNotEmpty) Text('Phone: ${record.phone}'),
            if (record.website.isNotEmpty) Text('Website: ${record.website}'),
            const SizedBox(height: 8),
            if (record.isBiteScore)
              Text(
                record.isActive != true
                    ? 'Inactive'
                    : record.isClaimed == true
                    ? 'Claimed'
                    : 'Unclaimed',
                key: ValueKey('admin-link-status-${record.recordKey}'),
              )
            else
              Text(
                'Approval: ${_approvalLabel(record.approvalStatus)}',
                key: ValueKey('admin-link-status-${record.recordKey}'),
              ),
            const SizedBox(height: 12),
            LayoutBuilder(
              builder: (context, actionConstraints) {
                final compactLabels =
                    actionConstraints.maxWidth < 420 ||
                    MediaQuery.textScalerOf(context).scale(14) > 21;
                return Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    if (record.isBiteSaver || record.isActive == true)
                      FilledButton.icon(
                        key: ValueKey('${record.recordKey}:coupon-invite'),
                        onPressed: isCouponInviteBusy
                            ? null
                            : () => _generateCouponInvite(record),
                        icon: isCouponInviteBusy
                            ? const SizedBox.square(
                                dimension: 16,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Icon(Icons.link),
                        label: Text(
                          isCouponInviteBusy
                              ? 'Generating...'
                              : compactLabels
                              ? 'Coupon Invite'
                              : 'Generate Coupon Invite',
                        ),
                      ),
                    if (record.isBiteScore &&
                        record.isActive == true &&
                        record.isClaimed != true)
                      OutlinedButton.icon(
                        key: ValueKey('${record.recordKey}:claim-invite'),
                        onPressed: isClaimInviteBusy
                            ? null
                            : () => _generateBiteScoreClaimInvite(record),
                        icon: isClaimInviteBusy
                            ? const SizedBox.square(
                                dimension: 16,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Icon(Icons.verified_user_outlined),
                        label: Text(
                          isClaimInviteBusy
                              ? 'Generating...'
                              : compactLabels
                              ? 'Claim Invite'
                              : 'Generate BiteScore Claim Invite',
                        ),
                      ),
                    if (record.isBiteScore &&
                        record.isActive == true &&
                        record.isClaimed == true)
                      const Chip(label: Text('Already claimed')),
                    if (record.isBiteScore && record.isActive == true)
                      OutlinedButton.icon(
                        key: ValueKey('${record.recordKey}:customer-link'),
                        onPressed: isCustomerLinkBusy
                            ? null
                            : () => _copyCustomerLink(record),
                        icon: const Icon(Icons.copy),
                        label: Text(
                          isCustomerLinkBusy
                              ? 'Copying...'
                              : compactLabels
                              ? 'BiteScore Link'
                              : 'Copy Customer BiteScore Link',
                        ),
                      ),
                    if (record.isBiteScore && record.isActive == true)
                      OutlinedButton.icon(
                        key: ValueKey('${record.recordKey}:customer-qr'),
                        onPressed: isCustomerQrBusy
                            ? null
                            : () => _createCustomerQr(record),
                        icon: isCustomerQrBusy
                            ? const SizedBox.square(
                                dimension: 16,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Icon(Icons.qr_code_2),
                        label: Text(
                          isCustomerQrBusy
                              ? 'Creating...'
                              : compactLabels
                              ? 'Customer QR'
                              : 'Create Customer QR',
                        ),
                      ),
                    if (record.isBiteSaver)
                      OutlinedButton.icon(
                        key: ValueKey('${record.recordKey}:customer-link'),
                        onPressed:
                            !record.canCopyCouponCustomerLink ||
                                isCustomerLinkBusy
                            ? null
                            : () => _copyCustomerLink(record),
                        icon: const Icon(Icons.copy),
                        label: Text(
                          isCustomerLinkBusy
                              ? 'Copying...'
                              : compactLabels
                              ? 'Coupon Link'
                              : 'Copy Customer Coupon Link',
                        ),
                      ),
                    if (record.canCopyCouponCustomerLink)
                      OutlinedButton.icon(
                        key: ValueKey('${record.recordKey}:customer-qr'),
                        onPressed: isCustomerQrBusy
                            ? null
                            : () => _createCustomerQr(record),
                        icon: isCustomerQrBusy
                            ? const SizedBox.square(
                                dimension: 16,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Icon(Icons.qr_code_2),
                        label: Text(
                          isCustomerQrBusy
                              ? 'Creating...'
                              : compactLabels
                              ? 'Customer QR'
                              : 'Create Customer QR',
                        ),
                      ),
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  String _approvalLabel(String? status) {
    final normalized = status?.trim().toLowerCase() ?? '';
    if (normalized.isEmpty) {
      return 'Unknown';
    }
    return '${normalized[0].toUpperCase()}${normalized.substring(1)}';
  }
}
