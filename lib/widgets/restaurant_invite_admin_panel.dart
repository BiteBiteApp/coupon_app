import 'package:flutter/material.dart';

import '../services/app_error_text.dart';
import '../services/restaurant_invite_service.dart';

class RestaurantInviteAdminPanel extends StatefulWidget {
  final String? side;

  const RestaurantInviteAdminPanel({super.key, this.side});

  @override
  State<RestaurantInviteAdminPanel> createState() =>
      _RestaurantInviteAdminPanelState();
}

class _RestaurantInviteAdminPanelState
    extends State<RestaurantInviteAdminPanel> {
  late Future<List<RestaurantInviteAdminEntry>> _invitesFuture;
  String? _busyInviteId;

  @override
  void initState() {
    super.initState();
    _invitesFuture = _loadInvites();
  }

  Future<List<RestaurantInviteAdminEntry>> _loadInvites() {
    return RestaurantInviteService.listInvites(side: widget.side);
  }

  void _refresh() {
    setState(() {
      _invitesFuture = _loadInvites();
    });
  }

  Future<void> _revoke(RestaurantInviteAdminEntry invite) async {
    setState(() {
      _busyInviteId = invite.id;
    });

    try {
      await RestaurantInviteService.revokeInvite(invite.id);
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Invite revoked.')));
      _refresh();
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            AppErrorText.friendly(
              error,
              fallback: 'Could not revoke this invite right now.',
            ),
          ),
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _busyInviteId = null;
        });
      }
    }
  }

  String _formatDate(DateTime? date) {
    if (date == null) {
      return 'Unknown';
    }
    final local = date.toLocal();
    final month = local.month.toString().padLeft(2, '0');
    final day = local.day.toString().padLeft(2, '0');
    return '$month/$day/${local.year}';
  }

  String _sideLabel(String side) {
    return switch (side.trim().toLowerCase()) {
      'coupon' => 'Coupon',
      'bitescore' => 'BiteScore',
      _ => side,
    };
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<RestaurantInviteAdminEntry>>(
      future: _invitesFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }

        if (snapshot.hasError) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Text(
                AppErrorText.load('restaurant invites'),
                textAlign: TextAlign.center,
              ),
            ),
          );
        }

        final invites = snapshot.data ?? const <RestaurantInviteAdminEntry>[];
        if (invites.isEmpty) {
          return Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.link_off_outlined, size: 42),
              const SizedBox(height: 12),
              const Text(
                'No invites yet.',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: _refresh,
                icon: const Icon(Icons.refresh),
                label: const Text('Refresh'),
              ),
            ],
          );
        }

        return Column(
          children: [
            Align(
              alignment: Alignment.centerRight,
              child: OutlinedButton.icon(
                onPressed: _refresh,
                icon: const Icon(Icons.refresh),
                label: const Text('Refresh'),
              ),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: ListView.separated(
                itemCount: invites.length,
                separatorBuilder: (_, _) => const Divider(height: 1),
                itemBuilder: (context, index) {
                  final invite = invites[index];
                  final isBusy = _busyInviteId == invite.id;
                  return ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(
                      invite.restaurantName.isEmpty
                          ? 'Unnamed restaurant'
                          : invite.restaurantName,
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                    subtitle: Text(
                      [
                        _sideLabel(invite.side),
                        if (invite.type.isNotEmpty) invite.type,
                        'Status: ${invite.status}',
                        'Uses: ${invite.useCount}/${invite.maxUses}',
                        'Created: ${_formatDate(invite.createdAt)}',
                        'Expires: ${_formatDate(invite.expiresAt)}',
                        if (invite.usedAt != null)
                          'Used: ${_formatDate(invite.usedAt)}',
                        if (invite.revokedAt != null)
                          'Revoked: ${_formatDate(invite.revokedAt)}',
                        if (invite.restaurantId.isNotEmpty)
                          'Restaurant ID: ${invite.restaurantId}'
                        else if (invite.pendingRestaurantKey.isNotEmpty)
                          'Pending key: ${invite.pendingRestaurantKey}',
                        if (invite.createdByEmail.isNotEmpty)
                          'By: ${invite.createdByEmail}',
                      ].join(' • '),
                    ),
                    trailing: invite.isActive
                        ? TextButton(
                            onPressed: isBusy ? null : () => _revoke(invite),
                            child: Text(isBusy ? 'Revoking...' : 'Revoke'),
                          )
                        : null,
                  );
                },
              ),
            ),
          ],
        );
      },
    );
  }
}
