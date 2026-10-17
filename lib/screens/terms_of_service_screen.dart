import 'package:flutter/material.dart';

import '../legal/legal_documents.dart';
import '../widgets/draft_legal_page.dart';

class TermsOfServiceScreen extends StatelessWidget {
  const TermsOfServiceScreen({super.key});

  @override
  Widget build(BuildContext context) => DraftLegalPage(
    title: termsOfService.title,
    metadata: legalMetadata(termsOfService),
    children: legalDocumentWidgets(termsOfService),
  );
}
