import '../widgets/owner_photo_check_feedback.dart';
import '../widgets/bitescore_terms_gate.dart';
import '../services/bitescore_terms_service.dart';
import '../services/owner_photo_screening_service.dart';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:cloud_functions/cloud_functions.dart';
import '../models/daily_special.dart';
import '../services/bitesaver_owner_media_service.dart';
import '../services/app_error_text.dart';
import '../widgets/bitesaver_restaurant_images.dart';
import 'bitesaver_photo_viewer.dart';

/// Owner-bound drafts. Publishing is one server transaction; switching modes is local.
class BiteSaverMediaEditorScreen extends StatefulWidget {
  final String ownerUid;
  final bool photos;
  final BiteSaverOwnerMediaService service;
  final Future<Map<String, dynamic>?> Function(String, int)? upload;
  @visibleForTesting
  final Future<bool> Function(BuildContext)? termsGate;
  BiteSaverMediaEditorScreen({
    super.key,
    required this.ownerUid,
    required this.photos,
    BiteSaverOwnerMediaService? service,
    this.upload,
    this.termsGate,
  }) : service = service ?? BiteSaverOwnerMediaService();
  @override
  State<BiteSaverMediaEditorScreen> createState() =>
      _BiteSaverMediaEditorScreenState();
}

class _BiteSaverMediaEditorScreenState
    extends State<BiteSaverMediaEditorScreen> {
  Map<String, dynamic>? _saved;
  Map<String, dynamic> _media = {};
  List<Map<String, dynamic>> _specials = [];
  Map<String, dynamic>? _board;
  List<String> _gallery = [];
  String _mode = 'manual';
  String? _boardImage;
  bool _busy = true, _dirty = false, _allowPop = false;
  String? _error;
  Map<String, dynamic>? _pending;
  int _formRevision = 0;
  int get _version => (_media['version'] as num?)?.toInt() ?? 0;
  List<Map<String, dynamic>> get _images => ((_media['images'] as List?) ?? [])
      .map((v) => Map<String, dynamic>.from(v as Map))
      .toList();
  @override
  void initState() {
    super.initState();
    _load();
  }

  bool get _editable => !_busy && _pending == null;
  Future<bool> _acceptTerms() async {
    final accepted = widget.termsGate != null
        ? await widget.termsGate!(context)
        : await BiteScoreTermsGate.ensureAccepted(
            context,
            expectedUserId: widget.ownerUid,
            isCurrent: () =>
                mounted && widget.service.isCurrentOwner(widget.ownerUid),
          );
    return accepted &&
        mounted &&
        widget.service.isCurrentOwner(widget.ownerUid);
  }

  Future<void> _load() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final value = await widget.service.load(widget.ownerUid);
      if (!mounted) return;
      _saved = value;
      _media = Map<String, dynamic>.from(value['media'] as Map);
      _gallery = List<String>.from(_media['gallery'] as List);
      _mode = _media['mode'] as String;
      _boardImage = _media['boardImage'] as String?;
      final list = (value['specials'] as List)
          .map((raw) => Map<String, dynamic>.from(raw as Map))
          .toList();
      _specials = [];
      _board = null;
      for (final raw in list) {
        final draft = _draft(raw);
        if (raw['id'] == 'bitesaver_managed_board' &&
            raw['managedBoard'] == true) {
          _board = draft;
        } else {
          _specials.add(draft);
        }
      }
      _pending = null;
      _dirty = false;
      _formRevision++;
    } catch (error) {
      _error = AppErrorText.friendly(
        error,
        fallback: 'Could not load your photos and specials. Try again.',
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Map<String, dynamic> _draft(Map<String, dynamic> raw) => {
    'id': raw['id'],
    'title': raw['title'] ?? '',
    'details': raw['details'],
    'isActive': raw['isActive'] ?? true,
    'availabilityMode': raw['availabilityMode'] ?? 'todayOnly',
    'daysOfWeek': List<int>.from(raw['daysOfWeek'] as List? ?? []),
    'allDay': raw['allDay'] ?? true,
    'startTime': raw['startTime'],
    'endTime': raw['endTime'],
    'hideWhenUnavailable': raw['hideWhenUnavailable'] ?? true,
    'expiresAtMillis':
        raw['expiresAt'] ??
        DailySpecial.endOfLocalDay(DateTime.now()).millisecondsSinceEpoch,
    'imageId': (_media['specialImages'] as Map?)?[raw['id']],
  };
  Map<String, dynamic> _newSpecial({bool board = false}) => _draft({
    'id': board
        ? 'bitesaver_managed_board'
        : BiteSaverOwnerMediaService.newId(),
    'title': board ? 'Daily Specials board' : '',
  });
  void _change(VoidCallback action) {
    if (!_editable) return;
    setState(() {
      action();
      _dirty = true;
      _error = null;
    });
  }

  String? _url(String? id) {
    if (id == 'legacy-main') return _media['legacyMain'] as String?;
    return _images.where((image) => image['id'] == id).firstOrNull?['url']
        as String?;
  }

  final Map<String, String> _previews = {};

  Future<void> _upload(
    void Function(String) assign, {
    String targetId = 'gallery',
  }) async {
    if (!_editable) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final oldIds = _images.map((i) => i['id']).toSet();
    try {
      if ((BiteScoreTermsService.enabled || widget.termsGate != null) &&
          !await _acceptTerms()) {
        return;
      }
      final result = widget.upload != null
          ? await widget.upload!(widget.ownerUid, _version)
          : await widget.service.upload(
              widget.ownerUid,
              _version,
              targetId: targetId,
            );
      if (!mounted || result == null) return;
      widget.service.requireOwner(widget.ownerUid);
      _media = Map<String, dynamic>.from(result['media'] as Map);
      final addedId =
          result['registeredImageId'] as String? ??
          _images.where((i) => !oldIds.contains(i['id'])).single['id']
              as String;
      if (OwnerPhotoScreeningService.isEnabled && addedId.startsWith('bso_')) {
        try {
          final preview = await OwnerPhotoScreeningService().preview(addedId);
          if (preview != null) _previews[addedId] = preview;
        } catch (_) {
          // Preview failure does not discard an approved selection. Saving
          // still uses the exact server-validated image receipt.
        }
        if (!mounted) return;
        widget.service.requireOwner(widget.ownerUid);
      }
      assign(addedId);
      _dirty = true;
    } catch (error) {
      if (mounted) {
        showOwnerPhotoCheckFeedback(context, error);
        _error = AppErrorText.friendly(
          error,
          fallback:
              'Photo upload could not be confirmed. Your saved content is unchanged. Use Add or Replace again to retry this same photo.',
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<bool> _confirm(String title, String message) async =>
      await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(title),
          content: Text(message),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Continue'),
            ),
          ],
        ),
      ) ??
      false;
  Future<void> _save() async {
    if (_busy || _saved == null) return;
    if (_pending == null && !widget.photos) {
      String? validation;
      if (_mode == 'photo' && _boardImage == null) {
        validation = 'Choose a board photo before saving.';
      }
      for (final special in [..._specials, if (_boardImage != null) _board!]) {
        if ((special['title'] as String).trim().isEmpty) {
          validation = 'Enter a title for each Daily Special.';
          break;
        }
        if (special['availabilityMode'] == 'specificDays' &&
            (special['daysOfWeek'] as List).isEmpty) {
          validation = 'Select available days for each Daily Special.';
          break;
        }
        final time = RegExp(r'^(?:[01]\d|2[0-3]):[0-5]\d$');
        final start = special['startTime'] as String? ?? '';
        final end = special['endTime'] as String? ?? '';
        if (special['allDay'] != true &&
            (!time.hasMatch(start) ||
                !time.hasMatch(end) ||
                end.compareTo(start) <= 0)) {
          validation =
              'Enter a valid start and later end time for each Daily Special.';
          break;
        }
      }
      if (validation != null) {
        setState(() => _error = validation);
        return;
      }
    }
    if (_pending == null &&
        _mode != (_saved!['media'] as Map)['mode'] &&
        !await _confirm(
          'Change published board?',
          'Only the selected mode will appear to customers. Your other board content will be kept for editing.',
        )) {
      return;
    }
    if (!mounted) return;
    _pending ??= {
      'action': 'publish',
      'section': widget.photos ? 'photos' : 'specials',
      'expectedVersion': _version,
      'requestId': BiteSaverOwnerMediaService.newId(),
      'gallery': List.of(_gallery),
      'mode': _mode,
      'boardImage': _boardImage,
      'board': _board ?? _newSpecial(board: true),
      'specials': _specials.map((v) => Map<String, dynamic>.from(v)).toList(),
      'contentFingerprint': _saved!['contentFingerprint'],
    };
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if ((BiteScoreTermsService.enabled || widget.termsGate != null) &&
          BiteSaverOwnerMediaService.publishes(_saved!, _pending!) &&
          !await _acceptTerms()) {
        if (mounted) {
          setState(() {
            _pending = null;
            _busy = false;
          });
        }
        return;
      }
      await widget.service.save(widget.ownerUid, _pending!);
      if (!mounted) return;
      await _load();
      if (mounted && _error == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Restaurant photos and specials saved.'),
          ),
        );
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          // A rejected transaction made no changes; let the owner repair the draft.
          // Transport failures retain the exact request for an idempotent retry.
          if (error is FirebaseFunctionsException &&
              error.code == 'invalid-argument') {
            _pending = null;
          }
          _error = AppErrorText.friendly(
            error,
            fallback:
                'Save could not be confirmed. Retry the same save or reload saved content.',
          );
          _busy = false;
        });
      }
    }
  }

  Future<void> _leave() async {
    if (_busy) return;
    if ((_dirty || _pending != null) &&
        !await _confirm(
          'Discard this draft?',
          _pending != null
              ? 'A save may already have completed. Leaving discards only this local draft. Reopen to check saved content.'
              : 'Your previously saved photos and specials will stay as they are. Unsaved uploaded photos remain listed for safe removal.',
        )) {
      return;
    }
    if (mounted) {
      setState(() => _allowPop = true);
      Navigator.pop(context);
    }
  }

  Future<void> _removeUnused(Map<String, dynamic> image) async {
    if (!_editable ||
        !await _confirm(
          'Delete unused photo?',
          'Delete this unused uploaded file? Published and saved draft references must be removed and saved first.',
        )) {
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.service.remove(widget.ownerUid, image);
      if (mounted) await _load();
    } catch (error) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = AppErrorText.friendly(
            error,
            fallback:
                'The photo could not be deleted. Its removal can be retried safely.',
          );
        });
      }
    }
  }

  Widget _photo(String? id, {double height = 100, String? legacyUrl}) =>
      SizedBox(
        height: height,
        width: double.infinity,
        child: InkWell(
          onTap: _previews[id] != null || (_url(id) ?? legacyUrl) == null
              ? null
              : () => Navigator.push(
                  context,
                  MaterialPageRoute<void>(
                    builder: (_) => BiteSaverPhotoViewer(
                      title: 'Restaurant photo',
                      imageUrl: (_url(id) ?? legacyUrl)!,
                    ),
                  ),
                ),
          child: _previews[id] != null
              ? Image.memory(base64Decode(_previews[id]!), fit: BoxFit.contain)
              : BiteSaverRestaurantImage(
                  imageUrl: _url(id) ?? legacyUrl,
                  fit: BoxFit.contain,
                ),
        ),
      );
  Widget _photos() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      const Text(
        'The first photo is your main restaurant photo. Up to 12 photos; JPEG or PNG, up to 5 MB each.',
      ),
      for (final id in _gallery)
        Card(
          key: ValueKey('gallery-$id'),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              children: [
                _photo(id),
                if (_gallery.first == id) const Text('Main photo'),
                Wrap(
                  spacing: 8,
                  children: [
                    if (_gallery.first != id)
                      TextButton(
                        onPressed: _editable
                            ? () => _change(() {
                                _gallery.remove(id);
                                _gallery.insert(0, id);
                              })
                            : null,
                        child: const Text('Make Main'),
                      ),
                    TextButton(
                      onPressed: _editable
                          ? () => _upload((next) {
                              _gallery[_gallery.indexOf(id)] = next;
                            })
                          : null,
                      child: const Text('Replace'),
                    ),
                    TextButton(
                      onPressed: _editable
                          ? () => _change(() => _gallery.remove(id))
                          : null,
                      child: const Text('Remove'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      OutlinedButton.icon(
        onPressed: _editable && _gallery.length < 12
            ? () => _upload(_gallery.add)
            : null,
        icon: const Icon(Icons.add_a_photo_outlined),
        label: const Text('Add Restaurant Photo'),
      ),
    ],
  );
  Widget _specialForm(Map<String, dynamic> special, {bool board = false}) {
    final legacyUrl = special['removeLegacyImage'] == true
        ? null
        : ((_media['legacySpecialImages'] as Map?)?[special['id']]
                  as String?) ??
              ((_saved?['specials'] as List?)
                      ?.cast<Map>()
                      .where((s) => s['id'] == special['id'])
                      .firstOrNull?['imageUrl']
                  as String?);
    final hasPhoto = special['imageId'] != null || legacyUrl != null;
    return Card(
      key: ValueKey('${special['id']}-$_formRevision'),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (!board) ...[
              TextFormField(
                initialValue: special['title'] as String,
                enabled: _editable,
                maxLength: 200,
                decoration: const InputDecoration(labelText: 'Title'),
                onChanged: (value) => _change(() => special['title'] = value),
              ),
              TextFormField(
                initialValue: special['details'] as String?,
                enabled: _editable,
                minLines: 1,
                maxLines: 4,
                maxLength: 2000,
                decoration: const InputDecoration(
                  labelText: 'Details (Optional)',
                ),
                onChanged: (value) => _change(() => special['details'] = value),
              ),
              if (hasPhoto)
                _photo(special['imageId'] as String?, legacyUrl: legacyUrl),
              Wrap(
                spacing: 8,
                children: [
                  OutlinedButton(
                    onPressed: _editable
                        ? () => _upload((id) {
                            special['imageId'] = id;
                            special['removeLegacyImage'] = true;
                          }, targetId: special['id'] as String)
                        : null,
                    child: Text(
                      !hasPhoto ? 'Add Optional Photo' : 'Replace Photo',
                    ),
                  ),
                  if (hasPhoto)
                    TextButton(
                      onPressed: _editable
                          ? () => _change(() {
                              special['imageId'] = null;
                              special['removeLegacyImage'] = true;
                            })
                          : null,
                      child: const Text('Remove Photo'),
                    ),
                ],
              ),
            ],
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Active'),
              value: special['isActive'] == true,
              onChanged: _editable
                  ? (v) => _change(() => special['isActive'] = v)
                  : null,
            ),
            DropdownButtonFormField<String>(
              isExpanded: true,
              initialValue: special['availabilityMode'] as String,
              decoration: const InputDecoration(labelText: 'Availability'),
              items: const [
                DropdownMenuItem(
                  value: 'todayOnly',
                  child: Text(
                    'Today only',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                DropdownMenuItem(
                  value: 'specificDays',
                  child: Text(
                    'Specific days',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
              onChanged: _editable
                  ? (v) => _change(() {
                      special['availabilityMode'] = v;
                      if (v == 'todayOnly') {
                        special['expiresAtMillis'] = DailySpecial.endOfLocalDay(
                          DateTime.now(),
                        ).millisecondsSinceEpoch;
                      }
                    })
                  : null,
            ),
            if (special['availabilityMode'] == 'specificDays')
              Wrap(
                spacing: 4,
                children: [
                  for (var day = 1; day <= 7; day++)
                    FilterChip(
                      label: Text(
                        const [
                          'Mon',
                          'Tue',
                          'Wed',
                          'Thu',
                          'Fri',
                          'Sat',
                          'Sun',
                        ][day - 1],
                      ),
                      selected: (special['daysOfWeek'] as List).contains(day),
                      onSelected: _editable
                          ? (selected) => _change(() {
                              final days = special['daysOfWeek'] as List;
                              selected ? days.add(day) : days.remove(day);
                            })
                          : null,
                    ),
                ],
              ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('All day'),
              value: special['allDay'] == true,
              onChanged: _editable
                  ? (v) => _change(() => special['allDay'] = v)
                  : null,
            ),
            if (special['allDay'] != true) ...[
              for (final field in ['startTime', 'endTime'])
                TextFormField(
                  initialValue: special[field] as String?,
                  enabled: _editable,
                  decoration: InputDecoration(
                    labelText: field == 'startTime'
                        ? 'Start time (24-hour HH:mm)'
                        : 'End time (24-hour HH:mm)',
                  ),
                  onChanged: (v) => _change(() => special[field] = v),
                ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Hide outside available hours'),
                value: special['hideWhenUnavailable'] == true,
                onChanged: _editable
                    ? (v) => _change(() => special['hideWhenUnavailable'] = v)
                    : null,
              ),
            ],
            if (!board)
              TextButton.icon(
                onPressed: _editable
                    ? () async {
                        if (await _confirm(
                          'Remove this special?',
                          'It will be removed when you save. Canceling the editor keeps the saved special.',
                        )) {
                          _change(() => _specials.remove(special));
                        }
                      }
                    : null,
                icon: const Icon(Icons.delete_outline),
                label: const Text('Remove Special'),
              ),
          ],
        ),
      ),
    );
  }

  Widget _specialEditor() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      const Text(
        'Choose one published board. Switching here does not change saved content until you save.',
      ),
      DropdownButtonFormField<String>(
        key: ValueKey('mode-$_mode'),
        initialValue: _mode,
        isExpanded: true,
        items: const [
          DropdownMenuItem(
            value: 'manual',
            child: Text(
              'Manual Daily Specials',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          DropdownMenuItem(
            value: 'photo',
            child: Text(
              'Photographed Daily Specials board',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
        onChanged: _editable
            ? (value) => _change(() {
                _mode = value!;
                _board ??= _newSpecial(board: true);
              })
            : null,
      ),
      if (_mode == 'manual') ...[
        for (final special in _specials) _specialForm(special),
        OutlinedButton.icon(
          onPressed: _editable && _specials.length < 50
              ? () => _change(() => _specials.add(_newSpecial()))
              : null,
          icon: const Icon(Icons.add),
          label: const Text('Add Another Daily Special'),
        ),
      ] else ...[
        if (_boardImage != null) _photo(_boardImage, height: 220),
        OutlinedButton.icon(
          onPressed: _editable
              ? () => _upload((id) {
                  _boardImage = id;
                  _board ??= _newSpecial(board: true);
                }, targetId: 'board')
              : null,
          icon: const Icon(Icons.add_a_photo_outlined),
          label: Text(
            _boardImage == null ? 'Upload Board Photo' : 'Replace Board Photo',
          ),
        ),
        _specialForm(_board ??= _newSpecial(board: true), board: true),
      ],
    ],
  );
  @override
  Widget build(BuildContext context) {
    final savedMedia = _saved?['media'] as Map?;
    final referenced = {
      ...List<String>.from(savedMedia?['gallery'] as List? ?? []),
      savedMedia?['boardImage'],
      ...(savedMedia?['specialImages'] as Map? ?? {}).values,
    };
    final unused = _images
        .where(
          (image) =>
              !referenced.contains(image['id']) &&
              !_gallery.contains(image['id']) &&
              _boardImage != image['id'] &&
              !_specials.any((s) => s['imageId'] == image['id']),
        )
        .toList();
    return PopScope(
      canPop: _allowPop,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _leave();
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(widget.photos ? 'Restaurant Photos' : 'Daily Specials'),
          leading: IconButton(
            onPressed: _busy ? null : _leave,
            icon: const Icon(Icons.arrow_back),
          ),
        ),
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (_busy) const LinearProgressIndicator(),
              if (_error != null) ...[
                Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
                TextButton(
                  onPressed: _busy
                      ? null
                      : () async {
                          if (!_dirty ||
                              await _confirm(
                                'Reload saved content?',
                                'This discards the local draft and checks whether a previous save completed.',
                              )) {
                            _load();
                          }
                        },
                  child: const Text('Reload saved content'),
                ),
              ],
              if (_saved != null) ...[
                widget.photos
                    ? _photos()
                    : _saved?['specialsOverflow'] == true
                    ? const Text(
                        'More than 50 Daily Specials are saved. Return to the existing Daily Specials list and remove unwanted entries before using this editor. Unused uploaded photos can still be deleted below.',
                      )
                    : _specialEditor(),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed:
                      _busy ||
                          (!widget.photos &&
                              _saved?['specialsOverflow'] == true)
                      ? null
                      : _save,
                  child: Text(
                    _busy
                        ? 'Please wait…'
                        : _pending != null
                        ? 'Retry Save'
                        : 'Save Changes',
                  ),
                ),
                TextButton(
                  onPressed: _busy ? null : _leave,
                  child: const Text('Cancel'),
                ),
                if (unused.isNotEmpty && !_dirty) ...[
                  const Divider(),
                  const Text('Unused uploaded photos'),
                  for (final image in unused)
                    ListTile(
                      title: SizedBox(
                        height: 60,
                        child: BiteSaverRestaurantImage(
                          imageUrl: image['url'] as String,
                          fit: BoxFit.contain,
                        ),
                      ),
                      trailing: IconButton(
                        tooltip: 'Delete unused photo',
                        onPressed: _editable
                            ? () => _removeUnused(image)
                            : null,
                        icon: const Icon(Icons.delete_outline),
                      ),
                    ),
                ],
              ],
            ],
          ),
        ),
      ),
    );
  }
}
