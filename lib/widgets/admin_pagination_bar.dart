import 'package:flutter/material.dart';

import '../models/pagination/paged_models.dart';

class AdminPaginationBar extends StatelessWidget {
  const AdminPaginationBar({
    super.key,
    required this.currentPageNumber,
    required this.visitedPageNumbers,
    required this.pageSize,
    required this.total,
    required this.capabilities,
    required this.loading,
    this.onFirst,
    this.onPrevious,
    this.onVisitedPage,
    this.onNext,
    this.onLast,
  });

  final int currentPageNumber;
  final List<int> visitedPageNumbers;
  final int pageSize;
  final PagedTotal? total;
  final PageCapabilities capabilities;
  final bool loading;
  final VoidCallback? onFirst;
  final VoidCallback? onPrevious;
  final ValueChanged<int>? onVisitedPage;
  final VoidCallback? onNext;
  final VoidCallback? onLast;

  String get _summary {
    final exactValue = total?.exactValue;
    final totalPages = total?.isExact == true
        ? ((exactValue! + pageSize - 1) ~/ pageSize).clamp(1, 9007199254740991)
        : null;
    final count = exactValue == null
        ? 'Total unknown'
        : '$exactValue ${exactValue == 1 ? 'result' : 'results'}';
    final page = totalPages == null
        ? 'Page $currentPageNumber'
        : 'Page $currentPageNumber of $totalPages';
    return '$count • $page • $pageSize per page';
  }

  @override
  Widget build(BuildContext context) {
    final pages = <int>{...visitedPageNumbers, currentPageNumber}.toList()
      ..sort();
    return Semantics(
      container: true,
      label: 'Pagination. $_summary${loading ? '. Loading' : ''}',
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text(
              _summary,
              key: const ValueKey<String>('pagination-summary'),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Wrap(
              alignment: WrapAlignment.center,
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 6,
              runSpacing: 6,
              children: <Widget>[
                if (capabilities.first)
                  _PaginationAction(
                    key: const ValueKey<String>('pagination-first'),
                    semanticLabel: 'First page',
                    label: 'First',
                    onPressed: loading ? null : onFirst,
                  ),
                if (capabilities.previous)
                  _PaginationAction(
                    key: const ValueKey<String>('pagination-previous'),
                    semanticLabel: 'Previous page',
                    label: 'Previous',
                    onPressed: loading ? null : onPrevious,
                  ),
                if (capabilities.numberedVisitedPages)
                  for (final page in pages)
                    _PaginationAction(
                      key: ValueKey<String>('pagination-page-$page'),
                      semanticLabel: page == currentPageNumber
                          ? 'Current page $page'
                          : 'Visited page $page',
                      label: '$page',
                      selected: page == currentPageNumber,
                      onPressed: loading || page == currentPageNumber
                          ? null
                          : onVisitedPage == null
                          ? null
                          : () => onVisitedPage!(page),
                    ),
                if (capabilities.next)
                  _PaginationAction(
                    key: const ValueKey<String>('pagination-next'),
                    semanticLabel: 'Next page',
                    label: 'Next',
                    onPressed: loading ? null : onNext,
                  ),
                if (capabilities.last)
                  _PaginationAction(
                    key: const ValueKey<String>('pagination-last'),
                    semanticLabel: 'Last page',
                    label: 'Last',
                    onPressed: loading ? null : onLast,
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _PaginationAction extends StatelessWidget {
  const _PaginationAction({
    super.key,
    required this.semanticLabel,
    required this.label,
    required this.onPressed,
    this.selected = false,
  });

  final String semanticLabel;
  final String label;
  final VoidCallback? onPressed;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final style = OutlinedButton.styleFrom(
      minimumSize: const Size(48, 48),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
    );
    return Semantics(
      button: true,
      selected: selected,
      enabled: onPressed != null,
      label: semanticLabel,
      child: ExcludeSemantics(
        child: OutlinedButton(
          style: style,
          onPressed: onPressed,
          child: Text(label, textAlign: TextAlign.center),
        ),
      ),
    );
  }
}
