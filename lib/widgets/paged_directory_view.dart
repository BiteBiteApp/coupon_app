import 'package:flutter/material.dart';

import '../services/paged_query_controller.dart';
import 'admin_pagination_bar.dart';

typedef PagedDirectoryItemBuilder<T> =
    Widget Function(BuildContext context, T item, int index);

class PagedDirectoryView<T> extends StatefulWidget {
  const PagedDirectoryView({
    super.key,
    required this.controller,
    required this.itemBuilder,
    this.emptyBuilder,
    this.loadingBuilder,
    this.errorBuilder,
    this.onRefresh,
    this.padding = EdgeInsets.zero,
  });

  final PagedQueryController<T> controller;
  final PagedDirectoryItemBuilder<T> itemBuilder;
  final WidgetBuilder? emptyBuilder;
  final WidgetBuilder? loadingBuilder;
  final Widget Function(BuildContext context, Object error, VoidCallback retry)?
  errorBuilder;
  final Future<void> Function()? onRefresh;
  final EdgeInsetsGeometry padding;

  @override
  State<PagedDirectoryView<T>> createState() => _PagedDirectoryViewState<T>();
}

class _PagedDirectoryViewState<T> extends State<PagedDirectoryView<T>> {
  final FocusNode _resultsFocusNode = FocusNode(debugLabel: 'Paged results');
  int? _lastPageNumber;

  @override
  void initState() {
    super.initState();
    _lastPageNumber = widget.controller.currentPageNumber;
    widget.controller.addListener(_handleControllerChange);
  }

  @override
  void didUpdateWidget(covariant PagedDirectoryView<T> oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.controller, widget.controller)) {
      oldWidget.controller.removeListener(_handleControllerChange);
      _lastPageNumber = widget.controller.currentPageNumber;
      widget.controller.addListener(_handleControllerChange);
    }
  }

  void _handleControllerChange() {
    if (!mounted) {
      return;
    }
    final currentPage = widget.controller.currentPageNumber;
    final changedPage =
        currentPage != null &&
        _lastPageNumber != null &&
        currentPage != _lastPageNumber;
    _lastPageNumber = currentPage;
    setState(() {});
    if (changedPage) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          _resultsFocusNode.requestFocus();
        }
      });
    }
  }

  @override
  void dispose() {
    widget.controller.removeListener(_handleControllerChange);
    _resultsFocusNode.dispose();
    super.dispose();
  }

  String _semanticStatus() {
    final controller = widget.controller;
    final exact = controller.total?.exactValue;
    final resultText = exact == null
        ? '${controller.items.length} results on this page'
        : '$exact total ${exact == 1 ? 'result' : 'results'}';
    final pageText = controller.currentPageNumber == null
        ? ''
        : ', page ${controller.currentPageNumber}';
    final loadingText = controller.isLoading ? ', loading' : '';
    final errorText = controller.error == null ? '' : ', error';
    return '$resultText$pageText$loadingText$errorText';
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    final page = controller.page;
    final initialLoading = page == null && controller.isLoading;
    final initialError = page == null && controller.error != null;

    if (initialLoading) {
      return Semantics(
        liveRegion: true,
        label: 'Loading results',
        child:
            widget.loadingBuilder?.call(context) ??
            const Center(
              key: ValueKey<String>('paged-directory-loading'),
              child: CircularProgressIndicator(),
            ),
      );
    }

    if (initialError) {
      void retry() {
        controller.retry();
      }

      return Semantics(
        liveRegion: true,
        label: 'Results could not be loaded. Error.',
        child:
            widget.errorBuilder?.call(context, controller.error!, retry) ??
            Center(
              key: const ValueKey<String>('paged-directory-error'),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  const Text('Results could not be loaded.'),
                  const SizedBox(height: 8),
                  ElevatedButton(onPressed: retry, child: const Text('Retry')),
                ],
              ),
            ),
      );
    }

    if (page == null) {
      return const SizedBox.shrink();
    }

    final items = controller.items;
    final content = items.isEmpty
        ? Center(
            key: const ValueKey<String>('paged-directory-empty'),
            child:
                widget.emptyBuilder?.call(context) ??
                const Text('No results found.'),
          )
        : ListView.builder(
            key: ValueKey<String>(
              'paged-directory-page-${controller.currentPageNumber}',
            ),
            padding: widget.padding,
            itemCount: items.length,
            itemBuilder: (context, index) =>
                widget.itemBuilder(context, items[index], index),
          );

    return Semantics(
      container: true,
      liveRegion: true,
      label: _semanticStatus(),
      child: Column(
        children: <Widget>[
          if (controller.isRefreshing)
            const LinearProgressIndicator(
              key: ValueKey<String>('paged-directory-refreshing'),
            ),
          if (controller.error != null)
            MaterialBanner(
              key: const ValueKey<String>('paged-directory-inline-error'),
              content: const Text('The page could not be refreshed.'),
              actions: <Widget>[
                TextButton(
                  onPressed: controller.retry,
                  child: const Text('Retry'),
                ),
              ],
            ),
          if (widget.onRefresh != null)
            Align(
              alignment: Alignment.centerRight,
              child: IconButton(
                key: const ValueKey<String>('paged-directory-refresh'),
                tooltip: 'Refresh results',
                constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
                onPressed: controller.isLoading ? null : widget.onRefresh,
                icon: const Icon(Icons.refresh),
              ),
            ),
          Expanded(
            child: Focus(
              focusNode: _resultsFocusNode,
              child: Semantics(
                container: true,
                label: 'Page ${controller.currentPageNumber ?? 1} results',
                child: content,
              ),
            ),
          ),
          AdminPaginationBar(
            currentPageNumber: controller.currentPageNumber ?? 1,
            visitedPageNumbers: controller.visitedPageNumbers,
            pageSize: page.pageSize,
            total: page.total,
            capabilities: page.capabilities,
            loading: controller.isLoading,
            onFirst: controller.firstPage,
            onPrevious: controller.previousPage,
            onVisitedPage: controller.goToVisitedPage,
            onNext: controller.nextPage,
            onLast: controller.lastPage,
          ),
        ],
      ),
    );
  }
}
