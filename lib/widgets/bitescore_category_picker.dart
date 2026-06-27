import 'package:flutter/material.dart';

import '../models/bitescore_category.dart';
import '../models/bitescore_dish.dart';
import 'biterater_theme.dart';

class BitescoreCategorySelection {
  final BitescoreCategory? category;
  final String? legacyCategory;
  final String? subcategory;
  final String manualKeywords;

  const BitescoreCategorySelection({
    this.category,
    this.legacyCategory,
    this.subcategory,
    this.manualKeywords = '',
  });

  factory BitescoreCategorySelection.fromDish(BitescoreDish dish) {
    return BitescoreCategorySelection.fromValues(
      category: dish.category,
      subcategory: dish.subcategory,
      manualKeywords: dish.categoryManualKeywords,
    );
  }

  factory BitescoreCategorySelection.fromValues({
    String? category,
    String? subcategory,
    String? manualKeywords,
  }) {
    final matchedCategory = BitescoreCategories.byIdOrName(category);
    final trimmedCategory = category?.trim() ?? '';

    return BitescoreCategorySelection(
      category: matchedCategory,
      legacyCategory: matchedCategory == null && trimmedCategory.isNotEmpty
          ? trimmedCategory
          : null,
      subcategory: subcategory?.trim().isEmpty ?? true
          ? null
          : subcategory?.trim(),
      manualKeywords: manualKeywords?.trim() ?? '',
    );
  }

  bool get hasCategory =>
      category != null || (legacyCategory?.trim().isNotEmpty ?? false);

  bool get needsSubcategory => category?.hasSubcategories ?? false;

  bool get hasRequiredSubcategory =>
      !needsSubcategory || (subcategory?.trim().isNotEmpty ?? false);

  String get categoryDisplayName =>
      category?.displayName ?? legacyCategory?.trim() ?? '';

  String? get categoryForSave {
    final trimmed = categoryDisplayName.trim();
    return trimmed.isEmpty ? null : trimmed;
  }

  String? get subcategoryForSave {
    final trimmed = subcategory?.trim() ?? '';
    return trimmed.isEmpty ? null : trimmed;
  }

  String? get manualKeywordsForSave {
    if (!isOtherSelection) {
      return null;
    }
    final trimmed = manualKeywords.trim();
    return trimmed.isEmpty ? null : trimmed;
  }

  bool get isOtherSelection {
    return category?.displayName == BitescoreCategories.otherLabel ||
        subcategory == BitescoreCategories.otherLabel;
  }

  bool get isMainCategoryOther {
    return category?.displayName == BitescoreCategories.otherLabel &&
        (subcategory?.trim().isEmpty ?? true);
  }

  String get displayText {
    final categoryName = categoryDisplayName;
    final subcategoryName = subcategory?.trim() ?? '';
    if (categoryName.isEmpty) {
      return 'Choose a category';
    }
    if (subcategoryName.isEmpty) {
      return categoryName;
    }
    return '$categoryName · $subcategoryName';
  }

  String? validate() {
    if (!hasCategory) {
      return 'Please choose a category.';
    }
    if (!hasRequiredSubcategory) {
      return 'Please choose a subcategory.';
    }
    if (isMainCategoryOther && manualKeywords.trim().isEmpty) {
      return 'Please describe the category.';
    }
    return null;
  }

  BitescoreCategorySelection copyWith({
    BitescoreCategory? category,
    bool clearCategory = false,
    String? legacyCategory,
    bool clearLegacyCategory = false,
    String? subcategory,
    bool clearSubcategory = false,
    String? manualKeywords,
  }) {
    return BitescoreCategorySelection(
      category: clearCategory ? null : category ?? this.category,
      legacyCategory: clearLegacyCategory
          ? null
          : legacyCategory ?? this.legacyCategory,
      subcategory: clearSubcategory ? null : subcategory ?? this.subcategory,
      manualKeywords: manualKeywords ?? this.manualKeywords,
    );
  }
}

class BitescoreCategoryPicker extends StatefulWidget {
  final BitescoreCategorySelection selection;
  final ValueChanged<BitescoreCategorySelection> onChanged;
  final bool enabled;
  final bool showError;
  final bool enableTopLevelOtherUndo;

  const BitescoreCategoryPicker({
    super.key,
    required this.selection,
    required this.onChanged,
    this.enabled = true,
    this.showError = false,
    this.enableTopLevelOtherUndo = false,
  });

  @override
  State<BitescoreCategoryPicker> createState() =>
      _BitescoreCategoryPickerState();
}

class _BitescoreCategoryPickerState extends State<BitescoreCategoryPicker> {
  @override
  Widget build(BuildContext context) {
    final selection = widget.selection;
    final errorText = widget.showError ? selection.validate() : null;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: widget.enabled ? _openPicker : null,
          child: InputDecorator(
            decoration: _inputDecoration(
              context,
              'Category',
              errorText: errorText,
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    selection.displayText,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: selection.hasCategory
                          ? BiteRaterTheme.ink
                          : Theme.of(context).hintColor,
                      fontWeight: selection.hasCategory
                          ? FontWeight.w700
                          : FontWeight.w500,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                const Icon(Icons.keyboard_arrow_down_rounded),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Future<void> _openPicker() async {
    final selection = await showModalBottomSheet<BitescoreCategorySelection>(
      context: context,
      useSafeArea: true,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      builder: (context) {
        return _BitescoreCategoryPickerSheet(
          selection: widget.selection,
          enableTopLevelOtherUndo: widget.enableTopLevelOtherUndo,
        );
      },
    );

    if (selection != null) {
      widget.onChanged(selection);
    }
  }

  InputDecoration _inputDecoration(
    BuildContext context,
    String label, {
    String? helperText,
    String? errorText,
  }) {
    return InputDecoration(
      labelText: label,
      helperText: helperText,
      errorText: errorText,
      filled: true,
      fillColor: Colors.white,
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: BiteRaterTheme.lineBlue),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: BiteRaterTheme.grape, width: 1.4),
      ),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
    );
  }
}

class _BitescoreCategoryPickerSheet extends StatefulWidget {
  final BitescoreCategorySelection selection;
  final bool enableTopLevelOtherUndo;

  const _BitescoreCategoryPickerSheet({
    required this.selection,
    required this.enableTopLevelOtherUndo,
  });

  @override
  State<_BitescoreCategoryPickerSheet> createState() =>
      _BitescoreCategoryPickerSheetState();
}

class _BitescoreCategoryPickerSheetState
    extends State<_BitescoreCategoryPickerSheet> {
  late String? _expandedCategoryId;
  late BitescoreCategorySelection _currentSelection;
  late final TextEditingController _otherController;
  bool _showOtherKeywordError = false;
  bool _isMoreCuisinesExpanded = false;

  @override
  void initState() {
    super.initState();
    _currentSelection = widget.selection;
    _otherController = TextEditingController(
      text: widget.selection.isOtherSelection
          ? widget.selection.manualKeywords
          : '',
    );
    final selectedCategory = _currentSelection.category;
    _expandedCategoryId = selectedCategory?.hasSubcategories ?? false
        ? selectedCategory?.id
        : null;
    final selectedId = selectedCategory?.id;
    _isMoreCuisinesExpanded =
        selectedId != null &&
        BitescoreCategories.addDishMoreCuisineCategories.any(
          (category) => category.id == selectedId,
        );
  }

  @override
  void dispose() {
    _otherController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final bottomPadding = MediaQuery.paddingOf(context).bottom;

    return ConstrainedBox(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * 0.82,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 12, 8),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    'Category',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      color: BiteRaterTheme.ink,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                IconButton(
                  tooltip: 'Close',
                  onPressed: () => Navigator.of(context).pop(_currentSelection),
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
          ),
          Flexible(
            child: ListView(
              shrinkWrap: true,
              padding: EdgeInsets.fromLTRB(8, 0, 8, bottomPadding + 16),
              children: [
                if (widget.selection.legacyCategory != null)
                  _buildLegacyTile(context),
                for (final category
                    in BitescoreCategories.addDishCommonCategories)
                  ..._buildCategoryTiles(context, category),
                if (BitescoreCategories.addDishMoreCuisineCategories.isNotEmpty)
                  _buildMoreCuisinesTile(context),
                if (_isMoreCuisinesExpanded)
                  for (final category
                      in BitescoreCategories.addDishMoreCuisineCategories)
                    ..._buildCategoryTiles(context, category),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLegacyTile(BuildContext context) {
    return ListTile(
      title: Text('Legacy: ${_currentSelection.legacyCategory}'),
      subtitle: const Text('Saved on this dish before categories were updated'),
      trailing: const Icon(Icons.check_rounded),
      onTap: () => Navigator.of(context).pop(_currentSelection),
    );
  }

  List<Widget> _buildCategoryTiles(
    BuildContext context,
    BitescoreCategory category,
  ) {
    final isExpanded = _expandedCategoryId == category.id;
    final isSelected = _currentSelection.category?.id == category.id;
    final isTopLevelOther =
        widget.enableTopLevelOtherUndo && category.id == 'other';
    final hasSubcategories =
        category.hasSubcategories &&
        !BitescoreCategories.isFeaturedCategory(category);

    return [
      ListTile(
        leading: isTopLevelOther
            ? Checkbox(
                value: isSelected && _currentSelection.isMainCategoryOther,
                onChanged: (checked) {
                  if (checked == true) {
                    _showOtherEntryFor(
                      BitescoreCategorySelection(
                        category: category,
                        manualKeywords: _currentSelection.manualKeywords,
                      ),
                    );
                  } else {
                    _clearTopLevelOtherSelection();
                  }
                },
              )
            : null,
        title: Text(
          category.displayName,
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        trailing: hasSubcategories
            ? Icon(
                isExpanded
                    ? Icons.keyboard_arrow_up_rounded
                    : Icons.keyboard_arrow_down_rounded,
                color: BiteRaterTheme.mutedInk,
              )
            : !isTopLevelOther && !hasSubcategories && isSelected
            ? const Icon(Icons.check_rounded)
            : null,
        onTap: () {
          if (!hasSubcategories) {
            final selection = BitescoreCategorySelection(
              category: category,
              manualKeywords:
                  category.displayName == BitescoreCategories.otherLabel
                  ? _currentSelection.manualKeywords
                  : '',
            );
            if (selection.isMainCategoryOther) {
              _showOtherEntryFor(selection);
              return;
            }
            Navigator.of(context).pop(selection);
            return;
          }

          setState(() {
            _expandedCategoryId = isExpanded ? null : category.id;
          });
        },
      ),
      if (_isCurrentOther(category: category)) _buildOtherEntry(),
      if (isExpanded)
        for (final subcategory in category.subcategories)
          Padding(
            padding: const EdgeInsets.only(left: 24),
            child: Column(
              children: [
                ListTile(
                  dense: true,
                  title: Text(subcategory),
                  leading: Checkbox(
                    value:
                        isSelected &&
                        _currentSelection.subcategory == subcategory,
                    onChanged: (_) {
                      _selectSubcategory(category, subcategory);
                    },
                  ),
                  onTap: () => _selectSubcategory(category, subcategory),
                ),
                if (_isCurrentOther(
                  category: category,
                  subcategory: subcategory,
                ))
                  _buildOtherEntry(),
              ],
            ),
          ),
    ];
  }

  void _selectSubcategory(BitescoreCategory category, String subcategory) {
    final isCurrentlySelected =
        _currentSelection.category?.id == category.id &&
        _currentSelection.subcategory == subcategory;
    if (isCurrentlySelected) {
      setState(() {
        _currentSelection = BitescoreCategorySelection(category: category);
      });
      return;
    }

    final selection = BitescoreCategorySelection(
      category: category,
      subcategory: subcategory,
      manualKeywords: subcategory == BitescoreCategories.otherLabel
          ? _currentSelection.manualKeywords
          : '',
    );
    if (subcategory == BitescoreCategories.otherLabel) {
      _showOtherEntryFor(selection);
      return;
    }

    Navigator.of(context).pop(selection);
  }

  void _showOtherEntryFor(BitescoreCategorySelection selection) {
    setState(() {
      _currentSelection = selection;
      _otherController.text = selection.manualKeywords;
      _showOtherKeywordError = false;
      _otherController.selection = TextSelection.collapsed(
        offset: _otherController.text.length,
      );
      _expandedCategoryId = selection.category?.hasSubcategories ?? false
          ? selection.category?.id
          : _expandedCategoryId;
    });
  }

  void _clearTopLevelOtherSelection() {
    setState(() {
      _currentSelection = const BitescoreCategorySelection();
      _otherController.clear();
      _showOtherKeywordError = false;
    });
  }

  bool _isCurrentOther({
    required BitescoreCategory category,
    String? subcategory,
  }) {
    if (!_currentSelection.isOtherSelection ||
        _currentSelection.category?.id != category.id) {
      return false;
    }
    return (_currentSelection.subcategory ?? '') == (subcategory ?? '');
  }

  Widget _buildOtherEntry() {
    final isRequired = _currentSelection.isMainCategoryOther;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            controller: _otherController,
            autofocus: true,
            textInputAction: TextInputAction.done,
            onChanged: (value) {
              setState(() {
                _currentSelection = _currentSelection.copyWith(
                  manualKeywords: value,
                );
                if (value.trim().isNotEmpty) {
                  _showOtherKeywordError = false;
                }
              });
            },
            onSubmitted: (_) => _submitOther(),
            decoration: InputDecoration(
              labelText: BitescoreCategories.otherLabel,
              hintText: isRequired ? null : 'Optional',
              helperText: isRequired
                  ? BitescoreCategories.requiredManualKeywordHelperText
                  : BitescoreCategories.manualKeywordHelperText,
              errorText: _showOtherKeywordError
                  ? 'Please enter at least one keyword.'
                  : null,
              filled: true,
              fillColor: Colors.white,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
              ),
            ),
          ),
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton(
              onPressed: _submitOther,
              child: const Text('Use Other'),
            ),
          ),
        ],
      ),
    );
  }

  void _submitOther() {
    if (_currentSelection.isMainCategoryOther &&
        _otherController.text.trim().isEmpty) {
      setState(() {
        _showOtherKeywordError = true;
      });
      return;
    }

    Navigator.of(context).pop(
      _currentSelection.copyWith(manualKeywords: _otherController.text.trim()),
    );
  }

  Widget _buildMoreCuisinesTile(BuildContext context) {
    return ListTile(
      dense: true,
      title: Text(
        'More cuisines',
        style: TextStyle(
          color: BiteRaterTheme.mutedInk,
          fontWeight: FontWeight.w700,
        ),
      ),
      trailing: Icon(
        _isMoreCuisinesExpanded
            ? Icons.keyboard_arrow_up_rounded
            : Icons.keyboard_arrow_down_rounded,
        color: BiteRaterTheme.mutedInk,
      ),
      onTap: () {
        setState(() {
          _isMoreCuisinesExpanded = !_isMoreCuisinesExpanded;
        });
      },
    );
  }
}
