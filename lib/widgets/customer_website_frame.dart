import 'package:flutter/material.dart';
import '../services/shared_location_state_service.dart';

/// Keep the existing customer components readable on desktop, with their real
/// available width also reflected in MediaQuery for existing responsive code.
class CustomerWebsiteFrame extends StatelessWidget {
  const CustomerWebsiteFrame({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => ColoredBox(
    color: Theme.of(context).scaffoldBackgroundColor,
    child: Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 1120),
        child: AnimatedBuilder(
          animation: SharedLocationStateService.changes,
          builder: (context, _) => Column(
            children: [
              if (SharedLocationStateService.usesGoogleSearchCenter)
                Container(
                  width: double.infinity,
                  color: Colors.white,
                  padding: const EdgeInsets.fromLTRB(10, 10, 10, 5),
                  child: DefaultTextStyle(
                    style: Theme.of(context).textTheme.bodySmall!,
                    child: Wrap(
                      alignment: WrapAlignment.center,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      spacing: 10,
                      runSpacing: 10,
                      children: [
                        const Text(
                          'Search center provided by',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w400,
                            color: Color(0xFF1F1F1F),
                          ),
                        ),
                        Image.asset(
                          'assets/images/google_maps_attribution.png',
                          height: 16,
                          semanticLabel: 'Google Maps',
                        ),
                      ],
                    ),
                  ),
                ),
              Expanded(
                child: LayoutBuilder(
                  builder: (context, constraints) => MediaQuery(
                    data: MediaQuery.of(context).copyWith(
                      size: Size(constraints.maxWidth, constraints.maxHeight),
                    ),
                    child: child,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}
