import 'package:flutter/material.dart';

import '../legal/legal_documents.dart';
import 'bitesaver_colors.dart';

List<Widget> legalDocumentWidgets(LegalDocument document) => [
  for (final block in document.blocks)
    switch (block.kind) {
      LegalBlockKind.paragraph => LegalParagraph(block.text.single),
      LegalBlockKind.heading => LegalSectionHeading(block.text.single),
      LegalBlockKind.subheading => LegalSectionHeading(
        block.text.single,
        subsection: true,
      ),
      LegalBlockKind.bullets => LegalBulletList(block.text),
      LegalBlockKind.link => LegalParagraph(block.text.join(': ')),
    },
];

/// Shared legal presentation; rendering requires no authentication or services.
/// The historical class name does not imply draft status.
class DraftLegalPage extends StatelessWidget {
  final String title;
  final List<Widget> children;
  final List<String> metadata;

  const DraftLegalPage({
    super.key,
    required this.title,
    required this.children,
    this.metadata = const [legalEffectiveDateLabel],
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: BiteSaverColors.pageBackground,
      appBar: AppBar(),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 680),
              child: DefaultTextStyle.merge(
                style: const TextStyle(
                  fontSize: 16,
                  height: 1.55,
                  color: BiteSaverColors.ink,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Semantics(
                      namesRoute: true,
                      header: true,
                      child: Text(
                        title,
                        style: const TextStyle(
                          fontSize: 28,
                          height: 1.25,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    for (final line in metadata) LegalParagraph(line),
                    ...children,
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class LegalSectionHeading extends StatelessWidget {
  final String text;
  final bool subsection;

  const LegalSectionHeading(this.text, {super.key, this.subsection = false});

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.only(top: subsection ? 8 : 16, bottom: 12),
    child: Semantics(
      header: true,
      child: Text(
        text,
        style: TextStyle(
          fontSize: subsection ? 18 : 22,
          height: 1.35,
          fontWeight: FontWeight.w700,
        ),
      ),
    ),
  );
}

class LegalParagraph extends StatelessWidget {
  final String text;

  const LegalParagraph(this.text, {super.key});

  @override
  Widget build(BuildContext context) =>
      Padding(padding: const EdgeInsets.only(bottom: 16), child: Text(text));
}

class LegalBulletList extends StatelessWidget {
  final List<String> items;

  const LegalBulletList(this.items, {super.key});

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(left: 12, bottom: 8),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final item in items)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Text('• $item'),
          ),
      ],
    ),
  );
}
