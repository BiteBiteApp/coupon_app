import 'package:flutter/material.dart';
import '../services/customer_bitescore_search_service.dart';

class CustomerBiteScorePageStatus extends StatelessWidget {
  const CustomerBiteScorePageStatus({super.key, required this.controller});
  final CustomerBiteScoreSearchController controller;
  @override
  Widget build(BuildContext context) {
    if (controller.isLoading) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            const LinearProgressIndicator(),
            const SizedBox(height: 8),
            Text(controller.isPreparing ? 'Preparing results…' : 'Loading…'),
          ],
        ),
      );
    }
    if (controller.error != null) {
      return Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          children: [
            const Text('Could not load these results.'),
            TextButton(
              onPressed: controller.loadInitial,
              child: const Text('Try Again'),
            ),
          ],
        ),
      );
    }
    return controller.hasMore
        ? Padding(
            padding: const EdgeInsets.all(8),
            child: OutlinedButton(
              onPressed: controller.loadMore,
              child: const Text('Load more'),
            ),
          )
        : const SizedBox.shrink();
  }
}
