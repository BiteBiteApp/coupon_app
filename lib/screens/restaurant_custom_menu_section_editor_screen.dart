import 'package:flutter/material.dart';

import '../services/app_error_text.dart';
import '../services/restaurant_account_service.dart';
import '../services/restaurant_menu_service.dart';
import '../widgets/restaurant_menu_section_card.dart';

class RestaurantCustomMenuSectionEditorScreen extends StatefulWidget {
  final RestaurantMenuSource source;
  final RestaurantMenuSection? section;

  const RestaurantCustomMenuSectionEditorScreen({
    super.key,
    required this.source,
    this.section,
  });

  @override
  State<RestaurantCustomMenuSectionEditorScreen> createState() =>
      _RestaurantCustomMenuSectionEditorScreenState();
}

class _RestaurantCustomMenuSectionEditorScreenState
    extends State<RestaurantCustomMenuSectionEditorScreen> {
  late final TextEditingController _titleController;
  late final TextEditingController _bodyController;
  bool _isSaving = false;
  String? _errorText;

  @override
  void initState() {
    super.initState();
    _titleController = TextEditingController(text: widget.section?.title ?? '');
    _bodyController = TextEditingController(text: widget.section?.body ?? '');
    _titleController.addListener(_refreshPreview);
    _bodyController.addListener(_refreshPreview);
  }

  @override
  void dispose() {
    _titleController
      ..removeListener(_refreshPreview)
      ..dispose();
    _bodyController
      ..removeListener(_refreshPreview)
      ..dispose();
    super.dispose();
  }

  void _refreshPreview() {
    if (mounted) {
      setState(() {});
    }
  }

  Future<void> _save() async {
    setState(() {
      _isSaving = true;
      _errorText = null;
    });

    try {
      await RestaurantMenuService.saveMenuSection(
        source: widget.source,
        title: _titleController.text,
        body: _bodyController.text,
        existingSectionId: widget.section?.id,
      );
      if (!mounted) {
        return;
      }
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _errorText = AppErrorText.friendly(
          error,
          fallback: 'Could not save this custom section right now.',
        );
        _isSaving = false;
      });
    }
  }

  InputDecoration _inputDecoration(String label, String hint) {
    return InputDecoration(
      labelText: label,
      hintText: hint,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
    );
  }

  Widget _buildPreview() {
    final title = _titleController.text.trim().isEmpty
        ? 'Section title'
        : _titleController.text.trim();
    final body = _bodyController.text.trim().isEmpty
        ? 'Menu details will preview here.'
        : _bodyController.text.trim();
    final realMenuWidth = (MediaQuery.sizeOf(context).width - 32)
        .clamp(280.0, 560.0)
        .toDouble();

    return Center(
      child: Container(
        width: 320,
        height: 260,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: const Color(0xFF171717),
          borderRadius: BorderRadius.circular(28),
          boxShadow: const [
            BoxShadow(
              color: Color.fromRGBO(0, 0, 0, 0.16),
              blurRadius: 18,
              offset: Offset(0, 10),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(18),
          child: FittedBox(
            alignment: Alignment.topCenter,
            fit: BoxFit.scaleDown,
            child: SizedBox(
              width: realMenuWidth,
              child: RestaurantMenuSectionCard(title: title, body: body),
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isEditing = widget.section != null;
    return Scaffold(
      appBar: AppBar(
        title: Text(isEditing ? 'Edit Custom Section' : 'Add Custom Section'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (_errorText != null) ...[
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFFFFF1F2),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFFFCA5A5)),
              ),
              child: Text(
                _errorText!,
                style: const TextStyle(
                  color: Color(0xFF991B1B),
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            const SizedBox(height: 12),
          ],
          TextField(
            controller: _titleController,
            textInputAction: TextInputAction.next,
            decoration: _inputDecoration('Section title', 'Pizza Sizes'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _bodyController,
            minLines: 8,
            maxLines: 14,
            keyboardType: TextInputType.multiline,
            decoration: _inputDecoration(
              'Menu text',
              'Small 10" - \$9.99\nMedium 14" - \$13.99\nLarge 18" - \$17.99',
            ),
          ),
          const SizedBox(height: 18),
          const Text(
            'Live Preview',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 10),
          _buildPreview(),
          const SizedBox(height: 20),
          FilledButton.icon(
            onPressed: _isSaving ? null : _save,
            icon: _isSaving
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.save_outlined),
            label: Text(_isSaving ? 'Saving...' : 'Save'),
          ),
        ],
      ),
    );
  }
}
