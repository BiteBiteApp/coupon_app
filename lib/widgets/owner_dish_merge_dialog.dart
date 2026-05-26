import 'package:flutter/material.dart';

import '../models/bitescore_dish.dart';
import '../services/app_error_text.dart';
import '../services/bitescore_service.dart';

class OwnerDishMergeDialog extends StatefulWidget {
  final List<BitescoreDish> dishes;

  const OwnerDishMergeDialog({super.key, required this.dishes});

  @override
  State<OwnerDishMergeDialog> createState() => _OwnerDishMergeDialogState();
}

class _OwnerDishMergeDialogState extends State<OwnerDishMergeDialog> {
  String? _sourceDishId;
  String? _targetDishId;
  bool _isSaving = false;

  List<BitescoreDish> get _targetOptions {
    if (_sourceDishId == null) {
      return widget.dishes;
    }
    return widget.dishes.where((dish) => dish.id != _sourceDishId).toList();
  }

  Future<void> _save() async {
    BitescoreDish? sourceDish;
    BitescoreDish? targetDish;
    for (final dish in widget.dishes) {
      if (dish.id == _sourceDishId) {
        sourceDish = dish;
      }
      if (dish.id == _targetDishId) {
        targetDish = dish;
      }
    }
    if (sourceDish == null || targetDish == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Choose both dishes to merge.')),
      );
      return;
    }

    setState(() {
      _isSaving = true;
    });

    try {
      await BiteScoreService.mergeDishesAsOwner(
        sourceDish: sourceDish,
        mergeTargetDish: targetDish,
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
              fallback: 'Could not merge the dishes right now.',
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
    final targetOptions = _targetOptions;
    final canSave =
        !_isSaving && _sourceDishId != null && _targetDishId != null;

    return AlertDialog(
      title: const Text('Merge Dishes'),
      content: SizedBox(
        width: 420,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            DropdownButtonFormField<String>(
              initialValue: _sourceDishId,
              decoration: const InputDecoration(
                labelText: 'Duplicate dish',
                border: OutlineInputBorder(),
              ),
              items: widget.dishes
                  .map(
                    (dish) => DropdownMenuItem<String>(
                      value: dish.id,
                      child: Text(dish.name),
                    ),
                  )
                  .toList(),
              onChanged: _isSaving
                  ? null
                  : (value) {
                      setState(() {
                        _sourceDishId = value;
                        if (_targetDishId == _sourceDishId) {
                          _targetDishId = null;
                        }
                      });
                    },
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _targetDishId,
              decoration: const InputDecoration(
                labelText: 'Keep this dish',
                border: OutlineInputBorder(),
              ),
              items: targetOptions
                  .map(
                    (dish) => DropdownMenuItem<String>(
                      value: dish.id,
                      child: Text(dish.name),
                    ),
                  )
                  .toList(),
              onChanged: _isSaving
                  ? null
                  : (value) {
                      setState(() {
                        _targetDishId = value;
                      });
                    },
            ),
            const SizedBox(height: 12),
            const Text(
              'This keeps one dish visible and marks the duplicate dish unavailable.',
              style: TextStyle(color: Colors.black54),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isSaving ? null : () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: canSave ? _save : null,
          child: Text(_isSaving ? 'Merging...' : 'Merge Dishes'),
        ),
      ],
    );
  }
}
