import 'package:flutter/material.dart';

import '../legal/legal_documents.dart';
import '../widgets/draft_legal_page.dart';

class PrivacyPolicyScreen extends StatelessWidget {
  const PrivacyPolicyScreen({super.key});

  @override
  Widget build(BuildContext context) => DraftLegalPage(
    title: privacyPolicy.title,
    children: legalDocumentWidgets(privacyPolicy),
  );
}
